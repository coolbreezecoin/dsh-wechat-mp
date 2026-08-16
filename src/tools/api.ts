/**
 * The tools that talk to the WeChat API: image upload, draft creation, draft listing.
 *
 * These mount only when a credential provider is composed, so a deployment without
 * one keeps the zero-risk typesetting half working (PLAN 决策 1).
 * @module
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { type Config, resolveTokenCacheDir } from '../config.ts'
import { fillImageUrls } from '../render/index.ts'
import { type DraftArticle, MpClient } from '../mp-client/index.ts'

/** Tool names that mutate the Official Account and therefore need approval. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(['mp_upload_image', 'mp_create_draft'])

/** Placeholder shape `mp_render` writes into `img src`, matched to detect unresolved images. */
const TOKEN_PATTERN = /src="(dsh-mp-image-\d+)"/g

/**
 * Build a client for one operation.
 *
 * Credentials are resolved per call, never cached: that per-operation read is what
 * lets a rotated secret reach the next call without a restart.
 * @param ctx - context carrying the credential provider.
 * @param config - deployment settings naming the credential references.
 * @returns a client bound to the configured account.
 */
async function connect(ctx: Context, config: Config): Promise<MpClient> {
  const appId = await ctx.credentials.resolve(credentialRef(config.appIdRef))
  const appSecret = await ctx.credentials.resolve(credentialRef(config.appSecretRef))
  const missing = [
    ...appId === undefined ? [config.appIdRef] : [],
    ...appSecret === undefined ? [config.appSecretRef] : [],
  ]
  if (missing.length > 0) {
    throw new Error(
      `公众号凭据未配置:缺少 ${missing.join(' 和 ')}。`
      + '把它们放进环境变量、项目 .env,或 $DSH_HOME/.credentials.yaml。'
      + '(mp_render 不需要凭据,排版结果可以手动粘进公众平台编辑器。)',
    )
  }
  return new MpClient({
    appId: appId!.value,
    appSecret: appSecret!.value,
    cacheDir: resolveTokenCacheDir(config),
    baseUrl: config.baseUrl,
  })
}

/**
 * Register the API tools and the approval gate guarding the write ones.
 * @param ctx - context carrying both the tool registry and the credential provider.
 * @param config - deployment settings.
 */
export function registerApiTools(ctx: Context, config: Config): void {
  // The model plans differently when a call will pause for a human, so the promise
  // in the description has to track the gate rather than assert it unconditionally.
  const approvalNote = config.requireApproval ? ' Requires user approval.' : ''

  // Writes to a public publishing account are gated at the policy layer rather than
  // inside each tool, so a deployment can reorder or extend the policy without
  // touching this plugin. The pipeline fails closed when no approval channel exists.
  //
  // Registering the listener only when the gate is wanted keeps a disabled gate off
  // the waterfall entirely, rather than having it run and immediately delegate.
  if (config.requireApproval) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      if (!WRITE_TOOLS.has(exec.name)) return next()
      return {
        kind: 'ask',
        reason: exec.name === 'mp_upload_image'
          ? '上传图片到公众号素材库'
          : '在公众号草稿箱创建草稿',
      }
    })
  }

  ctx.tools.register(defineTool({
    name: 'mp_upload_image',
    description:
      'Upload one local image to the WeChat Official Account and return the '
      + 'mmbiz.qpic.cn URL that article bodies must use. WeChat strips images served '
      + 'from any other host, so every local image in an article goes through this. '
      + 'Accepts jpg and png under 1 MB.' + approvalNote,
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to a local jpg or png.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true, description: 'The mmbiz.qpic.cn URL for use in article HTML.' },
          path: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Uploaded ${value.path}\n→ ${value.url}` }],
    },
    async execute(args, exec) {
      const client = await connect(ctx, config)
      const url = await client.uploadImage(resolvePath(args.path), exec.signal)
      return { url, path: resolvePath(args.path) }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Upload image to WeChat',
      kind: 'other',
      locations: [{ path: args.path }],
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'mp_create_draft',
    description:
      'Create a draft in the WeChat Official Account draft box from HTML produced by '
      + 'mp_render. Does NOT publish: a human still confirms and sends it from the '
      + 'Official Account console. Every image placeholder token must be resolved first — '
      + 'pass the token→url map from mp_upload_image, or the call is refused rather than '
      + 'shipping an article with broken images. WeChat requires a cover image.'
      + approvalNote,
    parameters: {
      html_path: {
        type: 'string',
        required: true,
        description: 'The `htmlPath` returned by mp_render.',
      },
      title: { type: 'string', required: true, description: 'Article title, at most 64 characters.' },
      cover_image: {
        type: 'string',
        description: 'Local jpg/png uploaded as the cover. Give this OR `thumb_media_id`.',
      },
      thumb_media_id: {
        type: 'string',
        description: 'An already-uploaded cover material id. Give this OR `cover_image`.',
      },
      author: { type: 'string', description: 'Author byline. Defaults to the deployment setting.' },
      digest: {
        type: 'string',
        description: 'Summary shown in the article list. WeChat derives one from the body when omitted.',
      },
      source_url: { type: 'string', description: 'Target of the "阅读原文" link.' },
      images: {
        type: 'array',
        description: 'Placeholder token to uploaded URL, one entry per image in the article.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            token: { type: 'string', required: true, description: 'A token from mp_render, e.g. dsh-mp-image-0.' },
            url: { type: 'string', required: true, description: 'The mmbiz.qpic.cn URL from mp_upload_image.' },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mediaId: { type: 'string', required: true, description: 'The draft media_id.' },
          title: { type: 'string', required: true },
          bytes: { type: 'integer', required: true, description: 'UTF-8 size of the submitted body.' },
          imagesFilled: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Draft created: "${value.title}" (media_id ${value.mediaId}, ${value.bytes} bytes, `
          + `${value.imagesFilled} image(s) filled).\n`
          + '打开公众平台后台「草稿箱」确认排版并发布——插件不会替你群发。',
      }],
    },
    async execute(args, exec) {
      if ((args.cover_image === undefined) === (args.thumb_media_id === undefined)) {
        throw new Error('mp_create_draft requires exactly one of `cover_image` or `thumb_media_id`；微信要求文章必须有封面')
      }

      const htmlPath = resolvePath(args.html_path)
      const rendered = await readFile(htmlPath, { encoding: 'utf8', signal: exec.signal })

      const urls = Object.fromEntries((args.images ?? []).map(entry => [entry.token, entry.url]))
      const content = fillImageUrls(rendered, urls)

      // Shipping an unresolved token would publish an article whose images are dead
      // links, and the failure would only be visible after a human hits send.
      const unresolved = [...content.matchAll(TOKEN_PATTERN)].map(match => match[1]!)
      if (unresolved.length > 0) {
        throw new Error(
          `还有 ${unresolved.length} 张图没上传:${[...new Set(unresolved)].join(', ')}。`
          + '先对每张本地图调用 mp_upload_image,把 token→url 一起传进来。',
        )
      }

      const client = await connect(ctx, config)
      const thumbMediaId = args.thumb_media_id
        ?? await client.uploadThumb(resolvePath(args.cover_image!), exec.signal)

      const author = args.author ?? config.defaultAuthor
      const article: DraftArticle = {
        title: args.title,
        content,
        thumb_media_id: thumbMediaId,
        ...author ? { author } : {},
        ...args.digest !== undefined ? { digest: args.digest } : {},
        ...args.source_url !== undefined ? { content_source_url: args.source_url } : {},
      }
      const mediaId = await client.addDraft([article], exec.signal)

      // The submitted body differs from the rendered file once tokens are filled;
      // keeping it makes a "what exactly did we send" question answerable later.
      await writeFile(`${htmlPath}.submitted.html`, content, 'utf-8').catch(() => undefined)

      return {
        mediaId,
        title: args.title,
        bytes: Buffer.byteLength(content, 'utf-8'),
        imagesFilled: Object.keys(urls).length,
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Create WeChat draft: ${args.title}`,
      kind: 'other',
      locations: [{ path: args.html_path }],
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'mp_list_drafts',
    description:
      'List recent drafts in the WeChat Official Account draft box, newest first. '
      + 'Read-only; use it to confirm a draft landed.',
    parameters: {
      count: {
        type: 'integer',
        description: 'How many drafts to return, 1 to 20. Defaults to 5.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          drafts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                mediaId: { type: 'string', required: true },
                updatedAt: { type: 'integer', required: true, description: 'Unix seconds.' },
                titles: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.drafts.length === 0
          ? '草稿箱是空的。'
          : value.drafts
              .map(draft => `${new Date(draft.updatedAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}  ${draft.titles.join(' / ')}  (${draft.mediaId})`)
              .join('\n'),
      }],
    },
    async execute(args, exec) {
      const count = args.count ?? 5
      if (count < 1 || count > 20) throw new Error('mp_list_drafts: count 必须在 1..20 之间')
      const client = await connect(ctx, config)
      const drafts = await client.listDrafts(count, exec.signal)
      return {
        drafts: drafts.map(draft => ({
          mediaId: draft.media_id,
          updatedAt: draft.update_time,
          titles: draft.titles,
        })),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List WeChat drafts', kind: 'other' }),
  }))
}
