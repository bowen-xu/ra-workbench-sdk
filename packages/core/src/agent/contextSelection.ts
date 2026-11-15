/** Conversation-owned resource selection, independent of any Agent runner or UI. */
export type AgentContextLeafResource = {
    readonly kind: "structuredObject" | "templateCatalog";
    readonly resourceId: string;
    readonly access?: "readOnly" | "readWrite";
} | {
    readonly kind: "paper";
    readonly resourceId: string;
    readonly attachmentId?: string;
    readonly pageIndex?: number;
} | {
    readonly kind: "paperNotes";
    readonly resourceId: string;
    readonly excludedNoteIds: readonly string[];
} | {
    readonly kind: "note";
    readonly resourceId: string;
} | {
    readonly kind: "manuscriptFile";
    readonly resourceId: string;
    readonly path: string;
} | {
    readonly kind: "paperMetadata" | "paperPortrait";
    readonly resourceId: string;
};
export interface AgentContextPart {
    readonly resource: AgentContextLeafResource;
    readonly label: string;
    readonly selected: boolean;
    readonly access: "readOnly" | "readWrite";
}
export interface AgentContextGroupResource {
    readonly kind: "paperGroup" | "manuscript" | "noteGroup";
    readonly resourceId: string;
    readonly parts: readonly AgentContextPart[];
    /** Effective ceiling; child preferences remain stored when this is read-only. */
    readonly groupAccess?: "readOnly" | "readWrite";
    /** Whole-object grant. Saved parts are overrides; absent members inherit this access. */
    readonly newMemberAccess?: "readOnly" | "readWrite";
}
export type AgentContextResource = AgentContextLeafResource | AgentContextGroupResource;
export function isAgentContextGroup(resource: AgentContextResource): resource is AgentContextGroupResource {
    return resource.kind === "paperGroup" || resource.kind === "manuscript" || resource.kind === "noteGroup";
}
/** Object authority contains defaults and exceptions, never a UI inventory. */
export function compactAgentContextResource(resource: AgentContextResource): AgentContextResource {
    if (!isAgentContextGroup(resource) || !resource.newMemberAccess) return resource;
    const access = resource.newMemberAccess;
    return {...resource, parts: resource.parts.filter(part => {
        if (resource.kind === "paperGroup" && part.resource.kind === "note" && !part.selected) return false;
        const inherited = canWriteAgentContext(part.resource) ? access : "readOnly";
        return !part.selected || part.access !== inherited || resource.kind === "paperGroup" && part.resource.kind === "note"
            || part.resource.kind === "paperNotes" && part.resource.excludedNoteIds.length > 0;
    }).map(part => ({...part, label: "权限覆盖"}))};
}
export function compactAgentContextSelection(selection: AgentContextSelection): AgentContextSelection {
    return {...selection,resource:compactAgentContextResource(selection.resource)};
}
export function canWriteAgentContext(resource: AgentContextLeafResource): boolean {
    return resource.kind !== "paper";
}
export interface AgentContextSelection {
    readonly resource: AgentContextResource;
    readonly label: string;
}
export interface AgentContextState {
    readonly schemaVersion: 1;
    readonly persistent: readonly AgentContextSelection[];
    readonly temporary: readonly AgentContextSelection[];
}
export const EMPTY_AGENT_CONTEXT: AgentContextState = { schemaVersion: 1, persistent: [], temporary: [] };
export function agentContextKey(resource: AgentContextResource): string {
    return JSON.stringify(resource.kind === "paper"
        ? [resource.kind, resource.resourceId, resource.attachmentId ?? null, resource.pageIndex ?? null]
        : resource.kind === "manuscriptFile" ? [resource.kind, resource.resourceId, resource.path]
            : [resource.kind, resource.resourceId]);
}
export function decodeAgentContextResource(value: unknown): AgentContextResource {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("上下文身份无效");
    const r = value as Record<string, unknown>;
    const safe = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(v);
    if (!safe(r.resourceId))
        throw new Error("上下文身份无效");
    if ((r.kind === "paperGroup" || r.kind === "manuscript" || r.kind === "noteGroup") && Object.keys(r).every(k => ["kind", "resourceId", "parts", "newMemberAccess", "groupAccess"].includes(k)) && Array.isArray(r.parts) && (r.parts.length > 0 || r.newMemberAccess !== undefined) && r.parts.length <= 256) {
        const kind = r.kind, id = r.resourceId;
        if (r.groupAccess !== undefined && !["readOnly", "readWrite"].includes(String(r.groupAccess))) throw new Error("上下文组权限无效");
        if (r.newMemberAccess !== undefined && (kind === "noteGroup" && r.groupAccess === undefined || !["readOnly", "readWrite"].includes(String(r.newMemberAccess)))) throw new Error("上下文范围权限无效");
        const parts = r.parts.map((value): AgentContextPart => {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("上下文子项无效");
            const part = value as Record<string, unknown>, resource = decodeAgentContextResource(part.resource);
            if (isAgentContextGroup(resource) || Object.keys(part).some(k => !["resource", "label", "selected", "access"].includes(k)) || !safe(part.label) || typeof part.selected !== "boolean" || !["readOnly", "readWrite"].includes(String(part.access))) throw new Error("上下文子项无效");
            if (part.access === "readWrite" && !canWriteAgentContext(resource)) throw new Error("PDF 仅支持只读");
            if (kind === "manuscript" ? resource.kind !== "manuscriptFile" || resource.resourceId !== id : kind === "noteGroup" ? resource.kind !== "note" || resource.resourceId !== id : resource.kind === "manuscriptFile" || resource.kind === "templateCatalog" || resource.kind !== "note" && resource.kind !== "structuredObject" && resource.resourceId !== id) throw new Error("上下文子项不属于此对象");
            return {resource, label: part.label, selected: part.selected, access: part.access as AgentContextPart["access"]};
        });
        if (new Set(parts.map(part => agentContextKey(part.resource))).size !== parts.length) throw new Error("上下文子项重复");
        return {kind, resourceId: id, parts, ...(r.groupAccess === undefined ? {} : {groupAccess:r.groupAccess as "readOnly" | "readWrite"}), ...(r.newMemberAccess === undefined ? {} : {newMemberAccess:r.newMemberAccess as "readOnly" | "readWrite"})};
    }
    if ((r.kind === "structuredObject" || r.kind === "templateCatalog") && Object.keys(r).every(k => ["kind", "resourceId", "access"].includes(k)) && (r.access === undefined || r.access === "readOnly" || r.access === "readWrite")) return {kind:r.kind,resourceId:r.resourceId,...(r.access === undefined ? {} : {access:r.access})};
    if (r.kind === "paperNotes" && Object.keys(r).every(k => ["kind", "resourceId", "excludedNoteIds"].includes(k)) && Array.isArray(r.excludedNoteIds) && r.excludedNoteIds.length <= 256 && r.excludedNoteIds.every(safe) && new Set(r.excludedNoteIds).size === r.excludedNoteIds.length) {
        return {kind: "paperNotes", resourceId: r.resourceId, excludedNoteIds: [...r.excludedNoteIds]};
    }
    if ((r.kind === "paperMetadata" || r.kind === "paperPortrait") && Object.keys(r).every(k => ["kind", "resourceId"].includes(k))) return {kind: r.kind, resourceId: r.resourceId};
    if (r.kind === "note" && Object.keys(r).every(k => ["kind", "resourceId"].includes(k)))
        return { kind: r.kind, resourceId: r.resourceId };
    if (r.kind === "manuscriptFile" && safe(r.path) && Object.keys(r).every(k => ["kind", "resourceId", "path"].includes(k))) {
        if (r.path.startsWith("/") || r.path.includes("\\") || r.path.split("/").some(p => !p || p === "." || p === ".."))
            throw new Error("上下文文件路径无效");
        return { kind: r.kind, resourceId: r.resourceId, path: r.path };
    }
    if (r.kind === "paper" && Object.keys(r).every(k => ["kind", "resourceId", "attachmentId", "pageIndex"].includes(k))
        && (r.attachmentId === undefined || safe(r.attachmentId))
        && (r.pageIndex === undefined || (typeof r.pageIndex === "number" && Number.isSafeInteger(r.pageIndex) && r.pageIndex >= 0 && r.pageIndex <= 0xffffffff))) {
        return { kind: r.kind, resourceId: r.resourceId, ...(r.attachmentId === undefined ? {} : { attachmentId: r.attachmentId }), ...(r.pageIndex === undefined ? {} : { pageIndex: r.pageIndex }) };
    }
    throw new Error("上下文类型无效");
}
/** Resolve inventory against durable scope/overrides without freezing resource bodies.
 * Preferences are for UI restoration only; tool callers use the effective default. */
export function agentContextGroupParts(current: AgentContextGroupResource, saved: AgentContextGroupResource, preferences = false): readonly AgentContextPart[] {
    return current.parts.map(part => {
        const override = saved.parts.find(value => agentContextKey(value.resource) === agentContextKey(part.resource));
        const resolved: AgentContextPart = override ? {...override,label:part.label} : {
            ...part, selected: saved.newMemberAccess !== undefined && !(saved.kind === "paperGroup" && part.resource.kind === "note"),
            access: canWriteAgentContext(part.resource) ? saved.newMemberAccess ?? "readOnly" : "readOnly",
        };
        return {...resolved, access: !preferences && saved.groupAccess === "readOnly" ? "readOnly" : resolved.access};
    });
}
/** Managed text-directory permission, with exact path overrides taking precedence. */
export function agentContextPathAccess(group: AgentContextGroupResource, path: string, write = false): boolean {
    if (group.kind !== "manuscript" || path.startsWith("/") || path.includes("\\") || path.split("/").some(part => !part || part === "." || part === "..")) return false;
    if (write && group.groupAccess === "readOnly") return false;
    const part = group.parts.find(part => part.resource.kind === "manuscriptFile" && part.resource.path === path);
    if (part) return part.selected && (!write || part.access === "readWrite");
    return /\.(tex|bib|sty|cls|bst|bbx|cbx)$/iu.test(path) && !!group.newMemberAccess && (!write || group.newMemberAccess === "readWrite");
}
export function decodeAgentContextSelection(value: unknown): AgentContextSelection {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("上下文选择无效");
    const r = value as Record<string, unknown>;
    if (Object.keys(r).some(k => !["resource", "label"].includes(k)) || typeof r.label !== "string" || !r.label.trim() || r.label.length > 1024)
        throw new Error("上下文标签无效");
    return { resource: decodeAgentContextResource(r.resource), label: r.label };
}
export function decodeAgentContextState(value: unknown): AgentContextState {
    if (!value || typeof value !== "object")
        throw new Error("上下文配置无效");
    const r = value as Record<string, unknown>;
    if (r.schemaVersion !== 1 || Object.keys(r).some(k => !["schemaVersion", "persistent", "temporary"].includes(k)) || !Array.isArray(r.persistent) || !Array.isArray(r.temporary) || r.persistent.length + r.temporary.length > 32)
        throw new Error("上下文配置无效");
    const decode = (value: unknown) => compactAgentContextSelection(decodeAgentContextSelection(value));
    const state: AgentContextState = { schemaVersion: 1, persistent: r.persistent.map(decode), temporary: r.temporary.map(decode) };
    const keys = [...state.persistent, ...state.temporary].map(s => agentContextKey(s.resource));
    if (new Set(keys).size !== keys.length)
        throw new Error("上下文身份重复");
    return state;
}
export function selectAgentContext(state: AgentContextState, selected: AgentContextSelection, lifetime: "persistent" | "temporary"): AgentContextState {
    const item = decodeAgentContextSelection(selected), key = agentContextKey(item.resource);
    const next = { schemaVersion: 1 as const, persistent: state.persistent.filter(s => agentContextKey(s.resource) !== key), temporary: state.temporary.filter(s => agentContextKey(s.resource) !== key) };
    return decodeAgentContextState({ ...next, [lifetime]: [...next[lifetime], item] });
}
export function removeAgentContext(state: AgentContextState, resource: AgentContextResource): AgentContextState {
    const key = agentContextKey(resource);
    return { ...state, persistent: state.persistent.filter(s => agentContextKey(s.resource) !== key), temporary: state.temporary.filter(s => agentContextKey(s.resource) !== key) };
}
/** Freeze a deep copy before async materialization; UI navigation cannot mutate it. */
export function freezeAgentContext(state: AgentContextState): readonly AgentContextSelection[] {
    const valid = decodeAgentContextState(state);
    return [...valid.persistent, ...valid.temporary].map(s => ({ ...s, resource: decodeAgentContextResource(s.resource) }));
}
