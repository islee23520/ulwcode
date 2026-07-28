export type CursorStyle = "block" | "underline" | "bar";

export interface TerminalConfig {
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly cursorBlink: boolean;
  readonly cursorStyle: CursorStyle;
  readonly scrollback: number;
}

export type WebviewMessage =
  | { readonly type: "ready"; readonly cols: number; readonly rows: number }
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | { readonly type: "copy"; readonly text: string };

export type HostMessage =
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exit"; readonly code: number; readonly signal?: number }
  | ({ readonly type: "config" } & TerminalConfig)
  | { readonly type: "focus" };
