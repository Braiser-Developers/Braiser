#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = path.join(rootDir, ".venv-markdown");
const requirementsPath = path.join(rootDir, "requirements-markdown.txt");

const python = await findPython();
if (!python) {
  console.error("Python was not found. Install Python 3 and rerun npm run setup:markdown.");
  process.exit(1);
}

if (!existsSync(venvPythonPath())) {
  await run(python.command, [...python.args, "-m", "venv", venvDir]);
}

await run(venvPythonPath(), [
  "-m",
  "pip",
  "install",
  "--upgrade",
  "pip"
]);
await run(venvPythonPath(), [
  "-m",
  "pip",
  "install",
  "-r",
  requirementsPath
]);

console.log(`Markdown venv ready: ${venvDir}`);

async function findPython() {
  const candidates = [
    { command: process.env.PYTHON, args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
    { command: "python3", args: [] }
  ].filter((candidate) => candidate.command);

  for (const candidate of candidates) {
    const result = await run(candidate.command, [...candidate.args, "--version"], {
      allowFailure: true
    });
    if (result === 0) {
      return candidate;
    }
  }

  return null;
}

function venvPythonPath() {
  return process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: "inherit",
      windowsHide: true
    });

    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve(1);
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0 || options.allowFailure) {
        resolve(code ?? 1);
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}
