import type { NoteBlockId, NoteLinkId, NotePageId } from "./entities";

export type NoteLinkTargetKind = "note_page" | "reading_note" | "paper" | "claim" | "manuscript";
export type NoteLinkRelation = "reference" | "mention" | "derived_from";

export interface NoteLinkTarget {
  readonly kind: NoteLinkTargetKind;
  readonly id: string;
  readonly labelSnapshot: string;
  readonly quoteSnapshot?: string;
}

export interface NoteLink {
  readonly id: NoteLinkId;
  readonly sourcePageId: NotePageId;
  readonly sourceBlockId?: NoteBlockId;
  readonly target: NoteLinkTarget;
  readonly relation: NoteLinkRelation;
  readonly isBroken: boolean;
  readonly createdAt: string;
}

export interface NoteLinkDraft {
  readonly sourcePageId: NotePageId;
  readonly sourceBlockId?: NoteBlockId;
  readonly target: NoteLinkTarget;
  readonly relation: NoteLinkRelation;
}

