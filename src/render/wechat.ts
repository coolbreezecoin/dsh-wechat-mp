/**
 * Post-juice fixes for the WeChat Official Account editor.
 *
 * These are ported from doocs/md `apps/web/src/services/export/clipboard.ts` and
 * `clipboard-dom.ts`, which run against a live browser DOM. Here they run under
 * cheerio so the same transforms work in a Node plugin process.
 * @module
 */

import * as cheerio from 'cheerio'

/**
 * Rewrite what the WeChat editor mishandles in otherwise valid inline CSS.
 * `top: <n>em` on an inline element is dropped by the editor, so it becomes a
 * transform, matching doocs/md's clipboard pipeline.
 * @param html - juiced HTML.
 * @returns HTML with editor-hostile declarations rewritten.
 */
export function rewriteHostileCss(html: string): string {
  return html.replace(/([^-])top:(.*?)em/g, '$1transform: translateY($2em)')
}

/**
 * Apply the structural fixes the WeChat editor needs.
 *
 * - A nested `<ul>`/`<ol>` inside an `<li>` is lifted out to a sibling; the editor
 *   silently flattens the nested form and loses its indentation.
 * - `width`/`height` attributes on `<img>` are moved into inline style, because the
 *   editor strips presentational attributes but keeps style.
 * - Empty leading/trailing paragraphs give the author a caret position above and
 *   below the pasted article.
 * @param html - juiced HTML with hostile declarations already rewritten.
 * @returns the final HTML fragment for `draft/add`.
 */
export function applyStructuralFixes(html: string): string {
  const $ = cheerio.load(html, null, false)

  // Lift nested lists out of their <li> (doocs modifyHtmlStructure).
  $('li > ul, li > ol').each((_i, el) => {
    $(el).parent().after(el)
  })

  // An image alone on a line becomes a <p> wrapping the block-level <figure>,
  // which is invalid: a browser auto-closes the <p> and the editor inherits the
  // broken nesting. Replace the paragraph with the figure it holds.
  $('p').each((_i, el) => {
    const $p = $(el)
    const children = $p.children()
    if (children.length === 1 && children.first().is('figure') && $p.text().trim() === $p.find('figcaption').text().trim()) {
      $p.replaceWith(children.first())
    }
  })

  // Move img sizing attributes into style (doocs solveWeChatImage).
  $('img').each((_i, el) => {
    const $img = $(el)
    for (const attr of ['width', 'height'] as const) {
      const value = $img.attr(attr)
      if (!value) continue
      $img.removeAttr(attr)
      $img.css(attr, /^\d+$/.test(value) ? `${value}px` : value)
    }
  })

  const spacer = '<p style="font-size: 0; line-height: 0; margin: 0;">&nbsp;</p>'
  return `${spacer}${$.html()}${spacer}`
}

/**
 * Strip class attributes once styles are inline.
 *
 * The editor discards class names anyway; removing them keeps the draft body well
 * under WeChat's content size limit on a long article.
 * @param html - HTML whose styling is fully inline.
 * @returns the same HTML without `class` attributes.
 */
export function stripClasses(html: string): string {
  return html.replace(/\s+class="[^"]*"/g, '')
}
