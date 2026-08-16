# dsh-wechat-mp

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件:把 markdown 变成排好版的微信公众号**草稿**。

> 「把 `~/posts/why-inline-css.md` 用 grace 主题发到草稿箱。」

agent 负责渲染文章、上传图片、创建草稿。**不做群发**——发送这一步留给你在公众平台后台确认。

<!-- 用绝对 URL:npm 在自己的域名下渲染 README,仓库相对路径会 404。 -->
![渲染文章并建好草稿的完整过程](https://raw.githubusercontent.com/coolbreezecoin/dsh-wechat-mp/main/assets/demo.gif)

## 为什么需要它

公众号编辑器会把 `<style>` 块和 class 名整个扔掉,还会过滤掉所有不在 `mmbiz.qpic.cn` 上的图片。所以「把 HTML 粘进去」是行不通的,引用自己图床的文章也一样。这个插件替你干那两件无聊又容易错的事:**把每条样式内联到元素上**,以及**让每张图都走微信自己的上传接口**。

## 两层,只有一层需要账号

| 层 | 要凭据吗 | 得到什么 |
|---|---|---|
| **排版层**(`mp_render`) | 不要 | 内联样式的 HTML + 本地预览页,可以手动粘进后台编辑器 |
| **API 层**(`mp_upload_image`、`mp_create_draft`、`mp_list_drafts`) | 要 | agent 直接把草稿建好 |

连未认证的个人订阅号都能调草稿箱接口,见[公众号类型](#公众号类型)。万一你的号确实调不了,排版层单独也能用。

## 安装

```bash
dsh plugin --profile web add dsh-wechat-mp
```

照常启动 dsh,`mp_render` 立刻可用。

## 凭据

API 层读两个凭据引用。配置里只放**引用名**,值交给 dsh 的 credential provider 管——所以配置文件可以放心提交。

| 引用名 | 含义 |
|---|---|
| `WECHAT_MP_APPID` | 公众号 AppID |
| `WECHAT_MP_SECRET` | 公众号 AppSecret |

按 dsh 认的任何方式提供都行:进程环境变量、项目 `.env`、`$DSH_HOME/.env`、`$DSH_HOME/.credentials.yaml`。

```bash
export WECHAT_MP_APPID=wx...
export WECHAT_MP_SECRET=...
```

两个都在 公众平台 → 设置与开发 → 基本配置 里。**AppSecret 只显示一次**;重置它会让其他系统手上的 token 立刻失效。

不配也不会崩:API tool 仍然注册,但调用时会明确告诉你缺哪个。`mp_render` 完全不受影响。

## 四个 tool

### `mp_render` —— 只读

markdown 进,公众号能吃的 HTML 出。写出正文文件和一个独立预览页,返回两个路径。

图片的 src 返回的是占位符(`dsh-mp-image-0`……)而不是 URL,等上传完再回填。

| 参数 | |
|---|---|
| `path` / `markdown` | 二选一:markdown 文件路径,或者直接给正文 |
| `theme` | `default`、`grace`、`simple` |
| `code_theme` | `github`、`github-dark`、`atom-one-light`、`atom-one-dark`、`vs`、`monokai` |
| `primary_color` | 主色,如 `#0F4C81` |
| `font_size` | 如 `15px` |
| `indent` | 段落首行缩进 2em |
| `line_numbers` | 代码块显示行号 |

### `mp_upload_image` —— 写操作

传一张本地 jpg/png(小于 1MB),返回它的 `mmbiz.qpic.cn` 地址。

### `mp_create_draft` —— 写操作

拿 `mp_render` 给的 `htmlPath`、上传得到的 token→URL 映射、标题和封面,创建草稿。

**只要还有占位符没填,它在碰任何接口之前就拒绝**——否则你要等到点了发送才发现一堆死图。封面是必须的(`cover_image` 或 `thumb_media_id` 恰好给一个),因为微信要求文章必须有封面。

### `mp_list_drafts` —— 只读

按时间倒序列出最近的草稿,用来确认草稿确实建上了。

## 一键发布(Web UI)

每条助手回复下面会多一个「**发公众号**」按钮。点一下,这条回复就按当前主题排好版、存进草稿箱——不用先写成文件再让 agent 发。

标题取消息里的第一个标题行,没有标题就取第一句(截到 64 字)。

用它之前必须配封面:微信要求每篇文章都有封面,而按钮没有地方让你挑。

```yaml
- id: wechat-mp
  config:
    defaultCover: /Users/you/posts/img/cover.png
```

没配的话点击会告诉你配哪个键,不会静默失败。

按钮和四个 tool 走的是**同一套排版和接口代码**,所以两边产出完全一致。消息里如果有外链图片,按钮会直接拒绝并说明原因——微信会把它们过滤掉,与其发出去变裂图,不如提前拦下。

## 审批

写操作默认不弹确认。插件本来就不发布任何东西——草稿仍然要人到后台点发送——所以无人值守跑一趟,留下的是一条你顺手删掉的草稿,而不是读者已经看到的推送。

想要确认就打开:

```yaml
- id: wechat-mp
  config:
    requireApproval: true
```

打开后走 dsh 的审批机制(`tools/pre-execute`),并且 **fail closed**:没有审批通道时是拒绝,不是默认放行。所以 headless 部署需要自己组合应答者——Web UI 自带一个,或者用 ACP 这类 machine answerer 驱动。

什么时候值得打开:agent 无人值守跑、而你在意这个号的**永久素材名额**——删草稿并不会把封面占掉的那个名额还给你。

## 配置

全部可选,写在 profile 的 `cordis.patch.yml` 里对应行上。

```yaml
- id: wechat-mp
  config:
    theme: default          # default | grace | simple
    codeTheme: github
    primaryColor: '#0F4C81'
    fontSize: 15px
    fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"
    outputDir: ''           # 留空 → 临时目录
    appIdRef: WECHAT_MP_APPID
    appSecretRef: WECHAT_MP_SECRET
    tokenCacheDir: ''       # 留空 → 临时目录
    baseUrl: https://api.weixin.qq.com
    defaultAuthor: ''
    defaultCover: ''         # 一键发布按钮必须配
    requireApproval: false   # true → 每次写操作前弹确认
```

注意 patch 层是**整体替换**一行的 `config`,不做深合并——想保留的键要一起写全。

## 已知的坑

### IP 白名单(errcode 40164)

所有接口调用的出口 IP 必须在 公众平台 → 基本配置 → IP白名单 里。**家庭宽带是动态 IP**,昨天能用今天就可能不行。报错信息会直接点明这一点,去后台更新即可。

### access_token 是全账号共享的(errcode 45009)

微信给每个公众号发一个 token,两小时有效,每天获取次数有限,而且**新发一个会让旧的立刻失效**。如果同一个公众号还有别的系统在用(CMS、某个微信 SDK、同事的脚本),你们会互相踢下线。

本插件把 token 缓存到磁盘、提前 5 分钟刷新、进程内并发刷新合并成一次。但它管不了**另一个系统**——如果确实存在,请预期偶发的 40001/42001。

### 公众号类型

**未认证的个人订阅号可以调草稿箱和素材接口。** 这是限制最严的账号类型,而且是拿真号实测的——所以只要你有公众号,API 层大概率就能用。

这一点值得明说,因为普遍的印象正好相反。这类号真正不能做的是**通过接口群发**,而本插件本来就不群发,所以这条限制碰不到。

如果某个接口确实对你的号不开放,微信会返回 **errcode 48001「api unauthorized」**,插件会用人话说明。那就用 `mp_render` 出 HTML 自己粘进后台——这条路完全不需要任何接口权限。

注意:**IP 白名单是在取 token 那一步就校验的**,还没走到具体接口。所以白名单没配好时所有调用都是 40164,这跟你有没有权限毫无关系;先把白名单弄对再测。

### 图片

`media/uploadimg` 只收 1MB 以内的 jpg/png,插件在本地先校验,不浪费接口调用次数。封面走的是**另一个接口**(永久素材 thumb),插件已经替你处理。

## 直接当库用

排版层不依赖 dsh,可以单独引:

```ts
import { render, previewDocument } from 'dsh-wechat-mp/render'

const { html, images, bytes } = render(markdown, { theme: 'grace' })
```

## 主题

主题 CSS 来自 [doocs/md](https://github.com/doocs/md)(WTFPL)——大多数中文作者已经熟悉的那个公众号 markdown 编辑器,所以产出看着眼熟。`grace` 和 `simple` 是叠在 `default` 上的 overlay。

有一处不同:doocs 走的是浏览器剪贴板,浏览器已经算过 `color-mix()` 和 `calc()`;本插件是直接把裸 HTML 提交给草稿接口,只有微信自己的过滤器会读它,所以提交前会把所有现代 CSS 函数压平成字面量(rgba / hex / px)。

## 不支持什么

- **没有 mermaid、KaTeX、信息图**。只覆盖普通 markdown:标题、段落、强调、链接、列表、表格、引用、带高亮的代码、图片、分割线。
- **只建草稿**。不群发、不定时发布、不管评论,这是有意的。
- **一个插件实例对一个公众号**。
- **暂无自定义主题**,三套内置。
- **远程图片不会被搬运**。markdown 里的 `https://` 图片会被列出来但不会自动下载再上传,微信那边会过滤掉。请用本地文件,或者自己上传后替换。

## 状态

早期版本。DeepSeek Harness 本身还是 developer preview 并明确警告会有 breaking change;本插件把与 harness 的接触面收在一层很薄的 tool 壳里,真 break 了改动范围可控。

## 许可

[MIT](LICENSE)。主题 CSS 来自 doocs/md,WTFPL。
