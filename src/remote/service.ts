/**
 * The Host service behind the "发公众号" button.
 *
 * The browser half owns only the click and the message text; everything that
 * touches WeChat happens here, reusing the same typesetting and REST layers the
 * agent tools use. One code path means the button and the tools cannot drift.
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { type Config, resolveTokenCacheDir } from '../config.ts'
import { fillImageUrls, render, type ThemeName } from '../render/index.ts'
import { MpClient } from '../mp-client/index.ts'

/** What the browser sends when the user clicks publish. */
export interface PublishRequest {
  markdown: string
  title?: string
  theme?: string
  fontSize?: string
}

/** What the button renders as success or failure. */
export interface PublishResult {
  ok: boolean
  mediaId?: string
  title?: string
  error?: string
}

/** WeChat truncates beyond this, so the derived title is cut here first. */
const TITLE_LIMIT = 64

/**
 * Derive an article title from the message itself.
 *
 * A published draft must be findable in the console list, and an assistant reply
 * has no title of its own — its first heading, or failing that its first line of
 * prose, is what a human would have typed anyway.
 * @param markdown - the message source.
 * @returns a non-empty title.
 */
export function deriveTitle(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const text = (heading?.[1] ?? line)
      // Strip the inline marks that would otherwise show up literally in the
      // console's article list.
      .replace(/[*_`~]/g, '')
      .replace(/^>\s*/, '')
      .trim()
    if (text !== '') return text.length > TITLE_LIMIT ? text.slice(0, TITLE_LIMIT) : text
  }
  return '未命名草稿'
}

/**
 * Publishes assistant messages to the Official Account draft box.
 *
 * Registered as `ctx.wechatMp`; the API gateway routes the browser's
 * `remote.wechatMp.publish` here.
 */
export class WechatMpService extends TypertRemoteService {
  private readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'wechatMp')
    this.config = config
  }

  /**
   * Render one message and put it in the draft box.
   *
   * Errors come back in the envelope rather than thrown: the caller is a button
   * that has to show the reason, and a WeChat errcode already carries an
   * actionable message.
   * @param request - message text and optional presentation overrides.
   * @returns the draft's media_id, or the reason it could not be created.
   */
  @Remote('publish')
  async publish(request: PublishRequest): Promise<PublishResult> {
    try {
      const markdown = (request.markdown ?? '').trim()
      if (markdown === '') return { ok: false, error: '这条消息没有正文,没什么可发布的。' }

      const cover = this.config.defaultCover.trim()
      if (cover === '') {
        return {
          ok: false,
          error: '没有配置封面图。微信要求每篇文章必须有封面——'
            + '在 profile 的 cordis.patch.yml 里给 wechat-mp 设置 defaultCover 指向一张本地 jpg/png。',
        }
      }

      const client = await this.connect()
      const title = (request.title ?? '').trim() || deriveTitle(markdown)

      const { html, images } = render(markdown, {
        theme: (request.theme as ThemeName | undefined) ?? this.config.theme,
        codeTheme: this.config.codeTheme,
        primaryColor: this.config.primaryColor,
        fontFamily: this.config.fontFamily,
        fontSize: request.fontSize ?? this.config.fontSize,
      })

      // A chat reply can reference a file the agent just wrote, so local images
      // are uploaded; remote ones are reported instead of silently vanishing
      // inside WeChat's filter.
      const remote = images.filter(image => !image.isLocal)
      if (remote.length > 0) {
        return {
          ok: false,
          error: `这条消息里有 ${remote.length} 张外链图片,微信会把它们过滤掉。`
            + '先把图片存到本地再发布,或者用 mp_upload_image 手动处理。',
        }
      }

      const urls: Record<string, string> = {}
      for (const image of images) {
        urls[image.token] = await client.uploadImage(image.source)
      }
      const content = fillImageUrls(html, urls)

      const thumbMediaId = await client.uploadThumb(cover)
      const mediaId = await client.addDraft([{
        title,
        content,
        thumb_media_id: thumbMediaId,
        ...this.config.defaultAuthor === '' ? {} : { author: this.config.defaultAuthor },
      }])

      return { ok: true, mediaId, title }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Build a client for one publish, resolving credentials per operation so a
   * rotated secret reaches the next click without a restart.
   * @returns a client bound to the configured account.
   */
  private async connect(): Promise<MpClient> {
    const appId = await this.ctx.credentials.resolve(credentialRef(this.config.appIdRef))
    const appSecret = await this.ctx.credentials.resolve(credentialRef(this.config.appSecretRef))
    const missing = [
      ...appId === undefined ? [this.config.appIdRef] : [],
      ...appSecret === undefined ? [this.config.appSecretRef] : [],
    ]
    if (missing.length > 0) {
      throw new Error(
        `公众号凭据未配置:缺少 ${missing.join(' 和 ')}。`
        + '把它们放进环境变量、项目 .env,或 $DSH_HOME/.credentials.yaml。',
      )
    }
    return new MpClient({
      appId: appId!.value,
      appSecret: appSecret!.value,
      cacheDir: resolveTokenCacheDir(this.config),
      baseUrl: this.config.baseUrl,
    })
  }
}
