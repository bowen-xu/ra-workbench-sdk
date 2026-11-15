import { describe, expect, it } from "vitest";

import { ReaderNavigationHistory } from "./history";

describe("ReaderNavigationHistory", () => {
  it("keeps explicit points while coalescing rapid and transient locations", () => {
    let now = 10_000;
    const history = new ReaderNavigationHistory({ now: () => now });
    history.save({ pageIndex: 0 });
    now += 2_100;
    history.save({ pageIndex: 4 });
    now += 200;
    history.save({ pageIndex: 5 });
    expect(history.snapshot()).toMatchObject({
      back: [{ pageIndex: 0 }, { pageIndex: 4 }],
      current: { pageIndex: 5 },
      canNavigateBack: true,
    });

    now += 2_100;
    history.save({ pageIndex: 5, top: 100 }, "transient");
    now += 100;
    history.save({ pageIndex: 5, top: 180 }, "transient");
    expect(history.snapshot().back).toEqual([{ pageIndex: 0 }, { pageIndex: 4 }, { pageIndex: 5 }]);
    expect(history.snapshot().current).toEqual({ pageIndex: 5, top: 180 });
  });

  it("supports back and forward without saving navigation as a new point", () => {
    let now = 0;
    const history = new ReaderNavigationHistory({ minimumPointIntervalMs: 0, now: () => now++ });
    history.save({ pageIndex: 1 });
    history.save({ pageIndex: 4 });
    history.save({ annotationId: "note-1" });
    expect(history.navigateBack()).toEqual({ pageIndex: 4 });
    expect(history.navigateBack()).toEqual({ pageIndex: 1 });
    expect(history.navigateForward()).toEqual({ pageIndex: 4 });
    expect(history.snapshot()).toMatchObject({ canNavigateBack: true, canNavigateForward: true });
  });

  it("keeps semantic source metadata while a transient view refines the same target page", () => {
    let now = 0;
    const history = new ReaderNavigationHistory({ now: () => now });
    history.save({ pageIndex: 0 });
    now += 2_100;
    history.save({
      pageIndex: 4,
      annotationId: "note-1",
      position: { segments: [{ pageIndex: 4, rects: [], exactText: "evidence" }] },
    }, "hard");
    now += 50;
    history.save({ pageIndex: 4, scale: { kind: "numeric", value: 1.5 }, top: 640, left: 12 }, "transient");
    expect(history.snapshot().current).toEqual({
      pageIndex: 4,
      annotationId: "note-1",
      position: { segments: [{ pageIndex: 4, rects: [], exactText: "evidence" }] },
      scale: { kind: "numeric", value: 1.5 },
      top: 640,
      left: 12,
    });
  });

  it("skips invalid or explicitly excluded points", () => {
    const history = new ReaderNavigationHistory();
    history.save({ pageIndex: 1 }, "skip");
    expect(history.snapshot().current).toBeUndefined();
    expect(() => history.save({ pageIndex: -1 })).toThrow(TypeError);
  });
});
