/**
 * Pure FAB state machine. The single floating button does different things
 * depending on the current note's translation state — this reducer decides
 * which, and is unit-testable without any DOM/obsidian.
 */
export type TranslateState = "untranslated" | "translating" | "translated";

export type FabAction = "translate" | "busy" | "toggle-mode";

const ACTION_BY_STATE: Record<TranslateState, FabAction> = {
  untranslated: "translate", // first click translates
  translating: "busy", // ignore clicks while a translation is in flight
  translated: "toggle-mode", // subsequent clicks flip bilingual <-> translation-only
};

export function nextFabAction(state: TranslateState): FabAction {
  return ACTION_BY_STATE[state];
}
