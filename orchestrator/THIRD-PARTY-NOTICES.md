# 第三方组件声明(Third-Party Notices)

本产品包含以下第三方开源组件。各组件按其自身许可证条款授权,许可文本以各项目官方发布为准;本文件为交付所附的归属与许可汇总。

## 一、运行时 npm 依赖(含传递依赖)

下表由 `package-lock.json` 经脚本生成,请勿手改。依赖变动后,请在 `orchestrator/` 下运行 `node scripts/gen-third-party-notices.mjs` 重新生成。

<!-- npm-deps:begin -->
| 组件 | 版本 | 许可证 |
|---|---|---|
| @kwsites/file-exists | 1.1.1 | MIT |
| @kwsites/promise-deferred | 1.1.1 | MIT |
| @napi-rs/canvas-android-arm64 | 0.1.100 | MIT |
| @napi-rs/canvas-darwin-arm64 | 0.1.100 | MIT |
| @napi-rs/canvas-darwin-x64 | 0.1.100 | MIT |
| @napi-rs/canvas-linux-arm-gnueabihf | 0.1.100 | MIT |
| @napi-rs/canvas-linux-arm64-gnu | 0.1.100 | MIT |
| @napi-rs/canvas-linux-arm64-musl | 0.1.100 | MIT |
| @napi-rs/canvas-linux-riscv64-gnu | 0.1.100 | MIT |
| @napi-rs/canvas-linux-x64-gnu | 0.1.100 | MIT |
| @napi-rs/canvas-linux-x64-musl | 0.1.100 | MIT |
| @napi-rs/canvas-win32-arm64-msvc | 0.1.100 | MIT |
| @napi-rs/canvas-win32-x64-msvc | 0.1.100 | MIT |
| @napi-rs/canvas | 0.1.100 | MIT |
| @neondatabase/serverless | 1.1.0 | MIT |
| @simple-git/args-pathspec | 1.0.3 | MIT |
| @simple-git/argv-parser | 1.1.1 | MIT |
| argparse | 1.0.10 | MIT |
| boolbase | 1.0.0 | ISC |
| cheerio-select | 2.1.0 | BSD-2-Clause |
| cheerio | 1.2.0 | MIT |
| css-select | 5.2.2 | BSD-2-Clause |
| css-what | 6.2.2 | BSD-2-Clause |
| debug | 4.4.3 | MIT |
| dom-serializer | 2.0.0 | MIT |
| domelementtype | 2.3.0 | BSD-2-Clause |
| domhandler | 5.0.3 | BSD-2-Clause |
| domutils | 3.2.2 | BSD-2-Clause |
| encoding-sniffer | 0.2.1 | MIT |
| entities | 4.5.0 | BSD-2-Clause |
| entities | 6.0.1 | BSD-2-Clause |
| entities | 7.0.1 | BSD-2-Clause |
| esprima | 4.0.1 | BSD-2-Clause |
| extend-shallow | 2.0.1 | MIT |
| gray-matter | 4.0.3 | MIT |
| htmlparser2 | 10.1.0 | MIT |
| iconv-lite | 0.6.3 | MIT |
| is-extendable | 0.1.1 | MIT |
| js-yaml | 3.15.2 | MIT |
| kind-of | 6.0.3 | MIT |
| ms | 2.1.3 | MIT |
| node-addon-api | 7.1.1 | MIT |
| node-pty | 1.1.0 | MIT |
| node-readable-to-web-readable-stream | 0.4.2 | MIT |
| nth-check | 2.1.1 | BSD-2-Clause |
| parse5-htmlparser2-tree-adapter | 7.1.0 | MIT |
| parse5-parser-stream | 7.1.2 | MIT |
| parse5 | 7.3.0 | MIT |
| pdfjs-dist | 5.4.624 | Apache-2.0 |
| safer-buffer | 2.1.2 | MIT |
| section-matter | 1.0.0 | MIT |
| simple-git | 3.36.0 | MIT |
| sprintf-js | 1.0.3 | BSD-3-Clause |
| strip-bom-string | 1.0.0 | MIT |
| undici | 7.29.1 | MIT |
| whatwg-encoding | 3.1.1 | MIT |
| whatwg-mimetype | 4.0.0 | MIT |
| ws | 8.21.0 | MIT |
| zod | 3.25.76 | MIT |
<!-- npm-deps:end -->

上表中标注 BSD-2-Clause、BSD-3-Clause、ISC 的组件,其版权声明与许可全文随包装在 `node_modules/<组件>/` 下的 LICENSE 里,分发时一并保留。

MIT 许可证模板(适用于上表中标注 MIT 的组件,各组件版权归其各自作者所有):

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## 二、内嵌浏览器资产(orchestrator/assets/vendor/)

| 组件 | 许可证 | 版权/上游 | 备注 |
|---|---|---|---|
| xterm.js(xterm.min.js/.css、xterm-addon-fit) | MIT | Copyright (c) 2017-, The xterm.js authors(github.com/xtermjs/xterm.js);部分源自 Christopher Jeffrey (MIT) | — |
| mermaid | MIT | Copyright (c) 2014-2022 Knut Sveidqvist(github.com/mermaid-js/mermaid) | — |
| cytoscape.js(cytoscape.min.js) | MIT | Copyright (c) 2016-2024, The Cytoscape Consortium(github.com/cytoscape/cytoscape.js) | — |
| cytoscape-elk.js | MIT | github.com/cytoscape/cytoscape.js-elk | 桥接层 |
| **elk.bundled.js(elkjs)** | **EPL-2.0**(Eclipse Public License 2.0) | Eclipse Layout Kernel,elkjs 转译(github.com/kieler/elkjs) | 弱 copyleft:本产品仅原样分发未修改的 elkjs 构建产物;其源码可从上游仓库获取(EPL-2.0 第 3 条源码可得性要求由该上游链接满足)。若客户修改 elkjs 本体,修改部分须按 EPL-2.0 开放 |
| **pdf.js(pdfjs/)** | **Apache-2.0** | Copyright Mozilla Foundation(github.com/mozilla/pdf.js) | 见下方 Apache-2.0 声明 |
| **tesseract.js(tesseract/)** | **Apache-2.0** | Copyright (c) tesseract.js 作者(github.com/naptha/tesseract.js);底层 Tesseract OCR 引擎 Apache-2.0(Google/HP) | 见下方 Apache-2.0 声明 |
| KaTeX(katex/) | MIT(代码)+ **SIL OFL 1.1**(字体) | Copyright (c) 2013-2020 Khan Academy 等(github.com/KaTeX/KaTeX) | katex/fonts 下字体按 SIL Open Font License 1.1 分发,字体可随软件捆绑分发,不得单独出售 |
| open-design 设计系统(src/design/vendor/design-systems/) | Apache-2.0 | nexu-io/open-design | 该目录已自带 LICENSE 与 NOTICE.md(含上游 commit 记录) |

### Apache License 2.0 声明(适用于 pdf.js、pdfjs-dist、tesseract.js、open-design)

以上标注 Apache-2.0 的 pdf.js、pdfjs-dist(npm 包形式的 pdf.js)、tesseract.js、open-design 依据 Apache License, Version 2.0 授权分发。你不得在不遵守该许可证的情况下使用这些组件。许可证全文见:

    http://www.apache.org/licenses/LICENSE-2.0

除非适用法律要求或书面同意,依据本许可证分发的软件按"现状"("AS IS")提供,不附带任何明示或默示的保证或条件。本产品对上述组件为原样捆绑分发,未作修改;各组件的 NOTICE 内容(如有)以其上游发布为准并经由本文件履行告知义务。

### Eclipse Public License 2.0 声明(适用于 elkjs)

elk.bundled.js 依据 EPL-2.0 授权,全文见:https://www.eclipse.org/legal/epl-2.0/ 。本产品未修改该组件;其完整对应源码可从 https://github.com/kieler/elkjs 获取。

---

*本文件随产品一同交付。新增/升级 vendored 组件时必须同步更新本文件。*
