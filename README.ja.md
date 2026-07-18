# Interlinear

[English](https://github.com/linyp/obsidian-interlinear/blob/main/README.md) · [简体中文](https://github.com/linyp/obsidian-interlinear/blob/main/README.zh-CN.md) · **日本語** · [한국어](https://github.com/linyp/obsidian-interlinear/blob/main/README.ko.md) · [Tiếng Việt](https://github.com/linyp/obsidian-interlinear/blob/main/README.vi.md)

[Obsidian](https://obsidian.md) のリーディングビューで使う、段落ごとの**対訳翻訳**プラグインです。
外国語のノートを開いてボタンを押すと、原文の各段落の下に日本語または任意の対象言語の
翻訳を表示します。原文と訳文の併記、または訳文のみの表示を選べます。

> 現在、プラグインの UI は英語です。この README では、設定名やコマンド名を実際の英語 UI に
> 合わせて記載しています。

## 安全性を重視した設計

- **ノートを変更しません。** 翻訳はレンダリング層の DOM にだけ挿入されます。ノートを閉じて
  開き直しても、Markdown ファイルは一切変更されません。
- **自動翻訳しません。** ノートを開く、切り替える、スクロールする、設定を変更するといった
  操作では翻訳リクエストを送りません。翻訳は、フローティングボタン、ステータスバー、または
  コマンドパレットからユーザーが明示的に実行した場合に限られます。
- **BYOK、テレメトリなし。** API キーやアプリ認証情報は Vault 内のプラグイン設定ファイルに
  のみ保存され、指定した翻訳サービス以外には送信されません。
- **リーディングビュー専用**です。編集モードや Live Preview は対象外です。

## 主な機能

- **ワンクリックでノート全体を翻訳。** デスクトップではステータスバー、モバイルでは右下の
  フローティングボタンから実行できます。処理中は進捗（`3/12` など）を表示します。
- **2 つの表示モード。** 原文＋訳文のバイリンガル表示と、訳文のみの表示を再翻訳なしで
  切り替えられます。訳文のみの表示では、ホバーまたはタップで原文を確認できます。
- **5 種類の表示スタイル。** ボーダー、引用、控えめな文字、破線下線、学習用マスクを
  CSS だけで即時に切り替えられます。
- **永続翻訳キャッシュ。** 内容ハッシュをキーにして `cache.json` に保存するため、同じ段落を
  再度翻訳する費用を抑えられます。原文そのものはキャッシュに保存しません。
- **Obsidian の仮想化表示に対応。** 表示中の段落をすぐに翻訳し、残りをキャッシュへ先読みし、
  スクロール時にキャッシュ済みの訳文だけを挿入します。
- **翻訳不要な内容を除外。** コード、数式、画像のみのブロック、URL、記号・数字のみのブロック、
  および対象言語であると安全に判定できるブロックをスキップします。
- **複数のバックエンド。** DeepSeek、OpenAI、SiliconFlow、Ollama、任意の OpenAI 互換
  エンドポイントに加え、Baidu Translate（百度翻译）と Youdao（有道智云）を選択できます。
  リクエストには Obsidian の `requestUrl` を使用します。
- **対象言語プリセット。** 日本語（`ja`）、韓国語（`ko`）、ベトナム語（`vi`）、簡体字・繁体字、
  英語などを選択でき、カスタム言語コードも入力できます。

## ネットワーク、アカウント、プライバシー

- **外部サービスを使用します。** 翻訳を実行するか **Test connection** を押した場合に限り、
  翻訳対象の段落を現在選択中のサービスへ送信します。
- **アカウントが必要です。** 選択したサービスの API キーまたはアプリ認証情報をご用意ください。
  利用料金は各サービスから請求され、Interlinear から請求されることはありません。
- **テレメトリはありません。** 利用状況の収集や分析データの送信は行いません。
- 設定は `data.json`、移行前の一時バックアップは `data.backup.json`、翻訳キャッシュは
  `cache.json` に保存されます。いずれもプラグインフォルダー内だけに置かれます。
- Vault を同期すると認証情報も同期されます。Vault を Git 管理する場合は、少なくとも
  `.obsidian/plugins/interlinear/data.json` と
  `.obsidian/plugins/interlinear/data.backup.json` を `.gitignore` に追加してください。

## インストール

### Obsidian から（推奨）

1. **Settings → Community plugins → Browse** を開きます。
2. **Interlinear** を検索し、**Install**、続いて **Enable** を選択します。

または [プラグインディレクトリのページ](https://obsidian.md/plugins?id=interlinear) を開き、
**Install** を押します。

### v0.2.5 から v0.3.0 へのアップグレード

v0.3.0 は設定スキーマ v2 を使用します。v0.2.5 の設定は一度だけ移行され、元のデータは
`data.json` を書き換える前に `data.backup.json` へ保存されます。

プラグイン設定を同期している場合は、設定を変更する前に**同期対象の全デバイス**で
Interlinear を更新してください。異なるバージョンの併用と、移行後のダウングレードは
サポートされません。

### BRAT / 手動インストール

- 先行版を利用する場合は [BRAT](https://github.com/TfTHacker/obsidian42-brat) をインストールし、
  **BRAT: Add a beta plugin for testing** で `linyp/obsidian-interlinear` を指定します。
- 手動の場合は [最新リリース](https://github.com/linyp/obsidian-interlinear/releases/latest) から
  `main.js`、`manifest.json`、`styles.css` をダウンロードし、
  `<your-vault>/.obsidian/plugins/interlinear/` に配置します。

## 設定

**Settings → Interlinear** を開きます。

| 設定 | 初期値 | 説明 |
| --- | --- | --- |
| Service | DeepSeek | LLM または従来型機械翻訳サービスを選択します。各プリセットは認証情報と詳細設定を個別に保持します。 |
| API key _(LLM のみ)_ | _空_ | 選択した LLM サービスの API キーです。 |
| App ID + secret _(Baidu / Youdao)_ | _空_ | 各サービスの開発者コンソールで取得する認証情報です。 |
| Base URL _(LLM のみ)_ | `https://api.deepseek.com` | OpenAI 互換エンドポイントです。 |
| Model _(LLM のみ)_ | `deepseek-v4-flash` | 使用するモデル名です。 |
| Test connection | — | 小さなリクエストを 1 回送信して接続を確認します。 |
| Target language | `zh-CN` | `ja`、`ko`、`vi` などのプリセット、またはカスタム言語コードを選択します。 |
| Default display mode | Bilingual | 初回翻訳後の表示形式です。 |
| Translation style | Border | 訳文の表示スタイルです。 |
| Floating button | Mobile only | Always / mobile only / never。 |
| Concurrency | 10 | 同時に実行するリクエスト数です。 |
| Min interval (ms) | 0 | リクエスト開始間隔です。 |
| Max retries | 3 | 429 や一時的なエラーに対する再試行回数です。 |
| Batch char budget | 4000 | 1 回のリクエストにまとめる最大文字数です。 |
| Max segments per request | 12 | 1 回のリクエストにまとめる最大ブロック数です。 |
| Custom instructions _(LLM のみ)_ | _空_ | 用語、文体、分野などをプロンプトへ追加します。変更内容はキャッシュ識別子にも反映されます。 |
| Persistent cache | On | 再起動後も翻訳キャッシュを保持します。 |

## 使い方

1. ノートを開き、**reading view** に切り替えます。
2. デスクトップではステータスバーの **Translate**、モバイルでは右下のフローティングボタンを
   押します。
3. もう一度押すと、訳文と原文の表示を切り替えられます。
4. モードボタンで **bilingual** と **translation-only** を切り替えます。この操作では新しい
   翻訳リクエストは発生しません。

コマンドパレットには次のコマンドがあります。既定のホットキーは設定されていません。

- **Interlinear: Translate / show original**
- **Interlinear: Toggle display mode (bilingual / translation-only)**
- **Interlinear: Clear translations**

## 開発

ビルド、テスト、リリース手順とアーキテクチャについては、
[英語版 README の Develop セクション](https://github.com/linyp/obsidian-interlinear/blob/main/README.md#develop)
を参照してください。

## 制限事項

- リーディングビュー専用です。編集モードと Live Preview には対応していません。
- リストと表は 1 ブロックとして翻訳されます。フラットなリストは再構成されますが、入れ子構造の
  完全な復元は保証されません。

## ライセンス

MIT
