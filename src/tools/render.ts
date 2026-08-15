/**
 * The `mp_render` tool: markdown in, WeChat-ready HTML on disk.
 * @module
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { type Config, resolveOutputDir } from '../config.ts'
import {
  CODE_THEMES,
  type CodeTheme,
  previewDocument,
  render,
  THEME_NAMES,
  type ThemeName,
} from '../render/index.ts'

/** Slug safe for a filename, derived from the article title or source name. */
export function slugify(text: string): string {
  const cleaned = text.trim().replace(/[/\\?%*:|"<>.\s]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 60) || 'article'
}

/** First ATX heading in the source, used as the default article name. */
export function firstHeading(markdown: string): string | undefined {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim()
}

/**
 * Register `mp_render`.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment typesetting defaults.
 */
export function registerRenderTool(ctx: Context, config: Config): void {
  const outputRoot = resolveOutputDir(config)

  ctx.tools.register(defineTool({
    name: 'mp_render',
    description:
      'Typeset markdown into WeChat Official Account HTML. Every style is inlined onto '
      + 'the elements, because the WeChat editor discards <style> blocks and class names. '
      + 'Writes the article body and a standalone preview file, and returns their paths '
      + 'plus the images the article references. Image sources are placeholder tokens, not '
      + 'URLs: WeChat filters images not hosted on its own CDN, so each one must go through '
      + 'mp_upload_image before mp_create_draft. Read-only apart from the two files it writes.',
    parameters: {
      path: {
        type: 'string',
        description: 'Path to a markdown file. Give this OR `markdown`, not both.',
      },
      markdown: {
        type: 'string',
        description: 'Markdown source text. Give this OR `path`, not both.',
      },
      theme: {
        type: 'string',
        enum: [...THEME_NAMES],
        description: `Typesetting theme. Defaults to the deployment setting (${config.theme}).`,
      },
      code_theme: {
        type: 'string',
        enum: Object.keys(CODE_THEMES),
        description: `Code block color scheme. Defaults to ${config.codeTheme}.`,
      },
      primary_color: {
        type: 'string',
        description: `Accent color as a hex value like #0F4C81. Defaults to ${config.primaryColor}.`,
      },
      font_size: {
        type: 'string',
        description: `Body font size, e.g. 15px. Defaults to ${config.fontSize}.`,
      },
      indent: {
        type: 'boolean',
        description: 'Indent the first line of each paragraph by 2em, as Chinese print does.',
      },
      line_numbers: {
        type: 'boolean',
        description: 'Show line numbers in code blocks.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          htmlPath: {
            type: 'string',
            required: true,
            description: 'File holding the article body. Pass this to mp_create_draft.',
          },
          previewPath: {
            type: 'string',
            required: true,
            description: 'Standalone HTML page for a human to open and check the typesetting.',
          },
          bytes: { type: 'integer', required: true, description: 'UTF-8 size of the article body.' },
          theme: { type: 'string', required: true },
          title: { type: 'string', required: true, description: 'Article title taken from the first heading.' },
          images: {
            type: 'array',
            required: true,
            description: 'Images in document order. Each must be uploaded before the draft is created.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                token: { type: 'string', required: true, description: 'Placeholder occupying the img src.' },
                source: { type: 'string', required: true, description: 'Source as written in the markdown.' },
                isLocal: { type: 'boolean', required: true, description: 'True when the source is a local file.' },
                resolvedPath: {
                  type: 'string',
                  description: 'Absolute path of a local source, resolved against the markdown file.',
                },
                alt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const local = value.images.filter(image => image.isLocal).length
        const imageNote = value.images.length === 0
          ? 'No images.'
          : `${value.images.length} image(s), ${local} local. Upload each with mp_upload_image, then pass the token→url map to mp_create_draft.`
        return [{
          type: 'text',
          text: `Typeset "${value.title}" with the ${value.theme} theme: ${value.bytes} bytes.\n`
            + `Article body: ${value.htmlPath}\nPreview: ${value.previewPath}\n${imageNote}`,
        }]
      },
    },
    async execute(args, exec) {
      if ((args.path === undefined) === (args.markdown === undefined)) {
        throw new Error('mp_render requires exactly one of `path` or `markdown`')
      }

      const sourcePath = args.path === undefined ? undefined : resolvePath(args.path)
      const markdown = sourcePath === undefined
        ? args.markdown!
        : await readFile(sourcePath, { encoding: 'utf8', signal: exec.signal })

      if (markdown.trim().length === 0) {
        throw new Error('mp_render received empty markdown')
      }

      const theme = (args.theme as ThemeName | undefined) ?? config.theme
      const result = render(markdown, {
        theme,
        codeTheme: (args.code_theme as CodeTheme | undefined) ?? config.codeTheme,
        primaryColor: args.primary_color ?? config.primaryColor,
        fontFamily: config.fontFamily,
        fontSize: args.font_size ?? config.fontSize,
        indent: args.indent,
        lineNumbers: args.line_numbers,
      })

      const title = firstHeading(markdown)
        ?? (sourcePath === undefined ? 'article' : basename(sourcePath, extname(sourcePath)))
      const slug = slugify(title)

      await mkdir(outputRoot, { recursive: true })
      const htmlPath = join(outputRoot, `${slug}.html`)
      const previewPath = join(outputRoot, `${slug}.preview.html`)
      await writeFile(htmlPath, result.html, 'utf-8')
      await writeFile(previewPath, previewDocument(result.html, title), 'utf-8')

      // A relative local image is written relative to its markdown file; without a
      // source file there is no anchor, so the path is reported as-is for the caller.
      const anchor = sourcePath === undefined ? undefined : resolvePath(sourcePath, '..')
      return {
        htmlPath,
        previewPath,
        bytes: result.bytes,
        theme,
        title,
        images: result.images.map(image => ({
          token: image.token,
          source: image.source,
          isLocal: image.isLocal,
          alt: image.alt,
          ...image.isLocal && (anchor !== undefined || isAbsolute(image.source))
            ? { resolvedPath: resolvePath(anchor ?? '', image.source) }
            : {},
        })),
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `Typeset for WeChat${args.theme ? ` (${args.theme})` : ''}`,
      kind: 'other',
      ...args.path ? { locations: [{ path: args.path }] } : {},
    }),
  }))
}
