# dsh-wechat-mp

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that turns markdown into a typeset WeChat Official Account (微信公众号) **draft**.

> "Put `~/posts/why-inline-css.md` in the draft box with the grace theme."

The agent renders the article, uploads each image, and creates the draft. It never broadcasts: sending is left to a human in the Official Account console.

## Why it exists

The WeChat editor throws away `<style>` blocks and class names, and filters every image not hosted on `mmbiz.qpic.cn`. So "paste your HTML in" does not work, and neither does an article that references your own CDN. This plugin does the two boring, error-prone parts: **inline every style onto its element**, and **route every image through WeChat's own upload endpoint**.

## Two layers, and only one needs an account

| Layer | Needs credentials? | What you get |
|---|---|---|
| **Typesetting** (`mp_render`) | No | Inline-styled HTML + a local preview page. Paste it into the console by hand. |
| **API** (`mp_upload_image`, `mp_create_draft`, `mp_list_drafts`) | Yes | The agent creates the draft for you. |

If your account cannot reach the draft API — an unverified personal subscription account often cannot, see [Account types](#account-types) — the typesetting layer still works and is still worth having.

## Install

```bash
dsh plugin --profile web add dsh-wechat-mp
```

Then start dsh as usual. `mp_render` is available immediately.

## Credentials

The API tools read two credential references. Configuration holds the *names*; the values live with dsh's credential provider, so your config stays safe to commit.

| Reference | What it is |
|---|---|
| `WECHAT_MP_APPID` | The Official Account's AppID |
| `WECHAT_MP_SECRET` | The Official Account's AppSecret |

Supply them any way dsh resolves credentials — process environment, a project `.env`, `$DSH_HOME/.env`, or `$DSH_HOME/.credentials.yaml`:

```bash
export WECHAT_MP_APPID=wx...
export WECHAT_MP_SECRET=...
```

Both come from 公众平台 → 设置与开发 → 基本配置. **The AppSecret is shown once**; regenerating it invalidates any token other systems hold.

Without them, the API tools are still registered but every call fails with a message telling you what is missing. `mp_render` is unaffected.

## Tools

### `mp_render` — read-only

Markdown in, WeChat-ready HTML out. Writes the article body and a standalone preview page, and returns their paths.

Image sources come back as placeholder tokens (`dsh-mp-image-0`, …), not URLs — they are filled in after upload.

| Parameter | |
|---|---|
| `path` / `markdown` | Exactly one: a markdown file, or the source text. |
| `theme` | `default`, `grace`, `simple`. |
| `code_theme` | `github`, `github-dark`, `atom-one-light`, `atom-one-dark`, `vs`, `monokai`. |
| `primary_color` | Accent hex, e.g. `#0F4C81`. |
| `font_size` | e.g. `15px`. |
| `indent` | Indent each paragraph 2em, as Chinese print does. |
| `line_numbers` | Line numbers in code blocks. |

### `mp_upload_image` — write, **requires approval**

Uploads one local jpg/png (under 1 MB) and returns its `mmbiz.qpic.cn` URL.

### `mp_create_draft` — write, **requires approval**

Takes the `htmlPath` from `mp_render`, the token→URL map from the uploads, a title and a cover, and creates the draft.

It **refuses before touching the API** if any image token is still unresolved — otherwise you would only discover the dead images after hitting send. A cover is mandatory (`cover_image` or `thumb_media_id`, exactly one) because WeChat requires one.

### `mp_list_drafts` — read-only

Recent drafts, newest first. Useful to confirm one landed.

## Approval

The two write tools go through dsh's approval seam via `tools/pre-execute`, and **fail closed**: with no approval channel composed, the call is denied rather than silently allowed. There is no configuration switch to disable this — an Official Account is a public publishing channel.

A headless deployment with no answerer therefore cannot upload or create drafts. That is deliberate. Compose an approval answerer (the Web UI has one) or drive it through a machine answerer such as the ACP bridge.

## Configuration

All optional; set them on the plugin row in your profile's `cordis.patch.yml`.

```yaml
- id: wechat-mp
  config:
    theme: default          # default | grace | simple
    codeTheme: github
    primaryColor: '#0F4C81'
    fontSize: 15px
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"
    outputDir: ''           # '' → a temp directory
    appIdRef: WECHAT_MP_APPID
    appSecretRef: WECHAT_MP_SECRET
    tokenCacheDir: ''       # '' → a temp directory
    baseUrl: https://api.weixin.qq.com
    defaultAuthor: ''
```

A patch layer replaces a row's whole `config`, so restate every key you want to keep.

## Known pitfalls

### IP allowlist (errcode 40164)

Every API call must originate from an IP listed in 公众平台 → 基本配置 → IP白名单. Home broadband rotates its address, so a setup that worked yesterday can fail today. The error message says so explicitly; go update the allowlist.

### access_token is shared per account (errcode 45009)

WeChat issues one token per account, valid two hours, with a bounded number of daily grants — and **a new grant invalidates the previous token**. If another system (a CMS, a WeChat SDK, a colleague's script) uses the same account, you will evict each other.

This plugin caches the token on disk, refreshes five minutes early, and collapses concurrent refreshes into one grant. It cannot do anything about a *different* system on the same account. If you have one, expect intermittent 40001/42001.

### Account types

Which endpoints an account may call depends on its type and verification status. An unverified personal subscription account (个人订阅号) generally has neither the draft box nor the material API, and calls come back as **errcode 48001, "api unauthorized"**.

The plugin says so in plain language when it happens. If that is your account, use `mp_render` and paste the HTML into the console yourself — that path needs no permissions at all.

### Images

`media/uploadimg` accepts jpg and png under 1 MB; the plugin checks locally before spending an API call. The cover is a *different* endpoint — a permanent thumb material — and the plugin handles that for you.

## Programmatic use

The typesetting layer has no dsh dependency and can be imported directly:

```ts
import { render, previewDocument } from 'dsh-wechat-mp/render'

const { html, images, bytes } = render(markdown, { theme: 'grace' })
```

## Themes

The stylesheets come from [doocs/md](https://github.com/doocs/md) (WTFPL) — the WeChat markdown editor most Chinese writers already know, so the output looks familiar. `grace` and `simple` are overlays on `default`.

One difference: doocs targets the browser clipboard, where the browser has already computed `color-mix()` and `calc()`. This plugin submits raw HTML to the draft API, where WeChat's own filter is the only reader, so every modern CSS function is flattened to a literal (rgba, hex, px) before submission.

## Limitations

- **No mermaid, KaTeX, or infographics.** Ordinary markdown only: headings, paragraphs, emphasis, links, lists, tables, blockquotes, code with highlighting, images, rules.
- **Drafts only.** No broadcast, no scheduled publishing, no comment management, by design.
- **One account per plugin instance.**
- **No custom themes yet** — three built-ins.
- **Remote images are not re-hosted.** An `https://` image in your markdown is reported but not downloaded and re-uploaded; WeChat will filter it. Point at local files, or upload and substitute yourself.

## Status

Early. DeepSeek Harness is itself a developer preview and warns of breaking changes; this plugin isolates its harness contact to a thin tool shell so breakage stays contained.

## License

[MIT](LICENSE). Theme CSS from doocs/md under the WTFPL.
