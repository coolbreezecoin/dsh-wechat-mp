/**
 * Typert Host Face — the `TYPERT` manifest the loader registers so the browser
 * half can call this plugin's service.
 *
 * Hand-written rather than generated: the generator is a workspace tool, and an
 * external plugin only needs the shape the loader validates. The loader requires
 * a real zod v4 schema per codec (it checks for `_zod`), so these cannot be the
 * lightweight validators the browser bundle uses.
 * @module dsh-wechat-mp/typert
 */

import { z } from 'zod'

const publishParameterSchema = z.object({
  markdown: z.string(),
  title: z.string().optional(),
  theme: z.string().optional(),
  fontSize: z.string().optional(),
})

const publishResultSchema = z.object({
  ok: z.boolean(),
  mediaId: z.string().optional(),
  title: z.string().optional(),
  error: z.string().optional(),
})

/** The manifest imported by `@deepseek-ai/dsh-typert-loader` at plugin load. */
export const TYPERT = {
  package: 'dsh-wechat-mp',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-wechat-mp#wechatMp/publish',
      service: 'wechatMp',
      namespace: 'wechatMp',
      method: 'publish',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          codec: {
            mode: 'strict',
            typeSymbol: 'dsh-wechat-mp/remote#PublishRequest',
            schema: publishParameterSchema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-wechat-mp/remote#PublishResult',
        schema: publishResultSchema,
      },
      sourceLocation: { file: 'src/remote/service.ts', line: 1, column: 1 },
    },
  ],
} as const
