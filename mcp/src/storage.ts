import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { CleanPage } from "./protocol.js";
import { toMarkdown } from "./cleaner.js";

const PAGES_DIR = path.join(homedir(), ".braiser", "pages");

export async function savePage(page: CleanPage): Promise<string> {
  await mkdir(PAGES_DIR, { recursive: true });

  const pageName = hostFromUrl(page.url) || page.title;
  const fileName = `${dateStamp()}-${slugify(pageName)}.md`;
  const filePath = path.join(PAGES_DIR, fileName);

  await writeFile(filePath, toMarkdown(page), "utf8");
  return filePath;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
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
