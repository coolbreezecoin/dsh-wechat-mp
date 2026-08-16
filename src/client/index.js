/**
 * Browser half: the「发公众号」entry in the assistant-message action strip.
 *
 * Hand-written in the `window.__ModuleLoader__` factory format rather than built
 * from TSX. The official plugins bundle through the monorepo's tsdown client
 * face, which an external package cannot reach; this format needs no bundler and
 * takes React from the host, so the package ships no second copy.
 *
 * The Host owns every WeChat call — see `src/remote/service.ts`. This file only
 * reads the addressed message out of the session snapshot and shows the outcome.
 */
window.__ModuleLoader__.load({
  id: 'dsh-wechat-mp',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    /**
     * Wire validators for the Remote contract.
     *
     * The client assembly only requires `parse()` on each codec, so these stand
     * in for zod and keep it out of the browser bundle. The Host face uses real
     * zod schemas, which its loader checks for.
     */
    function asRecord(value, field) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(field + ': expected object')
      }
      return value
    }
    function asString(value, field) {
      if (typeof value !== 'string') throw new Error(field + ': expected string')
      return value
    }
    function optionalString(value, field) {
      if (value === undefined) return undefined
      return asString(value, field)
    }

    var publishParameterSchema = {
      parse: function (value) {
        var o = asRecord(value, 'PublishRequest')
        return {
          markdown: asString(o.markdown, 'PublishRequest.markdown'),
          title: optionalString(o.title, 'PublishRequest.title'),
          theme: optionalString(o.theme, 'PublishRequest.theme'),
          fontSize: optionalString(o.fontSize, 'PublishRequest.fontSize'),
        }
      },
    }

    var publishResultSchema = {
      parse: function (value) {
        var o = asRecord(value, 'PublishResult')
        if (typeof o.ok !== 'boolean') throw new Error('PublishResult.ok: expected boolean')
        return {
          ok: o.ok,
          mediaId: optionalString(o.mediaId, 'PublishResult.mediaId'),
          title: optionalString(o.title, 'PublishResult.title'),
          error: optionalString(o.error, 'PublishResult.error'),
        }
      },
    }

    var TYPERT_REMOTE = {
      package: 'dsh-wechat-mp',
      face: 'remote-client',
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
    }

    /**
     * Pull the addressed assistant message's text out of the session snapshot.
     *
     * The slot hands over only a `messageId` — deliberately, so contributors do
     * not import the conversation implementation. The text has to be recovered
     * from the snapshot, whose node shapes differ by client version, so every
     * access here is defensive rather than assuming one layout.
     */
    function messageTextFrom(snapshot, messageId) {
      if (!snapshot) return ''
      var nodes = snapshot.nodes || snapshot.timeline || []
      var parts = []
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        if (!node || node.messageId !== messageId) continue
        var content = node.content || node.blocks || node.parts
        if (typeof content === 'string') { parts.push(content); continue }
        if (!content || typeof content.length !== 'number') continue
        for (var j = 0; j < content.length; j++) {
          var block = content[j]
          if (!block) continue
          if (typeof block === 'string') parts.push(block)
          else if (typeof block.text === 'string') parts.push(block.text)
        }
      }
      return parts.join('')
    }

    /** The strip entry: one button plus its transient outcome. */
    function PublishAction(props) {
      var state = React.useState({ phase: 'idle', message: '' })
      var status = state[0]
      var setStatus = state[1]
      var snapshot = props.useSession(function (value) { return value })

      var publish = React.useCallback(function () {
        if (status.phase === 'busy') return
        var markdown = messageTextFrom(snapshot, props.messageId)
        if (!markdown.trim()) {
          setStatus({ phase: 'error', message: '这条消息没有可发布的正文' })
          return
        }
        setStatus({ phase: 'busy', message: '' })
        props.remoteRef().then(function (remote) {
          return remote.publish({ markdown: markdown })
        }).then(function (result) {
          if (result && result.ok) {
            setStatus({ phase: 'done', message: '已存入草稿箱:' + (result.title || '') })
          } else {
            setStatus({ phase: 'error', message: (result && result.error) || '发布失败' })
          }
        }).catch(function (error) {
          setStatus({ phase: 'error', message: String((error && error.message) || error) })
        })
      }, [snapshot, props.messageId, status.phase])

      var label = status.phase === 'busy' ? '发布中…' : '发公众号'
      var title = status.phase === 'error' || status.phase === 'done' ? status.message : '把这条回复存入公众号草稿箱'

      return React.createElement(
        'button',
        {
          type: 'button',
          onClick: publish,
          disabled: status.phase === 'busy',
          title: title,
          style: {
            background: 'none',
            border: 'none',
            padding: '2px 6px',
            cursor: status.phase === 'busy' ? 'default' : 'pointer',
            font: 'inherit',
            fontSize: '12px',
            opacity: status.phase === 'busy' ? 0.6 : 1,
            color: status.phase === 'error' ? '#b23c3c' : status.phase === 'done' ? '#2f7a55' : 'inherit',
          },
        },
        status.phase === 'done' ? '✓ 已存草稿' : label,
      )
    }

    var inject = ['slots', 'remote']

    /**
     * Client plugin body: mount the Remote contract, then contribute the entry.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      var mountPromise = null
      ctx.effect(function () {
        mountPromise = ctx.remote.$mount(TYPERT_REMOTE)
        return function () {
          if (mountPromise) {
            mountPromise.then(function (dispose) { if (dispose) dispose() }).catch(function () {})
          }
        }
      })

      var remoteRef = function () {
        return mountPromise.then(function () {
          var remote = ctx.get('remote.wechatMp')
          if (!remote) throw new Error('公众号发布服务尚未就绪')
          return remote
        })
      }

      ctx.slots.inject('conversation.chat.assistant-actions', function () {
        return ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            id: 'wechat-mp-publish',
            order: 20,
            label: function () { return '发公众号' },
          },
          function (props) {
            return React.createElement(PublishAction, {
              remoteRef: remoteRef,
              messageId: props.messageId,
              useSession: props.useSession,
            })
          },
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
