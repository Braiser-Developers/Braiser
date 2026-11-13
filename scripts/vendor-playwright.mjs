// Copies Playwright's aria snapshot code into extension/src/vendor/playwright (D-0013).
// Files are kept verbatim except for import paths: Playwright's "@isomorphic/*" alias
// becomes a relative path so tsc and esbuild need no extra configuration.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "v1.65.0";
const FILES = [
  "packages/injected/src/ariaSnapshot.ts",
  "packages/injected/src/ariaSnapshotDistiller.ts",
  "packages/injected/src/domUtils.ts",
  "packages/injected/src/roleUtils.ts",
  "packages/isomorphic/ariaSnapshot.ts",
  "packages/isomorphic/ariaSnapshotRenderer.ts",
  "packages/isomorphic/cssTokenizer.ts",
  "packages/isomorphic/stringUtils.ts",
  "packages/isomorphic/yaml.ts"
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "extension/src/vendor/playwright");

async function fetchText(file) {
  const response = await fetch(`https://raw.githubusercontent.com/microsoft/playwright/${TAG}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

for (const file of FILES) {
  const local = file.replace("packages/injected/src/", "injected/").replace("packages/isomorphic/", "isomorphic/");
  const fromInjected = local.startsWith("injected/");
  const source = (await fetchText(file)).replace(/from '@isomorphic\/([^']+)'/g,
    (_match, name) => `from '${fromInjected ? "../isomorphic" : "."}/${name}'`);
  await mkdir(path.dirname(path.join(target, local)), { recursive: true });
  await writeFile(path.join(target, local), source);
  console.log(`${file} -> ${local}`);
}
for (const file of ["LICENSE", "NOTICE"]) {
  await writeFile(path.join(target, file), await fetchText(file));
}
await writeFile(path.join(target, "VERSION"), `${TAG}\n`);
