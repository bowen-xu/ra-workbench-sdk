import type { ManuscriptPath } from "./manuscriptPath";

export type LatexEngine = "pdflatex" | "xelatex" | "lualatex";
export interface CompileOptions {
  readonly draft: boolean;
  readonly stopOnFirstError: boolean;
  readonly fromScratch?: boolean;
}
export type CompileRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timedOut"
  | "interrupted";
export type DiagnosticSeverity = "error" | "warning" | "info";

export interface LatexTool {
  readonly name: string;
  readonly available: boolean;
  readonly path?: string;
  readonly version?: string;
}

export interface LatexToolchainInfo {
  readonly available: boolean;
  readonly tools: readonly LatexTool[];
  readonly supportedEngines: readonly LatexEngine[];
  readonly checkedAt: string;
}

export interface CompileDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly file?: ManuscriptPath;
  readonly line?: number;
  readonly column?: number;
}

export interface CompileArtifact {
  readonly kind: "pdf" | "log" | "synctex";
  readonly byteSize: number;
  readonly contentHash?: string;
}

export interface CompileRun {
  readonly id: string;
  readonly manuscriptId: string;
  readonly engine: LatexEngine;
  readonly status: CompileRunStatus;
  readonly diagnostics: readonly CompileDiagnostic[];
  readonly artifacts: readonly CompileArtifact[];
  readonly rawOutput: string;
  readonly exitCode?: number;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface SynctexPdfLocation {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SynctexSourceLocation {
  readonly relativePath: string;
  readonly line: number;
  readonly column?: number;
}
