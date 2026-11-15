export interface WritingWorkspaceChangeStats {
  readonly additions: number;
  readonly deletions: number;
}

/** Uses Core's existing line comparison for the two captured text versions. */
export declare function countWritingChangedLines(before: string, after: string): WritingWorkspaceChangeStats;
