import type {NoteIndexItem} from "@research-assistant/core/notes";

/** Shared IPC metadata boundary. Source-specific identities remain disjoint;
 * none of these read projections conveys an editing version or permission. */
export function decodeCatalogItems(values: readonly unknown[], source: "pages" | "writing", fail: () => never): readonly NoteIndexItem[] {
  const object = (entry: unknown): Record<string, unknown> => entry !== null && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : fail();
  const text = (entry: unknown) => typeof entry === "string" && entry.length > 0;
  const ids = new Set<string>();
  const allowed = new Set(["id","title","snippet","category","owner","sourceLabel","updatedAt","status","isFavorite","favoritePosition","target"]);
  for (const entry of values) {
    const item = object(entry), target = object(item.target);
    if (Object.keys(item).some(key => !allowed.has(key)) || !text(item.id) || ids.has(item.id as string) || !text(item.title)
      || typeof item.snippet !== "string" || item.snippet.length > 480 || !text(item.updatedAt) || !Number.isFinite(Date.parse(item.updatedAt as string))
      || !["active","archived","trashed"].includes(String(item.status)) || typeof item.isFavorite !== "boolean"
      || !["independent","dependent"].includes(String(item.category))
      || item.sourceLabel !== undefined && typeof item.sourceLabel !== "string"
      || item.favoritePosition !== undefined && (!Number.isSafeInteger(item.favoritePosition) || (item.favoritePosition as number) < 0)) fail();
    if (source === "pages") {
      if (!text(target.pageId) || item.id !== `page:${target.pageId}`) fail();
      if (target.kind === "reading") {if (!text(target.noteId) || Object.keys(target).some(key => !["kind","pageId","noteId"].includes(key))) fail();}
      else if (target.kind !== "page" || item.category !== "independent" || Object.keys(target).some(key => !["kind","pageId"].includes(key))) fail();
      if (item.category === "dependent") {
        const owner = object(item.owner);
        if (Object.keys(owner).some(key => !["kind","id","label"].includes(key)) || target.kind !== "reading" || owner.kind !== "highlight" || owner.id !== target.noteId || typeof owner.label !== "string" || item.isFavorite) fail();
      } else if (item.owner !== undefined) fail();
    } else {
      const owner = object(item.owner);
      if (Object.keys(target).some(key => !["kind","manuscriptId","path"].includes(key)) || target.kind !== "writing" || !text(target.manuscriptId)
        || !validWritingPath(target.path) || item.category !== "dependent" || item.isFavorite || item.favoritePosition !== undefined
        || item.status === "trashed" || Object.keys(owner).some(key => !["kind","id","label"].includes(key))
        || owner.kind !== "manuscript" || owner.id !== target.manuscriptId || typeof owner.label !== "string") fail();
      let identity: unknown;
      try {identity = JSON.parse((item.id as string).slice("writing:".length));} catch {return fail();}
      if (!Array.isArray(identity) || identity.length !== 2 || identity[0] !== target.manuscriptId || !text(identity[1]) || (identity[1] as string).length > 128
        || item.id !== `writing:${JSON.stringify(identity)}`) fail();
    }
    ids.add(item.id as string);
  }
  return values as readonly NoteIndexItem[];
}

/** Logical project-relative paths only. The writing adapter still resolves the
 * registered project and enforces its filesystem/authorization boundary. */
function validWritingPath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/[\\\u0000]/u.test(value)
    && !/^[a-z]:/iu.test(value) && value.split("/").every(part => part !== "" && part !== "." && part !== ".."
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part) && !/[ .]$/u.test(part)) && /\.ranote$/iu.test(value);
}
