export const BRAISER_EXTENSION_WS_PORT = 17832;
export const BRAISER_DAEMON_WS_PORT = 17833;
export const BRAISER_WS_PORT = BRAISER_EXTENSION_WS_PORT;

export type ExtensionRequestType =
  | "browser.get_active_tab"
  | "browser.list_tabs"
  | "browser.create_tab"
  | "browser.open_tab"
  | "browser.close_tab"
  | "browser.switch_tab"
  | "browser.download"
  | "page.extract_readable_text"
  | "browser.observe"
  | "browser.act"
  | "debug.inject_js"
  | "debug.cdp_command";

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

export type DaemonRequest =
  | {
      id: string;
      type: "daemon.status";
    }
  | {
      id: string;
      type: "extension.request";
      request: Omit<ExtensionRequest, "id">;
    };

export type DaemonRequestInput =
  | {
      type: "daemon.status";
    }
  | {
      type: "extension.request";
      request: Omit<ExtensionRequest, "id">;
    };

export interface DaemonResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

export interface DaemonStatus {
  daemon: "ok";
  extensionConnected: boolean;
}

export interface ActiveTabInfo {
  tabId: number;
  title: string;
  url: string;
  windowId: number;
  index: number;
  active: boolean;
  focused: boolean;
}

export type BrowserTabInfo = ActiveTabInfo;

export interface BrowserTabList {
  focusedTabId: number;
  tabs: BrowserTabInfo[];
}

export interface BrowserCreateTabInput {
  url?: string;
  active?: boolean;
}

export interface BrowserOpenTabInput {
  tabId?: number;
  url: string;
  active?: boolean;
}

export interface BrowserCloseTabInput {
  tabId?: number;
}

export interface BrowserSwitchTabInput {
  tabId: number;
  activate?: boolean;
}

export interface BrowserDownloadInput {
  url: string;
  filename?: string;
  conflictAction?: "uniquify" | "overwrite" | "prompt";
  saveAs?: boolean;
}

export interface BrowserDownloadResult {
  downloadId: number;
  url: string;
  filename?: string;
  state?: string;
  danger?: string;
  mime?: string;
  totalBytes?: number;
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
    debug?: Record<string, unknown>;
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

export interface DebugInjectJsInput {
  script: string;
}

export interface DebugInjectJsResult {
  ok: boolean;
  result?: unknown;
}

export interface DebugCdpCommandInput {
  method: string;
  params?: Record<string, unknown>;
}

export interface DebugCdpCommandResult {
  ok: boolean;
  result?: unknown;
}
