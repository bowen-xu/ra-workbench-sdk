import { describe, expect, it } from "vitest";
import { createAgentSubtaskGateway } from "./subtasks";

const parent = "11111111-1111-4111-8111-111111111111";
const child = "22222222-2222-4222-8222-222222222222";
const row = { schemaVersion: 1, childConversationId: child, parentConversationId: parent, parentContextSnapshotId: parent, childContextSnapshotId: child, depth: 1, modelCalls: 2, toolCalls: 3, status: "running", createdAt: "2026-09-12T00:00:00Z", finishedAt: null };

describe("agent child task gateway", () => {
  it("validates the parent identity and projects bounded lifecycle records", async () => {
    const invoke = async (command: string, args: Record<string, unknown>) => {
      expect(command).toBe("agent_list_child_tasks");
      expect(args).toEqual({ parentConversationId: parent, limit: 64 });
      return [row];
    };
    await expect(createAgentSubtaskGateway(invoke).list(parent)).resolves.toEqual([row]);
    await expect(createAgentSubtaskGateway(invoke).list("bad")).rejects.toThrow("invalid child task request");
  });

  it("reconciles one child without exposing execution controls", async () => {
    const invoke = async (command: string, args: Record<string, unknown>) => {
      expect(command).toBe("agent_reconcile_child_task");
      expect(args).toEqual({ parentConversationId: parent, childConversationId: child });
      return { ...row, status: "completed" };
    };
    await expect(createAgentSubtaskGateway(invoke).reconcile(parent, child)).resolves.toMatchObject({ status: "completed" });
    await expect(createAgentSubtaskGateway(invoke).reconcile(parent, "bad")).rejects.toThrow("invalid child task request");
  });

  it("keeps host-specific resume commands identity-scoped", async () => {
    const paper = "paper-123";
    const invoke = async (command: string, args: Record<string, unknown>) => {
      expect(command).toBe("agent_resume_paper_child");
      expect(args).toEqual({ parentConversationId: parent, childConversationId: child, paperId: paper });
      return null;
    };
    await expect(createAgentSubtaskGateway(invoke).resumePaper(parent, child, paper)).resolves.toBeUndefined();
    await expect(createAgentSubtaskGateway(invoke).resumeNote(parent, child, "bad")).rejects.toThrow("invalid child task request");
  });

  it("resumes reading-note children through their own binding command", async () => {
    const readingNote = "33333333-3333-4333-8333-333333333333";
    const invoke = async (command: string, args: Record<string, unknown>) => {
      expect(command).toBe("agent_resume_reading_note_child");
      expect(args).toEqual({ parentConversationId: parent, childConversationId: child, readingNoteId: readingNote });
      return null;
    };
    await expect(createAgentSubtaskGateway(invoke).resumeReadingNote(parent, child, readingNote)).resolves.toBeUndefined();
  });
});
