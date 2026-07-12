/**
 * Target-language code mapping for the traditional machine-translation
 * services. PURE — no `obsidian`, no network.
 *
 * The plugin stores one generic (BCP-47-ish) `targetLang`; each MT service
 * speaks its own dialect of language codes. The table covers the language
 * presets offered in settings; anything else (a custom code the user typed)
 * is passed through unchanged — the service itself rejects codes it doesn't
 * support, and that error is surfaced to the user. LLM providers receive the
 * generic code verbatim and are not routed through this module.
 */

/** The traditional MT backends (the LLM path is not one of these). */
export type MtServiceId = "baidu" | "youdao";

/** settings.targetLang value → per-service code, for the settings presets. */
const LANG_TABLE: Record<string, Record<MtServiceId, string>> = {
  "zh-CN": { baidu: "zh", youdao: "zh-CHS" },
  "zh-TW": { baidu: "cht", youdao: "zh-CHT" },
  en: { baidu: "en", youdao: "en" },
  ja: { baidu: "jp", youdao: "ja" },
  ko: { baidu: "kor", youdao: "ko" },
  fr: { baidu: "fra", youdao: "fr" },
  de: { baidu: "de", youdao: "de" },
  es: { baidu: "spa", youdao: "es" },
  ru: { baidu: "ru", youdao: "ru" },
  "pt-BR": { baidu: "pt", youdao: "pt" },
};

/**
 * Map the generic target language to the code `service` expects. Unknown
 * codes pass through unchanged so the "Custom language code" setting keeps
 * working beyond the preset table.
 */
export function mapTargetLang(service: MtServiceId, targetLang: string): string {
  const lang = targetLang.trim();
  return LANG_TABLE[lang]?.[service] ?? lang;
}
