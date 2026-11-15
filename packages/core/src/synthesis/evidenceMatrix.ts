export interface EvidenceMatrixDimension {
  readonly id: string;
  readonly label: string;
}

export interface EvidenceMatrix {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly paperIds: readonly string[];
  readonly dimensions: readonly EvidenceMatrixDimension[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvidenceMatrixDraft {
  readonly id?: string;
  readonly projectId: string;
  readonly title: string;
  readonly paperIds: readonly string[];
  readonly dimensions: readonly EvidenceMatrixDimension[];
  readonly expectedRevision?: number;
  readonly changeReason: string;
}

export interface EvidenceMatrixStatement {
  readonly id: string;
  readonly text: string;
  readonly epistemicRole:
    | "source_paraphrase"
    | "synthesis"
    | "inference"
    | "hypothesis";
  readonly evidenceAnchorIds: readonly string[];
}

export interface EvidenceMatrixCell {
  readonly id: string;
  readonly matrixId: string;
  readonly paperId: string;
  readonly dimensionId: string;
  readonly coverageState: "unreviewed" | "not_found" | "populated";
  readonly coverageNote: string;
  readonly statements: readonly EvidenceMatrixStatement[];
  readonly provenanceKind: "human_original" | "ai_accepted_unchanged" | "ai_accepted_after_edit";
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvidenceMatrixCellDraft {
  readonly matrixId: string;
  readonly paperId: string;
  readonly dimensionId: string;
  readonly coverageState: "unreviewed" | "not_found" | "populated";
  readonly coverageNote: string;
  readonly statements: readonly EvidenceMatrixStatement[];
  readonly expectedRevision?: number;
  readonly changeReason: string;
}
