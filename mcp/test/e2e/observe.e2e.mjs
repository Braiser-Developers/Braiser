// End-to-end check of observe/act in a real Chromium with the built extension (D-0015).
// Not part of `npm test`: run `npm run test:e2e` after `npx playwright-core install chromium`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { BraiserDaemon } from '../../dist/daemon-server.js';
import { ExtensionBridge } from '../../dist/websocket.js';

const localToken = 'L'.repeat(43), remoteToken = 'R'.repeat(43);
const longText = 'This paragraph is deliberately long so that the old 120 character limit would cut it. '.repeat(4) + 'It ends with ANSWER-42 and a';

const pages = {
  '/form.html': `<!doctype html><html><head><title>Form test</title></head><body>
    <h1>Create API token</h1>
    <p>${longText} <a href="/docs">documentation link</a> right here.</p>
    <form>
      <label for="name">Token name</label><input id="name" value="initial">
      <label><input id="agree" type="checkbox"> Read access</label>
      <label for="ttl">Expiration</label>
      <select id="ttl"><option value="7">7 days</option><option value="30">30 days</option></select>
      <textarea aria-label="Note">original note</textarea>
      <input type="file" id="upload" style="display:none">
      <button type="button" id="open">Open dialog</button>
    </form>
    <div id="dialog" role="dialog" aria-label="Confirm" hidden><button>Confirm</button><button>Cancel</button></div>
    <my-card></my-card>
    <iframe src="/frame.html" title="Embedded" width="300" height="120"></iframe>
    <a href="/next.html">Go next</a>
    <script>
      document.getElementById('name').value = 'changed by script';
      document.getElementById('agree').checked = true;
      document.getElementById('ttl').value = '30';
      document.querySelector('textarea').value = 'edited note';
      document.getElementById('open').onclick = () => { document.getElementById('dialog').hidden = false; };
      customElements.define('my-card', class extends HTMLElement {
        constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow text SHADOW-42</p><button>Shadow button</button>'; }
      });
    </script>
  </body></html>`,
  '/frame.html': `<!doctype html><html><body><p>Frame text FRAME-42</p>
    <button onclick="this.textContent='Frame clicked'">Frame button</button></body></html>`,
  '/next.html': '<!doctype html><html><head><title>Next page</title></head><body><h1>Next</h1></body></html>',
  '/docs': '<!doctype html><html><body>docs</body></html>'
};

async function setup(t) {
  const server = createServer((request, response) => {
    const body = pages[new URL(request.url, 'http://x').pathname];
    response.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    response.end(body ?? '');
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const daemon = new BraiserDaemon({ extensionPort: 0, clientPort: 0, localToken, remoteToken });
  await daemon.ready;
  t.after(() => daemon.close());

  // The extension hard-codes the bridge port; test against a copy pointed at this daemon.
  const dir = await mkdtemp(path.join(tmpdir(), 'braiser-e2e-'));
  const extension = path.join(dir, 'extension');
  await cp(path.resolve('extension'), extension, { recursive: true, filter: source => !source.includes(`${path.sep}src`) && !source.includes(`${path.sep}test`) });
  for (const file of ['dist/debug.js', 'dist/background.js', 'manifest.json']) {
    const target = path.join(extension, file);
    await writeFile(target, (await readFile(target, 'utf8')).replaceAll('127.0.0.1:17832', `127.0.0.1:${daemon.ports.extension}`));
  }

  const context = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  // Chrome keeps writing to its profile until it exits, so remove the directory afterwards.
  t.after(async () => { await context.close(); await rm(dir, { recursive: true, force: true }); });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const bridgePage = await context.newPage();
  await bridgePage.goto(`chrome-extension://${new URL(worker.url()).host}/debug.html`);

  const bridge = new ExtensionBridge(`ws://127.0.0.1:${daemon.ports.client}`, localToken, 60000);
  t.after(() => bridge.close());
  for (let i = 0; i < 50 && !(await bridge.status()).extensionConnected; i++) await new Promise(r => setTimeout(r, 100));
  return { bridge, origin };
}

async function openAndObserve(bridge, url, expected) {
  await bridge.request('browser.create_tab', { url, active: true });
  let last;
  for (let i = 0; i < 50; i++) {
    try {
      const snapshot = await bridge.request('browser.observe');
      if (snapshot.text.includes(expected)) return snapshot;
      last = snapshot.text;
    } catch (error) {
      last = String(error);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`page never showed ${expected}; last result:\n${last}`);
}

const idOf = (text, pattern) => {
  const match = text.match(pattern);
  assert.ok(match, `no element matching ${pattern} in:\n${text}`);
  return match[1];
};

test('observe shows current form state, shadow DOM, iframes and full text; act reports coarse changes', async t => {
  const { bridge, origin } = await setup(t);
  let snapshot = await openAndObserve(bridge, `${origin}/form.html`, 'FRAME-42');
  let text = snapshot.text;
  t.diagnostic(`\n${text}`);

  assert.match(text, /textbox "Token name" \[E\d+\]: changed by script/);
  assert.match(text, /checkbox "Read access" \[checked\] \[E\d+\]/);
  assert.match(text, /option "30 days" \[selected\]/);
  assert.match(text, /textbox "Note" \[E\d+\]: edited note/);
  assert.ok(text.includes('ANSWER-42'), 'long paragraph is not truncated');
  assert.match(text, /\[documentation link\]\(E\d+ \/docs\)/);
  assert.ok(text.includes('SHADOW-42'));
  assert.match(text, /button "Shadow button" \[E\d+\]/);
  assert.match(text, /iframe "Embedded":\n(?:\s+- generic:\n)?\s+- paragraph: Frame text FRAME-42/);
  assert.match(text, /button "Frame button" \[F\d+E\d+\]/);
  assert.match(text, /hidden file inputs:\n\s+- file input \[E\d+\]/);
  assert.equal(snapshot.meta.frameCount, 2);

  const act = (elementId, action, extra = {}) => bridge.request('browser.act', { snapshotId: snapshot.snapshotId, elementId, action, ...extra });

  const opened = await act(idOf(text, /button "Open dialog" \[(E\d+)\]/), 'click');
  assert.equal(opened.ok, true);
  assert.equal(opened.snapshotValid, true);
  assert.equal(opened.changes.navigated, undefined);
  assert.deepEqual(opened.changes.added.sort(), ['button "Cancel"', 'button "Confirm"']);
  t.diagnostic(`click result: ${JSON.stringify(opened)}`);

  const typed = await act(idOf(text, /textbox "Token name" \[(E\d+)\]/), 'input-text', { text: 'my token' });
  assert.equal(typed.ok, true);
  assert.deepEqual(typed.changes, {}, 'typing changes no actionable element');
  const selected = await act(idOf(text, /combobox "Expiration" \[(E\d+)\]/), 'select-option', { value: '7 days' });
  assert.equal(selected.ok, true);
  const frameClick = await act(idOf(text, /button "Frame button" \[(F\d+E\d+)\]/), 'click');
  assert.equal(frameClick.ok, true);
  assert.deepEqual(frameClick.changes.added, ['button "Frame clicked"']);

  snapshot = await bridge.request('browser.observe');
  text = snapshot.text;
  assert.match(text, /textbox "Token name"(?: \[active\])? \[E\d+\]: my token/);
  assert.match(text, /option "7 days" \[selected\]/);
  assert.match(text, /dialog "Confirm":/);

  const upload = await bridge.request('browser.upload', {
    snapshotId: snapshot.snapshotId, elementId: idOf(text, /file input \[(E\d+)\]/), files: [path.resolve('package.json')]
  });
  assert.equal(upload.ok, true, JSON.stringify(upload));

  const next = await bridge.request('browser.act', { snapshotId: snapshot.snapshotId, elementId: idOf(text, /link "Go next" \[(E\d+)\]/), action: 'click' });
  t.diagnostic(`navigation result: ${JSON.stringify(next)}`);
  assert.equal(next.ok, true);
  assert.equal(next.changes.navigated, true);
  assert.equal(next.changes.url, `${origin}/next.html`);
  assert.equal(next.changes.title, 'Next page');
  assert.equal(next.snapshotValid, false);
  assert.equal(next.changes.removed, undefined, 'a new document is reported as navigation, not as removed elements');
  const stale = await bridge.request('browser.act', { snapshotId: snapshot.snapshotId, elementId: 'E1', action: 'click' });
  assert.equal(stale.ok, false);
});
