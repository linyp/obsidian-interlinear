/**
 * Pure FAB state machine. The single floating button either starts translation
 * or, once a note is active, toggles the display mode. Unit-testable with no DOM.
 */
export type FabAction = "translate" | "toggle-mode";

export function nextFabAction(active: boolean): FabAction {
  // Not yet active -> a click activates translation; already active -> toggle mode
  // (bilingual <-> translation-only), never a re-request.
  return active ? "toggle-mode" : "translate";
}
