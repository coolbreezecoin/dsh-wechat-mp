/**
 * Markdown to WeChat-compatible HTML, with the class names the vendored doocs/md
 * themes style. Pure: no Cordis, no filesystem writes, no network.
 * @module
 */

import { Marked } from 'marked'
import hljs from 'highlight.js'

/** How an image caption is derived from the markdown image node. */
export type LegendMode = 'alt' | 'title' | 'alt-title' | 'title-alt' | 'none'

/** One image the document references, in document order. */
export interface ImageRef {
  /** Stable placeholder token emitted in place of `src`, replaced after upload. */
  token: string
  /** The `src` exactly as written in the markdown. */
  source: string
  /** True when `source` points at the local filesystem rather than an http(s) URL. */
  isLocal: boolean
  /** The image's alt text, for a human-readable upload report. */
  alt: string
}

export interface MarkdownOptions {
  legend?: LegendMode
  /** Render code blocks with line numbers down the left gutter. */
  lineNumbers?: boolean
}

export interface MarkdownResult {
  html: string
  images: ImageRef[]
}

const PLACEHOLDER_PREFIX = 'dsh-mp-image-'

/** `![a](b "c")` caption text for the configured legend mode. */
function caption(mode: LegendMode, alt: string, title: string): string {
  switch (mode) {
    case 'none': return ''
    case 'alt': return alt
    case 'title': return title
    case 'alt-title': return alt || title
    case 'title-alt': return title || alt
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** An `src` is local unless it is an absolute http(s) URL or already a data URI. */
function isLocalSource(src: string): boolean {
  return !/^(https?:)?\/\//i.test(src) && !/^data:/i.test(src)
}

/**
 * Wrap highlighted code in the numbered-gutter structure. WeChat drops `<ol>`
 * counters inside `<pre>`, so numbers are literal text in a leading span.
 * @param highlighted - highlight.js HTML for the whole block.
 * @returns per-line HTML with a number prefix on each line.
 */
function withLineNumbers(highlighted: string): string {
  const lines = highlighted.split('\n')
  const width = String(lines.length).length
  return lines
    .map((line, i) => {
      const n = String(i + 1).padStart(width, ' ').replace(/ /g, '&nbsp;')
      return `<span class="code__line"><span class="code__ln">${n}&nbsp;&nbsp;</span>${line}</span>`
    })
    .join('\n')
}

/**
 * Render markdown to HTML carrying the theme's class names, replacing every image
 * `src` with a placeholder token so uploads can be filled in afterwards.
 * @param markdown - the article source.
 * @param options - legend and code-block presentation.
 * @returns the HTML fragment and the ordered image references it contains.
 */
export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): MarkdownResult {
  const legend = options.legend ?? 'alt-title'
  const images: ImageRef[] = []

  const marked = new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      code({ text, lang }): string {
        const requested = (lang ?? '').trim().split(/\s+/)[0]
        const language = requested && hljs.getLanguage(requested) ? requested : 'plaintext'
        let body = hljs.highlight(text, { language }).value
        if (options.lineNumbers) body = withLineNumbers(body)
        return `<pre class="hljs code__pre"><code class="language-${language}">${body}</code></pre>`
      },
      codespan({ text }): string {
        // marked hands the renderer the RAW span content and relies on the default
        // renderer to escape it. Without this, `<style>` written as inline code
        // becomes a real tag and juice consumes the rest of the article as CSS.
        return `<code class="codespan">${escapeHtml(text)}</code>`
      },
      image({ href, title, text }): string {
        const token = `${PLACEHOLDER_PREFIX}${images.length}`
        images.push({
          token,
          source: href,
          isLocal: isLocalSource(href),
          alt: text ?? '',
        })
        const legendText = caption(legend, text ?? '', title ?? '')
        const figcaption = legendText
          ? `<figcaption class="md-figcaption">${escapeHtml(legendText)}</figcaption>`
          : ''
        return `<figure><img src="${token}" alt="${escapeHtml(text ?? '')}"/>${figcaption}</figure>`
      },
    },
  })

  const html = marked.parse(markdown, { async: false })
  return { html, images }
}

/**
 * Substitute uploaded WeChat URLs back into rendered HTML.
 * @param html - HTML whose image sources are placeholder tokens.
 * @param urls - token to final `mmbiz.qpic.cn` URL.
 * @returns HTML with every supplied token replaced.
 */
export function fillImageUrls(html: string, urls: Record<string, string>): string {
  let out = html
  for (const [token, url] of Object.entries(urls)) {
    out = out.replaceAll(`src="${token}"`, `src="${escapeHtml(url)}"`)
  }
  return out
}
