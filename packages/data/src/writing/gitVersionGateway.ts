/** Public domain contract. No platform adapter or UI implementation imports. */


export interface ManuscriptVersionCommit {
  readonly sha: string;
  readonly timestampUnixSeconds: number;
  readonly subject: string;
}


export interface ManuscriptVersionHistory {
  readonly schemaVersion: number;
  readonly manuscriptId: string;
  readonly commits: readonly ManuscriptVersionCommit[];
}


export interface ManuscriptVersionGateway {
  initialize(manuscriptId: string): Promise<GitRepositoryView>;
  listBranches(manuscriptId: string): Promise<ManuscriptGitBranches>;
  createBranch(manuscriptId: string, branch: string): Promise<ManuscriptGitBranches>;
  deleteBranch(manuscriptId: string, branch: string): Promise<ManuscriptGitBranches>;
  diffVersions(manuscriptId: string, fromRevision: string, toRevision: string): Promise<ManuscriptVersionDiff>;
  list(manuscriptId: string, limit?: number): Promise<ManuscriptVersionHistory>;
  create(manuscriptId: string, message: string): Promise<ManuscriptVersionCommit>;
  readFile(manuscriptId: string, revision: string, relativePath: string): Promise<HistoricalVersionFile>;
  restoreVersion(scope: GitRestoreScope, revision: string): Promise<ManuscriptGitRestoreProposal>;
  latestRestoreScope(conversationId: string, manuscriptId: string): Promise<GitRestoreScope | null>;
}


export interface GitRestoreScope {
  readonly conversationId: string;
  readonly requestId: string;
  readonly manuscriptId: string;
  readonly contextSnapshotId: string;
}


export interface ManuscriptGitRestoreProposal {
  readonly schemaVersion: number;
  readonly manuscriptId: string;
  readonly revision: string;
  readonly proposalId: string;
  readonly changeCount: number;
}


export interface GitRepositoryView {
  readonly schemaVersion: number;
  readonly manuscriptId: string;
  readonly root: string;
  readonly branch?: string;
  readonly head?: string;
}


export interface ManuscriptGitBranches {
  readonly schemaVersion: number;
  readonly manuscriptId: string;
  readonly current?: string;
  readonly branches: readonly string[];
}


export interface ManuscriptVersionDiff {
  readonly schemaVersion: number;
  readonly manuscriptId: string;
  readonly fromRevision: string;
  readonly toRevision: string;
  readonly kind: "text" | "binary";
  readonly content?: string;
  readonly byteSize: number;
}


export interface HistoricalVersionFile {
  readonly schemaVersion: number;
  readonly manuscriptId: string;
  readonly revision: string;
  readonly relativePath: string;
  readonly kind: "text" | "binary";
  readonly content?: string;
  readonly byteSize: number;
}
