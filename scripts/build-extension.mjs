// Bundles the extension (D-0015). tsc only type-checks; esbuild writes extension/dist.
// The content script must be a classic script for chrome.scripting.executeScript, so it is an IIFE.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "extension/src");
const outdir = path.join(root, "extension/dist");
const common = { bundle: true, target: "chrome120", logLevel: "warning", legalComments: "inline" };

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(src, "content.ts")],
    outfile: path.join(outdir, "content.js"),
    format: "iife",
    banner: { js: "/* Includes code from Playwright, Copyright (c) Microsoft Corporation, Apache-2.0. See src/vendor/playwright/LICENSE. */" }
  }),
  build({
    ...common,
    entryPoints: ["background", "popup", "debug"].map((name) => path.join(src, `${name}.ts`)),
    outdir,
    format: "esm"
  })
]);
