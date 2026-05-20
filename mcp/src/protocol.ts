export const BRAISER_WS_PORT = 17832;

export type ExtensionRequestType =
  | "browser.get_active_tab"
  | "page.extract_readable_text";

export interface ExtensionRequest {
  id: string;
  type: ExtensionRequestType;
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
