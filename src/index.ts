/**
 * dsh plugin: turn markdown into a typeset WeChat Official Account draft.
 *
 * This module and `./tools/` are the only Cordis-aware layers. Typesetting lives in
 * `./render/` and the API wrapper in `./mp-client/`, neither of which imports the
 * harness, so a breaking dsh change is contained to the shell (PLAN 决策 2).
 * @module dsh-wechat-mp
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: resolves ctx.credentials for the API-tool child below.
import type {} from '@deepseek-ai/dsh-credentials'
import type { Config } from './config.ts'
import { registerApiTools } from './tools/api.ts'
import { registerRenderTool } from './tools/render.ts'

export { Config } from './config.ts'
export type { Config as ConfigType } from './config.ts'

export const name = 'wechat-mp'
export const inject = ['tools']

/**
 * Register the typesetting tool always, and the API tools once a credential
 * provider is composed.
 *
 * The split is deliberate: typesetting needs no account and no permissions, so a
 * reader whose Official Account cannot reach the draft API still gets usable HTML
 * to paste into the console by hand.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - deployment settings.
 */
export function apply(ctx: Context, config: Config): void {
  registerRenderTool(ctx, config)
  ctx.inject(['credentials'], (credentialCtx) => {
    registerApiTools(credentialCtx, config)
  })
}
