import * as cheerio from 'cheerio'
import { describe, expect, it } from 'vitest'
import { fillImageUrls, render, THEME_NAMES } from '../src/render/index.ts'

const SAMPLE = `# 标题

正文里有 **加粗**、\`行内代码\` 和 [链接](https://example.com)。

> 引用段落

- 一
- 二
  - 嵌套

\`\`\`ts
export const x: number = 1
\`\`\`

| A | B |
|---|---|
| 1 | 2 |

![本地图](./img/a.png)
![远程图](https://cdn.example.com/b.png "标题")
`

describe('render', () => {
  it('inlines every style and leaves no stylesheet behind', () => {
    const { html } = render(SAMPLE)
    expect(html).not.toMatch(/<style/i)
    expect(html).not.toMatch(/<link/i)
    expect(html.match(/style="/g)!.length).toBeGreaterThan(10)
  })

  it('resolves every modern CSS function WeChat may not support', () => {
    for (const theme of THEME_NAMES) {
      const { html } = render(SAMPLE, { theme })
      expect(html, theme).not.toMatch(/var\(--/)
      expect(html, theme).not.toMatch(/color-mix\(/)
      expect(html, theme).not.toMatch(/calc\(/)
      expect(html, theme).not.toMatch(/hsl\(/)
    }
  })

  it('strips class attributes by default and keeps them on request', () => {
    expect(render(SAMPLE).html).not.toMatch(/class="/)
    expect(render(SAMPLE, { keepClasses: true }).html).toMatch(/class="/)
  })

  it('every theme produces a comparably complete stylesheet', () => {
    // grace/simple are overlays on default; loading one alone drops most rules.
    const counts = THEME_NAMES.map(theme => (render(SAMPLE, { theme }).html.match(/style="/g) ?? []).length)
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    expect(max - min).toBeLessThanOrEqual(2)
  })

  it('replaces image sources with tokens and reports each image', () => {
    const { html, images } = render(SAMPLE)
    expect(images).toHaveLength(2)
    expect(images[0]).toMatchObject({ source: './img/a.png', isLocal: true, alt: '本地图' })
    expect(images[1]).toMatchObject({ source: 'https://cdn.example.com/b.png', isLocal: false })
    expect(html).not.toMatch(/cdn\.example\.com/)
    for (const image of images) expect(html).toContain(`src="${image.token}"`)
  })

  it('fills uploaded urls back into the html', () => {
    const { html, images } = render(SAMPLE)
    const filled = fillImageUrls(html, {
      [images[0]!.token]: 'https://mmbiz.qpic.cn/a',
      [images[1]!.token]: 'https://mmbiz.qpic.cn/b',
    })
    expect(filled).toContain('src="https://mmbiz.qpic.cn/a"')
    expect(filled).toContain('src="https://mmbiz.qpic.cn/b"')
    expect(filled).not.toMatch(/dsh-mp-image-/)
  })

  it('lifts nested lists out of their list item', () => {
    const { html } = render('- a\n  - b\n')
    const $ = cheerio.load(html, null, false)
    expect($('li > ul, li > ol')).toHaveLength(0)
    expect($('ul ul')).toHaveLength(1)
  })

  it('escapes markup written as inline code', () => {
    // Regression: marked passes codespan content unescaped. A literal `<style>`
    // became a real tag and juice swallowed the rest of the article as CSS.
    const { html } = render('文字 `<style>` 更多文字\n\n## 后面的标题\n\n结尾段落。')
    expect(html).not.toMatch(/<style/i)
    expect(html).toContain('&lt;style&gt;')
    // Everything after the span still carries its inline styling.
    expect(html).toMatch(/<h2 style="[^"]+">后面的标题<\/h2>/)
    expect(html).toContain('结尾段落。')
  })

  it('carries code-block line breaks and indentation as markup', () => {
    // Regression: the theme sets `white-space: nowrap` on code because WeChat
    // only scrolls a `-webkit-box`. Real newlines and spaces are collapsed by
    // that, so a block submitted as-is arrived as one jammed line —
    // "export function" rendered as "exportfunction".
    const { html } = render('```ts\nexport function a() {\n  return 1\n}\n```')
    const code = html.match(/<code[\s\S]*?<\/code>/)![0]

    expect(code).not.toMatch(/\n/)
    // Three lines, so two separators — marked drops the block's trailing newline.
    expect((code.match(/<br\s*\/?>/g) ?? []).length).toBe(2)
    // The two-space indent survives as entities, not as collapsible spaces.
    expect(code).toContain('&nbsp;&nbsp;')
    // Separators between highlighted tokens survive, so keywords stay apart
    // instead of collapsing into "exportfunction".
    expect(code).toMatch(/export<\/span>&nbsp;/)
  })

  it('keeps code lines in order under -webkit-box', () => {
    // Sibling spans and <br> become flex items in a -webkit-box on some
    // engines, which scrambles line order; one block child prevents it.
    const { html } = render('```ts\nconst a = 1\nconst b = 2\n```')
    expect(html).toMatch(/<code[^>]*><span style="display:\s*block">/)
  })

  it('does not let inline code smuggle a script tag through', () => {
    const { html } = render('见 `<script>alert(1)</script>` 示例')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('&lt;script&gt;')
  })

  it('does not wrap a block figure inside a paragraph', () => {
    const { html } = render('![图](./a.png)')
    const $ = cheerio.load(html, null, false)
    expect($('p figure')).toHaveLength(0)
    expect($('figure img')).toHaveLength(1)
  })

  it('applies the primary color to the theme', () => {
    const { html } = render('# T', { primaryColor: '#FF0000' })
    expect(html.toUpperCase()).toContain('#FF0000')
  })

  it('reports utf-8 byte length, not character count', () => {
    const { html, bytes } = render('# 中文标题')
    expect(bytes).toBe(Buffer.byteLength(html, 'utf-8'))
    expect(bytes).toBeGreaterThan(html.length)
  })
})
