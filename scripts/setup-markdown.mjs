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
  console.error("Python 3.10 or newer was not found. Install it and rerun npm install.");
  process.exit(1);
}

const projectPython = venvPythonPath();

if (!existsSync(projectPython)) {
  await run(python.command, [...python.args, "-m", "venv", venvDir]);
}

await run(projectPython, [
  "-m",
  "pip",
  "install",
  "--disable-pip-version-check",
  "-r",
  requirementsPath
]);

await run(projectPython, [
  "-c",
  "import bs4, markitdown"
]);

console.log(`Markdown venv ready: ${venvDir}`);

async function findPython() {
  const candidates = [
    { command: process.env.PYTHON, args: [] },
    { command: "python3.13", args: [] },
    { command: "python3.12", args: [] },
    { command: "python3.11", args: [] },
    { command: "python3.10", args: [] },
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
    { command: "python3", args: [] }
  ].filter((candidate) => candidate.command);

  for (const candidate of candidates) {
    const result = await run(candidate.command, [
      ...candidate.args,
      "-c",
      "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
    ], {
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
