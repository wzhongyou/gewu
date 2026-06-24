# 发布与版本管理

格物使用语义化版本号，并以 Chrome Web Store 的 `manifest.version` 作为发布版本。

## 版本号规则

- `0.1.1`：修复 bug、文案、样式、小范围兼容性问题。
- `0.2.0`：新增功能、调整交互流程、扩大权限或支持新场景。
- `1.0.0`：稳定公开版本。

Chrome Web Store 不允许重复上传同一个版本号。每次上传新版前，都必须递增版本号。

## 发版前改动

每次发布前同步更新：

- `package.json` 里的 `version`
- `manifest.config.ts` 里的 `version`

两个版本号必须保持一致。

## 打包命令

```bash
npm run pack:chrome
```

脚本会自动执行生产构建，并生成：

```text
releases/gewu-chrome-{version}.zip
```

上传 Chrome Web Store 时选择这个 zip 包。压缩包根目录会直接包含 `manifest.json`。

## 推荐发布流程

1. 完成功能或修复，并确认工作区只包含本次发布相关改动。
2. 根据变更范围递增 `package.json` 和 `manifest.config.ts` 的版本号。
3. 执行质量检查：

   ```bash
   npm run typecheck
   npm run lint
   ```

4. 生成商店包：

   ```bash
   npm run pack:chrome
   ```

5. 本地加载 `dist/` 做一次冒烟验证。
6. 提交代码，例如：

   ```bash
   git commit -m "发布 0.1.1"
   ```

7. 给发布提交打 tag：

   ```bash
   git tag v0.1.1
   ```

8. 上传 `releases/gewu-chrome-0.1.1.zip` 到 Chrome Web Store。

## 上传前检查

- `dist/manifest.json` 的 `version` 是本次新版本。
- `releases/` 中 zip 文件名版本与 manifest 版本一致。
- zip 根目录直接包含 `manifest.json`，不是外层套了一个 `dist/` 目录。
- 新增权限、host permissions 或数据使用说明已准备好商店审核文案。
