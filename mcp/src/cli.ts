#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExtensionBridge } from "./websocket.js";
import type { ActiveTabInfo, AgentHtmlSnapshot, ReadablePage } from "./protocol.js";

type DownloadTarget = "dom" | "observe" | "both" | "markdown" | "preprocessed-html";

interface ProcessResult {
  code: number | null;
  stderr: string;
  notFound: boolean;
}

const PROJECT_ROOT = projectRoot();
const DOWNLOADS_DIR = path.resolve(PROJECT_ROOT, "downloads");
const MARKDOWN_VENV_DIR = path.join(PROJECT_ROOT, ".venv-markdown");

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
  console.error("Usage: npm run cli -- dom|observe|both|markdown|preprocessed-html");
  process.exitCode = 1;
} finally {
  bridge.close();
}

function parseTarget(args: string[]): DownloadTarget {
  const target = args[0] ?? "both";
  if (
    target === "dom" ||
    target === "observe" ||
    target === "both" ||
    target === "markdown" ||
    target === "preprocessed-html"
  ) {
    return target;
  }

  if (target === "md") {
    return "markdown";
  }

  if (target === "debug-html" || target === "katex-html") {
    return "preprocessed-html";
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
    bridge.request<AgentHtmlSnapshot>("browser.observe", undefined, 30000)
  ]);
  const pageName = hostFromUrl(tab.url) || tab.title || snapshot.snapshotId;
  const fileName = `${fileStamp()}-${slugify(pageName)}-${snapshot.snapshotId}-observed-output.html`;
  return writeDownload(fileName, snapshot.html);
}

async function downloadMarkdown(bridge: ExtensionBridge): Promise<string> {
  const page = await bridge.request<ReadablePage>("page.extract_readable_text", undefined, 30000);
  const stamp = fileStamp();
  const pageName = slugify(hostFromUrl(page.url) || page.title);
  const tempHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}.markitdown-input.html`);
  const preprocessedHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}.markitdown-preprocessed.html`);
  const markdownPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}-runtime-dom.md`);

  await mkdir(DOWNLOADS_DIR, { recursive: true });
  await writeFile(tempHtmlPath, page.html, "utf8");

  try {
    await preprocessHtmlForMarkdown(tempHtmlPath, preprocessedHtmlPath);
    await convertHtmlToMarkdown(preprocessedHtmlPath, markdownPath);
  } finally {
    await Promise.all([
      rm(tempHtmlPath, { force: true }),
      rm(preprocessedHtmlPath, { force: true })
    ]);
  }

  return markdownPath;
}

async function downloadPreprocessedHtml(bridge: ExtensionBridge): Promise<string> {
  const page = await bridge.request<ReadablePage>("page.extract_readable_text", undefined, 30000);
  const stamp = fileStamp();
  const pageName = slugify(hostFromUrl(page.url) || page.title);
  const tempHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}.markitdown-input.html`);
  const preprocessedHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}-runtime-dom-preprocessed.html`);

  await mkdir(DOWNLOADS_DIR, { recursive: true });
  await writeFile(tempHtmlPath, page.html, "utf8");

  try {
    await preprocessHtmlForMarkdown(tempHtmlPath, preprocessedHtmlPath);
  } finally {
    await rm(tempHtmlPath, { force: true });
  }

  return preprocessedHtmlPath;
}

async function writeDownload(fileName: string, content: string): Promise<string> {
  await mkdir(DOWNLOADS_DIR, { recursive: true });
  const filePath = path.join(DOWNLOADS_DIR, fileName);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

async function convertHtmlToMarkdown(inputPath: string, outputPath: string): Promise<void> {
  const scriptPath = path.join(PROJECT_ROOT, "scripts", "markitdown-braiser.py");
  const attempts = markdownPythonAttempts([
    scriptPath,
    inputPath,
    outputPath
  ]);
  const errors: string[] = [];

  for (const attempt of attempts) {
    const result = await runProcess(attempt.command, attempt.args);
    if (result.code === 0) {
      return;
    }

    if (!result.notFound) {
      errors.push(`${attempt.command}: ${result.stderr || `exit code ${result.code}`}`);
    }
  }

  const details = errors.length ? `\n${errors.join("\n")}` : "";
  throw new Error(
    `Braiser Markdown conversion is not available. Run "npm run setup:markdown" and try again.${details}`
  );
}

async function preprocessHtmlForMarkdown(inputPath: string, outputPath: string): Promise<void> {
  const scriptPath = path.join(PROJECT_ROOT, "scripts", "preprocess-markdown-html.py");
  const attempts = markdownPythonAttempts([
    scriptPath,
    inputPath,
    outputPath
  ]);
  const errors: string[] = [];

  for (const attempt of attempts) {
    const result = await runProcess(attempt.command, attempt.args);
    if (result.code === 0) {
      return;
    }

    if (!result.notFound) {
      errors.push(`${attempt.command}: ${result.stderr || `exit code ${result.code}`}`);
    }
  }

  const details = errors.length ? `\n${errors.join("\n")}` : "";
  throw new Error(
    `Unable to preprocess HTML for Markdown. Run "npm run setup:markdown" and try again.${details}`
  );
}

function markdownPythonAttempts(args: string[]): Array<{ command: string; args: string[] }> {
  const pythonPath = process.platform === "win32"
    ? path.join(MARKDOWN_VENV_DIR, "Scripts", "python.exe")
    : path.join(MARKDOWN_VENV_DIR, "bin", "python");
  const attempts: Array<{ command: string; args: string[] }> = [];

  if (existsSync(pythonPath)) {
    attempts.push({ command: pythonPath, args });
  }

  attempts.push(
    { command: "py", args: ["-3", ...args] },
    { command: "python", args },
    { command: "python3", args }
  );

  return attempts;
}

function runProcess(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: ProcessResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    const child = spawn(command, args, {
      windowsHide: true
    });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      settle({
        code: null,
        stderr: error.message,
        notFound: error.code === "ENOENT"
      });
    });

    child.on("close", (code) => {
      settle({
        code,
        stderr: stderr.trim(),
        notFound: false
      });
    });
  });
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
