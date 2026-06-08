import { Plugin } from "obsidian";

/**
 * Interlinear — reading-mode immersive translation for Obsidian.
 *
 * Milestone 1: skeleton only. Deliberately does nothing at load time —
 * no post-processor, no FAB, no network, no Vault writes. The translation
 * pipeline (render layer, settings, and the FAB that is the *only* translate
 * trigger) is wired in later milestones.
 */
export default class InterlinearPlugin extends Plugin {
  async onload(): Promise<void> {
    // Intentionally empty for the skeleton milestone.
  }

  onunload(): void {
    // Everything is registered via register*/add* helpers in later milestones,
    // so Obsidian tears it all down automatically — nothing to clean up here.
  }
}
