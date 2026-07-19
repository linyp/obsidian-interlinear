<h1 align="center">Interlinear</h1>

<p align="center">
  為 <a href="https://obsidian.md">Obsidian</a> 打造的閱讀模式逐段對照翻譯
</p>

<p align="center">
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.md">English</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-CN.md">简体中文</a> ·
  <strong>繁體中文</strong> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ja.md">日本語</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ko.md">한국어</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.vi.md">Tiếng Việt</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.ru.md">Русский</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.pt-BR.md">Português (Brasil)</a> ·
  <a href="https://github.com/linyp/obsidian-interlinear/blob/main/README.es.md">Español</a>
</p>

<p align="center">
  <img src="images/interlinear-bilingual.png" alt="Interlinear 在 Obsidian 中逐段顯示雙語對照翻譯" width="900">
</p>

一款用於 [Obsidian](https://obsidian.md) 閱讀模式的**逐段對照翻譯**外掛。
開啟外語筆記並按下翻譯按鈕，Interlinear 會把繁體中文或其他目標語言的譯文
顯示在每一段原文下方。你可以檢視雙語對照，也可以只看譯文。

> 外掛介面目前仍為英文。本 README 中的設定與指令名稱會保留實際英文介面的寫法，
> 方便你在 Obsidian 中找到對應項目。

## 以安全為核心的設計

- **絕不修改筆記。** 譯文只會注入顯示層 DOM。關閉並重新開啟筆記後，磁碟上的
  Markdown 檔案仍會逐位元組保持不變。
- **絕不自動翻譯。** 開啟或切換筆記、捲動頁面、變更版面或設定都不會發送翻譯請求。
  只有在你明確使用懸浮按鈕、狀態列或命令面板時才會開始翻譯。
- **BYOK、零遙測。** API key 與應用程式憑證只會儲存在 Vault 內的外掛設定中，
  且僅傳送給你選擇的翻譯服務。
- **僅支援閱讀模式。** 不支援編輯模式與 Live Preview。

## 主要功能

- **按一下翻譯整篇筆記。** 桌面端使用狀態列，行動裝置使用右下角懸浮按鈕。
  翻譯期間會顯示分批進度（例如 `3/12`）。
- **兩種顯示模式。** 可立即在雙語對照（原文 + 譯文）與僅譯文之間切換，
  不會重新發送翻譯請求。僅譯文模式下，把滑鼠移到譯文上或輕觸譯文即可暫時查看原文。
- **五種顯示樣式。** 邊框、引用區塊、淡色文字、虛線底線和學習遮罩都只透過 CSS 切換。
- **持久化翻譯快取。** 結果以內容雜湊為索引，並儲存在外掛目錄的 `cache.json` 中，
  減少重複翻譯的等待時間與費用；快取不會儲存原文。
- **相容 Obsidian 虛擬化渲染。** 畫面中的段落會立即翻譯，其餘內容會先翻譯並寫入快取，
  捲動時再注入已有結果。
- **略過不應翻譯的內容。** 程式碼、公式、只有圖片、URL、符號或數字的區塊，
  以及能可靠判斷為已使用目標語言的內容都會略過。
- **可替換的後端。** 支援 DeepSeek、OpenAI、SiliconFlow、Ollama、自訂 OpenAI 相容
  endpoint、百度翻譯與有道智雲。所有網路請求都透過 Obsidian 的 `requestUrl` 發送。
- **目標語言預設。** 內建繁體中文（`zh-TW`）、簡體中文、英文、日文（`ja`）、
  韓文（`ko`）、越南文（`vi`）、俄文（`ru`）、巴西葡萄牙文（`pt-BR`）、
  西班牙文（`es`）等，也可以自行輸入語言代碼。

## 網路、帳號與隱私

- 只有在你明確啟動翻譯或按下 **Test connection** 時，外掛才會把需要翻譯的段落
  傳送到目前選擇的服務。
- 你需要自行提供 API key 或應用程式憑證，費用由所選服務商收取，而不是 Interlinear。
- 外掛不收集使用統計，也不會傳送分析資料。
- 設定儲存在 `data.json`；遷移設定前的一次性備份可能位於 `data.backup.json`；
  翻譯快取則位於 `cache.json`。這些檔案都在外掛目錄中。
- 同步 Vault 時，憑證也可能同步到其他裝置。若使用 Git 管理 Vault，請至少把
  `.obsidian/plugins/interlinear/data.json` 與
  `.obsidian/plugins/interlinear/data.backup.json` 加入 `.gitignore`。

## 安裝

### 從 Obsidian 安裝（推薦）

1. 開啟 **Settings → Community plugins → Browse**。
2. 搜尋 **Interlinear**，然後選擇 **Install** 與 **Enable**。

也可以直接開啟[外掛目錄頁面](https://obsidian.md/plugins?id=interlinear)，再按下
**Install**。

### 從 v0.2.5 升級到 v0.3.0

v0.3.0 使用 settings schema v2。v0.2.5 的扁平設定只會遷移一次；重新寫入
`data.json` 之前，原始資料會備份到 `data.backup.json`。

若你有同步外掛設定，請先在**所有同步裝置上更新 Interlinear，再變更任何設定**。
不支援混用不同外掛版本，也不支援遷移後降級。

### BRAT / 手動安裝

- 若想在正式外掛目錄發布前取得新版本，請安裝
  [BRAT](https://github.com/TfTHacker/obsidian42-brat)，執行
  **BRAT: Add a beta plugin for testing**，並輸入 `linyp/obsidian-interlinear`。
- 手動安裝時，請從[最新版本](https://github.com/linyp/obsidian-interlinear/releases/latest)
  下載 `main.js`、`manifest.json` 和 `styles.css`，再放入
  `<your-vault>/.obsidian/plugins/interlinear/`。

## 設定

開啟 **Settings → Interlinear**。

| 設定 | 預設值 | 說明 |
| --- | --- | --- |
| Service | DeepSeek | 選擇 LLM 或傳統機器翻譯。每個預設會分別保留自己的憑證與進階設定。 |
| API key _（僅 LLM）_ | _空白_ | 所選 LLM 服務的 API key。 |
| App ID + secret _（Baidu / Youdao）_ | _空白_ | 服務開發者主控台中的應用程式憑證。 |
| Base URL _（僅 LLM）_ | `https://api.deepseek.com` | OpenAI 相容 endpoint。 |
| Model _（僅 LLM）_ | `deepseek-v4-flash` | 使用的模型名稱。 |
| Test connection | — | 發送一個小型請求以驗證憑證與連線。 |
| Target language | `zh-CN` | 選擇 `zh-TW`、`pt-BR`、`es`、`ru` 等預設，或輸入自訂語言代碼。 |
| Default display mode | Bilingual | 第一次翻譯後使用的顯示方式。 |
| Translation style | Border | 譯文的視覺樣式。 |
| Floating button | Mobile only | Always / mobile only / never。 |
| Concurrency | 10 | 同時進行的請求上限。 |
| Min interval (ms) | 0 | 各請求開始時間之間的最短間隔。 |
| Max retries | 3 | 遇到 429 或暫時性錯誤時的重試次數。 |
| Batch char budget | 4000 | 單一請求合併的字元上限。 |
| Max segments per request | 12 | 單一請求合併的區塊上限。 |
| Custom instructions _（僅 LLM）_ | _空白_ | 把術語、語氣或領域指示加入 prompt；內容也會納入快取識別。 |
| Persistent cache | On | 重新啟動後仍保留翻譯快取。 |

## 使用方式

1. 開啟筆記並切換到 **reading view**。
2. 桌面端按下狀態列中的 **Translate**；行動裝置按下右下角懸浮按鈕。
3. 再按一次即可在譯文與原文之間切換。
4. 使用模式按鈕在 **bilingual** 與 **translation-only** 之間切換；此操作不會發送新的翻譯請求。

命令面板提供以下指令。外掛不會設定預設快捷鍵。

- **Interlinear: Translate / show original**
- **Interlinear: Toggle display mode (bilingual / translation-only)**
- **Interlinear: Clear translations**

## 開發

建置、測試、發布與架構說明請參閱
[英文 README 的 Develop 章節](https://github.com/linyp/obsidian-interlinear/blob/main/README.md#develop)。

## 限制

- 僅支援閱讀模式；不支援編輯模式或 Live Preview。
- 清單與表格會作為單一區塊翻譯。扁平清單會重新建構為清單，但巢狀結構無法完整還原。

## 授權

MIT
