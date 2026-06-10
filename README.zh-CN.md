# Interlinear

[English](README.md) · **简体中文**

为 [Obsidian](https://obsidian.md) 打造的**阅读模式对照翻译**插件。在阅读视图中打开一篇
外语笔记，点一下按钮，Interlinear 就会把它逐段翻成中文（或任意目标语言），**与原文对照**
呈现——支持双语对照或仅译文两种模式。

## 为什么它在设计上是安全的

- **绝不改动你的笔记。** 译文只作为渲染层 DOM 注入（通过 `registerMarkdownPostProcessor`）。
  关闭再重开笔记，磁盘上的文件一字节未变。
- **绝不自动翻译。** 打开或切换笔记什么都不会发生。翻译**有且仅有**在你显式点击悬浮按钮 /
  状态栏按钮（或执行命令）时才会运行。
- **BYOK，零遥测。** API key 只存在 vault 本地的 `data.json` 里（已被 git 忽略）。绝不硬编码、
  绝不写入日志，也绝不发往你配置的翻译端点以外的任何地方。
- **仅阅读模式**（MVP）。不做编辑 / 实时预览（Live Preview）翻译。

## 功能

- **一键整篇翻译**，两个触发入口任选：
  - 阅读视图右下角的**悬浮按钮**——**移动端**的主入口（手机版没有状态栏），桌面端可选；
  - **状态栏按钮**（桌面端）或命令面板。
  翻译进行中两处都会实时显示批次进度（`3/12`）。再次点击在**译文 ↔ 原文**之间切换
  （只是切换 CSS class，不发新请求）。
- **两种显示模式**——**双语对照**（原文 + 译文）↔ **仅译文**，即时切换、不重新翻译。
  仅译文模式下，**悬停译文（移动端轻点）即可就地查看对应原文**。
- **五种译文样式**（纯 CSS，可随时切换）：边框、引用块、弱化文字、虚线下划线，以及把译文
  模糊处理、悬停才显示的**学习遮罩**——适合语言学习。
- **持久化翻译缓存**——按内容 hash 索引、LRU 容量上限，存为插件目录下的 `cache.json`。
  重启 Obsidian 后重开同一篇笔记零成本；落盘的只有 hash 和译文，绝无原文。
- **整篇翻译，兼容虚拟化渲染。** Obsidian 的阅读视图只把屏幕内的块保留在实时 DOM 中，所以
  一次点击会立即翻译可见块、把其余部分预翻译进缓存，并由 `MutationObserver` 在你滚动时，
  于每个块渲染出来的瞬间注入对应的缓存译文。
- **跳过不该翻译的内容：** 代码块、公式、纯图片块、裸 URL、纯符号/数字块，以及**已经是目标
  语言**的块（这些块不会发出请求）。
- **可插拔后端**，抽象在 `TranslationProvider` 接口之后，内置**服务商预设**（默认 DeepSeek，
  另有 OpenAI、SiliconFlow、Ollama，或任意自定义 OpenAI 兼容端点），设置页提供**测试连接**
  按钮。请求使用 Obsidian 的 `requestUrl`（而非 `fetch`）。

## 联网、账号与隐私说明

- **远程服务。** 只有在你主动触发翻译或点击**测试连接**时，插件才会把当前笔记中可翻译的
  段落文本发送到**你自己配置的端点**（默认 `https://api.deepseek.com`）。除此之外不发送
  任何数据。
- **需要账号。** 自带 API key（BYOK），费用由对应服务商收取，与本插件无关。
- **零遥测。** 插件不收集任何信息，不向任何地方上报。
- **仅本地文件。** 设置（含 API key）存于插件的 `data.json`；翻译缓存存于同目录的
  `cache.json`（只有内容 hash 和译文）。你的笔记永远不会被修改。

## 安装

尚未上架社区插件商店，在此之前可用以下方式：

### 通过 BRAT（推荐——可自动更新）

1. 在 **设置 → 第三方插件 → 浏览** 中搜索并安装、启用
   **[BRAT](https://github.com/TfTHacker/obsidian42-brat)**。
2. 执行命令 **BRAT: Add a beta plugin for testing**。
3. 填入仓库 `linyp/obsidian-interlinear` 并确认。
4. 在 **设置 → 第三方插件** 中启用 **Interlinear**。

BRAT 会拉取最新的 GitHub Release，并在你发布新版本时保持插件自动更新。

### 手动安装

1. 从 [最新 Release](https://github.com/linyp/obsidian-interlinear/releases/latest)
   下载 `main.js`、`manifest.json`、`styles.css`。
2. 把这三个文件放进 `<你的 vault>/.obsidian/plugins/interlinear/`。
3. 在 **设置 → 第三方插件** 中启用 **Interlinear**。

（若想从源码构建，见 [开发](#开发)。）

## 配置

打开 **设置 → Interlinear**：

| 设置项 | 默认值 | 说明 |
| --- | --- | --- |
| 服务预设 | DeepSeek | 一键填充端点 + 模型：DeepSeek / OpenAI / SiliconFlow / Ollama / 自定义。 |
| API key | _（空）_ | 必填（BYOK）。仅存于 `data.json`。 |
| Base URL | `https://api.deepseek.com` | 任意 OpenAI 兼容端点。 |
| 模型 | `deepseek-v4-flash` | |
| 测试连接 | — | 发送一次极小请求，验证 key 与端点是否可用。 |
| 目标语言 | `zh-CN` | 例如 `zh-CN`、`en`、`ja`。 |
| 默认显示模式 | 双语对照 | |
| 译文样式 | 边框 | 边框 / 引用块 / 弱化 / 虚线下划线 / 学习遮罩。 |
| 悬浮按钮 | 总是显示 | 总是显示 / 仅移动端 / 从不。 |
| 并发数 | 10 | 最大同时请求数（1–16）。 |
| 最小间隔（ms） | 0 | 两次请求发起之间的间隔。 |
| 最大重试次数 | 3 | 遇到 429 / 临时错误时。 |
| 单批字符预算 | 4000 | 每次请求打包的字符数。 |
| 单批最大段落数 | 12 | 每次请求打包的块数，与字符预算共同限制（1–100）。 |
| 自定义指令 | _（空）_ | 可选，追加到系统提示词之后——术语表、语气或领域。 |
| 持久化缓存 | 开 | 翻译结果跨重启保留；设置页显示大小并可一键清空。 |

> DeepSeek 的 flash 档按**并发连接数**限流，而非按 RPM/TPM，因此默认配置以无间隔的方式
> 并行发送多个请求。

## 使用

1. 打开一篇笔记并切换到**阅读模式**。
2. 点击右下角的**悬浮按钮**（或状态栏的**翻译**按钮）。它会收集可翻译段落、翻译整篇笔记，
   翻译期间实时显示批次进度。
3. 再次点击可在**译文 ↔ 原文**之间切换。
4. 用小的**模式**按钮（或状态栏按钮）在**双语对照 ↔ 仅译文**之间切换（即时生效，不发新
   请求）。仅译文模式下，悬停（桌面端）或轻点（移动端）译文即可就地查看原文。

命令（命令面板中以 **Interlinear:** 前缀显示）。插件不预设快捷键（遵循社区插件指南），
可在 **设置 → 快捷键** 中自行绑定：

- **Translate / show original**——翻译笔记；翻译后再次执行则在译文 ↔ 原文之间切换。
  重复执行是幂等的：缓存块会被复用，同时会重试此前失败的批次。
- **Toggle display mode (bilingual / translation-only)**
- **Clear translations**

## 开发

通过环境变量把构建产物直接输出到一个**测试 vault**（用一个随手可弃的库，别用日常主库），
保存即重新构建：

```bash
INTERLINEAR_OUTDIR="/path/to/test-vault/.obsidian/plugins/interlinear" npm run dev
```

`npm run dev` 以 watch 模式运行 esbuild（带 inline sourcemap），并把 `manifest.json`、
`styles.css`、`.hotreload` 一并复制到 `main.js` 旁边。在测试 vault 里安装 pjeby 的
**Hot Reload** 插件，`.hotreload` 标记文件就能让它在每次重新构建后自动重载。（阅读模式的
渲染只有在你切换 编辑 ↔ 阅读 或重开笔记时才会重新执行。）

常用脚本：

```bash
npm run build      # tsc --noEmit + 生产打包 -> main.js
npm run typecheck  # tsc --noEmit
npm test           # vitest run
npm run test:watch # vitest（watch）
```

### 发版

```bash
npm version patch|minor|major  # 同步 package.json、manifest.json、versions.json
git push && git push --tags
```

推送 tag 会触发 GitHub Actions workflow：自动测试、构建，并创建一个附带
`main.js` / `manifest.json` / `styles.css` 三个独立资产的 **draft** release——
检查无误后手动发布。

## 架构

这个插件最棘手的地方在于：它的 UI / 渲染只能在 Obsidian 里验证。因此设计上把**所有可判定的
逻辑都下沉到纯粹、可测试的模块**，把接触 Obsidian / DOM / 网络的表面积压到最薄。

```
src/
  core/         纯逻辑（不依赖 obsidian）：hash、段落切分 + 批次打包/拆包、
                块跳过规则 + 同语言判定、限速器（并发 / 退避）
  translator/   provider.ts（接口 + 类型化错误）、deepseek.ts（纯请求构造 /
                响应解析 + DeepSeekProvider）、cache.ts（持久化缓存的 LRU +
                序列化）；requestUrlClient.ts 是唯一的 requestUrl 适配器
  render/       postProcessor.ts —— DOM 适配器 + 收集/注入/清除/显示模式/样式辅助函数
  ui/           translateButton.ts（状态栏 + 悬浮按钮 + 翻译流程）、settingsTab.ts
  settings.ts   纯设置类型 + 默认值 + 归一化/校验
  main.ts       组合根（composition root）
```

**铁律：** 被测试导入的模块绝不导入 `obsidian` 运行时（它是一个仅类型的包）。只有五个 shell
文件接触 obsidian：`main.ts`、`ui/translateButton.ts`、`ui/settingsTab.ts`、
`render/postProcessor.ts`、`translator/requestUrlClient.ts`。HTTP 调用被隔在一个可注入的
`HttpClient` 接缝之后，因此 provider 完全可以脱离网络进行测试。

批次以带编号的 `<<<SEG k>>>` sentinel 打包；若模型返回的段数不对，provider 会退回到每段一次
请求，从而保证每条译文仍与其原文块严格一一对应。

## 局限（MVP）

- 仅阅读模式——不做编辑 / 实时预览翻译。
- 列表和表格作为单个块整体翻译（尽力而为）。

## 许可证

MIT
