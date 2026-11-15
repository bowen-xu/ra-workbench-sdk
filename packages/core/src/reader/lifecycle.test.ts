import { describe, expect, it } from "vitest";

import { nextReaderLifecycleState } from "./lifecycle";

describe("reader lifecycle", () => {
  it("moves through hidden, trimmed, suspended, active, and disposed states", () => {
    expect(nextReaderLifecycleState("active", "hide")).toBe("hidden");
    expect(nextReaderLifecycleState("hidden", "trim")).toBe("trimmed");
    expect(nextReaderLifecycleState("trimmed", "suspend")).toBe("suspended");
    expect(nextReaderLifecycleState("suspended", "activate")).toBe("active");
    expect(nextReaderLifecycleState("active", "dispose")).toBe("disposed");
    expect(nextReaderLifecycleState("disposed", "activate")).toBe("disposed");
  });
});
