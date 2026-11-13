// D-0021: version and build id of each component. The build id is a hash of the component's source
// files, so it only changes when the code changes and is the same on every machine with the same code.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = {
  mcp: ["mcp/src", "mcp/package.json"],
  extension: ["extension/src", "extension/manifest.json", "extension/popup.html", "extension/popup.css", "extension/debug.html", "extension/debug.css"]
};
const OUTPUT = { mcp: "mcp/dist/build-info.json", extension: "extension/dist/build-info.json" };

async function listFiles(relative) {
  const absolute = path.join(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null);
  if (!entries) return [relative];
  const nested = await Promise.all(entries.map(entry => listFiles(path.posix.join(relative, entry.name))));
  return nested.flat();
}

export async function buildInfo(component) {
  const files = (await Promise.all(SOURCES[component].map(listFiles))).flat().sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file}\0`);
    hash.update(await readFile(path.join(root, file)));
    hash.update("\0");
  }
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  return { version, build: hash.digest("hex").slice(0, 12) };
}

export async function writeBuildInfo(component, info) {
  const target = path.join(root, OUTPUT[component]);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(info ?? await buildInfo(component), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const component = process.argv[2];
  if (!SOURCES[component]) throw new Error("Usage: node scripts/build-info.mjs mcp|extension");
  await writeBuildInfo(component);
}
