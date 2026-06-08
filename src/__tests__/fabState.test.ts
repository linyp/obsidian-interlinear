import { describe, it, expect } from "vitest";
import { nextFabAction } from "../ui/fabState";

describe("nextFabAction", () => {
  it("translates on the first click (untranslated)", () => {
    expect(nextFabAction("untranslated")).toBe("translate");
  });

  it("is busy while a translation is in flight (prevents double-fire)", () => {
    expect(nextFabAction("translating")).toBe("busy");
  });

  it("toggles display mode once translated (no re-request)", () => {
    expect(nextFabAction("translated")).toBe("toggle-mode");
  });
});
