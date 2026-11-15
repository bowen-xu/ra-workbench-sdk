import type {GitWorktreeGateway} from "@research-assistant/data/writing";
export type {GitWorktreeGateway, ManuscriptGitWorktree} from "@research-assistant/data/writing";

/** The existing Core gateway owns worktree execution and runtime routing. */
export declare function getGitWorktreeGateway(): GitWorktreeGateway;
