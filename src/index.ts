import { Context, HTTP, Schema } from 'koishi'
import { detectAdContent } from './ad'
import {
  HitReason,
  collectMessageParts,
  defaultNotify,
  findQrInImages,
  isOfficeFile,
  muteDurationMs,
  shouldModerate,
} from './detect'
import { collectTencentDocUrls, extractOfficeText, fetchTencentDoc } from './document'
import { downloadImage, decodeQr } from './qrcode'
import { isGroupInviteCard } from './share'

export const name = 'ban-qrcode'

export const inject = ['http']

export const usage = `
群内检测到图片二维码、拉群分享卡，或腾讯文档 / Word 里的卖货广告时，自动撤回并禁言发送者（默认 60 秒）。

机器人需要撤回消息和禁言成员的权限。群主 / 管理员默认跳过。
`

export interface Config {
  muteSeconds: number
  recall: boolean
  notify: boolean
  notifyText: string
  skipAdmins: boolean
  ignoreUsers: string[]
  guilds: string[]
  scanQrcode: boolean
  scanGroupInvite: boolean
  scanDocs: boolean
  adKeywords: string[]
}

export const Config: Schema<Config> = Schema.object({
  muteSeconds: Schema.number().min(0).default(60).description('禁言秒数。0 表示只撤回不禁言。'),
  recall: Schema.boolean().default(true).description('撤回违规消息。'),
  notify: Schema.boolean().default(true).description('处理后在群内发送提示。'),
  notifyText: Schema.string().default('').description('自定义提示。留空则按原因和禁言秒数生成。'),
  skipAdmins: Schema.boolean().default(true).description('跳过群主和管理员。'),
  ignoreUsers: Schema.array(Schema.string()).role('table').default([]).description('忽略的用户 ID。'),
  guilds: Schema.array(Schema.string()).role('table').default([]).description('只在这些群生效。留空表示全部群。'),
  scanQrcode: Schema.boolean().default(true).description('扫描图片二维码。'),
  scanGroupInvite: Schema.boolean().default(true).description('拦截邀请 / 推荐群聊分享卡。'),
  scanDocs: Schema.boolean().default(true).description('检查腾讯文档和 Word / 文本附件里的广告。'),
  adKeywords: Schema.array(Schema.string()).role('table').default([]).description('额外广告关键词。命中即撤回。'),
})

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('ban-qrcode')
  const docHttp = createDocHttp(ctx.http)

  ctx.on('message', async (session) => {
    if (!shouldModerate({
      guildId: session.guildId,
      isDirect: session.isDirect,
      userId: session.userId,
      selfId: session.selfId,
      ignoreUsers: config.ignoreUsers,
      guilds: config.guilds,
      roles: session.event.member?.roles,
      skipAdmins: config.skipAdmins,
    })) return

    const parts = collectMessageParts(session.elements ?? [], session.content ?? '')
    const docUrls = config.scanDocs ? collectTencentDocUrls([parts.text, ...parts.shares, ...parts.urls].join('\n')) : []
    const officeFiles = config.scanDocs ? parts.files.filter(file => isOfficeFile(file.name)) : []

    const needInvite = config.scanGroupInvite && parts.shares.some(isGroupInviteCard)
    const needQr = config.scanQrcode && parts.images.length > 0
    const needDocs = Boolean(docUrls.length || officeFiles.length)
    if (!needInvite && !needQr && !needDocs) return

    try {
      if (needInvite) {
        await enforce(session, config, logger, 'group-invite')
        return
      }

      if (needQr) {
        const hit = await findQrInImages(
          parts.images,
          src => downloadImage(ctx.http, src),
          decodeQr,
        )
        if (hit) {
          await enforce(session, config, logger, 'qrcode')
          return
        }
      }

      if (!needDocs) return

      for (const url of docUrls) {
        try {
          const doc = await fetchTencentDoc(docHttp, url)
          if (!doc) continue
          if (detectAdContent(doc.text, doc.title, config.adKeywords)) {
            await enforce(session, config, logger, 'ad-doc')
            return
          }
          if (config.scanQrcode && doc.images.length) {
            const qr = await findQrInImages(
              doc.images,
              src => downloadImage(ctx.http, src),
              decodeQr,
            )
            if (qr) {
              await enforce(session, config, logger, 'qrcode')
              return
            }
          }
        } catch (error) {
          logger.warn(error)
        }
      }

      for (const file of officeFiles) {
        try {
          const doc = extractOfficeText(await downloadImage(ctx.http, file.src), file.name)
          if (doc && detectAdContent(doc.text, doc.title || file.name, config.adKeywords)) {
            await enforce(session, config, logger, 'ad-doc')
            return
          }
        } catch (error) {
          logger.warn(error)
        }
      }
    } catch (error) {
      logger.warn(error)
    }
  })
}

interface EnforceSession {
  userId?: string
  guildId?: string
  messageId?: string
  channelId?: string
  bot: {
    deleteMessage(channelId: string, messageId: string): Promise<unknown>
    muteGuildMember(guildId: string, userId: string, duration: number): Promise<unknown>
  }
  send(content: string): Promise<unknown>
}

async function enforce(
  session: EnforceSession,
  config: Config,
  logger: { info: (...args: unknown[]) => void, warn: (error: unknown) => void },
  reason: HitReason,
) {
  logger.info('%s from %s in %s', reason, session.userId, session.guildId)

  if (config.recall && session.messageId && session.channelId) {
    try {
      await session.bot.deleteMessage(session.channelId, session.messageId)
    } catch (error) {
      logger.warn(error)
    }
  }

  const duration = muteDurationMs(config.muteSeconds)
  if (duration > 0 && session.guildId && session.userId) {
    try {
      await session.bot.muteGuildMember(session.guildId, session.userId, duration)
    } catch (error) {
      logger.warn(error)
    }
  }

  if (config.notify) {
    await session.send(config.notifyText || defaultNotify(config.muteSeconds, reason))
  }
}

function createDocHttp(http: HTTP) {
  return {
    async text(url: string, headers?: Record<string, string>) {
      const response = await http(url, {
        responseType: 'text',
        headers,
        timeout: 15000,
      })
      return {
        body: response.data,
        cookies: cookiesFromHeaders(response.headers),
      }
    },
  }
}

function cookiesFromHeaders(headers: Headers): string | undefined {
  const parts = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : String(headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/)
  const cookies = parts.map(item => item.split(';', 1)[0].trim()).filter(Boolean)
  return cookies.length ? cookies.join('; ') : undefined
}
