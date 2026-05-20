import type { CleanPage, ReadablePage } from "./protocol.js";

export function cleanReadablePage(page: ReadablePage): CleanPage {
  return {
    title: normalizeWhitespace(page.title),
    url: page.url,
    text: normalizeText(page.text)
  };
}

export function toMarkdown(page: CleanPage): string {
  const title = page.title || page.url || "Untitled page";

  return [
    `# ${title}`,
    "",
    `Source: ${page.url}`,
    "",
    page.text
  ].join("\n");
}

function normalizeText(text: string): string {
  return text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
