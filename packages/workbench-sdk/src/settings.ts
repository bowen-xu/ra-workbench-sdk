import type {JSX, ReactNode} from "react";
import type {SystemDocumentGateway} from "@research-assistant/core/agent";

export interface SettingRowProps {
  readonly title: ReactNode;
  readonly description?: string;
  readonly details?: ReactNode;
  readonly children: ReactNode;
}
export interface SettingGroupProps {
  readonly label: string;
  readonly children: ReactNode;
}
export interface DeveloperModeState {
  enabled: boolean;
  setEnabled(value: boolean): void;
}

/** Present existing Core settings layout; these components do not create a
 * separate settings registry or persistence owner. */
export declare function SettingRow(props: SettingRowProps): JSX.Element;
export declare function SettingGroup(props: SettingGroupProps): JSX.Element;
/** Uses the already-mounted Core developer-mode context. */
export declare function useDeveloperMode(): DeveloperModeState;

/** Uses the original Core system-document catalog and text-tab navigation. */
export declare function SystemDocumentDialog(props: {
  readonly id?: string;
  readonly workflow?: "portrait" | "reading";
  readonly onClose: () => void;
  readonly gateway?: SystemDocumentGateway;
}): JSX.Element;
