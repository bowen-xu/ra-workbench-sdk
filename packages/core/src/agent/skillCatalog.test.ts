import { describe, expect, it } from "vitest";
import { decodeAgentSkillCatalog } from "./skillCatalog";

const catalog = { schemaVersion: 1, environmentId: "application", skills: [{
  sourceId: ".agents/skills/review/SKILL.md", name: "review", description: "Review prose",
  revision: "sha256", allowImplicitInvocation: true, enabled: true,
}], errors: [{ sourceId: ".agents/skills/broken/SKILL.md", code: "invalid_document" }] };

describe("application skill catalog", () => {
  it("decodes native metadata and structured failures", () => {
    expect(decodeAgentSkillCatalog(catalog)).toEqual(catalog);
  });

  it.each([
    { ...catalog, environmentId: "manuscript" },
    { ...catalog, extra: true },
    { ...catalog, skills: [...catalog.skills, catalog.skills[0]] },
    { ...catalog, errors: [{ sourceId: "broken", code: "raw filesystem error" }] },
  ])("rejects malformed or authority-expanding catalogs", (value) => {
    expect(() => decodeAgentSkillCatalog(value)).toThrow();
  });
});
