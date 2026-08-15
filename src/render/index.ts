/**
 * The typesetting layer: markdown in, WeChat-ready inline-styled HTML out.
 *
 * Zero Cordis dependency by design (PLAN 决策 2) so it stays unit-testable and
 * survives breaking changes in the harness. The tool shell in `src/index.ts` is the
 * only part that knows about dsh.
 * @module
 */

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import juice from 'juice'
import { assembleCss, type ParagraphOptions, type ThemeName, THEME_NAMES, type ThemeVars } from './css.ts'
import { fillImageUrls, type ImageRef, type LegendMode, renderMarkdown } from './markdown.ts'
import { applyStructuralFixes, rewriteHostileCss, stripClasses } from './wechat.ts'

export { THEME_NAMES, fillImageUrls }
export type { ImageRef, LegendMode, ThemeName }

/** Highlight.js stylesheets bundled with the dependency, by friendly name. */
export const CODE_THEMES = {
  github: 'github.css',
  'github-dark': 'github-dark.css',
  'atom-one-light': 'atom-one-light.css',
  'atom-one-dark': 'atom-one-dark.css',
  vs: 'vs.css',
  monokai: 'monokai.css',
} as const

export type CodeTheme = keyof typeof CODE_THEMES

/** Sensible defaults for a Chinese technical article. */
export const DEFAULTS = {
  theme: 'default',
  codeTheme: 'github',
  primaryColor: '#0F4C81',
  fontFamily: `-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', sans-serif`,
  fontSize: '15px',
  legend: 'alt-title',
} as const

export interface RenderOptions extends ParagraphOptions {
  theme?: ThemeName
  codeTheme?: CodeTheme
  primaryColor?: string
  fontFamily?: string
  fontSize?: string
  legend?: LegendMode
  lineNumbers?: boolean
  /** Keep `class` attributes in the output. Off by default: the editor drops them. */
  keepClasses?: boolean
}

export interface RenderResult {
  /** The article body, every style inline, ready for `draft/add`'s `content` field. */
  html: string
  /** Images in document order, each carrying the placeholder token in `html`. */
  images: ImageRef[]
  /** Byte length of `html` as UTF-8, which is what WeChat's size limit counts. */
  bytes: number
}

const require = createRequire(import.meta.url)

const hljsCssCache = new Map<string, string>()

/**
 * Read a highlight.js stylesheet out of the installed dependency.
 * @param theme - bundled code theme name.
 * @returns the stylesheet source.
 */
function readCodeTheme(theme: CodeTheme): string {
  const file = CODE_THEMES[theme]
  const cached = hljsCssCache.get(file)
  if (cached !== undefined) return cached
  const path = require.resolve(`highlight.js/styles/${file}`)
  const css = readFileSync(path, 'utf-8')
  hljsCssCache.set(file, css)
  return css
}

/**
 * Render markdown into the inline-styled HTML the WeChat draft API accepts.
 *
 * Image sources come back as placeholder tokens rather than URLs: WeChat filters
 * any image not hosted on its own CDN, so the caller uploads each one and calls
 * {@link fillImageUrls} with the results.
 * @param markdown - the article source.
 * @param options - theme and typography selection.
 * @returns the rendered HTML, its image references, and its byte size.
 */
export function render(markdown: string, options: RenderOptions = {}): RenderResult {
  const theme = options.theme ?? DEFAULTS.theme
  const vars: ThemeVars = {
    primaryColor: options.primaryColor ?? DEFAULTS.primaryColor,
    fontFamily: options.fontFamily ?? DEFAULTS.fontFamily,
    fontSize: options.fontSize ?? DEFAULTS.fontSize,
  }

  const { html: body, images } = renderMarkdown(markdown, {
    legend: options.legend ?? DEFAULTS.legend,
    lineNumbers: options.lineNumbers,
  })

  const css = assembleCss(
    theme,
    vars,
    readCodeTheme(options.codeTheme ?? DEFAULTS.codeTheme),
    { indent: options.indent, justify: options.justify },
  )

  // inlineContent, not juice(): the input is a fragment, and juice() would wrap it
  // in a full document and re-emit <html>/<body> around the article.
  let html = juice.inlineContent(body, css, {
    inlinePseudoElements: true,
    preserveImportant: true,
    resolveCSSVariables: false,
  })

  html = rewriteHostileCss(html)
  html = applyStructuralFixes(html)
  if (!options.keepClasses) html = stripClasses(html)

  return { html, images, bytes: Buffer.byteLength(html, 'utf-8') }
}

/**
 * Wrap rendered HTML in a standalone page so a human can eyeball the typesetting
 * before anything is uploaded.
 * @param html - rendered article body.
 * @param title - page title shown in the browser tab.
 * @returns a complete HTML document approximating the WeChat article column width.
 */
export function previewDocument(html: string, title: string): string {
  const safeTitle = title.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  body { margin: 0; background: #f5f5f5; }
  /* 375px is the WeChat article column; the padding matches the reader's gutter. */
  .mp-preview { max-width: 375px; margin: 0 auto; padding: 20px 16px; background: #fff; min-height: 100vh; box-sizing: border-box; }
</style>
</head>
<body>
<div class="mp-preview">
${html}
</div>
</body>
</html>
`
}
