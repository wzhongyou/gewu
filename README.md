# 格物 · Gewu

> 致知在格物。——《大学》

浏览器插件，将英文、日文、韩文等外语网页实时翻译为中文，
直接在原网页内替换文本；右侧 Side Panel 可针对页面内容持续提问。
专为阅读 arXiv 论文打造，用户自备 API Key。

格物不提供自建后端：网页内容由用户浏览器直接发送到用户配置的模型服务商。

## 当前状态

项目处于 MVP 开发阶段，优先支持 Chrome / Edge MV3：

- 默认在原网页内替换文本，保留页面结构和链接。
- 长文采用滚动懒翻译，优先翻译当前视口附近内容。
- 用户自备模型服务商 API Key。
- Options 页配置服务商、Base URL、API Key、模型和目标语言。
- Popup 启动 / 恢复当前页翻译，并自动打开右侧问答。
- Side Panel 基于当前页面内容进行问答。

PDF 翻译和 Firefox 适配放在后续版本。

## 效果预览

以 arXiv 论文阅读为例，格物会在原网页内直接替换正文文本，尽量保留页面原有排版、链接和阅读节奏。

原始英文页面：

![arXiv 原始英文页面](docs/assets/screenshots/arxiv-original.png)

翻译后的页面：

![格物翻译后的 arXiv 页面](docs/assets/screenshots/arxiv-translated.png)

## 本地开发

安装依赖：

```bash
npm install
```

开发构建：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

质量检查：

```bash
npm run typecheck
npm run lint
```

具体脚本以 `package.json` 为准。

## 在 Chrome 中加载

1. 执行 `npm run build`，生成 `dist/`。
2. 打开 `chrome://extensions/`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择项目下的 `dist/` 目录。
6. 固定格物插件图标，方便从工具栏打开 Popup。

Edge 的加载方式类似，入口是 `edge://extensions/`。

## 配置

首次使用前：

1. 打开插件 Options 页面。
2. 选择模型服务商。默认是 DeepSeek / OpenAI 兼容接口。
3. 填入自己的 API Key。
4. 确认 Base URL 和模型。
5. 保存设置，保存成功后设置页会自动关闭。

DeepSeek 默认配置：

```text
Provider: DeepSeek / OpenAI 兼容
Base URL: https://api.deepseek.com
Model: deepseek-chat
```

API Key 存在浏览器扩展本地存储中。格物不提供自建后端，也不会把 Key 上传到项目服务器。

## 使用方式

翻译网页：

1. 打开英文、日文、韩文等外文网页。
2. 点击浏览器工具栏里的格物图标。
3. 点击“翻译当前页”。
4. 当前网页文本会直接替换为中文，右侧 Side Panel 会自动打开。
5. 长文会优先翻译当前可见区域；继续向下滚动时，后续内容会自动翻译。
6. 再次点击“翻译当前页”，可恢复原文。

页面问答：

1. 在支持的浏览器中打开格物 Side Panel。
2. 当前页面内容会作为上下文。
3. 直接用中文提问，例如“这篇文章的核心结论是什么？”。
4. `Enter` 发送，`Shift + Enter` 换行。

## 验证清单

开发完成后建议至少验证：

- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm run build` 能生成可加载的 `dist/`。
- Chrome 扩展页加载 `dist/` 无 manifest 错误。
- Options 能保存并读取 API Key。
- Popup 能启动翻译并自动打开 Side Panel。
- 当前网页文字能被原地替换为中文。
- 再次点击“翻译当前页”能恢复原文。
- 长文滚动到新区域时能继续懒翻译。
- Side Panel 能基于当前页面完成一轮问答。
- 切换标签页或页面加载完成时，Side Panel 会清空旧上下文并读取新页面。
- API Key 错误、网络失败、限流时有明确错误提示。

## 常见问题

**加载扩展时报 manifest 错误**

先确认已经执行 `npm run build`，并且加载的是 `dist/` 目录，不是项目根目录。

**点击翻译没有结果**

检查 Options 页是否已经保存 API Key；再打开扩展的 background service worker 控制台查看请求错误。

**页面布局被影响**

再次点击 Popup 的“翻译当前页”会恢复原文。当前默认是原网页文本替换，不再使用右侧译文栏作为主模式。

**译文很慢**

长文采用滚动懒翻译：优先翻译当前视口附近内容，继续滚动时再翻译后续内容。速度仍取决于模型服务商、网络和限流策略。

**Chrome 扩展页显示“错误”**

Chrome 会保留历史错误。先点扩展卡片里的“错误”，再点“全部清除”，然后刷新扩展和网页。

如果清除后再次出现错误，以最新文件名为准；旧构建 hash 例如 `assets/index.ts-CZufLYVF.js` 说明多半是历史错误或旧页面仍挂着旧 content script。

## 技术设计

详见 [docs/gewu-design.md](docs/gewu-design.md)。
