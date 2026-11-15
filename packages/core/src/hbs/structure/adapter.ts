import type { DocumentChange, DocumentConflict, DocumentPath, HbsDocumentAdapter } from "../document";
import type { TextDiff } from "../textDiff";
import { structuralDiff, type StructurePolicy } from "./diff";
import { align } from "./alignment";
import { changeAt, cloneValue, containsPath, equalValue, identity, isObject, replaceAt, valueAt } from "./value";
import { mapTextPosition, mergeTextValue, selectedText, textChangesAt } from "./text";
import { mergeCompatibleSequence } from "./sequence";

export function createStructuralAdapter<D>(kind: string, decode: (value: unknown) => D, calculate: TextDiff,
  policy: StructurePolicy): HbsDocumentAdapter<D> {
  const diff = (before: D, after: D) => kind === "text" && typeof before === "string" && typeof after === "string"
    ? textChangesAt(before, after, [], calculate) : structuralDiff(before, after, policy);
  const applyRaw = (target: unknown, change: DocumentChange, side: "before" | "after"): unknown => {
    const path = side === "after" ? change.beforePath : change.path, value = change[side];
    const previous = change[side === "after" ? "before" : "after"], actual = valueAt(target, path);
    if (change.text && typeof actual === "string") {
      const selected = selectedText(change, side);
      const result = mergeTextValue(selected.base, selected.value, actual, calculate);
      if (result.conflicts.length) throw new Error("MODEL_RANGE_CHANGED：所选文字已变化，请重新核对。");
      return replaceAt(target, path, result.value);
    }
    if (change.placement && value !== undefined && actual === undefined) {
      const parent = valueAt(target, path.slice(0,-1));
      if (!Array.isArray(parent)) throw new Error("MODEL_RANGE_CHANGED：目标父容器已变化。");
      const order = change.placement[side], id = identity(value)?.value, index = order.indexOf(id ?? "");
      const next = order.slice(index + 1).find(key => parent.some(item => identity(item)?.value === key));
      const copy = cloneValue(parent); copy.splice(next ? copy.findIndex(item => identity(item)?.value === next) : copy.length,0,cloneValue(value));
      return replaceAt(target,path.slice(0,-1),copy);
    }
    if (change.axis) {
      if (!Array.isArray(actual) || !actual.every(Array.isArray)) throw new Error("MODEL_RANGE_CHANGED：表格范围已变化。");
      const axis = change.axis, columns = axis.direction === "column";
      const rows: unknown[][] = cloneValue(actual);
      const units = columns ? (rows[0] ?? []).map((_, col) => rows.map(row => row[col])) : rows;
      const start = side === "after" ? axis.beforeFrom : axis.afterFrom, count = side === "after" ? axis.beforeCount : axis.afterCount;
      if (!equalValue(units.slice(start, start + count), previous)) throw new Error("MODEL_RANGE_CHANGED：行列范围已变化，请重新核对。");
      units.splice(start, count, ...(cloneValue(value) as unknown[][]));
      return replaceAt(target, path, columns ? (units[0] ?? []).map((_, row) => units.map(col => col[row])) : units);
    }
    if (change.kind === "order") {
      if (!Array.isArray(actual) || !Array.isArray(value)) throw new Error("MODEL_RANGE_CHANGED：顺序容器已变化。");
      const available = new Map(actual.map(item => [identity(item)?.value, item]));
      const ordered = value.flatMap(item => { const id = identity(item)?.value; const found = available.get(id); available.delete(id); return found === undefined ? [] : [found]; });
      ordered.push(...available.values()); return replaceAt(target, path, ordered);
    }
    if (!equalValue(actual, previous) && !equalValue(actual, value)) {
      const merged = merge(previous, value, actual);
      if (merged.conflicts.length) throw new Error("MODEL_RANGE_CHANGED：目标内容已变化，旧操作未应用。");
      return replaceAt(target, path, merged.value);
    }
    return replaceAt(target, path, value);
  };
  const merge = (base: unknown, local: unknown, incoming: unknown, review = false): { value: unknown; conflicts: DocumentConflict[] } => {
    if (equalValue(local, incoming) || equalValue(base, incoming)) return { value: local, conflicts: [] };
    if (equalValue(base, local)) return { value: incoming, conflicts: [] };
    if (typeof base === "string" && typeof local === "string" && typeof incoming === "string") {
      return mergeTextValue(base, local, incoming, calculate, review);
    }
    // Reconcile cell edits against a uniquely aligned changed grid. Coordinates
    // are derived from sequence matching, not assigned as row identities.
    if (grid(base) && grid(local) && grid(incoming) && (base.length !== local.length || base.length !== incoming.length
      || base[0]?.length !== local[0]?.length || base[0]?.length !== incoming[0]?.length)) {
      const result = mergeGrid(base,local,incoming,review);
      if (result) return result;
    }
    const sequence = mergeSequence(base,local,incoming,review);
    if (sequence) return sequence;
    const left = structuralDiff(base, local, policy), right = structuralDiff(base, incoming, policy);
    let value = cloneValue(local); const conflicts: DocumentConflict[] = [];
    for (const remote of right) {
      const overlaps = left.filter(change => {
        const sameContainer = equalValue(change.beforePath, remote.beforePath);
        // Keyed permutations act only on their own container. A child body or
        // another container's permutation keeps its stable identity address.
        // Replacing/deleting an ancestor is still a genuine overlap.
        if (change.kind === "order" && remote.kind === "order") return sameContainer;
        if (change.kind === "order" && !sameContainer && containsPath(change.beforePath, remote.beforePath)) return false;
        if (remote.kind === "order" && !sameContainer && containsPath(remote.beforePath, change.beforePath)) return false;
        return containsPath(change.beforePath, remote.beforePath) || containsPath(remote.beforePath, change.beforePath);
      });
      if (!overlaps.length) { value = applyRaw(value, remote, "after"); continue; }
      // A permutation concerns stable identities, not the member bodies stored
      // alongside it. The same move on both branches is already installed;
      // member edits are reconciled independently by their own changes.
      if (remote.kind === "order" && Array.isArray(remote.after)) {
        const incomingOrder = remote.after.map(identity);
        if (incomingOrder.every(id => id && id.key === incomingOrder[0]?.key)
          && new Set(incomingOrder.map(id => id!.value)).size === incomingOrder.length
          && overlaps.every(item => item.kind === "order" && Array.isArray(item.after)
            && equalValue(item.after.map(identity), incomingOrder))) continue;
      }
      let path: DocumentPath = remote.beforePath;
      for (const item of overlaps) { let count = 0; while (count < path.length && count < item.beforePath.length && equalValue(path[count], item.beforePath[count])) count++; path = path.slice(0, count); }
      if (conflicts.some(item => containsPath(item.path, path))) continue;
      const a = valueAt(base, path), b = valueAt(local, path), c = valueAt(incoming, path);
      if (equalValue(b, c)) continue;
      if (typeof a === "string" && typeof b === "string" && typeof c === "string") {
        const nested = merge(a, b, c, review); value = replaceAt(value, path, nested.value);
        conflicts.push(...nested.conflicts.map(item => ({ ...item, path, beforePath: path, id: `${JSON.stringify(path)}:${item.id}` })));
      } else if (path.length && isObject(a) && isObject(b) && isObject(c) && !policy.atom(a) && !policy.atom(b) && !policy.atom(c)) {
        const nested = merge(a, b, c, review); value = replaceAt(value, path, nested.value);
        conflicts.push(...nested.conflicts.map(item => ({ ...item, path: [...path, ...item.path], beforePath: [...path, ...item.beforePath], id: `${JSON.stringify(path)}:${item.id}` })));
      } else {
        const sequence = mergeSequence(a,b,c,review);
        if (sequence) { value = replaceAt(value,path,sequence.value); continue; }
        if (grid(a) && grid(b) && grid(c)) {
          const nested = mergeGrid(a,b,c,review);
          if (nested) { value = replaceAt(value,path,nested.value); continue; }
        }
        // A complete matched cell may still contain disjoint character edits.
        if (isObject(a) && isObject(b) && isObject(c) && !policy.atom(a)) {
          const nested = mergeObjects(a, b, c, review); value = replaceAt(value, path, nested.value);
          if (!nested.conflicts.length) continue;
        }
        conflicts.push({ ...changeAt(path, a, b, remote.kind, remote.reason), incoming: c });
      }
    }
    return { value, conflicts };
  };
  function mergeSequence(base: unknown, local: unknown, incoming: unknown, review = false) {
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(incoming)
      && !grid(base) && !grid(local) && !grid(incoming) && ![...base,...local,...incoming].some(identity)) {
      return mergeCompatibleSequence(base,local,incoming,(a,b,c)=>merge(a,b,c,review),policy.compatibleSequenceItems);
    }
    return undefined;
  }
  function grid(value: unknown): value is unknown[][] {
    return Array.isArray(value) && Array.isArray(value[0]) && value.every(Array.isArray) && value.every(row => row.length===(value[0] as unknown[]).length);
  }
  function mergeGrid(base: unknown[][], local: unknown[][], incoming: unknown[][], review = false) {
    const shape = (a: unknown[][], b: unknown[][]) => a.length===b.length && a[0]?.length===b[0]?.length;
    const remoteStructure = shape(base,local) && !shape(base,incoming), localStructure = shape(base,incoming) && !shape(base,local);
    if (!remoteStructure && !localStructure) return undefined;
    const structured = remoteStructure ? incoming : local, edited = remoteStructure ? local : incoming;
    const columns = base[0]?.length !== structured[0]?.length;
    if (columns && base.length!==structured.length) return undefined;
    const transpose = (rows: unknown[][]) => (rows[0]??[]).map((_,c)=>rows.map(row=>row[c]));
    const a = columns ? transpose(base) : base, s = columns ? transpose(structured) : structured, e = columns ? transpose(edited) : edited;
    const matched = align(a,s); if (matched.ambiguous) return undefined;
    const result = cloneValue(s);
    for (const pair of matched.pairs) {
      if (pair.before===undefined) continue;
      if (pair.after===undefined) { if (!equalValue(a[pair.before],e[pair.before])) return undefined; continue; }
      for (let index=0;index<a[pair.before]!.length;index++) {
        const merged = remoteStructure ? merge(a[pair.before]![index],e[pair.before]![index],s[pair.after]![index],review)
          : merge(a[pair.before]![index],s[pair.after]![index],e[pair.before]![index],review);
        if (merged.conflicts.length) return undefined;
        result[pair.after]![index]=merged.value;
      }
    }
    return {value:columns?transpose(result):result,conflicts:[]};
  }
  function mergeObjects(base: Record<string, unknown>, local: Record<string, unknown>, incoming: Record<string, unknown>, review = false) {
    const value = cloneValue(local), conflicts: DocumentConflict[] = [];
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(incoming)])) {
      const part = merge(base[key], local[key], incoming[key], review);
      if (part.value === undefined) delete value[key]; else value[key] = part.value;
      conflicts.push(...part.conflicts.map(change => ({ ...change, path: [key, ...change.path], beforePath: [key, ...change.beforePath] })));
    }
    return { value, conflicts };
  }
  const combine = (change: DocumentConflict): unknown => {
    const a = change.incoming, b = change.after;
    if (equalValue(a, b)) return cloneValue(a);
    if (typeof a === "string" && typeof b === "string") return `${a}\n${b}`;
    if (Array.isArray(a) && Array.isArray(b) && ![...a, ...b].some(identity)) return [...cloneValue(a), ...cloneValue(b)];
    if (isObject(a) && isObject(b) && a.kind === "inline" && b.kind === "inline" && Array.isArray(a.items) && Array.isArray(b.items)) return { ...b, items: [...cloneValue(a.items), { type: "text", text: "\n", styles: [] }, ...cloneValue(b.items)] };
    throw new Error("MODEL_BOTH_UNSUPPORTED：该结构不能直接并置；当前输入已保留，请选 Take／Keep 或编辑后确认。");
  };
  const textIncoming = (change: DocumentConflict, content: D, confirmed: D, saved: D) => {
    const current = String(valueAt(content, change.path) ?? ""), original = String(valueAt(confirmed, change.path) ?? "");
    const source = String(change.after), incoming = String(change.origin === "baseline" ? valueAt(saved, change.path) ?? "" : change.incoming);
    const start = change.text?.fromB ?? 0, end = change.text?.toB ?? source.length;
    const from = mapTextPosition(source, current, start, -1, calculate), to = mapTextPosition(source, current, end, 1, calculate);
    return { from, to, document: incoming,
      text: incoming.slice(mapTextPosition(source, incoming, start, -1, calculate), mapTextPosition(source, incoming, end, 1, calculate)),
      base: original.slice(mapTextPosition(current, original, from, -1, calculate), mapTextPosition(current, original, to, 1, calculate)) };
  };
  const mergeDocument = (base: D, local: D, incoming: D, review = false) => {
      const result = merge(base, local, incoming, review);
      let ancestor: unknown = cloneValue(incoming);
      for (const conflict of [...result.conflicts].reverse()) {
        const current = valueAt(ancestor, conflict.path);
        if (conflict.text && conflict.incomingRange && typeof current === "string") {
          const {from,to} = conflict.incomingRange;
          ancestor = replaceAt(ancestor, conflict.path, current.slice(0,from) + String(conflict.before).slice(conflict.text.fromA,conflict.text.toA) + current.slice(to));
        } else ancestor = replaceAt(ancestor, conflict.path, conflict.before);
      }
      const conflicts=result.conflicts.map(conflict=>({...conflict,
        id:`${conflict.id}:${changeAt(conflict.path,conflict.before,conflict.incoming,conflict.kind).id}`}));
      return { value: decode(result.value), conflicts, ancestor: decode(ancestor) };
  };
  return { kind, decode, equal: equalValue, diff, read: valueAt, replace: (value, path, replacement) => decode(replaceAt(value, path, replacement)),
    projectManual: (baseline, previous, next) => {
      // Atomic structural moves overlap every pending part of the document.
      // Match the reference's conservative projection: retain accepted B as a
      // whole instead of recursively combining old/new parents into duplicate IDs.
      if (policy.atomicPair?.(previous, next) && diff(baseline, previous).length) return baseline;
      return decode(merge(previous,baseline,next).value);
    },
    apply: (target, change, side) => decode(applyRaw(target, change, side)),
    merge: mergeDocument, mergeReview: (base,local,incoming) => mergeDocument(base,local,incoming,true), combine, textIncoming,
    retainReviewOrigin: (origin,content,baseline) => {
      const refine=(changes:readonly DocumentChange[])=>changes.flatMap(change=>change.kind==="text"&&typeof change.before==="string"&&typeof change.after==="string"
        ?textChangesAt(change.before,change.after,change.path,calculate):[change]);
      const pending=refine(diff(baseline,content));
      let value:unknown=content;
      for(const human of refine(diff(origin,content))){
        const retained=pending.some(change=>{
          if(!containsPath(change.path,human.path)&&!containsPath(human.path,change.path))return false;
          if(!change.text||!human.text)return true;
          return change.text.fromB===change.text.toB||human.text.fromB===human.text.toB
            ?change.text.fromB<=human.text.toB&&human.text.fromB<=change.text.toB
            :change.text.fromB<human.text.toB&&human.text.fromB<change.text.toB;
        });
        if(retained)value=applyRaw(value,human,"before");
      }
      return decode(value);
    },
    resolveConflict: (context, change, action) => {
      if (change.text && typeof change.after === "string") {
        const source = change.after, start = change.text.fromB, end = change.text.toB;
        const entry = textIncoming(change, context.content, context.baseline, context.saved);
        const current = String(valueAt(context.content,change.path) ?? "").slice(entry.from,entry.to);
        const chosen = action === "incoming" ? entry.text : action === "both" ? entry.text === current ? current : `${entry.text}\n${current}` : action === "undo" ? entry.base : current;
        const replace = (target: D, text: string): D => {
          const value = String(valueAt(target,change.path) ?? "");
          const from = mapTextPosition(source,value,start,-1,calculate), to = mapTextPosition(source,value,end,1,calculate);
          return decode(replaceAt(target,change.path,value.slice(0,from)+text+value.slice(to)));
        };
        const saved=String(valueAt(context.saved,change.path)??"");
        const ancestorText=change.origin==="review"?saved.slice(mapTextPosition(source,saved,start,-1,calculate),mapTextPosition(source,saved,end,1,calculate)):entry.text;
        const confirmed=String(valueAt(context.confirmed,change.path)??"");
        const confirmedText=confirmed.slice(mapTextPosition(source,confirmed,start,-1,calculate),mapTextPosition(source,confirmed,end,1,calculate));
        return { content: replace(context.content,chosen), ancestor: replace(context.ancestor,ancestorText),
          baseline: change.origin === "baseline" && action === "incoming" ? replace(context.baseline,confirmedText) : context.baseline,
          baselineAncestor: change.origin === "baseline" ? replace(context.baselineAncestor,confirmedText) : context.baselineAncestor };
      }
      const confirmed = valueAt(context.confirmed,change.path);
      const incoming = change.origin === "baseline" ? valueAt(context.saved,change.path) : change.incoming;
      const chosen = action === "incoming" ? incoming : action === "both" ? combine({...change,incoming}) : action === "undo" ? valueAt(context.baseline,change.path) : valueAt(context.content,change.path);
      return { content: decode(replaceAt(context.content,change.path,chosen)), ancestor: decode(replaceAt(context.ancestor,change.path,change.origin==="review"?valueAt(context.saved,change.path):incoming)),
        baseline: change.origin === "baseline" && action === "incoming" ? decode(replaceAt(context.baseline,change.path,confirmed)) : context.baseline,
        baselineAncestor: change.origin === "baseline" ? decode(replaceAt(context.baselineAncestor,change.path,confirmed)) : context.baselineAncestor };
    } };
}
