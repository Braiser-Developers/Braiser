// D-0021: the root package.json is the only place the version is edited; copy it to the other two.
// Runs from `npm version` (see the "version" script) and can be run by hand.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
for (const file of ["mcp/package.json", "extension/manifest.json"]) {
  const target = path.join(root, file);
  const text = await readFile(target, "utf8");
  if (JSON.parse(text).version === version) continue;
  // Replace only the value so the file's own formatting stays as it is.
  await writeFile(target, text.replace(/("version"\s*:\s*)"[^"]*"/, `$1${JSON.stringify(version)}`));
  console.log(`${file}: ${version}`);
}
