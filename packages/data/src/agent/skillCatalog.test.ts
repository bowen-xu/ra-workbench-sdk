import { describe, expect, it, vi } from "vitest";
import { createAgentSkillCatalogGateway } from "./skillCatalog";

describe("application skill catalog gateway", () => {
  it("lists only through the fixed native application root", async () => {
    const response = { schemaVersion: 1, environmentId: "application", skills: [], errors: [] };
    const invoke = vi.fn(async () => response);
    await expect(createAgentSkillCatalogGateway(invoke).list()).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_list_application_skills", {});
  });

  it("writes an exact revision-bound skill identity", async () => {
    const response = { schemaVersion: 1, environmentId: "application", skills: [], errors: [] };
    const invoke = vi.fn(async () => response);
    const gateway = createAgentSkillCatalogGateway(invoke);
    await expect(gateway.setEnabled(".agents/skills/review/SKILL.md", "sha256", false)).resolves.toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_set_application_skill_enabled", { request: { sourceId: ".agents/skills/review/SKILL.md", revision: "sha256", enabled: false } });
    await expect(gateway.setEnabled("../outside/SKILL.md", "sha256", false)).rejects.toThrow();
  });
});
