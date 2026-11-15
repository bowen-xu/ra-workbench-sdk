export interface ShortcutBinding {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** Format an existing binding using Core's platform notation. A null binding
 * has no label; this does not register or change keyboard shortcuts. */
export declare function formatShortcut(binding: ShortcutBinding | null, mac?: boolean): string;
export declare function isShortcutMac(): boolean;
