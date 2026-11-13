# D-0015 用 esbuild 打包扩展，用 Playwright 驱动的 Chromium 做端到端测试

- 状态：有效
- 日期：2026-11-13
- 决策者：agent
- 服务于：
  - 上游决策：[D-0013](0013-playwright-recognition-layer.md)

## 背景

复制进来的 Playwright 代码分成多个模块互相 import，而 `chrome.scripting.executeScript` 注入的 content script 必须是单个经典脚本。原来扩展只用 tsc 输出 ES 模块，content script 只能写成一个没有 import 的文件。

扩展的页面行为以前没有自动测试，改动只能在作者的 Chrome 里手工验证。品牌版 Google Chrome 从 137 版起不再支持 `--load-extension`，无法在测试里自动加载扩展。

## 决策

- tsc 只做类型检查（`--noEmit`），`scripts/build-extension.mjs` 用 esbuild 输出 `extension/dist`：content script 打包成 IIFE，background、popup、debug 打包成 ES 模块。
- Playwright 代码由 `scripts/vendor-playwright.mjs` 从固定版本标签复制，除 import 路径外不改动；为了让 tsc 检查其中只用到类型的 `yaml` 引用，增加 `yaml` 开发依赖。
- 渲染格式的纯函数用 Node 单元测试（`extension/test/`，随 `npm test` 运行）。
- 端到端测试 `npm run test:e2e` 用 `playwright-core` 启动 Playwright 下载的 Chromium，加载一份指向临时 daemon 端口的扩展副本，经真实的 daemon、Bridge 页面和 content script 跑 observe/act/upload。需要先运行一次 `npx playwright-core install chromium`，所以不放进默认的 `npm test`。

## 考虑过、没有采用

- 手工把 Playwright 代码合并成一个无 import 的文件：每次升级都要重新手工合并，容易出错。
- 用 tsc 的 `outFile` 拼接：只支持非 ES 模块写法，同样需要改写 Playwright 代码。
- 在作者自己的 Chrome 里测试：会打扰作者正在用的浏览器，且无法自动重复。

## 代价

- 多了 esbuild、yaml、playwright-core 三个开发依赖，端到端测试还要一个约 100 MB 的 Chromium。
- 测试用的是 Chromium 而不是作者的 Google Chrome，两者在个别行为上可能不同。

## 什么时候应该重新考虑

随时可以换成其他打包工具；Chrome 恢复命令行加载扩展，或者有更轻的扩展测试方式时，可以改测试方案。
