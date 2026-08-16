/**
 * Lay down the demo article the README's example line refers to, so a recorded
 * session shows a natural path rather than a temp directory.
 *
 * Writes to ~/posts/, which is outside the repo on purpose: the GIF should look
 * like someone's own writing folder, not a checkout.
 *
 *   node scripts/prep-demo.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { makePng } from './make-test-png.mjs'

const postsDir = join(homedir(), 'posts')
const imgDir = join(postsDir, 'img')
await mkdir(imgDir, { recursive: true })

const article = `# 为什么公众号排版必须内联样式

写完 markdown,粘进公众号编辑器,格式全没了——这是每个技术号作者都踩过的坑。
原因不复杂,但知道的人不多。

## 编辑器会扔掉什么

公众号的编辑器只保留元素上的 \`style\` 属性。\`<style>\` 块、外链样式表、
class 名,一律丢弃。

> 所以「导出 HTML 再粘贴」几乎必然糊掉:样式全在 class 上,而 class 已经没了。

正确做法是把每一条 CSS 规则算出来,写到对应元素的 \`style\` 里:

\`\`\`ts
export function render(markdown: string, options?: RenderOptions): RenderResult {
  const { html, images } = renderMarkdown(markdown, options)
  // juice 负责把样式表摊平到每个元素上
  return { html: inlineStyles(html), images, bytes: byteLength(html) }
}
\`\`\`

## 图片是第二个坑

正文里的图片必须挂在 \`mmbiz.qpic.cn\` 上。引用自己图床的链接会被静默过滤,
你要等到发送后才发现整篇文章全是裂图。

![排版流程示意](./img/flow.png)

## 一张表总结

| 你写的 | 编辑器保留 | 结果 |
|---|---|---|
| \`<style>\` 块 | ❌ | 样式全丢 |
| class 名 | ❌ | 样式全丢 |
| \`style\` 属性 | ✅ | 正常显示 |
| 外链图片 | ❌ | 裂图 |
| \`mmbiz.qpic.cn\` 图片 | ✅ | 正常显示 |

## 所以流程是

1. markdown 渲染成 HTML,样式全部内联
2. 每张本地图片走微信的上传接口,换成微信自己的地址
3. 组装标题、作者、封面,提交到草稿箱
4. 人到后台确认排版,再点发送
`

await writeFile(join(postsDir, 'why-inline-css.md'), article, 'utf-8')
await writeFile(join(imgDir, 'flow.png'), makePng(900, 420, [15, 76, 129]))
await writeFile(join(imgDir, 'cover.png'), makePng(900, 383, [37, 99, 72]))

console.log(`✅ 演示文章已就绪:`)
console.log(`   ~/posts/why-inline-css.md`)
console.log(`   ~/posts/img/flow.png    (正文配图 900×420)`)
console.log(`   ~/posts/img/cover.png   (封面 900×383)`)
