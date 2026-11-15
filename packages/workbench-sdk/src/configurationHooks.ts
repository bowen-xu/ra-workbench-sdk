import type {Dispatch, SetStateAction} from "react";
import type {ConfigurationSetting} from "./configuration.js";

/** Uses the Core-selected configuration owner. Disabled embedded surfaces retain
 * their existing local presentation state without reading/writing its settings. */
export declare function usePluginSetting<T>(setting: ConfigurationSetting<T>, options?: {
  readonly resourceId?: string;
  readonly enabled?: boolean;
}): readonly [T, Dispatch<SetStateAction<T>>];
