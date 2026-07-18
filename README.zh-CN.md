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
- **BYOK，零遥测。** 凭据只存在 vault 本地的插件设置文件里：`data.json`，以及设置迁移后
  一次性保留的 `data.backup.json`（本仓库已忽略二者）。绝不硬编码、绝不写入日志，
  也绝不发往你配置的翻译端点以外的任何地方。
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
- **可插拔后端**，抽象在 `TranslationProvider` 接口之后，内置两类**服务预设**，设置页提供
  **测试连接**按钮：
  - **LLM**（默认）：DeepSeek、OpenAI、SiliconFlow、Ollama，或任意自定义 OpenAI 兼容端点；
  - **传统机器翻译**：百度翻译、有道智云——更便宜、更快、免费额度更大的翻译 API；
    各服务的凭据独立保存，切换服务不会丢失已填的 key。
  请求使用 Obsidian 的 `requestUrl`（而非 `fetch`）。

## 联网、账号与隐私说明

- **远程服务。** 只有在你主动触发翻译或点击**测试连接**时，插件才会把当前笔记中可翻译的
  段落文本发送到**你所选服务的官方端点**（默认 `https://api.deepseek.com`；传统机器翻译
  服务则是各自固定的 API 端点）。除此之外不发送任何数据，也绝不会同时发给多个服务。
- **需要账号。** 自带 API key / 应用凭据（BYOK），费用由对应服务商收取，与本插件无关。
- **零遥测。** 插件不收集任何信息，不向任何地方上报。
- **仅本地文件。** 设置（含凭据）存于插件的 `data.json`；设置迁移前的一次性副本可能存于
  `data.backup.json`；翻译缓存存于同目录的 `cache.json`（只有内容 hash 和译文）。你的
  笔记永远不会被修改。
- **同步注意。** 这些设置文件位于 vault 内部，vault 同步（Obsidian Sync、iCloud、
  Dropbox 等）会把凭据带到所有同步端。若你用 git 管理 vault，请把
  `.obsidian/plugins/interlinear/data.json` 和
  `.obsidian/plugins/interlinear/data.backup.json` 都加入该 vault 仓库的 `.gitignore`，
  避免把凭据提交出去。

## 安装

### 从 Obsidian 安装（推荐）

1. 打开 **设置 → 第三方插件 → 浏览**。
2. 搜索 **Interlinear**，点击 **安装**，然后**启用**。

也可以在浏览器中打开[插件市场页面](https://obsidian.md/plugins?id=interlinear)，
点击 **Install** 跳转安装。

后续更新通过 Obsidian 的插件更新流程获取——**设置 → 第三方插件 → 检查更新**。

### 从 v0.2.5 升级设置

首个使用 settings schema v2 的版本会把 v0.2.5 的扁平设置一次性迁移到新格式，并在改写
`data.json` 之前把原始数据保存在 `data.backup.json`。

如果你同步插件设置，请先在**所有同步设备上升级 Interlinear，再在任何设备上修改设置**。
不支持新旧插件版本混用，也不支持迁移后直接降级。

### 通过 BRAT（抢先 / 测试版）

想在新版进入插件商店之前就跟踪最新的 GitHub Release：

1. 在 **设置 → 第三方插件 → 浏览** 中搜索并安装、启用
   **[BRAT](https://github.com/TfTHacker/obsidian42-brat)**。
2. 执行命令 **BRAT: Add a beta plugin for testing**。
3. 填入仓库 `linyp/obsidian-interlinear` 并确认。
4. 在 **设置 → 第三方插件** 中启用 **Interlinear**。

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
| 翻译服务 | DeepSeek | 一个下拉、两类服务。**LLM**：DeepSeek / OpenAI / SiliconFlow / Ollama / 自定义 OpenAI 兼容端点。**传统机器翻译**：百度翻译 / 有道智云。每个预设分别保存凭据和高级调优；LLM 预设还会分别保存端点/模型与自定义指令。首次选择时初始化该预设的推荐默认值，以后切回时恢复已保存的值。 |
| API key _（仅 LLM）_ | _（空）_ | 必填（BYOK）。仅存于本地插件设置文件。 |
| App ID + 密钥 _（百度 / 有道）_ | _（空）_ | 到对应服务的开发者控制台申请的应用凭据对（BYOK，同样只存本地）。 |
| Base URL _（仅 LLM）_ | `https://api.deepseek.com` | 任意 OpenAI 兼容端点。 |
| 模型 _（仅 LLM）_ | `deepseek-v4-flash` | |
| 测试连接 | — | 发送一次极小请求，验证凭据与端点是否可用。 |
| 目标语言 | `zh-CN` | 例如 `zh-CN`、`en`、`ja`。 |
| 默认显示模式 | 双语对照 | |
| 译文样式 | 边框 | 边框 / 引用块 / 弱化 / 虚线下划线 / 学习遮罩。 |
| 悬浮按钮 | 仅移动端 | 总是显示 / 仅移动端 / 从不。 |
| 并发数 | 10 | 最大同时请求数（1–16）。 |
| 最小间隔（ms） | 0 | 两次请求发起之间的间隔。 |
| 最大重试次数 | 3 | 遇到 429 / 临时错误时。 |
| 单批字符预算 | 4000 | 每次请求打包的字符数。 |
| 单批最大段落数 | 12 | 每次请求打包的块数，与字符预算共同限制（1–100）。传统机器翻译服务还会额外套用各自的单请求硬上限。 |
| 自定义指令 _（仅 LLM）_ | _（空）_ | 可选，追加到系统提示词之后——术语表、语气或领域。 |
| 持久化缓存 | 开 | 翻译结果跨重启保留；设置页显示大小并可一键清空。 |

> DeepSeek 的 flash 档按**并发连接数**限流，而非按 RPM/TPM，因此默认配置以无间隔的方式
> 并行发送多个请求。切换到其他预设会套用更保守的调优（OpenAI / SiliconFlow 这类按
> RPM/TPM 限流的服务会降低并发并加入请求间隔；本地 Ollama 模型则改用更小的批量）。
> 百度的基础文本翻译在完成**个人认证**后即可免费使用：高级版 QPS 为 10、每月 100 万字符
> 免费额度，对应预设按此限速（间隔 ~150ms、每请求一个段落）。若账号未认证（约 1 QPS），
> 请把**最小间隔**调回 ~1100ms。有道的文档虽未公布 QPS 数字，但控制台会按应用分配
> QPS 配额、默认档实测很低，因此有道预设严格串行、间隔 ≥1.1 秒；只有确认自己应用的
> 配额更高时才建议调小**最小间隔**（出现 411/412 错误说明超了）。
>
> 传统机器翻译服务还会在你的批量设置之上套用各自的单请求硬上限（两者取小）：
> 百度 1 段 / 约 1800 字符；有道 1 段 / 约 4500 字符。
> **并发数 / 最小间隔 / 最大重试**对所有服务都生效；**自定义指令**只作用于 LLM（传统
> 机器翻译没有提示词），选中这些服务时该项会隐藏。单个段落若超过服务的单请求上限，会在
> 服务端失败并显示为失败批次——通知会注明失败原因，再次点击即可重试。

## 使用

1. 打开一篇笔记并切换到**阅读模式**。
2. 点击状态栏的**翻译**按钮（桌面端）或右下角的**悬浮按钮**（移动端）。它会收集可翻译
   段落、翻译整篇笔记，翻译期间实时显示批次进度。
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
                块跳过规则 + 同语言判定、限速器（并发 / 退避）、
                MD5/SHA-256 签名助手（百度/有道）、列表译文的标记还原
  translator/   provider.ts（接口 + 类型化错误 + 共享 HTTP 助手）、每个后端一个
                纯请求构造/响应解析模块（deepseek.ts、baidu.ts、youdao.ts）、
                factory.ts（settings -> provider）、
                langCodes.ts（各服务目标语言码映射）、cache.ts（持久化缓存的
                LRU + 序列化）；requestUrlClient.ts 是唯一的 requestUrl 适配器
  render/       postProcessor.ts —— DOM 适配器 + 收集/注入/清除/显示模式/样式辅助函数
  ui/           translateButton.ts（状态栏 + 悬浮按钮 + 翻译流程）、settingsTab.ts
  settings.ts   纯设置类型 + 默认值 + schema 迁移 + 归一化/校验
  main.ts       组合根（composition root）
```

**铁律：** 被测试导入的模块绝不导入 `obsidian` 运行时（它是一个仅类型的包）。只有五个 shell
文件接触 obsidian：`main.ts`、`ui/translateButton.ts`、`ui/settingsTab.ts`、
`render/postProcessor.ts`、`translator/requestUrlClient.ts`。HTTP 调用被隔在一个可注入的
`HttpClient` 接缝之后，因此 provider 完全可以脱离网络进行测试。

LLM 路径的批次以带编号的 `<<<SEG k>>>` sentinel 打包；若模型返回的段数不对，provider 会退回
到每段一次请求，从而保证每条译文仍与其原文块严格一一对应。传统机器翻译 API 每请求只译一段
文本、天然一一对应，因此完全绕过 sentinel 协议；各 provider 声明自己的单请求硬上限，
controller 按上限切分批次。

想要别的后端？新增一个后端刻意做得很小：在 `src/translator/` 写一个纯请求构造/响应解析
模块（照 `baidu.ts` / `youdao.ts` 的样子——不导入 `obsidian`，HTTP 注入、可单测），
`factory.ts` 加一个 case、`settings.ts` 加一个预设、设置页加一行凭据输入。欢迎 PR！

## 局限（MVP）

- 仅阅读模式——不做编辑 / 实时预览翻译。
- 列表和表格作为单个块整体翻译（尽力而为）。平铺列表的译文会还原为列表渲染；
  嵌套结构不做重建。

## 许可证

MIT
