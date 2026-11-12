#!/usr/bin/env node
import { localCredentials } from "./auth.js";
import { clientConfig, portNumber } from "./config.js";
import { BraiserDaemon } from "./daemon-server.js";

const config = clientConfig({ ...process.env, BRAISER_MODE: "local" });
const credentials = await localCredentials(config.stateDir);
const daemon = new BraiserDaemon({
  clientPort: portNumber(process.env.BRAISER_DAEMON_PORT ?? "17833", "BRAISER_DAEMON_PORT"),
  extensionPort: portNumber(process.env.BRAISER_EXTENSION_PORT ?? "17832", "BRAISER_EXTENSION_PORT"),
  localToken: credentials.local, remoteToken: credentials.remote
});
try {
  await daemon.ready;
  console.error(`Braiser daemon: extension 127.0.0.1:${daemon.ports.extension}, authenticated clients 127.0.0.1:${daemon.ports.client}`);
} catch (error) {
  console.error(`Cannot start Braiser daemon: ${error instanceof Error ? error.message : String(error)}`);
  await daemon.close();
  process.exitCode = 1;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void daemon.close().then(() => process.exit(0)); });
}
