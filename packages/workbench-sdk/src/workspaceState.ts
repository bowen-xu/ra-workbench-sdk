import type {Dispatch, SetStateAction} from "react";

/** Presentation state only; documents, authorization and reviews keep their owners. */
export declare function readWorkspaceState<T>(key: string, fallback: T, decode: (value: unknown) => T): T;
export declare function writeWorkspaceState(key: string, value: unknown): void;
export declare function useWorkspaceState<T>(key: string, fallback: T, decode: (value: unknown) => T, enabled?: boolean): readonly [T, Dispatch<SetStateAction<T>>];
export declare function workspaceString(value: unknown): string;
export declare function workspaceStringSet(value: unknown): ReadonlySet<string>;
export declare function workspaceBoolean(value: unknown): boolean;
