export const BRAISER_WS_PORT = 17832;

export type ExtensionRequestType =
  | "browser.get_active_tab"
  | "page.extract_readable_text"
  | "browser.observe"
  | "browser.act";

export interface ExtensionRequest {
  id: string;
  type: ExtensionRequestType;
  payload?: unknown;
}

export interface ExtensionResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

export interface ActiveTabInfo {
  title: string;
  url: string;
}

export interface ReadablePage {
  title: string;
  url: string;
  html: string;
  text: string;
}

export interface CleanPage {
  title: string;
  url: string;
  text: string;
}

export interface AgentHtmlSnapshot {
  snapshotId: string;
  format: "agent-html";
  html: string;
  meta: {
    elementCount: number;
    truncated: boolean;
  };
}

export type BrowserActAction =
  | "click"
  | "input-text"
  | "select-option"
  | "toggle"
  | "focus"
  | "scroll-into-view";

export interface BrowserActInput {
  snapshotId: string;
  elementId: string;
  action: BrowserActAction;
  text?: string;
  clearFirst?: boolean;
  value?: string;
  checked?: boolean;
}

export interface BrowserActResult {
  ok: boolean;
  message?: string;
  error?: string;
  shouldObserveAgain: boolean;
}
