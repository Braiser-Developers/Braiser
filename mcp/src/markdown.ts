import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReadablePage } from "./protocol.js";

interface ProcessResult {
  code: number | null;
  stderr: string;
  notFound: boolean;
}

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DOWNLOADS_DIR = path.resolve(PROJECT_ROOT, "downloads");
const MARKDOWN_VENV_DIR = path.join(PROJECT_ROOT, ".venv-markdown");

export async function readablePageToMarkdown(page: ReadablePage): Promise<string> {
  const paths = markdownTempPaths(page);

  await mkdir(DOWNLOADS_DIR, { recursive: true });
  await writeFile(paths.inputHtmlPath, page.html, "utf8");

  try {
    await preprocessHtmlForMarkdown(paths.inputHtmlPath, paths.preprocessedHtmlPath);
    await convertHtmlToMarkdown(paths.preprocessedHtmlPath, paths.markdownPath);
    return readFile(paths.markdownPath, "utf8");
  } finally {
    await Promise.all([
      rm(paths.inputHtmlPath, { force: true }),
      rm(paths.preprocessedHtmlPath, { force: true }),
      rm(paths.markdownPath, { force: true })
    ]);
  }
}

export async function writeRuntimeDomMarkdown(page: ReadablePage): Promise<string> {
  const stamp = fileStamp();
  const pageName = slugify(hostFromUrl(page.url) || page.title);
  const inputHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}.markitdown-input.html`);
  const preprocessedHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}.markitdown-preprocessed.html`);
  const markdownPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}-runtime-dom.md`);

  await mkdir(DOWNLOADS_DIR, { recursive: true });
  await writeFile(inputHtmlPath, page.html, "utf8");

  try {
    await preprocessHtmlForMarkdown(inputHtmlPath, preprocessedHtmlPath);
    await convertHtmlToMarkdown(preprocessedHtmlPath, markdownPath);
  } finally {
    await Promise.all([
      rm(inputHtmlPath, { force: true }),
      rm(preprocessedHtmlPath, { force: true })
    ]);
  }

  return markdownPath;
}

export async function writePreprocessedRuntimeDomHtml(page: ReadablePage): Promise<string> {
  const stamp = fileStamp();
  const pageName = slugify(hostFromUrl(page.url) || page.title);
  const inputHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}.markitdown-input.html`);
  const preprocessedHtmlPath = path.join(DOWNLOADS_DIR, `${stamp}-${pageName}-runtime-dom-preprocessed.html`);

  await mkdir(DOWNLOADS_DIR, { recursive: true });
  await writeFile(inputHtmlPath, page.html, "utf8");

  try {
    await preprocessHtmlForMarkdown(inputHtmlPath, preprocessedHtmlPath);
  } finally {
    await rm(inputHtmlPath, { force: true });
  }

  return preprocessedHtmlPath;
}

export function fileStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
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

function markdownTempPaths(page: ReadablePage): {
  inputHtmlPath: string;
  preprocessedHtmlPath: string;
  markdownPath: string;
} {
  const stamp = fileStamp();
  const pageName = slugify(hostFromUrl(page.url) || page.title);
  const random = Math.random().toString(36).slice(2);
  const prefix = `${stamp}-${pageName}-${random}.markitdown`;

  return {
    inputHtmlPath: path.join(DOWNLOADS_DIR, `${prefix}-input.html`),
    preprocessedHtmlPath: path.join(DOWNLOADS_DIR, `${prefix}-preprocessed.html`),
    markdownPath: path.join(DOWNLOADS_DIR, `${prefix}.md`)
  };
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
