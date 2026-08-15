# 主题 CSS 来源

本目录的 `base.css` / `default.css` / `grace.css` / `simple.css` 直接取自
[doocs/md](https://github.com/doocs/md)（`packages/shared/src/configs/theme-css/`），
license 为 WTFPL，允许任意使用与修改。原作者：Doocs <admin@doocs.org>，grace 主题为 @brzhang。

**组合规则(照抄 doocs `themeApplicator.ts` 的 `resolveThemeCSS`)**:
`default.css` 永远是基座,`grace` / `simple` 是叠在它上面的 overlay,不是独立主题。
只加载 overlay 会丢掉绝大部分排版规则。

同步上游时直接覆盖这四个文件即可,本项目不修改它们——所有微信侧的差异都在
`src/render/` 里以后处理的方式实现。
