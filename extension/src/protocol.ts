export const BRAISER_WS_URL = "ws://127.0.0.1:17832";

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

export type PopupRequest =
  | { type: "popup.get_status" }
  | { type: "popup.get_active_tab" }
  | { type: "popup.get_runtime_dom" }
  | { type: "popup.get_observed_output" };

export interface BridgeRuntimeRequest {
  type: "bridge.handle_extension_request";
  request: ExtensionRequest;
}

export interface PopupStatus {
  extensionConnected: boolean;
  connectionState: "connected" | "connecting" | "offline";
  websocketUrl: string;
}
