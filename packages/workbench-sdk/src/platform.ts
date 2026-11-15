/** Core selects the actual file picker or preview adapter. No raw native I/O. */
export declare function chooseAppFile(input: HTMLInputElement | null, receive: (file: File) => void, kind: "markdown" | "asset"): void;
/** Requires core.platform.confirmation v1. Resolves only after the real Core
 * dialog; cancellation is false and dialog failures reject before any writes. */
export declare function confirm(message: string): Promise<boolean>;

/** Pure options for the existing Core-selected open dialog. */
export interface OpenDialogFilter {
  name: string;
  extensions: string[];
}
export interface OpenDialogOptions {
  title?: string;
  filters?: OpenDialogFilter[];
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  recursive?: boolean;
  canCreateDirectories?: boolean;
  pickerMode?: "document" | "media" | "image" | "video";
  fileAccessMode?: "copy" | "scoped";
}
export type OpenDialogReturn<T extends OpenDialogOptions> = T["directory"] extends true
  ? T["multiple"] extends true ? string[] | null : string | null
  : T["multiple"] extends true ? string[] | null : string | null;
/** Preserves the original dialog's conditional return type and cancellation. */
export declare function open<T extends OpenDialogOptions>(options?: T): Promise<OpenDialogReturn<T>>;
export declare function downloadDir(): Promise<string>;
export declare function join(...paths: string[]): Promise<string>;
