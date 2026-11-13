#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { clientConfig } from "./config.js";
import { clientToken } from "./auth.js";
import { ensureDaemon } from "./lifecycle.js";
import { ExtensionBridge } from "./websocket.js";
import type { ActiveTabInfo, BrowserTabInfo, BrowserTabList, PageSnapshot, ReadablePage } from "./protocol.js";
import {
  DOWNLOADS_DIR,
  fileStamp,
  hostFromUrl,
  slugify,
  writePreprocessedRuntimeDomHtml,
  writeRuntimeDomMarkdown
} from "./markdown.js";

type CliCommand =
  | { type: "download"; target: DownloadTarget }
  | { type: "tabs" }
  | { type: "switch-tab"; tabId: number };

type DownloadTarget = "dom" | "observe" | "both" | "markdown" | "preprocessed-html";

const config = clientConfig();
const bridge = new ExtensionBridge(config.url, await clientToken(config), config.requestTimeoutMs);

try {
  const command = parseCommand(process.argv.slice(2));
  if (config.mode === "remote" && command.type === "download") throw new Error("File exports are unavailable in remote mode; use MCP observation and reading tools");
  await ensureDaemon(bridge, config);
  await ensureExtensionConnected(bridge);
  await runCommand(command, bridge);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Usage: npm run cli -- dom|observe|both|markdown|preprocessed-html|tabs|switch-tab <tabId>");
  process.exitCode = 1;
} finally {
  bridge.close();
}

function parseCommand(args: string[]): CliCommand {
  const target = args[0] ?? "both";
  if (
    target === "dom" ||
    target === "observe" ||
    target === "both" ||
    target === "markdown" ||
    target === "preprocessed-html"
  ) {
    return { type: "download", target };
  }

  if (target === "md") {
    return { type: "download", target: "markdown" };
  }

  if (target === "debug-html" || target === "katex-html") {
    return { type: "download", target: "preprocessed-html" };
  }

  if (target === "tabs" || target === "list-tabs") {
    return { type: "tabs" };
  }

  if (target === "switch-tab") {
    const tabId = Number(args[1]);
    if (!Number.isInteger(tabId)) {
      throw new Error("switch-tab requires an integer tabId");
    }
    return { type: "switch-tab", tabId };
  }

  throw new Error(`Unsupported CLI target: ${target}`);
}

async function runCommand(command: CliCommand, bridge: ExtensionBridge): Promise<void> {
  if (command.type === "download") {
    const savedFiles = await downloadTarget(command.target, bridge);
    for (const filePath of savedFiles) {
      console.log(filePath);
    }
    return;
  }

  if (command.type === "tabs") {
    const tabs = await bridge.request<BrowserTabList>("browser.list_tabs", undefined, 10000);
    console.log(JSON.stringify(tabs, null, 2));
    return;
  }

  const tab = await bridge.request<BrowserTabInfo>(
    "browser.switch_tab",
    { tabId: command.tabId },
    10000
  );
  console.log(JSON.stringify(tab, null, 2));
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

  if (target === "markdown") {
    savedFiles.push(await downloadMarkdown(bridge));
  }

  if (target === "preprocessed-html") {
    savedFiles.push(await downloadPreprocessedHtml(bridge));
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
    bridge.request<PageSnapshot>("browser.observe", undefined, 30000)
  ]);
  const pageName = hostFromUrl(tab.url) || tab.title || snapshot.snapshotId;
  const fileName = `${fileStamp()}-${slugify(pageName)}-${snapshot.snapshotId}-observed-output.txt`;
  return writeDownload(fileName, snapshot.text);
}

async function downloadMarkdown(bridge: ExtensionBridge): Promise<string> {
  const page = await bridge.request<ReadablePage>("page.extract_readable_text", undefined, 30000);
  return writeRuntimeDomMarkdown(page);
}

async function downloadPreprocessedHtml(bridge: ExtensionBridge): Promise<string> {
  const page = await bridge.request<ReadablePage>("page.extract_readable_text", undefined, 30000);
  return writePreprocessedRuntimeDomHtml(page);
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
