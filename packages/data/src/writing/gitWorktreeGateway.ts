/** Public domain contract. No platform adapter or UI implementation imports. */


export interface ManuscriptGitWorktree {
  readonly schemaVersion: number;
  readonly id: string;
  readonly manuscriptId: string;
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly revision: string;
  readonly state: "active" | "released" | "recovery_required";
  readonly git?: { readonly path: string; readonly head?: string; readonly branch?: string; readonly bare: boolean; readonly locked: boolean; readonly prunable: boolean };
  readonly status?: { readonly dirty: boolean; readonly stagedCount: number; readonly unstagedCount: number; readonly untrackedCount: number };
}


export interface GitWorktreeGateway {
  list(manuscriptId: string): Promise<readonly ManuscriptGitWorktree[]>;
  create(manuscriptId: string, revision?: string): Promise<ManuscriptGitWorktree>;
  remove(manuscriptId: string, worktreeId: string, discardChanges: boolean): Promise<void>;
}
