export type DerivedResearchViewKind =
  | "taxonomy"
  | "historical_context"
  | "gap_hypothesis"
  | "innovation_hypothesis";

export interface DerivedViewInputRef {
  readonly objectKind: "matrix_cell";
  readonly objectId: string;
  readonly objectRevision: number;
  readonly selectionReason: string;
}

export interface DerivedViewItem {
  readonly id: string;
  readonly text: string;
  readonly epistemicRole: "synthesis" | "inference" | "hypothesis";
  readonly evidenceAnchorIds: readonly string[];
  readonly hasConflict: boolean;
}

export interface DerivedResearchView {
  readonly id: string;
  readonly projectId: string;
  readonly viewKind: DerivedResearchViewKind;
  readonly title: string;
  readonly scopeNote: string;
  readonly inputs: readonly DerivedViewInputRef[];
  readonly items: readonly DerivedViewItem[];
  readonly reviewState: "unreviewed" | "accepted" | "rejected" | "deferred";
  readonly provenanceKind: "human_original" | "ai_suggestion" | "ai_accepted_after_edit";
  readonly providerId?: string;
  readonly modelId?: string;
  readonly generatedAt: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DerivedResearchViewDraft {
  readonly id?: string;
  readonly projectId: string;
  readonly viewKind: DerivedResearchViewKind;
  readonly title: string;
  readonly scopeNote: string;
  readonly inputs: readonly DerivedViewInputRef[];
  readonly items: readonly DerivedViewItem[];
  readonly reviewState: "unreviewed" | "accepted" | "rejected" | "deferred";
  readonly expectedRevision?: number;
  readonly changeReason: string;
}
