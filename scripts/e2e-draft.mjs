/**
 * End-to-end check against a real Official Account: render → upload → create draft.
 *
 * Writes one draft into the account's draft box and consumes one permanent-material
 * slot for the cover. The draft is never sent; delete it in the console afterwards.
 *
 * Test images are generated here rather than read from disk so the run is
 * self-contained and repeatable.
 *
 * Run with WECHAT_MP_APPID / WECHAT_MP_SECRET in the environment:
 *   node scripts/e2e-draft.mjs
 */

import { deflateSync } from 'node:zlib'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { MpClient, WeChatApiError, WeChatTransportError } from '../lib/mp-client/index.js'
import { fillImageUrls, render } from '../lib/render/index.js'

const appId = process.env.WECHAT_MP_APPID
const appSecret = process.env.WECHAT_MP_SECRET

if (!appId || !appSecret) {
  console.error('缺少 WECHAT_MP_APPID 或 WECHAT_MP_SECRET,先 export 再跑')
  process.exit(1)
}

// ---------------------------------------------------------------- PNG encoding

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/**
 * CRC-32 over a buffer, as PNG chunks require.
 * @param buf - bytes to checksum.
 * @returns the unsigned checksum.
 */
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * Wrap payload bytes in a PNG chunk.
 * @param type - four-character chunk name.
 * @param data - chunk payload.
 * @returns the framed chunk.
 */
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/**
 * Build a PNG with a simple vertical gradient, so the result is visibly a real
 * image in the WeChat preview rather than a flat block.
 * @param width - image width in pixels.
 * @param height - image height in pixels.
 * @param rgb - base colour as `[r, g, b]`.
 * @returns the encoded PNG.
 */
function makePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1))
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0 // filter: none
    const shade = 0.65 + 0.35 * (y / Math.max(1, height - 1))
    for (let x = 0; x < width; x++) {
      raw[offset++] = Math.round(rgb[0] * shade)
      raw[offset++] = Math.round(rgb[1] * shade)
      raw[offset++] = Math.round(rgb[2] * shade)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------- run

const workDir = await mkdtemp(join(tmpdir(), 'dsh-mp-e2e-'))
const contentImage = join(workDir, 'diagram.png')
const coverImage = join(workDir, 'cover.png')

// 900×383 is the cover ratio the console itself recommends.
await writeFile(coverImage, makePng(900, 383, [15, 76, 129]))
await writeFile(contentImage, makePng(800, 400, [58, 122, 90]))

const markdown = `# dsh-wechat-mp 端到端测试

这条草稿由 [dsh-wechat-mp](https://github.com/coolbreezecoin/dsh-wechat-mp) 自动创建,
用来验证 render → upload → draft 整条链路。**确认无误后可以直接删掉。**

## 样式必须内联

公众号编辑器会丢弃 \`<style>\` 块和 class 名,所以每条样式都要落到元素的
\`style\` 属性上。

> 这就是直接粘 HTML 往往会糊掉的原因。

## 代码高亮

\`\`\`ts
export function render(markdown: string, options?: RenderOptions): RenderResult {
  const { html, images } = renderMarkdown(markdown, options)
  return { html: inlineStyles(html), images, bytes: byteLength(html) }
}
\`\`\`

## 表格

| 元素 | 状态 |
|---|---|
| 表格 | ✅ |
| 代码高亮 | ✅ |
| 图片 | ✅ |

## 图片

![一张测试配图](${contentImage})

1. 渲染
2. 上传图片
3. 建草稿
`

console.log(`AppID: ${appId.slice(0, 6)}…${appId.slice(-2)}  (secret 不打印)`)
console.log(`测试图片: ${workDir}`)

const client = new MpClient({ appId, appSecret, cacheDir: workDir })

try {
  console.log('\n— 1/4 渲染 —')
  const { html, images, bytes } = render(markdown, { theme: 'grace' })
  console.log(`   ${bytes} 字节,${images.length} 张图(${images.filter(i => i.isLocal).length} 张本地)`)

  console.log('\n— 2/4 上传正文图片 —')
  const urls = {}
  for (const image of images.filter(i => i.isLocal)) {
    urls[image.token] = await client.uploadImage(image.source)
    console.log(`   ${image.alt || image.source} → ${urls[image.token]}`)
  }
  const finalHtml = fillImageUrls(html, urls)
  if (finalHtml.includes('dsh-mp-image-')) throw new Error('仍有未回填的图片占位符')

  console.log('\n— 3/4 上传封面(永久素材,占一个名额)—')
  const thumbMediaId = await client.uploadThumb(coverImage)
  console.log(`   thumb_media_id: ${thumbMediaId}`)

  console.log('\n— 4/4 创建草稿 —')
  const mediaId = await client.addDraft([{
    title: '[测试] dsh-wechat-mp 端到端验证',
    author: 'dsh-wechat-mp',
    digest: '由插件自动创建的测试草稿,确认后可删除。',
    content: finalHtml,
    thumb_media_id: thumbMediaId,
  }])
  console.log(`   media_id: ${mediaId}`)

  const drafts = await client.listDrafts(3)
  console.log(`\n✅ 全链路打通。草稿箱现有 ${drafts.length} 条,最新:`)
  for (const draft of drafts) console.log(`   · ${draft.titles.join(' / ')}`)
  console.log('\n去公众平台「草稿箱」看排版效果,确认后把这条测试草稿删掉。')
} catch (error) {
  if (error instanceof WeChatApiError || error instanceof WeChatTransportError) {
    console.error(`\n❌ ${error.message}`)
  } else {
    console.error(`\n❌ ${error instanceof Error ? error.stack : String(error)}`)
  }
  process.exit(1)
}
