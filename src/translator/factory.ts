/**
 * Provider factory — the single place that maps `settings.service` to a
 * concrete {@link TranslationProvider}. Everything downstream (controller,
 * settings-tab test button) is service-agnostic: it asks for a provider and
 * calls translate(). PURE — no `obsidian`; the transport stays injected.
 */
import { HttpClient, TranslationProvider } from "./provider";
import { InterlinearSettings, toProviderConfig } from "../settings";
import { DeepSeekProvider } from "./deepseek";
import { BaiduProvider } from "./baidu";
import { YoudaoProvider } from "./youdao";

export function createProvider(s: InterlinearSettings, http: HttpClient): TranslationProvider {
  switch (s.service) {
    case "baidu":
      return new BaiduProvider({
        config: { appId: s.baidu.appId, appSecret: s.baidu.appSecret, targetLang: s.targetLang },
        http,
      });
    case "youdao":
      return new YoudaoProvider({
        config: { appKey: s.youdao.appKey, appSecret: s.youdao.appSecret, targetLang: s.targetLang },
        http,
      });
    default:
      return new DeepSeekProvider({ config: toProviderConfig(s), http });
  }
}
