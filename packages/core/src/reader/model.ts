export const READER_VIEW_STATE_SCHEMA_VERSION = 2 as const;
export const SOURCE_SELECTOR_SCHEMA_VERSION = 2 as const;
export const MIN_READER_NUMERIC_SCALE = 0.5;
export const MAX_READER_NUMERIC_SCALE = 3;

export type ReaderScale =
  | { readonly kind: "numeric"; readonly value: number }
  | { readonly kind: "page-fit" | "page-width" | "page-height" | "auto" };

export type ReaderScrollMode = "vertical" | "horizontal" | "wrapped" | "page";
export type ReaderSpreadMode = "none" | "odd" | "even";
export type ReaderHistoryMode = "hard" | "transient" | "skip";

export interface ReaderSourceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ReaderSourceSegment {
  readonly pageIndex: number;
  readonly pageLabel?: string;
  readonly rects: readonly ReaderSourceRect[];
  readonly exactText: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface ReaderSourcePosition {
  readonly anchorId?: string;
  readonly attachmentSha256?: string;
  readonly segments: readonly ReaderSourceSegment[];
}

export interface SourceSelectorV2 extends ReaderSourcePosition {
  readonly schemaVersion: typeof SOURCE_SELECTOR_SCHEMA_VERSION;
  readonly attachmentSha256: string;
}

export type ReaderDestinationPart = string | number | boolean | null | { readonly name: string };

export interface ReaderLocation {
  readonly alignment?: "center";
  readonly pageIndex?: number;
  readonly pageLabel?: string;
  readonly destination?: string | readonly ReaderDestinationPart[];
  readonly position?: ReaderSourcePosition;
  readonly annotationId?: string;
  readonly scale?: ReaderScale;
  readonly top?: number;
  readonly left?: number;
  readonly behavior?: "instant" | "smooth";
  readonly ifNeeded?: boolean;
  readonly visibilityMargin?: number;
  readonly history?: ReaderHistoryMode;
}

export interface ReaderViewStateV2 {
  readonly schemaVersion: typeof READER_VIEW_STATE_SCHEMA_VERSION;
  readonly pageIndex: number;
  readonly scale: ReaderScale;
  readonly top?: number;
  readonly left?: number;
  readonly scrollMode: ReaderScrollMode;
  readonly spreadMode: ReaderSpreadMode;
}

export const READER_UI_SESSION_SCHEMA_VERSION = 1 as const;

export interface ReaderUiSessionState {
  readonly schemaVersion: typeof READER_UI_SESSION_SCHEMA_VERSION;
  readonly navigationSidebar: {
    readonly open: boolean;
    readonly width: number;
    readonly view: "thumbnails" | "outline";
  };
  readonly notesSidebar: {
    readonly open: boolean;
    readonly width: number;
  };
  readonly structuredOverlay: {
    readonly open: boolean;
  };
}

export const DEFAULT_READER_UI_SESSION_STATE: ReaderUiSessionState = {
  schemaVersion: READER_UI_SESSION_SCHEMA_VERSION,
  navigationSidebar: { open: true, width: 190, view: "thumbnails" },
  notesSidebar: { open: true, width: 300 },
  structuredOverlay: { open: false },
};

export function decodeReaderUiSessionState(value: unknown): ReaderUiSessionState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const navigation = input.navigationSidebar;
  const notes = input.notesSidebar;
  const structuredOverlay = input.structuredOverlay;
  if (
    input.schemaVersion !== READER_UI_SESSION_SCHEMA_VERSION
    || typeof navigation !== "object" || navigation === null
    || typeof notes !== "object" || notes === null
  ) return undefined;
  const navigationInput = navigation as Record<string, unknown>;
  const notesInput = notes as Record<string, unknown>;
  const structuredOverlayInput = typeof structuredOverlay === "object" && structuredOverlay !== null
    ? structuredOverlay as Record<string, unknown>
    : undefined;
  const navigationWidth = finiteNumber(navigationInput.width);
  const notesWidth = finiteNumber(notesInput.width);
  if (
    typeof navigationInput.open !== "boolean"
    || (navigationInput.view !== "thumbnails" && navigationInput.view !== "outline")
    || navigationWidth === undefined || navigationWidth < 140 || navigationWidth > 480
    || typeof notesInput.open !== "boolean"
    || notesWidth === undefined || notesWidth < 220 || notesWidth > 640
  ) return undefined;
  return {
    schemaVersion: READER_UI_SESSION_SCHEMA_VERSION,
    navigationSidebar: {
      open: navigationInput.open,
      width: navigationWidth,
      view: navigationInput.view,
    },
    notesSidebar: { open: notesInput.open, width: notesWidth },
    structuredOverlay: {
      open: typeof structuredOverlayInput?.open === "boolean" ? structuredOverlayInput.open : false,
    },
  };
}

export interface LegacyReaderViewState {
  readonly pageIndex: number;
  readonly zoom: number;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 && Number.isInteger(number) ? number : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeReaderScale(value: unknown): ReaderScale | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as { readonly kind?: unknown; readonly value?: unknown };
  if (input.kind === "numeric") {
    const numericValue = finiteNumber(input.value);
    return numericValue !== undefined
      && numericValue >= MIN_READER_NUMERIC_SCALE
      && numericValue <= MAX_READER_NUMERIC_SCALE
      ? { kind: "numeric", value: numericValue }
      : undefined;
  }
  if (
    input.kind === "page-fit"
    || input.kind === "page-width"
    || input.kind === "page-height"
    || input.kind === "auto"
  ) {
    return { kind: input.kind };
  }
  return undefined;
}

function normalizeRect(value: unknown): ReaderSourceRect | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const x = finiteNumber(input.x);
  const y = finiteNumber(input.y);
  const width = finiteNumber(input.width);
  const height = finiteNumber(input.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function normalizeSegment(value: unknown): ReaderSourceSegment | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const pageIndex = nonNegativeInteger(input.pageIndex);
  if (pageIndex === undefined || !Array.isArray(input.rects) || typeof input.exactText !== "string") {
    return undefined;
  }
  const rects = input.rects.map(normalizeRect);
  if (rects.some((rect) => rect === undefined)) return undefined;
  const pageLabel = nonEmptyString(input.pageLabel);
  const prefix = typeof input.prefix === "string" ? input.prefix : undefined;
  const suffix = typeof input.suffix === "string" ? input.suffix : undefined;
  return {
    pageIndex,
    ...(pageLabel === undefined ? {} : { pageLabel }),
    rects: rects as readonly ReaderSourceRect[],
    exactText: input.exactText,
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  };
}
export function normalizeReaderSourcePosition(value: unknown): ReaderSourcePosition | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 2) {
    return undefined;
  }
  const segments = input.segments.map(normalizeSegment);
  if (segments.some((segment) => segment === undefined)) return undefined;
  const normalizedSegments = segments as readonly ReaderSourceSegment[];
  if (
    normalizedSegments.length === 2
    && Math.abs(normalizedSegments[0]!.pageIndex - normalizedSegments[1]!.pageIndex) !== 1
  ) {
    return undefined;
  }
  const anchorId = nonEmptyString(input.anchorId);
  const attachmentSha256 = nonEmptyString(input.attachmentSha256);
  return {
    ...(anchorId === undefined ? {} : { anchorId }),
    ...(attachmentSha256 === undefined ? {} : { attachmentSha256 }),
    segments: normalizedSegments,
  };
}

export function decodeSourceSelectorV2(value: unknown): SourceSelectorV2 | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== SOURCE_SELECTOR_SCHEMA_VERSION) return undefined;
  const position = normalizeReaderSourcePosition(input);
  return position === undefined || position.attachmentSha256 === undefined
    ? undefined
    : { schemaVersion: SOURCE_SELECTOR_SCHEMA_VERSION, ...position, attachmentSha256: position.attachmentSha256 };
}

export function normalizeReaderLocation(value: unknown): ReaderLocation | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const pageIndex = nonNegativeInteger(input.pageIndex);
  const pageLabel = nonEmptyString(input.pageLabel);
  const annotationId = nonEmptyString(input.annotationId);
  const position = input.position === undefined ? undefined : normalizeReaderSourcePosition(input.position);
  const destination = typeof input.destination === "string" || Array.isArray(input.destination)
    ? input.destination as string | readonly ReaderDestinationPart[]
    : undefined;
  if (
    pageIndex === undefined
    && pageLabel === undefined
    && annotationId === undefined
    && position === undefined
    && destination === undefined
  ) {
    return undefined;
  }
  const scale = input.scale === undefined ? undefined : normalizeReaderScale(input.scale);
  if (input.scale !== undefined && scale === undefined) return undefined;
  const top = input.top === undefined ? undefined : finiteNumber(input.top);
  const left = input.left === undefined ? undefined : finiteNumber(input.left);
  const visibilityMargin = input.visibilityMargin === undefined
    ? undefined
    : finiteNumber(input.visibilityMargin);
  if (
    (input.top !== undefined && top === undefined)
    || (input.left !== undefined && left === undefined)
    || (input.visibilityMargin !== undefined && (visibilityMargin === undefined || visibilityMargin < 0))
  ) {
    return undefined;
  }
  const behavior = input.behavior === "smooth" || input.behavior === "instant"
    ? input.behavior
    : undefined;
  const history = input.history === "hard" || input.history === "transient" || input.history === "skip"
    ? input.history
    : undefined;
  return {
    ...(pageIndex === undefined ? {} : { pageIndex }),
    ...(input.alignment === "center" ? { alignment: "center" as const } : {}),
    ...(pageLabel === undefined ? {} : { pageLabel }),
    ...(destination === undefined ? {} : { destination }),
    ...(position === undefined ? {} : { position }),
    ...(annotationId === undefined ? {} : { annotationId }),
    ...(scale === undefined ? {} : { scale }),
    ...(top === undefined ? {} : { top }),
    ...(left === undefined ? {} : { left }),
    ...(behavior === undefined ? {} : { behavior }),
    ...(typeof input.ifNeeded === "boolean" ? { ifNeeded: input.ifNeeded } : {}),
    ...(visibilityMargin === undefined ? {} : { visibilityMargin }),
    ...(history === undefined ? {} : { history }),
  };
}

export function decodeReaderViewStateV2(value: unknown): ReaderViewStateV2 | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== READER_VIEW_STATE_SCHEMA_VERSION) return undefined;
  const pageIndex = nonNegativeInteger(input.pageIndex);
  const scale = normalizeReaderScale(input.scale);
  const top = input.top === undefined ? undefined : finiteNumber(input.top);
  const left = input.left === undefined ? undefined : finiteNumber(input.left);
  const scrollMode = input.scrollMode;
  const spreadMode = input.spreadMode;
  if (
    pageIndex === undefined
    || scale === undefined
    || (input.top !== undefined && top === undefined)
    || (input.left !== undefined && left === undefined)
    || (scrollMode !== "vertical" && scrollMode !== "horizontal" && scrollMode !== "wrapped" && scrollMode !== "page")
    || (spreadMode !== "none" && spreadMode !== "odd" && spreadMode !== "even")
  ) {
    return undefined;
  }
  return {
    schemaVersion: READER_VIEW_STATE_SCHEMA_VERSION,
    pageIndex,
    scale,
    ...(top === undefined ? {} : { top }),
    ...(left === undefined ? {} : { left }),
    scrollMode,
    spreadMode,
  };
}

export function upgradeLegacyReaderViewState(value: LegacyReaderViewState): ReaderViewStateV2 {
  const pageIndex = nonNegativeInteger(value.pageIndex) ?? 0;
  const zoom = finiteNumber(value.zoom);
  // PDF.js updateviewarea historically persisted numeric zoom as a percentage
  // (for example 197.75 for 197.75%), while older fixtures used a scale ratio.
  const legacyScale = zoom === undefined || zoom <= 0
    ? undefined
    : zoom > MAX_READER_NUMERIC_SCALE ? zoom / 100 : zoom;
  return {
    schemaVersion: READER_VIEW_STATE_SCHEMA_VERSION,
    pageIndex,
    scale: legacyScale === undefined
      ? { kind: "page-fit" }
      : { kind: "numeric", value: Math.max(
          MIN_READER_NUMERIC_SCALE,
          Math.min(MAX_READER_NUMERIC_SCALE, legacyScale),
        ) },
    scrollMode: "vertical",
    spreadMode: "none",
  };
}
