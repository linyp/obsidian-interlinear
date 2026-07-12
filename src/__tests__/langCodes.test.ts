import { describe, it, expect } from "vitest";
import { mapTargetLang, MtServiceId } from "../translator/langCodes";

describe("mapTargetLang", () => {
  it("maps every settings language preset for every service", () => {
    const rows: Array<[string, Record<MtServiceId, string>]> = [
      ["zh-CN", { baidu: "zh", youdao: "zh-CHS" }],
      ["zh-TW", { baidu: "cht", youdao: "zh-CHT" }],
      ["en", { baidu: "en", youdao: "en" }],
      ["ja", { baidu: "jp", youdao: "ja" }],
      ["ko", { baidu: "kor", youdao: "ko" }],
      ["fr", { baidu: "fra", youdao: "fr" }],
      ["de", { baidu: "de", youdao: "de" }],
      ["es", { baidu: "spa", youdao: "es" }],
      ["ru", { baidu: "ru", youdao: "ru" }],
      ["pt-BR", { baidu: "pt", youdao: "pt" }],
    ];
    for (const [lang, expected] of rows) {
      for (const service of Object.keys(expected) as MtServiceId[]) {
        expect(mapTargetLang(service, lang)).toBe(expected[service]);
      }
    }
  });

  it("passes unknown custom codes through unchanged", () => {
    expect(mapTargetLang("baidu", "th")).toBe("th");
    expect(mapTargetLang("youdao", "th")).toBe("th");
    expect(mapTargetLang("youdao", "pt-PT")).toBe("pt-PT");
  });

  it("trims surrounding whitespace before lookup", () => {
    expect(mapTargetLang("baidu", " zh-CN ")).toBe("zh");
    expect(mapTargetLang("youdao", " it ")).toBe("it");
  });
});
