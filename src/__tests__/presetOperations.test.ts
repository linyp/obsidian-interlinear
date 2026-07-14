import { describe, expect, it } from "vitest";
import {
  ActivePresetPatch,
  ActivePresetSettings,
  getActivePresetSettings,
  InterlinearSettings,
  isLlmPresetId,
  normalizeSettings,
  selectPreset,
  SETTINGS_SCHEMA_VERSION,
  TranslationPresetId,
  updateActivePreset,
} from "../settings";

type PatchEntry = readonly [keyof ActivePresetPatch, string | number];

interface PresetCase {
  id: TranslationPresetId;
  fields: ReadonlyArray<PatchEntry>;
}

const PRESET_CASES: ReadonlyArray<PresetCase> = [
  {
    id: "deepseek",
    fields: [
      ["apiKey", "key-deepseek"],
      ["model", "model-deepseek"],
      ["concurrency", 8],
    ],
  },
  {
    id: "openai",
    fields: [
      ["apiKey", "key-openai"],
      ["customInstructions", "openai glossary"],
      ["minIntervalMs", 321],
    ],
  },
  {
    id: "siliconflow",
    fields: [
      ["apiKey", "key-siliconflow"],
      ["model", "model-siliconflow"],
      ["maxRetries", 7],
    ],
  },
  {
    id: "ollama",
    fields: [
      ["apiKey", "local"],
      ["baseUrl", "http://127.0.0.1:11434/v1"],
      ["batchCharBudget", 2345],
    ],
  },
  {
    id: "custom",
    fields: [
      ["apiKey", "key-custom"],
      ["baseUrl", "https://custom.example.com/v1"],
      ["model", "custom-model"],
    ],
  },
  {
    id: "baidu",
    fields: [
      ["appId", "baidu-id"],
      ["appSecret", "baidu-secret"],
      ["minIntervalMs", 1150],
    ],
  },
  {
    id: "youdao",
    fields: [
      ["appKey", "youdao-key"],
      ["appSecret", "youdao-secret"],
      ["concurrency", 3],
    ],
  },
];

function permutations<T>(items: ReadonlyArray<T>): T[][] {
  if (items.length === 0) return [[]];
  const result: T[][] = [];
  for (let index = 0; index < items.length; index++) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([items[index], ...tail]);
  }
  return result;
}

/** Every non-empty field subset, in every possible modification order. */
function orderedFieldSelections<T>(items: ReadonlyArray<T>): T[][] {
  const result: T[][] = [];
  const visit = (prefix: T[], remaining: T[]): void => {
    if (prefix.length > 0) result.push(prefix);
    for (let index = 0; index < remaining.length; index++) {
      visit(
        [...prefix, remaining[index]],
        [...remaining.slice(0, index), ...remaining.slice(index + 1)]
      );
    }
  };
  visit([], [...items]);
  return result;
}

function patchFrom(entries: ReadonlyArray<PatchEntry>): ActivePresetPatch {
  return Object.fromEntries(entries) as ActivePresetPatch;
}

function roundTrip(settings: InterlinearSettings): InterlinearSettings {
  return normalizeSettings(JSON.parse(JSON.stringify(settings)) as unknown);
}

function recordFor(
  settings: InterlinearSettings,
  id: TranslationPresetId
): ActivePresetSettings | undefined {
  if (isLlmPresetId(id)) return settings.presets.llm[id];
  return id === "baidu" ? settings.presets.mt.baidu : settings.presets.mt.youdao;
}

describe("generated preset user-operation sequences", () => {
  it("restores each record after every ordering of representative preset selections", () => {
    const representatives = PRESET_CASES.filter(({ id }) =>
      ["deepseek", "custom", "baidu", "youdao"].includes(id)
    );

    for (const order of permutations(representatives)) {
      let settings = normalizeSettings({
        settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
        service: "deepseek",
        targetLang: "ja",
        showFab: "always",
        presets: { llm: {}, mt: {} },
      });

      for (const preset of order) {
        const existed = recordFor(settings, preset.id);
        settings = selectPreset(settings, preset.id);
        expect(recordFor(settings, preset.id)).toBeDefined();
        if (existed) expect(recordFor(settings, preset.id)).toEqual(existed);

        settings = updateActivePreset(settings, patchFrom(preset.fields));
        settings = roundTrip(settings);
      }

      for (const preset of representatives) {
        settings = selectPreset(settings, preset.id);
        expect(settings.service).toBe(preset.id);
        expect(getActivePresetSettings(settings)).toMatchObject(patchFrom(preset.fields));
        expect(settings.targetLang).toBe("ja");
        expect(settings.showFab).toBe("always");
      }
    }
  });

  it("handles every one-field/multi-field subset in every edit order", () => {
    for (const preset of PRESET_CASES) {
      for (const orderedFields of orderedFieldSelections(preset.fields)) {
        let settings = selectPreset(normalizeSettings(null), preset.id);
        const expected = { ...getActivePresetSettings(settings) } as Record<string, unknown>;

        for (const [key, value] of orderedFields) {
          settings = updateActivePreset(settings, { [key]: value } as ActivePresetPatch);
          settings = roundTrip(settings);
          expected[key] = value;
        }

        expect(getActivePresetSettings(settings)).toEqual(expected);
      }
    }
  });

  it("isolates edits across every ordered pair of preset transitions", () => {
    for (const first of PRESET_CASES) {
      for (const second of PRESET_CASES) {
        if (first.id === second.id) continue;

        let settings = selectPreset(normalizeSettings(null), first.id);
        settings = updateActivePreset(settings, patchFrom(first.fields));
        const firstRecord = JSON.stringify(recordFor(settings, first.id));

        settings = selectPreset(settings, second.id);
        settings = updateActivePreset(settings, patchFrom(second.fields));
        settings = roundTrip(settings);

        expect(JSON.stringify(recordFor(settings, first.id))).toBe(firstRecord);
        expect(recordFor(settings, second.id)).toMatchObject(patchFrom(second.fields));

        settings = selectPreset(settings, first.id);
        expect(JSON.stringify(getActivePresetSettings(settings))).toBe(firstRecord);
      }
    }
  });
});
