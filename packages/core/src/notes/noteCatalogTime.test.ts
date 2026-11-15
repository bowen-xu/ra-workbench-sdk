import {expect,it} from "vitest";
import samples from "../../../../tests/contracts/note-catalog-time.json";

it("shares the native catalog's UTC millisecond fixtures without rewriting original timestamps", () => {
  for (const sample of samples) {
    const value = Date.parse(sample.input);
    expect(Number.isFinite(value) ? value : null,sample.input).toBe(sample.milliseconds);
  }
});
