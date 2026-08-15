/**
 * Plugin configuration. Credential *references* live here; the secrets behind them
 * stay with the credential provider, so this config is safe to commit and to render
 * in a settings UI.
 * @module
 */

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { CODE_THEMES, type CodeTheme, DEFAULTS, THEME_NAMES, type ThemeName } from './render/index.ts'
import { DEFAULT_BASE_URL } from './mp-client/index.ts'

/** Deployment settings for typesetting and for reaching one Official Account. */
export interface Config {
  /** Built-in theme applied when a call omits `theme`. */
  theme: ThemeName
  /** highlight.js stylesheet applied when a call omits `code_theme`. */
  codeTheme: CodeTheme
  /** Accent color (hex) used for headings, links, and inline code. */
  primaryColor: string
  /** CSS font-family stack for the article body. */
  fontFamily: string
  /** Base font size, e.g. `15px`. */
  fontSize: string
  /** Directory rendered HTML and preview files are written to. Empty means a temporary directory. */
  outputDir: string
  /** Credential reference naming the Official Account's AppID. */
  appIdRef: string
  /** Credential reference naming the Official Account's AppSecret. */
  appSecretRef: string
  /** Directory holding the access_token cache. Empty means a temporary directory. */
  tokenCacheDir: string
  /** WeChat API origin. Change it only to route through a proxy that fronts the real API. */
  baseUrl: string
  /** Default author written on drafts when a call omits it. */
  defaultAuthor: string
}

export const Config: Schema<Config> = Schema.object({
  theme: Schema.union([...THEME_NAMES]).default(DEFAULTS.theme),
  codeTheme: Schema.union(Object.keys(CODE_THEMES) as CodeTheme[]).default(DEFAULTS.codeTheme),
  primaryColor: Schema.string().default(DEFAULTS.primaryColor),
  fontFamily: Schema.string().default(DEFAULTS.fontFamily),
  fontSize: Schema.string().default(DEFAULTS.fontSize),
  outputDir: Schema.string().default(''),
  appIdRef: Schema.string().default('WECHAT_MP_APPID'),
  appSecretRef: Schema.string().default('WECHAT_MP_SECRET'),
  tokenCacheDir: Schema.string().default(''),
  baseUrl: Schema.string().default(DEFAULT_BASE_URL),
  defaultAuthor: Schema.string().default(''),
})

/** Where rendered artifacts go when the deployment does not pin a directory. */
export function resolveOutputDir(config: Config): string {
  return config.outputDir || join(tmpdir(), 'dsh-wechat-mp')
}

/** Where the access_token cache goes when the deployment does not pin a directory. */
export function resolveTokenCacheDir(config: Config): string {
  return config.tokenCacheDir || join(tmpdir(), 'dsh-wechat-mp', 'tokens')
}
