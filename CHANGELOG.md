# Changelog

## 0.2.0 (2026-06-26)

### 新增

- **PDF 阅读器**：自动检测 PDF URL，点击翻译在当前页打开内置阅读器，逐页对照翻译
- **逐页翻译布局**：每页一行，左侧 PDF 页面 + 右侧译文，进度标签实时显示
- **滚动懒翻译**：仅翻译当前可见页面，向下滚动自动翻译后续页
- **批量并发翻译**：PDF 段落批量发送，大幅提升翻译速度
- **沉浸阅读模式**：提取页面正文，双栏对照阅读，翻译进度显示
- **译文缓存**：IndexedDB URL+内容哈希缓存，相同页面二次打开秒出译文
- **API Key 加密存储**：extension ID 自动派生 AES-GCM 密钥，落盘非明文
- **Ollama 适配器**（代码就绪，设置页隐藏，待验证后启用）

### 优化

- 设置页模型默认值改为 `deepseek-v4-flash`
- Popup 简化为三按钮：翻译当前页 / 问答 / 设置
- PDF 翻译打开侧栏时自动重试获取上下文
- 侧栏加载页面上下文时最多重试 5 次（适配 PDF 异步加载）
- PDF 阅读器无 Tab 切换，直接 PDF 页面对照译文

### 修复

- arXiv `/pdf/XXXX` 类 URL 通过 HEAD 请求检测 Content-Type
- Popup 在 PDF 页面点击翻译时同时打开侧栏问答
- PDF Canvas 渲染去重，缓存 PDF 文档避免重复 fetch

---

## 0.1.0 (2026-06-24)

### 新增

- 项目初始化：Vite + CRXJS + TypeScript + React 18
- Background Service Worker：AI 请求代理、消息路由、翻译/聊天管道
- AI 适配器：DeepSeek / OpenAI 兼容（流式+批量）、Anthropic Claude
- 网页原地翻译：提取正文段落，替换原文为译文，保留链接和结构
- 滚动懒翻译：视口优先翻译，滚动到新区域自动继续
- Side Panel 问答：基于页面内容上下文对话，流式回答
- Options 设置页：服务商、Base URL、API Key、模型配置
- Popup 工具栏：一键翻译/恢复、打开问答
- 品牌图标、隐私政策页面
- Chrome Web Store 展示素材
