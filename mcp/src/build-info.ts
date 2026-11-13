// D-0021: which build of each component is running, and which is the newest on this machine's disk.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildInfo {
  version: string;
  build: string;
}

export interface VersionReport {
  daemon?: BuildInfo;
  /** Reported by the loaded Chrome extension; null when it is too old to report. */
  extension?: BuildInfo | null;
  /** Newest builds on the browser host's disk, read when the status is requested. */
  latest: { mcp?: BuildInfo; extension?: BuildInfo };
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(file: string): BuildInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path.join(root, file), "utf8")) as Partial<BuildInfo>;
    return typeof parsed.version === "string" && typeof parsed.build === "string"
      ? { version: parsed.version, build: parsed.build } : undefined;
  } catch {
    return undefined;
  }
}

/** Build of this process, read once at startup so a later rebuild shows up as a difference. */
export const RUNNING_BUILD: BuildInfo = read("mcp/dist/build-info.json") ?? { version: "unknown", build: "unknown" };

export function latestBuilds(): VersionReport["latest"] {
  return { mcp: read("mcp/dist/build-info.json"), extension: read("extension/dist/build-info.json") };
}

const label = (info?: BuildInfo | null) => info ? `${info.version}+${info.build}` : "unknown";

/** Plain-language advice when a running part is older than the code on disk or than its peer. */
export function versionWarnings(
  report: VersionReport | undefined,
  self: BuildInfo,
  ownDisk: BuildInfo | undefined,
  mode: "local" | "remote",
  extensionConnected: boolean
): string[] {
  if (!report) return ["The running Braiser daemon is too old to report versions; restart it."];
  const warnings: string[] = [];
  const { latest } = report;
  if (extensionConnected && report.extension === null) {
    warnings.push("The loaded Chrome extension is too old to report its version; reload Braiser in chrome://extensions and reopen the Bridge page.");
  } else if (report.extension && latest.extension && report.extension.build !== latest.extension.build) {
    warnings.push(`The loaded Chrome extension (${label(report.extension)}) is older than the build on disk (${label(latest.extension)}); reload Braiser in chrome://extensions and reopen the Bridge page.`);
  }
  if (report.daemon && latest.mcp && report.daemon.build !== latest.mcp.build) {
    warnings.push(`The running daemon (${label(report.daemon)}) is older than the build on disk (${label(latest.mcp)}); restart the daemon.`);
  }
  // In remote mode the MCP's own disk is the agent host's copy, which may itself be out of sync.
  if (ownDisk && self.build !== ownDisk.build) {
    warnings.push(`This MCP process (${label(self)}) is older than the build on its disk (${label(ownDisk)}); restart the agent session.`);
  } else if (mode === "remote" && latest.mcp && self.build !== latest.mcp.build) {
    warnings.push(`Braiser on this host (${label(self)}) differs from the browser host (${label(latest.mcp)}); sync and rebuild this copy.`);
  }
  return warnings;
}
