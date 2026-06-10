# CLAUDE.md

本文件是该项目的工程约束与上下文，供 Claude Code 在 `/goal` 运行期间持续遵守。
开工前请先 `/plan` 锁定方案，再 `/goal`。严格按 MVP 范围推进，不要过度工程化。

---

## 项目目标

为 Obsidian 开发一个阅读模式逐段对照翻译插件：在**阅读模式**下，把当前外语文章逐段翻译成中文，
以**对照展示**的形式呈现。翻译只是渲染层效果，**绝不改动原始 markdown 文件**。
默认使用 DeepSeek 作为翻译后端（BYOK，用户自带 API key）。

---

## 不可违背的硬约束（MUST / MUST NOT）

以下规则任何情况下都不得违反。若某个实现方式与之冲突，改方案，不要改规则。

1. **绝不自动翻译。** 打开笔记、切换笔记、切换到阅读模式——这些都**不得**触发任何翻译请求。
   翻译**有且只有一个触发入口**：用户**显式点击阅读视图右下角的悬浮按钮**。
   插件加载完成后默认状态是「未翻译」，原文照常渲染，安静等待用户点击。
2. **绝不修改原始 markdown 文件。** 译文只能作为渲染层 DOM 注入，走 `registerMarkdownPostProcessor`。
   禁止任何对笔记正文的 Vault 写操作。用户关闭/重开笔记后，磁盘上的文件必须一字节未变。
3. **MVP 只做阅读模式（Reading view）。** 不要实现编辑模式 / 实时预览（Live Preview / CodeMirror 6）的翻译。
4. **网络请求必须用 Obsidian 的 `requestUrl`，禁止使用 `fetch`。** （`fetch` 在渲染进程里会被 CORS 拦截。）
5. **BYOK，零遥测。** API key 仅来自设置项；禁止硬编码；禁止任何分析/遥测/上报；key 不得写入日志、不得提交仓库。
6. **DeepSeek 模型名必须是 `deepseek-v4-flash`**（deepseek-chat (to be deprecated on 2026/07/24)）。
   Base URL `https://api.deepseek.com`，OpenAI 兼容的 `/chat/completions` 端点。

---

## 技术栈

- 语言：TypeScript（strict）
- 依赖：`obsidian`（**仅类型定义**，运行时由 Obsidian 注入；不要假设它有实现）
- 打包：esbuild（输出单个 `main.js`）
- 模板基准：`obsidian-sample-plugin`
- **不引入任何重型前端框架（无 React / Vue）。** UI 用原生 DOM API（含 Obsidian 的 `createEl` 等辅助方法）。

---

## 功能范围（MVP）

- 阅读视图右下方工具栏上一个**按钮**，点击触发翻译。
- 点击后：收集当前文章中可翻译的段落块 → 调用翻译后端 → 在每个原文块下方注入译文 DOM。
- **两种展示模式，可切换**：
  - 双语对照（原文在上、译文在下）
  - 仅译文（隐藏原文，只显示中文）
  - 模式切换**只通过切换 CSS class 实现，不重新发起翻译请求**。
- 翻译结果**按内容 hash 缓存**（重复点击、再次打开同一文章命中缓存，省时省钱）。
- **跳过不翻**：代码块、行内/块级公式、frontmatter、链接 URL、图片、纯符号块。
- 设置页（`PluginSettingTab`）：DeepSeek API key、base URL、model、默认展示模式、目标语言、请求并发/限速。

明确**不在 MVP 范围**：编辑模式翻译、PDF/EPUB、多文件批量、自定义视图面板。

---

## 架构

建议的文件结构（可微调，但职责边界保持）：

```
manifest.json
styles.css                     # 双语 / 仅译文两种模式的样式
esbuild.config.mjs
src/
  main.ts                      # Plugin 入口：onload/onunload，注册 post-processor、设置页、FAB
  settings.ts                  # Settings 类型 + 默认值 + PluginSettingTab
  ui/
    translateButton.ts         # FAB 注入、点击处理、模式切换
  render/
    postProcessor.ts           # 渲染原文（不翻译）；提供「收集可翻译块」「注入译文」「清除译文」
  translator/
    provider.ts                # TranslationProvider 接口（抽象，便于以后接别的服务）
    deepseek.ts                # DeepSeek 实现，用 requestUrl
    cache.ts                   # 基于内容 hash 的翻译缓存
```

**关键数据流：**
- post-processor 在渲染阶段**只渲染原文**，不做任何翻译（呼应硬约束 #1）。
- 用户点击按钮 → 收集可翻译块 → 分批调用 provider（受并发/限速控制，命中缓存则跳过）→
  在各原文块下注入带可识别 class（如 `.it-translation`）的译文节点 → 套用当前展示模式 class。
- 再次点击 / 切换模式 → 仅操作已注入节点的可见性与 class，不重新请求。
- **翻译 provider 抽象成接口**，DeepSeek 只是默认实现；不要把 DeepSeek 细节散落到 UI 或 post-processor 里。后续还可能支持其他LLM接口。

---

## Obsidian API 注意事项（防踩坑）

- **凡是注册都走 `register*` / `add*` 方法**（`registerMarkdownPostProcessor`、`registerDomEvent`、
  `registerInterval`、`addSettingTab`、`addCommand` 等），保证插件重载时自动清理。
  禁止裸用 `addEventListener` / `setInterval`——开发期靠热重载反复 enable/disable，裸监听会泄漏叠加。
- **不要凭记忆编造 Obsidian API。** 以 `obsidian` 包的 `.d.ts` 类型定义和 `obsidian-sample-plugin` 为准；
  不确定的方法名先去类型定义里查证。
- `requestUrl` 的请求**不会出现在 DevTools 的 Network 面板**（它走主进程绕 CORS）；调试 API 靠 `console.log` 打请求体和返回值。
- post-processor **只在阅读模式触发**；修改代码热重载后，需切换 编辑↔阅读（或重开笔记）才会重渲染。
- 译文节点务必带稳定的 class，方便定位、清除、按模式控制显隐。

---

## DeepSeek 调用细节

- 端点：`POST https://api.deepseek.com/chat/completions`（OpenAI 兼容）。
- model：`deepseek-v4-flash`。
- 请求体：`messages` 中用一个简洁的 system prompt 约束「保持术语一致、保留 markdown 结构、只输出译文、不要解释」。
- 错误处理：429（Too Many Requests）→ 降低并发或增大请求间隔后重试；网络错误给用户可见提示。
- 分批：把多个段落合理打包成一次请求以减少往返，但要能把译文准确对应回各自的原文块。

---

## 构建与本地开发

- `npm run dev`：esbuild watch + inline sourcemap（便于 DevTools 里对着 .ts 打断点）。
- 把 esbuild 的 `outdir` 指向**测试 vault** 的 `.obsidian/plugins/<plugin-id>/`（或软链过去），
  改完保存即落盘。
- 安装 pjeby 的 **Hot Reload** 插件，并在插件目录放一个 `.hotreload` 文件，实现保存后自动重载。
- **用独立的测试 vault 开发，不要用日常主库。**
- 打开 DevTools：macOS `Cmd+Option+I`。

---

## /goal 验收标准（Definition of Done）

⚠️ **你无法启动 Obsidian、点按钮、肉眼看渲染效果。** 因此目标的「完成」只能锁定在**你能自行验证**的部分：

- [ ] `npm run build` 成功产出 `main.js`
- [ ] `tsc --noEmit` 无类型错误
- [ ] `manifest.json` 字段合法完整（id、name、version、minAppVersion、main 等）
- [ ] 对**纯逻辑**有单元测试且通过：provider 请求构造、段落切分、缓存 key 生成、"跳过不翻"规则
- [ ] 代码中可静态确认：渲染阶段无翻译调用；翻译仅由 FAB 点击触发；无任何 Vault 正文写操作；用的是 `requestUrl`

UI 表现、真实翻译质量、双语/仅译文切换的视觉效果**由人工在 Obsidian 中验证，不计入你的自动验收**。

**不要**在构建和单测跑通前宣布目标达成；**不要**为了"让测试过"而 mock 掉真实的翻译/注入逻辑。

---

## 命名

项目/插件正式定名：**Interlinear**（id `interlinear`）。
**工程中任何位置（代码、注释、文档、元数据、commit message）都不得出现任何第三方翻译产品的品牌名**
（中英文均不允许），描述功能时用中性的「对照翻译 / interlinear translation」等表述。

---

## 提交前自检

- `npm run build` 通过、`tsc --noEmit` 无错。
- key 不在日志、不在仓库（检查 `.gitignore` 含 `data.json` 与构建产物按需忽略）。
- 重申一遍最容易回归的三条：**不自动翻译 / 不改原文件 / 用 requestUrl**。
