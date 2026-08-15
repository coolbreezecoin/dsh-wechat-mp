/**
 * Probe what this Official Account is actually allowed to do.
 *
 * Read-only: it fetches an access_token and lists drafts. It creates nothing and
 * spends no permanent-material quota. The one cost is a single access_token grant,
 * which invalidates any token another system on the same account currently holds.
 *
 * Run with WECHAT_MP_APPID / WECHAT_MP_SECRET in the environment:
 *   node scripts/probe-permissions.mjs
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { DEFAULT_BASE_URL, MpClient, TokenManager, WeChatApiError, WeChatTransportError } from '../lib/mp-client/index.js'

const appId = process.env.WECHAT_MP_APPID
const appSecret = process.env.WECHAT_MP_SECRET

if (!appId || !appSecret) {
  console.error('缺少 WECHAT_MP_APPID 或 WECHAT_MP_SECRET,先 export 再跑')
  process.exit(1)
}

console.log(`AppID: ${appId.slice(0, 6)}…${appId.slice(-2)}  (secret 不打印)`)

const cacheDir = await mkdtemp(join(tmpdir(), 'dsh-mp-probe-'))
const client = new MpClient({ appId, appSecret, cacheDir })

/**
 * Run one probe and report it in terms of what it proves about permissions.
 * @param label - human name for the capability being probed.
 * @param run - the call to attempt.
 */
async function probe(label, run) {
  try {
    const result = await run()
    console.log(`\n✅ ${label}:可用`)
    return result
  } catch (error) {
    if (error instanceof WeChatApiError) {
      const verdict = error.errcode === 48001
        ? '这个账号类型没有该接口权限'
        : '调用失败,但不是权限问题'
      console.log(`\n❌ ${label}:${verdict}`)
      console.log(`   errcode ${error.errcode} — ${error.message}`)
      return undefined
    }
    if (error instanceof WeChatTransportError) {
      console.log(`\n❌ ${label}:连不上微信 — ${error.message}`)
      return undefined
    }
    console.log(`\n❌ ${label}:${error instanceof Error ? error.message : String(error)}`)
    return undefined
  }
}

// The IP allowlist is enforced at token acquisition, so a blocked address fails
// here and tells you nothing about per-endpoint permissions. Probe it separately
// or a 40164 reads as if the draft API were the problem.
console.log('\n— 第一步:拿 access_token（会占用一次每日配额）—')
const gotToken = await probe('access_token', async () => {
  // TokenManager shares the cache directory with the client below, so this grant
  // is reused rather than spending a second one.
  await new TokenManager({ appId, appSecret, cacheDir, baseUrl: DEFAULT_BASE_URL }).get()
  return true
})

if (!gotToken) {
  console.log('\n结论:连 token 都没拿到,接口权限无从谈起。先按上面的 errcode 处理(40164 = 加 IP 白名单),再重跑。')
  process.exit(0)
}

console.log('\n— 第二步:草稿箱接口 —')
const drafts = await probe('草稿箱接口 draft/batchget', () => client.listDrafts(1))

if (drafts !== undefined) {
  console.log(`   现有草稿 ${drafts.length} 条${drafts.length > 0 ? `,最近一条:${drafts[0].titles.join(' / ')}` : ''}`)
  console.log('\n结论:这个号能调草稿箱接口,API 层可以全自动跑通。')
} else {
  console.log('\n结论:见上面的 errcode。若是 48001,用 mp_render 出 HTML 手动粘贴即可,排版层不受影响。')
}
