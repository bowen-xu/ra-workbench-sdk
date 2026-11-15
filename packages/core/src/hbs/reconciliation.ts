import type { DocumentSnapshot, HbsDocumentAdapter } from "./document";
import { changeAt } from "./structure/value";

/** Saving acknowledges a transmitted value, not the human review branch.
 * Remove already acknowledged local input from the incoming branch before
 * comparing it with that branch's retained review origin. */
export function coordinateDocument<D>(adapter:HbsDocumentAdapter<D>,ancestor:D,reviewAncestor:D,content:D,snapshot:DocumentSnapshot<D>){
  const incoming=adapter.merge(ancestor,snapshot.saved,reviewAncestor).value;
  const merged=adapter.mergeReview ? adapter.mergeReview(reviewAncestor,content,incoming) : adapter.merge(reviewAncestor,content,incoming);
  const frontier=merged.ancestor===undefined?incoming:merged.ancestor;
  return {value:merged.value,
    reviewAncestor:adapter.merge(content,reviewAncestor,frontier).value,
    ancestor:adapter.merge(incoming,frontier,snapshot.saved).value,
    conflicts:merged.conflicts.map(change=>{
      const actual=adapter.read(snapshot.saved,change.path);
      return {...change,incoming:actual,id:`${change.id}:${changeAt(change.path,change.before,actual,change.kind).id}`};
    })};
}

/** Explicit Keep/Undo and ordinary baseline acknowledgements can advance the
 * selected review origin. Merely writing a candidate to S cannot. */
export function reviewOrigin<D>(adapter:HbsDocumentAdapter<D>,origin:D,source:D,content:D,sourceBaseline:D,baseline:D):D{
  return adapter.merge(sourceBaseline,baseline,adapter.merge(source,content,origin).value).value;
}
