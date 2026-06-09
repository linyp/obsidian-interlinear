import { describe, it, expect } from "vitest";
import { nextFabAction } from "../ui/fabState";

describe("nextFabAction", () => {
  it("translates (activates) when the note is not yet active", () => {
    expect(nextFabAction(false)).toBe("translate");
  });

  it("toggles display mode once the note is active (no re-request)", () => {
    expect(nextFabAction(true)).toBe("toggle-mode");
  });
});
