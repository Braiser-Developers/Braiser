#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtensionBridge } from "./websocket.js";
import type { ActiveTabInfo, AgentHtmlSnapshot, ReadablePage } from "./protocol.js";

type DownloadTarget = "dom" | "observe" | "both";

const DOWNLOADS_DIR = path.resolve(projectRoot(), "downloads");

const bridge = new ExtensionBridge();

try {
  const target = parseTarget(process.argv.slice(2));
  await ensureDaemon(bridge);
  await ensureExtensionConnected(bridge);
  const savedFiles = await downloadTarget(target, bridge);

  for (const filePath of savedFiles) {
    console.log(filePath);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Usage: npm run cli -- dom|observe|both");
  process.exitCode = 1;
} finally {
  bridge.close();
}

function parseTarget(args: string[]): DownloadTarget {
  const target = args[0] ?? "both";
  if (target === "dom" || target === "observe" || target === "both") {
    return target;
  }

  throw new Error(`Unsupported download target: ${target}`);
}

async function downloadTarget(
  target: DownloadTarget,
  bridge: ExtensionBridge
): Promise<string[]> {
  const savedFiles: string[] = [];

  if (target === "dom" || target === "both") {
    savedFiles.push(await downloadRuntimeDom(bridge));
  }

  if (target === "observe" || target === "both") {
    savedFiles.push(await downloadObservedOutput(bridge));
  }

  return savedFiles;
}

async function downloadRuntimeDom(bridge: ExtensionBridge): Promise<string> {
  const page = await bridge.request<ReadablePage>("page.extract_readable_text", undefined, 30000);
  const fileName = `${fileStamp()}-${slugify(hostFromUrl(page.url) || page.title)}-runtime-dom.html`;
  return writeDownload(fileName, page.html);
}

async function downloadObservedOutput(bridge: ExtensionBridge): Promise<string> {
  const [tab, snapshot] = await Promise.all([
    bridge.request<ActiveTabInfo>("browser.get_active_tab", undefined, 10000),
    bridge.request<AgentHtmlSnapshot>("browser.observe", undefined, 30000)
  ]);
  const pageName = hostFromUrl(tab.url) || tab.title || snapshot.snapshotId;
  const fileName = `${fileStamp()}-${slugify(pageName)}-${snapshot.snapshotId}-observed-output.html`;
  return writeDownload(fileName, snapshot.html);
}

async function writeDownload(fileName: string, content: string): Promise<string> {
  await mkdir(DOWNLOADS_DIR, { recursive: true });
  const filePath = path.join(DOWNLOADS_DIR, fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function ensureExtensionConnected(bridge: ExtensionBridge): Promise<void> {
  if (!(await bridge.isExtensionConnected())) {
    throw new Error("Chrome extension is not connected to braiser-daemon");
  }
}

async function ensureDaemon(bridge: ExtensionBridge): Promise<void> {
  if (await bridge.isDaemonConnected()) {
    return;
  }

  const daemonPath = fileURLToPath(new URL("./daemon.js", import.meta.url));
  const child = spawn(process.execPath, [daemonPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(150);
    if (await bridge.isDaemonConnected()) {
      return;
    }
  }

  throw new Error("braiser-daemon is not available");
}

function projectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
