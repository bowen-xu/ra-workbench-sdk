import type {ManuscriptVersionGateway} from "@research-assistant/data/writing";
export type {
  ManuscriptVersionCommit, ManuscriptVersionHistory, ManuscriptVersionGateway,
  GitRestoreScope, ManuscriptGitRestoreProposal, GitRepositoryView, ManuscriptGitBranches,
  ManuscriptVersionDiff, HistoricalVersionFile,
} from "@research-assistant/data/writing";

/** The existing manuscript-scoped gateway retains native Git execution. */
export declare function getManuscriptVersionGateway(): ManuscriptVersionGateway;
