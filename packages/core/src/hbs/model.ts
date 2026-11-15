import { mergeText, renderMerge, scopeReviewConflicts, textChanges, type ConflictChoice, type MergePart } from "./merge";
import { positionMap, type HbsTextPolicy, type TextDiff } from "./textDiff";

export interface Paragraph { readonly id: string; readonly label: string; readonly text: string }
export interface ModelSnapshot { readonly version: number; readonly baseline: readonly Paragraph[]; readonly saved: readonly Paragraph[] }
export interface ModelDraft {
  readonly id: string;
  readonly kind: "body" | "candidate";
  readonly base: string;
  /** Actual synchronization frontier, independent of the retained review origin. */
  readonly syncBase?: string;
  readonly baseline: string;
  /** Unsaved baseline projection maintained by the editor's transaction mapping.
   * Ordinary edits are included; edits inside pending new are excluded. */
  readonly editedBaseline?: string;
  readonly value: string;
}
export interface PlannedParagraph { readonly id: string; readonly label: string; readonly kind: ModelDraft["kind"]; readonly baseline: string; readonly parts: readonly MergePart[]; readonly incoming?: string }
export interface SavePlan { readonly version: number; readonly paragraphs: readonly PlannedParagraph[] }
export interface SynchronizationPlan {
  readonly diff: TextDiff;
  readonly policy: HbsTextPolicy;
  readonly snapshot: ModelSnapshot;
  readonly review: SavePlan;
  readonly baselineParts: readonly MergePart[];
  readonly originBaseline: string;
  readonly ordinaryConflicts: readonly MergePart[];
}
export interface SynchronizationResult { readonly observed: ModelSnapshot; readonly draft: ModelDraft | undefined }
export interface ParagraphUpdate { readonly id: string; readonly saved: string; readonly baseline: string }

function mergeValue(base:string,local:string,incoming:string,calculate:TextDiff):string {
  return renderMerge(mergeText(base,local,incoming,calculate),"candidate","","local").saved;
}
function incomingValue(input:ModelDraft,saved:string,calculate:TextDiff):string {
  return mergeValue(input.syncBase??input.base,saved,input.base,calculate);
}
function coordinatedOrigins(parts:readonly MergePart[],saved:string,calculate:TextDiff,chosen=false){
  const incoming=parts.map(part=>part.remote).join("");
  const frontier=parts.map(part=>part.source==="conflict"&&!chosen?part.base:part.remote).join("");
  return {base:parts.map(part=>part.source==="conflict"&&chosen?part.remote:part.local!==part.base?part.base:part.remote).join(""),
    syncBase:mergeValue(incoming,frontier,saved,calculate)};
}

function retainPendingOrigin(origin:string,saved:string,baseline:string,calculate:TextDiff):string {
  const pending=textChanges(baseline,saved,calculate);let value=saved;
  for(const human of [...textChanges(origin,saved,calculate)].reverse()){
    const retained=pending.some(change=>change.fromB===change.toB||human.fromB===human.toB?change.fromB<=human.toB&&human.fromB<=change.toB:change.fromB<human.toB&&human.fromB<change.toB);
    if(retained)value=value.slice(0,human.fromB)+origin.slice(human.fromA,human.toA)+value.slice(human.toB);
  }return value;
}

/** Preserve the unconfirmed review branch while acknowledging an immutable write. */
export function acknowledgedDraft(input:ModelDraft,current:ModelDraft|undefined,before:ModelSnapshot,committedBefore:ModelSnapshot,receipt:ModelSnapshot,value:string,baseline:string,
  intent:{readonly source:ModelSnapshot;readonly content:string;readonly baseline:string;readonly origin?:ModelDraft}|undefined,calculate:TextDiff):ModelDraft {
  const id=input.id,origin=intent?.origin?.base??input.base;
  const source=intent?.source??before;
  const target=intent?.content??paragraph(receipt.saved,id).text;
  const targetBaseline=intent?.baseline??paragraph(receipt.baseline,id).text;
  const startBaseline=paragraph((intent?.source??committedBefore).baseline,id).text;
  const humanCandidate=mergeValue(input.baseline,input.editedBaseline??input.baseline,input.base,calculate)!==input.value;
  const proposedOrigin=intent||humanCandidate?mergeValue(startBaseline,targetBaseline,mergeValue(paragraph(source.saved,id).text,target,origin,calculate),calculate):paragraph(receipt.saved,id).text;
  const targetOrigin=retainPendingOrigin(proposedOrigin,paragraph(receipt.saved,id).text,paragraph(receipt.baseline,id).text,calculate);
  const nextValue=mergeValue(paragraph(before.saved,id).text,value,paragraph(receipt.saved,id).text,calculate);
  return {...input,base:mergeValue(origin,current?.base??input.base,targetOrigin,calculate),syncBase:paragraph(receipt.saved,id).text,
    value:nextValue,kind:nextValue===baseline?"body":"candidate",editedBaseline:baseline,baseline:paragraph(before.baseline,id).text};
}

export function paragraph(values: readonly Paragraph[], id: string): Paragraph {
  const result = values.find(value => value.id === id);
  if (!result) throw new Error(`MODEL_NOT_FOUND：段落 ${id} 不存在。`);
  return result;
}

export function createDraft(snapshot: ModelSnapshot, id: string, value: string): ModelDraft {
  const saved = paragraph(snapshot.saved, id).text, baseline = paragraph(snapshot.baseline, id).text;
  return { id, value, base: saved, baseline, kind: saved === baseline ? "body" : "candidate" };
}

/** Each draft retains the S it was actually edited from, not a guessed ancestor. */
export function planSave(snapshot: ModelSnapshot, drafts: readonly ModelDraft[], calculate: TextDiff): SavePlan {
  return { version: snapshot.version, paragraphs: drafts.map(draft => {
    const baseline = paragraph(snapshot.baseline, draft.id).text;
    if (baseline !== draft.baseline) throw new Error("MODEL_BASELINE_CHANGED：基线已改变，保留输入并重新核对。");
    const saved = paragraph(snapshot.saved, draft.id);
    return { id: draft.id, label: saved.label, kind: draft.kind, baseline: draft.editedBaseline ?? baseline,
      incoming:saved.text, parts: scopeReviewConflicts(mergeText(draft.base, draft.value, incomingValue(draft,saved.text,calculate), calculate)) };
  }) };
}

export function conflictingParagraphs(plan: SavePlan): readonly PlannedParagraph[] {
  return plan.paragraphs.filter(item => item.parts.some(part => part.source === "conflict"));
}

export function finishPlan(plan: SavePlan, choices: Readonly<Record<string, ConflictChoice>> = {}): readonly ParagraphUpdate[] {
  return plan.paragraphs.map(item => ({ id: item.id, ...renderMerge(item.parts, item.kind, item.baseline, choices[item.id]) }));
}

export function reviewUpdates(snapshot: ModelSnapshot, id: string, action: "keep" | "undo"): readonly ParagraphUpdate[] {
  const saved = paragraph(snapshot.saved, id).text, baseline = paragraph(snapshot.baseline, id).text;
  return [{ id, saved: action === "undo" ? baseline : saved, baseline: action === "keep" ? saved : baseline }];
}

/** Receiving S rebases unsaved input; it never uses the current H as its ancestor
 * and never writes the gateway. B′ is rebased separately from candidate content. */
export function planSynchronization(observed: ModelSnapshot, latest: ModelSnapshot, id: string, draft: ModelDraft | undefined, policy: HbsTextPolicy): SynchronizationPlan {
  const calculate = policy.calculate;
  const input = draft ?? createDraft(observed, id, paragraph(observed.saved, id).text);
  const target = paragraph(latest.saved, id), confirmed = paragraph(latest.baseline, id).text;
  const baselineParts = mergeText(input.baseline, input.editedBaseline ?? input.baseline, confirmed, calculate);
  const content: PlannedParagraph = { id, label: target.label, kind: input.kind, baseline: input.baseline,
    incoming:target.text,parts: scopeReviewConflicts(mergeText(input.base, input.value, incomingValue(input,target.text,calculate), calculate)) };
  const baselineConflict: PlannedParagraph = { id: `${id}:baseline`, label: `${target.label} · B′ 协调`, kind: "body", baseline: confirmed, parts: baselineParts };
  const candidateRanges = textChanges(input.baseline, input.base, calculate);
  const intersects = (part: MergePart, from: number, to: number) => part.from === part.to || from === to
    ? part.from <= to && from <= part.to : part.from < to && from < part.to;
  const ordinaryConflicts = content.parts.filter(part => part.source === "conflict" &&
    !candidateRanges.some(range => intersects(part, range.fromB, range.toB)));
  return { diff: calculate, policy, snapshot: latest, originBaseline: input.baseline, ordinaryConflicts, baselineParts, review: { version: latest.version,
    paragraphs: [content, ...(baselineParts.some(part => part.source === "conflict") ? [baselineConflict] : [])] } };
}

/** Install compatible ranges immediately without deciding any conflict. The
 * local branch remains current at conflicts; only clean incoming ranges advance
 * its ancestor. B′ follows its own merge, never accepting incoming S as B. */
export function stageSynchronization(plan: SynchronizationPlan): SynchronizationResult {
  const item = plan.review.paragraphs[0]!;
  const current = (parts: readonly MergePart[]) => renderMerge(parts, "candidate", "", "local").saved;
  const ancestor = (parts: readonly MergePart[]) => parts.map(part => part.source === "conflict" ? part.base : part.remote).join("");
  const value = current(item.parts), editedBaseline = current(plan.baselineParts);
  return { observed: plan.snapshot, draft: {
    id: item.id, value, editedBaseline,
    ...coordinatedOrigins(item.parts,paragraph(plan.snapshot.saved,item.id).text,plan.diff), baseline: ancestor(plan.baselineParts),
    kind: value === editedBaseline ? "body" : "candidate",
  } };
}

/** A clean pull changes only observed H/B′. A conflict caller can explicitly
 * persist this same result after confirmation, using the regular save path. */
export function finishSynchronization(plan: SynchronizationPlan, latest: ModelSnapshot,
  choices: Readonly<Record<string, ConflictChoice>> = {}): SynchronizationResult {
  if (latest.version !== plan.snapshot.version) throw new Error("MODEL_VERSION_CHANGED：同步期间 S 又有更新，请重新核对。");
  const item = plan.review.paragraphs[0]!;
  const saved = paragraph(latest.saved, item.id).text, confirmed = paragraph(latest.baseline, item.id).text;
  const selection = choices[item.id], baselineSelection = choices[`${item.id}:baseline`] ?? selection;
  let mergedBaseline = renderMerge(plan.baselineParts, "candidate", confirmed, baselineSelection).saved;
  // Existing candidates elsewhere do not turn an ordinary conflict into new.
  // Project explicitly resolved ordinary ranges through the actual E → B′ map.
  if (item.kind === "candidate" && selection && selection !== "discard" && plan.ordinaryConflicts.length) {
    const ancestor = item.parts.map(part => part.base).join("");
    const mapping = positionMap(ancestor, mergedBaseline, plan.policy);
    const apply = (side: "local" | "remote") => {
      let result = mergedBaseline;
      for (const part of [...plan.ordinaryConflicts].reverse()) {
        const from = mapping.mapPos(part.from, -1), to = mapping.mapPos(part.to, 1);
        result = result.slice(0, from) + part[side] + result.slice(to);
      }
      return result;
    };
    const remote = apply("remote"), local = apply("local");
    mergedBaseline = selection === "both" ? remote === local ? remote : [remote, local].join("\n") : selection === "remote" ? remote : local;
  }
  const content = renderMerge(item.parts, item.kind, item.kind === "candidate" ? mergedBaseline : plan.originBaseline, selection);
  const baseline = item.kind === "candidate" ? mergedBaseline
    : renderMerge(mergeText(plan.originBaseline, content.baseline, confirmed, plan.diff), "candidate", confirmed, baselineSelection).saved;
  const value = selection === "discard" ? mergedBaseline : content.saved;
  const editedBaseline = selection === "discard" ? mergedBaseline : baseline;
  const origins=coordinatedOrigins(item.parts,saved,plan.diff,selection!==undefined);
  const draft = value === saved && editedBaseline === confirmed && origins.base===origins.syncBase ? undefined
    // A Keep receipt may make backend S=B while later edits to its new are
    // still pending. Classify from the actual local review projection, rather
    // than turning those later edits into ordinary accepted input on save.
    : { ...createDraft(latest, item.id, value),...origins, editedBaseline, kind: value === editedBaseline ? "body" as const : "candidate" as const };
  return { observed: latest, draft };
}

/** Synchronize only the ordinary B′ delta before reconciling a newer S.
 * S keeps overlapping remote edits; compatible ordinary edits still reach S.
 * A concurrent change to B itself requires the existing conflict machinery. */
export function planBaselineSynchronization(latest: ModelSnapshot, id: string, input: ModelDraft | undefined, calculate: TextDiff): ParagraphUpdate | undefined {
  if (!input || input.editedBaseline === undefined || input.editedBaseline === input.baseline) return;
  const confirmed = paragraph(latest.baseline, id).text;
  const parts = mergeText(input.baseline, input.editedBaseline, confirmed, calculate);
  if (parts.some(part => part.source === "conflict")) return;
  const baseline = renderMerge(parts, "candidate", confirmed, "local").saved;
  if (baseline === confirmed) return;
  const saved = renderMerge(mergeText(input.baseline, input.editedBaseline, paragraph(latest.saved, id).text, calculate), "candidate", confirmed, "remote").saved;
  return { id, saved, baseline };
}

/** Acknowledge the immutable ordinary delta in the existing ancestors. Later
 * input stays in H/B′, and human edits of new retain their review origin. */
export function acknowledgedBaselineDraft(input: ModelDraft, current: ModelDraft | undefined, before: ModelSnapshot, receipt: ModelSnapshot,
  value: string, baseline: string, calculate: TextDiff): ModelDraft {
  const from = paragraph(before.baseline, input.id).text, to = paragraph(receipt.baseline, input.id).text;
  const align = (text: string) => mergeValue(from, to, text, calculate);
  return { ...input, ...current, value, editedBaseline: baseline, baseline: align(input.baseline),
    base: align(current?.base ?? input.base), syncBase: align(current?.syncBase ?? input.syncBase ?? input.base),
    kind: value === baseline ? "body" : "candidate" };
}
