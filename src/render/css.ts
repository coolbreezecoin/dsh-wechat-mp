/**
 * CSS assembly and flattening for the WeChat draft path.
 *
 * doocs/md targets the browser clipboard: it pastes into the WeChat editor, where
 * the browser has already computed modern CSS functions. This plugin posts raw HTML
 * to `draft/add`, where WeChat's server-side sanitizer is the only reader, so every
 * `color-mix()` / `calc()` / `var()` must be resolved to a literal before it ships.
 * @module
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Built-in theme names. `grace` and `simple` are overlays applied on top of `default`. */
export const THEME_NAMES = ['default', 'grace', 'simple'] as const

export type ThemeName = (typeof THEME_NAMES)[number]

/** Resolved typography knobs a theme's CSS variables are filled from. */
export interface ThemeVars {
  primaryColor: string
  fontFamily: string
  fontSize: string
}

const THEME_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'themes')

const cache = new Map<string, string>()

function readTheme(file: string): string {
  const hit = cache.get(file)
  if (hit !== undefined) return hit
  const css = readFileSync(join(THEME_DIR, file), 'utf-8')
  cache.set(file, css)
  return css
}

/**
 * Strip the `#output` editor scope so juice matches a bare document fragment.
 * Mirrors `stripOutputScope` in doocs/md `apps/web/src/services/export/share-styles.ts`.
 * @param css - theme CSS written against the editor's `#output` container.
 * @returns the same rules, unscoped.
 */
function stripOutputScope(css: string): string {
  return css
    .replace(/#output\s*\{/g, 'body {')
    .replace(/#output\s+/g, '')
    .replace(/^#output\s*/gm, '')
}

/** `--foreground` / `--blockquote-background` normally come from the editor shell's `:root`. */
const SHELL_VARS: Record<string, string> = {
  '--foreground': '0 0% 3.9%',
  '--blockquote-background': '#f7f7f7',
}

/**
 * Replace every `var(--x)` with its literal value.
 * @param css - CSS possibly referencing theme or shell variables.
 * @param vars - variable name to literal value.
 * @returns CSS with no `var()` references left for the known names.
 */
function resolveVars(css: string, vars: Record<string, string>): string {
  // Repeat until stable: a variable's value may itself reference another.
  let out = css
  for (let pass = 0; pass < 5; pass++) {
    const next = out.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (whole, name: string, fallback?: string) => {
      const value = vars[name]
      if (value !== undefined) return value
      if (fallback !== undefined) return fallback.trim()
      return whole
    })
    if (next === out) break
    out = next
  }
  return out
}

/** `hsl(0 0% 3.9%)` → `#0a0a0a`. WeChat keeps `hsl()`, but a hex literal is safer and shorter. */
function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12
    const value = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * value).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

function parseHex(color: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  const digits = m?.[1]
  if (digits === undefined) return undefined
  const hex = digits.length === 3 ? digits.replace(/./g, c => c + c) : digits
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ]
}

/** Resolve `hsl(<h> <s>% <l>%)` to hex. Only the space-separated form the themes use. */
function flattenHsl(css: string): string {
  return css.replace(
    /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/g,
    (_whole, h: string, s: string, l: string) => hslToHex(Number(h), Number(s), Number(l)),
  )
}

/**
 * Resolve `color-mix(in srgb, <color> <pct>%, transparent)` to `rgba(...)`.
 * That single form is the only one the vendored themes use; anything else is left
 * untouched rather than guessed at.
 * @param css - CSS with variables already resolved to literal colors.
 * @returns CSS with the transparent-mix form flattened to rgba.
 */
function flattenColorMix(css: string): string {
  return css.replace(
    /color-mix\(\s*in\s+srgb\s*,\s*(#[0-9a-f]{3,6})\s+([\d.]+)%\s*,\s*transparent\s*\)/gi,
    (whole, color: string, pct: string) => {
      const rgb = parseHex(color)
      if (!rgb) return whole
      const alpha = Math.round((Number(pct) / 100) * 1000) / 1000
      return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
    },
  )
}

/**
 * Resolve `calc(<px> * <factor>)` and `calc(<px> / <divisor>)` to a literal px value.
 * Theme CSS only ever scales the base font size, so a general expression evaluator
 * would be unused machinery.
 * @param css - CSS with variables already resolved.
 * @returns CSS with single-operation px arithmetic reduced to a literal.
 */
function flattenCalc(css: string): string {
  return css.replace(
    /calc\(\s*([\d.]+)px\s*([*/])\s*([\d.]+)\s*\)/g,
    (_whole, base: string, op: string, factor: string) => {
      const value = op === '*' ? Number(base) * Number(factor) : Number(base) / Number(factor)
      return `${Math.round(value * 100) / 100}px`
    },
  )
}

/**
 * Reduce every modern CSS function the themes emit to a literal WeChat accepts.
 * Order matters: variables first (they carry the colors), then hsl, then color-mix
 * (it consumes hex literals), then calc.
 * @param css - assembled theme CSS.
 * @param vars - resolved typography values.
 * @returns CSS containing only literal values.
 */
export function flattenCss(css: string, vars: ThemeVars): string {
  const table: Record<string, string> = {
    ...SHELL_VARS,
    '--md-primary-color': vars.primaryColor,
    '--md-font-family': vars.fontFamily,
    '--md-font-size': vars.fontSize,
  }
  let out = resolveVars(css, table)
  out = flattenHsl(out)
  out = flattenColorMix(out)
  out = flattenCalc(out)
  return out
}

/** Paragraph-level options that the editor expresses as generated CSS rather than theme CSS. */
export interface ParagraphOptions {
  /** Indent the first line of every paragraph by 2em, as Chinese print typography does. */
  indent?: boolean
  /** Justify paragraph text instead of left-aligning it. */
  justify?: boolean
}

/**
 * Assemble the complete stylesheet for one render: base, theme (with its overlay),
 * highlight.js colors, paragraph options, then flatten to literals.
 * @param theme - built-in theme name.
 * @param vars - resolved typography values.
 * @param hljsCss - highlight.js stylesheet for the selected code theme.
 * @param paragraph - paragraph indent/justify options.
 * @returns one flattened stylesheet ready for juice.
 */
export function assembleCss(
  theme: ThemeName,
  vars: ThemeVars,
  hljsCss: string,
  paragraph: ParagraphOptions = {},
): string {
  // resolveThemeCSS() in doocs/md themeApplicator.ts: default.css is always the
  // base and grace/simple are overlays appended after it. Loading an overlay
  // alone drops nearly every typography rule.
  const themeCss = theme === 'default'
    ? readTheme('default.css')
    : `${readTheme('default.css')}\n\n${readTheme(`${theme}.css`)}`

  const paragraphCss = paragraph.indent || paragraph.justify
    ? `p {\n${paragraph.indent ? '  text-indent: 2em;\n' : ''}${paragraph.justify ? '  text-align: justify;\n' : ''}}`
    : ''

  const merged = [
    stripOutputScope(readTheme('base.css')),
    stripOutputScope(themeCss),
    hljsCss,
    paragraphCss,
  ].filter(Boolean).join('\n\n')

  return flattenCss(merged, vars)
}
