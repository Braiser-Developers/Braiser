#!/usr/bin/env node
import { localCredentials } from "./auth.js";
import { clientConfig, portNumber } from "./config.js";
import { BraiserDaemon } from "./daemon-server.js";
import { TunnelSupervisor } from "./tunnel-supervisor.js";

const config = clientConfig({ ...process.env, BRAISER_MODE: "local" });
const credentials = await localCredentials(config.stateDir);
const clientPort = portNumber(process.env.BRAISER_DAEMON_PORT ?? "17833", "BRAISER_DAEMON_PORT");
// D-0018: the tunnel forwards the server's loopback port to this daemon's client port.
const tunnel = new TunnelSupervisor(config.stateDir, clientPort);
const daemon = new BraiserDaemon({
  clientPort,
  extensionPort: portNumber(process.env.BRAISER_EXTENSION_PORT ?? "17832", "BRAISER_EXTENSION_PORT"),
  localToken: credentials.local, remoteToken: credentials.remote, tunnel
});
try {
  await daemon.ready;
  console.error(`Braiser daemon: extension 127.0.0.1:${daemon.ports.extension}, authenticated clients 127.0.0.1:${daemon.ports.client}`);
  await tunnel.reload();
} catch (error) {
  console.error(`Cannot start Braiser daemon: ${error instanceof Error ? error.message : String(error)}`);
  await tunnel.stop();
  await daemon.close();
  process.exitCode = 1;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void tunnel.stop().then(() => daemon.close()).then(() => process.exit(0)); });
}
