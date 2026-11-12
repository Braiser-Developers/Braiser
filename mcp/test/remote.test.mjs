import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BraiserDaemon } from '../dist/daemon-server.js';
import { ExtensionBridge } from '../dist/websocket.js';
import { clientConfig } from '../dist/config.js';
import { localCredentials } from '../dist/auth.js';
import { ensureDaemon } from '../dist/lifecycle.js';
import { toolsForMode, callTool } from '../dist/tools.js';
import { parseRemoteArgs, SshTunnel } from '../dist/ssh-tunnel.js';

const localToken = 'L'.repeat(43), remoteToken = 'R'.repeat(43);
async function fixture(t) {
  const daemon = new BraiserDaemon({ extensionPort: 0, clientPort: 0, localToken, remoteToken });
  await daemon.ready;
  t.after(() => daemon.close());
  const url = `ws://127.0.0.1:${daemon.ports.client}`;
  const local = new ExtensionBridge(url, localToken);
  const remote = new ExtensionBridge(url, remoteToken);
  t.after(() => { local.close(); remote.close(); });
  const connectExtension = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.ports.extension}`);
    await once(ws, 'open');
    t.after(() => ws.terminate());
    return ws;
  };
  return { daemon, url, local, remote, connectExtension };
}

function respond(ws, request, result) { ws.send(JSON.stringify({ id: request.id, ok: true, result })); }

test('configuration fails closed and remote never invokes local lifecycle', async () => {
  const config = clientConfig({ BRAISER_MODE: 'remote', BRAISER_TOKEN: remoteToken });
  assert.equal(config.url, 'ws://127.0.0.1:27833/');
  await ensureDaemon({ status() { throw new Error('must not probe or spawn'); } }, config);
  assert.throws(() => clientConfig({ BRAISER_MODE: 'remote' }), /requires/);
  assert.throws(() => clientConfig({ BRAISER_DAEMON_URL: 'ws://0.0.0.0:17833' }), /127.0.0.1/);
  assert.throws(() => clientConfig({ BRAISER_REQUEST_TIMEOUT_MS: 'NaN' }), /TIMEOUT/);
  assert.throws(() => parseRemoteArgs(['remote', 'start', '--ssh', '-oProxyCommand=x']), /requires/);
  assert.throws(() => parseRemoteArgs(['remote', 'start', '--ssh', 'host', '--remote-port', '0']), /65535/);
  assert.deepEqual(parseRemoteArgs(['remote', 'start', '--ssh', 'user@host']), { destination: 'user@host', remotePort: 27833, sshPort: undefined });
});

test('credentials are distinct, private and stable', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'braiser-auth-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const credentials = await localCredentials(dir);
  assert.notEqual(credentials.local, credentials.remote);
  assert.deepEqual(await localCredentials(dir), credentials);
  assert.equal((await stat(path.join(dir, 'remote-token'))).mode & 0o777, 0o600);
});

test('authentication rejects missing/wrong tokens; status diagnoses extension state', async t => {
  const f = await fixture(t);
  for (const token of ['', 'wrong']) {
    const bridge = new ExtensionBridge(f.url, token);
    await assert.rejects(bridge.status(), /HTTP 401/);
    bridge.close();
  }
  assert.deepEqual(await f.remote.status(), { daemon: 'ok', protocolVersion: 2, clientMode: 'remote', extensionConnected: false });
  await f.connectExtension();
  assert.equal((await f.local.status()).extensionConnected, true);
  await assert.rejects(ensureDaemon(f.remote, clientConfig({})), /local-token/);
});

test('remote boundaries are enforced by both MCP and daemon, local tools still work', async t => {
  const f = await fixture(t);
  const extension = await f.connectExtension();
  const seen = [];
  extension.on('message', bytes => {
    const request = JSON.parse(bytes.toString()); seen.push(request.type);
    respond(extension, request, { result: request.type });
  });
  const remoteNames = toolsForMode('remote').map(tool => tool.name);
  for (const name of ['browser.upload', 'browser.download', 'page.save_current_page', 'debug.inject_js', 'debug.cdp_command']) {
    assert.equal(remoteNames.includes(name), false);
    await assert.rejects(callTool(name, f.remote, {}, 'remote'), /unavailable/);
    if (name !== 'page.save_current_page') await assert.rejects(f.remote.request(name, {}), /unavailable/);
  }
  assert.deepEqual(seen, []);
  for (const name of ['browser.observe', 'browser.act', 'browser.list_tabs', 'page.extract_readable_text']) {
    assert.deepEqual(await f.remote.request(name, {}), { result: name });
  }
  await f.local.request('debug.inject_js', { script: '1' });
  assert.equal(seen.at(-1), 'debug.inject_js');
});

test('timeout does not replay actions; request ids route concurrent clients correctly', async t => {
  const f = await fixture(t);
  const extension = await f.connectExtension();
  let actions = 0;
  extension.on('message', bytes => {
    const request = JSON.parse(bytes.toString());
    if (request.type === 'browser.act') { actions++; return; }
    setTimeout(() => respond(extension, request, request.payload), request.payload?.delay ?? 0);
  });
  const started = Date.now();
  await assert.rejects(f.remote.request('browser.act', {}, 30), /outcome is unknown/);
  assert.ok(Date.now() - started < 800, 'daemon must honor the caller deadline before the client fallback expires');
  assert.deepEqual(await Promise.all([
    f.remote.request('browser.observe', { caller: 'remote', delay: 20 }),
    f.local.request('browser.observe', { caller: 'local', delay: 1 })
  ]), [{ caller: 'remote', delay: 20 }, { caller: 'local', delay: 1 }]);
  assert.equal(actions, 1);
});

test('extension replacement cancels old requests and accepts new snapshots', async t => {
  const f = await fixture(t);
  const old = await f.connectExtension();
  const pending = f.remote.request('browser.act', {});
  const rejected = assert.rejects(pending, /replaced.*outcome is unknown/);
  await once(old, 'message');
  const replacement = await f.connectExtension();
  replacement.on('message', bytes => respond(replacement, JSON.parse(bytes.toString()), 'new snapshot'));
  await rejected;
  assert.equal(await f.remote.request('browser.observe'), 'new snapshot');
});

test('malformed messages cannot crash daemon; extension disconnect reports uncertain outcome', async t => {
  const f = await fixture(t);
  const raw = new WebSocket(f.url, { headers: { Authorization: `Bearer ${remoteToken}` } });
  await once(raw, 'open'); t.after(() => raw.terminate());
  const answer = once(raw, 'message'); raw.send('not JSON');
  assert.equal(JSON.parse((await answer)[0].toString()).ok, false);
  const extension = await f.connectExtension();
  const pending = assert.rejects(f.remote.request('browser.act', {}), /outcome is unknown/);
  await once(extension, 'message'); extension.send('not JSON');
  await pending;
  assert.equal((await f.remote.status()).extensionConnected, false);
});

test('reconnecting after daemon loss never replays an in-flight action', async t => {
  const f = await fixture(t);
  const ports = f.daemon.ports;
  const extension = await f.connectExtension();
  const action = assert.rejects(f.remote.request('browser.act', {}), /outcome is unknown/);
  await once(extension, 'message');
  await f.daemon.close();
  await action;
  const replacement = new BraiserDaemon({ extensionPort: ports.extension, clientPort: ports.client, localToken, remoteToken });
  await replacement.ready;
  t.after(() => replacement.close());
  const newExtension = new WebSocket(`ws://127.0.0.1:${ports.extension}`);
  await once(newExtension, 'open'); t.after(() => newExtension.terminate());
  const seen = [];
  newExtension.on('message', bytes => {
    const request = JSON.parse(bytes.toString()); seen.push(request.type); respond(newExtension, request, 'reconnected');
  });
  assert.equal(await f.remote.request('browser.observe'), 'reconnected');
  assert.deepEqual(seen, ['browser.observe']);
});

test('real MCP stdio lists restricted tools, relays observation and reports offline tunnel', async t => {
  const f = await fixture(t);
  const extension = await f.connectExtension();
  extension.on('message', bytes => respond(extension, JSON.parse(bytes.toString()), { snapshotId: 'S1', html: '<page />' }));
  const dir = await mkdtemp(path.join(tmpdir(), 'braiser-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = new Client({ name: 'test', version: '1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.resolve('mcp/dist/server.js')],
    env: { PATH: process.env.PATH, BRAISER_MODE: 'remote', BRAISER_DAEMON_URL: f.url, BRAISER_TOKEN: remoteToken, BRAISER_STATE_DIR: path.join(dir, 'unused') }, stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.some(tool => tool.name === 'browser.upload'), false);
  const result = await client.callTool({ name: 'browser.observe', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).snapshotId, 'S1');
  await assert.rejects(client.callTool({ name: 'debug.inject_js', arguments: { script: '1' } }), /unavailable/);
  await f.daemon.close();
  const status = await client.callTool({ name: 'braiser.status', arguments: {} });
  assert.equal(JSON.parse(status.content[0].text).daemonConnected, false);
  await assert.rejects(stat(path.join(dir, 'unused')), { code: 'ENOENT' });
});

test('SSH launcher confirms forwarding, reports bind failure and cleans up only its master', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'braiser-ssh-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls.jsonl');
  const fake = `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.BRAISER_TEST_LOG, JSON.stringify(args)+'\\n');
const control = args[args.indexOf('-S')+1];
const operation = args[args.indexOf('-O')+1];
if (args.includes('-O')) {
 if (!fs.existsSync(control)) process.exit(1);
 if (operation === 'forward' && process.env.BRAISER_TEST_FORWARD_FAIL === '1') process.exit(1);
 process.exit(0);
}
fs.writeFileSync(control, 'master');
process.on('SIGTERM', () => { fs.rmSync(control, {force:true}); process.exit(0); });
setInterval(() => {}, 1000);
`;
  await writeFile(path.join(dir, 'ssh'), fake, { mode: 0o755 });
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}:${oldPath}`;
  process.env.BRAISER_TEST_LOG = log;
  t.after(() => { process.env.PATH = oldPath; delete process.env.BRAISER_TEST_LOG; delete process.env.BRAISER_TEST_FORWARD_FAIL; });
  const controller = new AbortController();
  const tunnel = new SshTunnel({ destination: 'test-host', remotePort: 27833 }, 17833);
  try { await tunnel.start(controller.signal); } finally { await tunnel.stop(controller.signal); }
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  const master = calls.find(args => args.includes('-M'));
  assert.ok(master.includes('ClearAllForwardings=yes'));
  const forward = calls.find(args => args.includes('forward'));
  assert.ok(forward.includes('127.0.0.1:27833:127.0.0.1:17833'));
  await assert.rejects(stat(master[master.indexOf('-S') + 1]), { code: 'ENOENT' });
  process.env.BRAISER_TEST_FORWARD_FAIL = '1';
  const failed = new SshTunnel({ destination: 'test-host', remotePort: 27833 }, 17833);
  try { await assert.rejects(failed.start(controller.signal), /forwarding failed/); } finally { await failed.stop(controller.signal); }
  delete process.env.BRAISER_TEST_FORWARD_FAIL;
  const aborted = new AbortController();
  const interrupted = new SshTunnel({ destination: 'test-host', remotePort: 27833 }, 17833);
  try {
    await interrupted.start(aborted.signal);
    aborted.abort();
    assert.equal(await interrupted.wait(), 0);
  } finally { await interrupted.stop(aborted.signal); }
});
