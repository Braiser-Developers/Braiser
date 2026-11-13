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
  | "browser.upload"
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
      type: "daemon.status" | "daemon.tunnel_reload";
    }
  | {
      id: string;
      type: "extension.request";
      request: Omit<ExtensionRequest, "id">;
      timeoutMs?: number;
    };

export type DaemonRequestInput =
  | {
      type: "daemon.status" | "daemon.tunnel_reload";
    }
  | {
      type: "extension.request";
      request: Omit<ExtensionRequest, "id">;
      timeoutMs?: number;
    };

export interface DaemonResponse<T = unknown> {
  id: string;
  ok: boolean;
  result?: T;
  error?: string;
}

export interface DaemonStatus {
  daemon: "ok";
  protocolVersion: 2;
  clientMode: "local" | "remote";
  extensionConnected: boolean;
  /** Only reported to local clients (D-0018). */
  tunnel?: import("./tunnel-supervisor.js").TunnelStatus;
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

export interface BrowserUploadInput {
  snapshotId: string;
  elementId: string;
  files: string[];
}

export interface BrowserUploadFile {
  name: string;
  size: number;
}

export interface BrowserUploadResult {
  ok: boolean;
  status?: "files_selected";
  fileCount?: number;
  targetUrl?: string;
  files?: BrowserUploadFile[];
  error?: string;
  message?: string;
  shouldObserveAgain: boolean;
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

export interface PageSnapshot {
  snapshotId: string;
  format: "braiser-aria";
  text: string;
  meta: {
    elementCount: number;
    frameCount: number;
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

// D-0014: only success and coarse changes, no page text.
export interface BrowserActChanges {
  navigated?: true;
  url?: string;
  title?: string;
  newTabs?: Array<{ tabId: number; url: string }>;
  downloads?: string[];
  added?: string[];
  removed?: string[];
  addedCount?: number;
  removedCount?: number;
}

export interface BrowserActResult {
  ok: boolean;
  error?: string;
  message?: string;
  snapshotValid: boolean;
  changes?: BrowserActChanges;
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
