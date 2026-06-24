# 格物 · Gewu 技术设计文档

## 一、项目概览

| 项 | 内容 |
|---|---|
| 定位 | 浏览器插件，外文网页 / PDF 阅读模式双栏翻译 + AI 对话 |
| 支持语言 | 英 / 日 / 韩等外文 → 简体中文 |
| 典型场景 | arXiv 论文阅读 |
| 发布平台 | Chrome / Edge（v1-v2）· Firefox（v3 适配） |
| 后端依赖 | 无，用户自备 API Key |

---

## 二、目录结构

```
gewu/
├── manifest.json          # MV3 主配置
├── src/
│   ├── background/
│   │   └── index.ts       # Service Worker：AI 请求代理、消息路由
│   ├── content/
│   │   └── index.ts       # 注入页面：正文提取、启动原页双栏
│   ├── overlay/
│   │   ├── InlineTranslator.ts # 原网页内双栏翻译容器
│   │   └── styles.css          # Shadow DOM 内部样式
│   ├── reader/
│   │   ├── App.tsx        # 沉浸阅读模式 / 原页注入失败时的回退
│   │   └── main.tsx       # 阅读模式入口
│   ├── pdf/
│   │   ├── App.tsx        # PDF 阅读模式：PDF 渲染、文本提取、译文栏
│   │   └── main.tsx       # PDF 阅读模式入口
│   ├── sidepanel/
│   │   ├── App.tsx        # 聊天 UI 主组件
│   │   └── main.tsx       # 入口
│   ├── popup/
│   │   └── App.tsx        # 工具栏弹窗：开关 + 跳转设置
│   ├── options/
│   │   └── App.tsx        # 设置页：API Key、模型、语言偏好
│   ├── adapters/
│   │   ├── base.ts        # AIAdapter 接口定义
│   │   ├── claude.ts      # Claude 实现
│   │   ├── openaiCompatible.ts # DeepSeek / OpenAI 兼容接口实现
│   │   └── ollama.ts      # 本地 Ollama 实现
│   └── shared/
│       ├── types.ts       # 公共类型
│       ├── storage.ts     # chrome.storage 封装
│       └── readability.ts # Readability.js 封装
├── public/
│   ├── icons/             # 插件图标
│   ├── reader.html
│   ├── pdf.html
│   └── sidepanel.html
├── vite.config.ts
└── package.json
```

---

## 三、核心模块设计

### 3.1 网页翻译流程

```
用户点击翻译
  → content/index.ts 调用 Readability.js 提取正文
  → content/index.ts 为正文段落建立 paragraphId 映射
  → overlay/InlineTranslator.ts 在当前网页内注入右侧译文栏
  → 按段落分块（保留 paragraphId，按 token 预算控制块大小）
  → 通过 chrome.runtime.connect 建立长连接发给 background
  → background 调用 AI Adapter 流式翻译
  → 逐块返回译文增量，overlay 写入右栏对应段落
```

**原页双栏布局：**

v1 默认在当前网页内完成双栏翻译，这是更接近主流翻译插件的体验。实现上不直接
把 `document.body` 改成 grid，而是注入一个固定定位的右侧译文栏，并给页面主内容
区域加一个可撤销的右侧让位样式。

右侧译文栏使用 Shadow DOM 隔离样式；原文 DOM 保持在原位置，只给识别出的正文段落
加 `data-gewu-paragraph-id` 标记。复杂页面如果无法可靠让位，降级为打开
`reader.html` 沉浸阅读模式。

```typescript
// overlay/InlineTranslator.ts 核心数据结构（伪代码）
type Paragraph = {
  id: string
  text: string
  element?: HTMLElement
}

type TranslationEvent =
  | { type: 'delta'; requestId: string; paragraphId: string; text: string }
  | { type: 'done'; requestId: string; paragraphId: string }
  | { type: 'error'; requestId: string; paragraphId?: string; message: string }

function startTranslation(paragraphs: Paragraph[]) {
  const port = chrome.runtime.connect({ name: 'translation' })
  port.postMessage({ type: 'translate', requestId: crypto.randomUUID(), paragraphs })
  port.onMessage.addListener((event: TranslationEvent) => {
    // 根据 paragraphId 将流式增量写入右栏对应段落
  })
}
```

同步关系通过 `paragraphId` 建立：左侧是网页原文段落，右侧是 overlay 内的译文段落。
滚动同步优先使用 IntersectionObserver 定位当前原文段落，再滚动右栏对应译文。

回退条件：

- 页面使用强约束全屏布局，右侧让位会破坏核心内容。
- Readability 能提取正文，但正文段落无法稳定映射回原 DOM。
- 用户主动选择“沉浸阅读模式”。

---

### 3.2 PDF 翻译流程

Chrome 内置 PDF Viewer 不是普通网页，不能假设 content script 能稳定进入
viewer 内部读取文本。v2 采用扩展自有 PDF 阅读模式：
识别 PDF URL 后打开 `pdf.html?url=...`，由扩展页面 fetch PDF 二进制，
再用 `pdfjs-dist` 渲染页面和提取文本。

```
用户在 PDF 页面点击翻译
  → background / content 检测 URL 是否为 PDF
  → 打开 pdf.html?url={encodedPdfUrl}
  → pdf/App.tsx 通过 fetch 获取 PDF ArrayBuffer
  → pdfjs-dist 渲染 PDF 页面并按页提取文本
  → 按 pageNumber + paragraphId 分块
  → 复用翻译长连接：background → AI → 右栏渲染
```

> v1 只做网页翻译，v2 加 PDF 支持，两套流程共用同一个翻译管道。

---

### 3.3 AI Adapter 接口

所有 AI 后端实现同一接口，background 根据用户设置动态选择：

```typescript
// adapters/base.ts
interface AIAdapter {
  translate(input: TranslateInput, signal: AbortSignal): AsyncIterable<TranslateDelta>
  chat(messages: Message[], signal: AbortSignal): AsyncIterable<string>
}

type TranslateInput = {
  paragraphId: string
  text: string
  sourceLang?: string
  targetLang: 'zh-CN'
}

type TranslateDelta = {
  paragraphId: string
  text: string
}
```

**Prompt 设计（翻译）：**

```
你是一名专业学术翻译，将以下文本翻译为简体中文。
要求：
- 保留专业术语原文（括号标注）
- 保持段落结构
- 不添加解释，只输出译文

原文：{chunk}
```

---

### 3.4 Side Panel 对话 Agent

```typescript
// 每次对话时注入页面上下文
const systemPrompt = `
你是一个阅读助手，帮助用户理解以下网页内容。
用中文回答，简洁准确。

页面标题：${title}
页面内容（摘要）：${content.slice(0, 6000)}
`
```

上下文管理：按模型 context window 配置 token budget。优先保留 system prompt、
当前页面摘要、最近对话；超出预算时压缩页面摘要或丢弃最早对话。

---

### 3.5 API Key 安全存储

```typescript
// shared/storage.ts
// Key 存在 chrome.storage.local，并限制只允许 trusted extension contexts 访问。
// content script 不直接读取 API Key，只通过 background 发起模型请求。

await chrome.storage.local.setAccessLevel({
  accessLevel: 'TRUSTED_CONTEXTS'
})

await chrome.storage.local.set({ 
  apiKey: key,
  provider: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  targetLang: 'zh-CN'
})
```

说明：`chrome.storage.local` 不是加密存储。v1 只做扩展上下文隔离；如果后续
需要本地加密，应单独设计 WebCrypto + 用户口令或系统密钥链方案。

---

## 四、技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 构建 | Vite + CRXJS | 支持 HMR，MV3 打包友好 |
| 语言 | TypeScript | 类型安全，AI Coding 友好 |
| UI | React 18 + Tailwind | Side Panel / Options 页面 |
| 正文提取 | @mozilla/readability | 去噪效果好，arXiv 适配佳 |
| PDF 提取 | pdfjs-dist | 浏览器端 PDF 文本提取 |
| 临时上下文 | chrome.storage.session | overlay / reader / sidepanel 之间传递页面上下文 |
| 持久存储 | chrome.storage.local | API Key、模型、语言偏好 |
| 跨浏览器 | webextension-polyfill | 统一 API 差异；Firefox 需单独适配 Side Panel |

---

## 五、开发阶段规划

### v1：网页翻译（MVP）

- [ ] 项目初始化（Vite + CRXJS + TS）
- [ ] manifest.json 配置
- [ ] background Service Worker 基础框架
- [ ] DeepSeek / OpenAI 兼容 Adapter 实现（流式）
- [ ] content script 正文提取 + 段落 DOM 映射
- [ ] overlay 原页内右侧译文栏
- [ ] reader.html 沉浸阅读模式回退
- [ ] Readability 正文提取 + paragraphId 分块
- [ ] runtime.connect 长连接消息协议
- [ ] 翻译结果流式写入右栏对应段落
- [ ] Side Panel 基础聊天 UI
- [ ] Options 页：API Key + 模型选择
- [ ] Popup：开关翻译

### v2：PDF 支持

- [ ] PDF URL 检测与 pdf.html 跳转
- [ ] pdfjs-dist PDF 渲染和文本提取
- [ ] PDF pageNumber + paragraphId 分块
- [ ] PDF 阅读模式双栏渲染适配

### v3：体验优化

- [ ] IndexedDB 译文缓存（URL 哈希索引）
- [ ] Firefox 适配打包
- [ ] Claude / Ollama Adapter

---

## 六、关键文件优先级

从零开始建议按此顺序让 AI 帮你生成：

```
1. manifest.json          ← 先把插件跑起来
2. vite.config.ts         ← 构建配置
3. adapters/base.ts       ← 定义接口
4. adapters/openaiCompatible.ts ← 接通 DeepSeek / OpenAI 兼容接口
5. background/index.ts    ← 消息路由
6. shared/storage.ts      ← 设置与临时上下文存储
7. content/index.ts       ← 正文提取与段落 DOM 映射
8. overlay/InlineTranslator.ts ← 原页内双栏翻译
9. reader/App.tsx         ← 沉浸阅读模式回退
10. sidepanel/App.tsx     ← 聊天界面
11. options/App.tsx       ← 设置页
```

---

## 七、验证方案

### 7.1 本地构建验证

每次提交前至少跑通：

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

验收标准：

- TypeScript 无类型错误。
- lint 无阻断级问题。
- `dist/` 产物包含 `manifest.json`、content script、background service worker、popup、options、sidepanel 等入口。
- Chrome 扩展页加载 `dist/` 后无 manifest 解析错误。

### 7.2 Chrome 手工验收

测试环境：

- Chrome / Edge 最新稳定版。
- 开发者模式加载 `dist/` 目录。
- Options 页配置可用 API Key 和模型。

核心用例：

1. 打开一篇英文网页或 arXiv abstract 页面。
2. 点击插件 Popup 的“翻译当前页”。
3. 当前网页右侧出现译文栏，原网页主体让位但核心内容不被遮挡。
4. 译文按段落流式出现，长段落不会阻塞整页翻译。
5. 滚动原文时，右侧译文能定位到对应段落。
6. 再次点击关闭 / 恢复时，页面样式恢复到翻译前状态。
7. 打开 Side Panel 提问，回答能基于当前页面内容。
8. 清空或填错 API Key 时，界面显示可理解的错误，不暴露异常堆栈。

### 7.3 兼容性页面集

v1 至少覆盖以下页面类型：

- arXiv abstract 页面。
- 普通博客 / 文档站文章页。
- 新闻或长文页面。
- 页面主体较窄、右侧已有目录或侧栏的页面。
- 内容提取失败或正文过短的页面。

验收标准：

- 能提取正文的页面优先使用原页 overlay。
- overlay 会遮挡或破坏布局时，提示用户切换到沉浸阅读模式。
- 正文提取失败时给出明确提示，不发起空翻译请求。

### 7.4 消息与流式验证

重点验证 `runtime.connect` 长连接：

- 每个翻译任务都有唯一 `requestId`。
- 每个译文事件都带 `paragraphId`。
- 单段失败不会导致整页翻译不可恢复。
- 用户关闭 overlay 或切换页面时，background 能中止对应请求。
- Service Worker 被浏览器回收后，界面能提示重试。

### 7.5 安全与隐私验证

- content script 不直接读取 API Key。
- API Key 只在 options / background 等 trusted extension contexts 使用。
- 网页脚本无法通过 DOM 或 `window` 读取 API Key。
- 发送给模型服务商的内容仅包括当前页面正文、标题、URL 和用户问题。
- README 明确告知：格物无自建后端，页面内容由浏览器直接发送给用户配置的模型服务商。

### 7.6 回归检查清单

发布前快速检查：

- Popup 能打开、翻译、关闭。
- Options 能保存、读取、更新 API Key 和模型。
- Side Panel 能读取当前页面上下文并完成一轮问答。
- overlay 注入后页面可滚动、可复制原文、可正常点击主要链接。
- 翻译中断、网络失败、API 限流时都有错误提示。
- 卸载 / 禁用插件后，网页不会残留样式或 DOM。
