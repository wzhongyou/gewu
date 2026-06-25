# 发布与版本管理

格物使用语义化版本号，以 Chrome Web Store 的 `manifest.version` 作为发布版本。

## 版本号规则

- `0.1.x`：修复 bug、文案、样式、小范围兼容性问题。
- `0.2.0`：新增功能、调整交互流程、扩大权限或支持新场景。
- `1.0.0`：稳定公开版本。

Chrome Web Store 不允许重复上传同一个版本号。每次上传新版前，都必须递增版本号。

## 当前版本状态

| 环境 | 版本 |
|---|---|
| 开发（dev） | 0.2.0 |
| Chrome 商店（提交中） | 0.1.0 |

商店 0.1.0 审核通过后，再提交 0.2.0。

## 发版前改动

每次发布前同步更新以下三个文件的版本号，确保一致：

- `package.json` 里的 `version`
- `manifest.config.ts` 里的 `version`
- `CHANGELOG.md` 里的版本标题

## 变更记录

每次发版在 [CHANGELOG.md](../CHANGELOG.md) 中按以下分类记录：

- **新增**：新功能、新模块
- **优化**：体验改进、性能提升、UI 调整
- **修复**：bug 修复、兼容性问题

## 打包命令

```bash
npm run pack:chrome
```

脚本自动执行生产构建，生成：

```text
releases/gewu-chrome-{version}.zip
```

上传 Chrome Web Store 时选择这个 zip 包。压缩包根目录直接包含 `manifest.json`。

## 发版流程

1. 确认工作区只包含本次发布相关改动。
2. 根据变更范围递增 `package.json`、`manifest.config.ts` 的版本号。
3. 更新 `CHANGELOG.md`，填写本次变更内容。
4. 质量检查：

   ```bash
   npm run typecheck
   npm run lint
   ```

5. 生成商店包：

   ```bash
   npm run pack:chrome
   ```

6. 本地加载 `dist/` 冒烟验证。
7. 提交代码：

   ```bash
   git add -A
   git commit -m "发布 0.2.0"
   ```

8. 打 tag：

   ```bash
   git tag v0.2.0
   ```

9. 推送代码和 tag：

   ```bash
   git push origin main --tags
   ```

10. 上传 `releases/gewu-chrome-0.2.0.zip` 到 Chrome Web Store。

## 上传前检查

- `dist/manifest.json` 的 `version` 是本次新版本。
- `releases/` 中 zip 文件名版本与 manifest 版本一致。
- `package.json`、`manifest.config.ts`、`CHANGELOG.md` 版本号三者一致。
- zip 根目录直接包含 `manifest.json`，不是外层套 `dist/` 目录。
- 新增权限、host permissions 或数据使用说明已准备好商店审核文案。
