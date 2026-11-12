import type { Mode } from "./config.js";

const remoteTools = new Set([
  "braiser.status", "browser.get_active_tab", "browser.list_tabs", "browser.create_tab",
  "browser.open_tab", "browser.close_tab", "browser.switch_tab", "browser.observe",
  "browser.act", "page.extract_readable_text"
]);

// D-0003: file tools and arbitrary JS/CDP are not part of the first remote release.
export function toolAllowed(name: string, mode: Mode): boolean {
  return mode === "local" || remoteTools.has(name);
}
