import type { AgentReferenceInput } from "./userInput";
import {parseSourceLink, sourcePath} from "../sourceNavigation";
export interface SystemDocument {
    readonly id: string;
    readonly name: string;
    readonly workflow: "portrait" | "reading" | "shared";
    readonly path: string;
    readonly content: string;
    readonly baseline: string;
    readonly revision: string;
}
export interface SystemDocumentWrite {
    readonly id: string;
    readonly expectedRevision: string;
    readonly content: string;
    readonly baseline: string;
}
export interface SystemDocumentApproval {
    readonly id: string;
    readonly conversationId: string;
    readonly documentId: string;
    readonly name: string;
    readonly path: string;
    readonly before: string;
    readonly after: string;
}
export interface SystemDocumentGateway {
    list(): Promise<readonly SystemDocument[]>;
    read(id: string): Promise<SystemDocument>;
    write(input: SystemDocumentWrite): Promise<SystemDocument>;
    pending(conversationId: string): Promise<readonly SystemDocumentApproval[]>;
    decide(conversationId: string, requestId: string, allow: boolean): Promise<void>;
}
export function systemDocumentReference(document: SystemDocument): AgentReferenceInput {
    return { type: "mention", name: document.name, target: { kind: "file", sourceId: `builtin:${document.id}`,
            resourceId: document.id } };
}
export function systemDocumentId(reference: AgentReferenceInput): string | undefined {
    if (reference.type === "skill") return reference.identity.environment_id === "application" ? Object.entries(registeredPaths).find(([, path]) => path.startsWith("skills/") && reference.identity.source_id === ".agents/" + path)?.[0] : undefined;
    if (reference.type !== "mention" || reference.target.kind !== "file") return undefined;
    return reference.target.sourceId === `builtin:${reference.target.resourceId}` ? reference.target.resourceId
        : systemDocumentIdFromPath(reference.target.sourceId);
}

/** Registered Agent resource paths, independent of installation and content versions. */
const registeredPaths: Readonly<Record<string,string>> = {
  "structured-task": "prompts/structured-task.md",
  "structured-reading-contract": "prompts/structured-reading-contract.md",
  "generate-paper-portrait": "skills/generate-paper-portrait/SKILL.md",
  "edit-structured-resources": "skills/edit-structured-resources/SKILL.md",
  "portrait-reference": "skills/edit-structured-resources/references/portrait.md",
  "reading-reference": "skills/edit-structured-resources/references/reading.md",
  "templates-reference": "skills/edit-structured-resources/references/templates.md",
};
export function systemDocumentPath(id: string): string | undefined {
  return Object.hasOwn(registeredPaths,id) ? sourcePath("agents", ...registeredPaths[id]!.split("/")) : undefined;
}
export function systemDocumentIdFromPath(path: string): string | undefined {
  try {
    const link = parseSourceLink(path);
    if (link.locator || link.path[0] !== "agents") return undefined;
    return Object.entries(registeredPaths).find(([, registered]) => {
      const parts = registered.split("/");
      return link.path.length === parts.length + 1 && parts.every((part, index) => link.path[index + 1] === part);
    })?.[0];
  } catch { return undefined; }
}
export const systemDocumentIds: readonly string[] = Object.keys(registeredPaths);
