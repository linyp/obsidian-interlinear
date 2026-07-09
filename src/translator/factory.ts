/**
 * Provider factory — picks the {@link TranslationProvider} implementation for
 * the current settings. Keeps `TranslationProvider` decisions out of the UI /
 * controller: they just call `createProvider(settings, http)` and use the
 * result. Adding a new backend later (Gemini/Claude/whatever) means adding a
 * `ProviderKind` case here — the call sites stay identical.
 *
 * Pure: no `obsidian`, no DOM, no network — the transport is passed in.
 */
import { InterlinearSettings, toProviderConfig } from "../settings";
import { HttpClient, TranslationProvider } from "./provider";
import { DeepSeekProvider } from "./deepseek";
import { BaiduProvider } from "./baidu";

/**
 * Build the provider for the current settings. The `apiKey`/`baseUrl`/`model`
 * fields on {@link ProviderConfig} carry backend-specific meaning — see
 * {@link ProviderKind} — but by this point the setting-time normalization
 * already stored them in the right shape.
 */
export function createProvider(
  settings: InterlinearSettings,
  http: HttpClient
): TranslationProvider {
  const config = toProviderConfig(settings);
  switch (settings.providerKind) {
    case "baidu":
      return new BaiduProvider({ config, http });
    case "openai":
    default:
      return new DeepSeekProvider({ config, http });
  }
}
