import { Context, HTTP, Schema } from 'koishi'
import { detectAdContent } from './ad'
import {
  HitReason,
  collectMessageParts,
  defaultNotify,
  elementTypes,
  findQrInImages,
  isOfficeFile,
  muteDurationMs,
  resolveGuildId,
  roleLabels,
  skipModerateReason,
  summarizeSrc,
} from './detect'
import { collectTencentDocUrls, extractOfficeText, fetchTencentDoc } from './document'
import { createFileResolver, decodeQr, downloadFile, downloadImage, warmupQrDecoder } from './qrcode'
import { extractShareCardText, isGroupInviteCard, isTencentDocCard } from './share'

export const name = 'ban-qrcode'

export const inject = ['http']

export const usage = `
群内检测到图片二维码、拉群分享卡，或腾讯文档 / Word 里的卖货广告时，自动撤回并禁言发送者（默认 60 秒）。

机器人需要撤回消息和禁言成员的权限。群主 / 管理员默认跳过。

自测没反应时打开 debug，看日志里是 skip admin、图片没下下来，还是扫码/文档未命中。
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
  maxOfficeMb: number
  debug: boolean
}

export const Config: Schema<Config> = Schema.object({
  muteSeconds: Schema.number().min(0).default(60).description('禁言秒数。0 表示只撤回不禁言。'),
  recall: Schema.boolean().default(true).description('撤回违规消息。'),
  notify: Schema.boolean().default(true).description('处理后在群内发送提示。'),
  notifyText: Schema.string().default('').description('自定义提示。留空则按原因和禁言秒数生成。'),
  skipAdmins: Schema.boolean().default(true).description('跳过群主和管理员。自测请先关掉，或用普通成员号发。'),
  ignoreUsers: Schema.array(Schema.string()).role('table').default([]).description('忽略的用户 ID。'),
  guilds: Schema.array(Schema.string()).role('table').default([]).description('只在这些群生效。留空表示全部群。'),
  scanQrcode: Schema.boolean().default(true).description('扫描图片二维码。'),
  scanGroupInvite: Schema.boolean().default(true).description('拦截邀请 / 推荐群聊 / 群名片分享卡。'),
  scanDocs: Schema.boolean().default(true).description('检查腾讯文档和 Word / 文本附件里的广告。'),
  adKeywords: Schema.array(Schema.string()).role('table').default([]).description('额外广告关键词。命中即撤回。'),
  maxOfficeMb: Schema.number().min(1).default(5).description('解析 Word / 文本附件的大小上限（MB）。超出则跳过，防止解压占用过多内存。'),
  debug: Schema.boolean().default(true).description('输出调试日志：跳过原因、消息结构、下载/扫码/文档结果。'),
})

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('ban-qrcode')
  const docHttp = createDocHttp(ctx.http)
  void warmupQrDecoder().catch(error => logger.warn(error))

  ctx.on('message', async (session) => {
    const moderate = {
      guildId: session.guildId,
      channelId: session.channelId,
      isDirect: session.isDirect,
      userId: session.userId,
      selfId: session.selfId,
      ignoreUsers: config.ignoreUsers,
      guilds: config.guilds,
      roles: session.event.member?.roles,
      skipAdmins: config.skipAdmins,
    }
    const parts = collectMessageParts(session.elements ?? [], session.content ?? '')
    const skip = skipModerateReason(moderate)
    if (skip) {
      if (config.debug && looksRelevant(parts, config)) {
        logger.info(
          'skip %s user=%s guild=%s roles=%j images=%d shares=%d files=%d types=%j',
          skip,
          session.userId,
          resolveGuildId(moderate),
          roleLabels(moderate.roles),
          parts.images.length,
          parts.shares.length,
          parts.files.length,
          elementTypes(session.elements ?? []),
        )
      }
      return
    }

    const docUrls = config.scanDocs
      ? collectTencentDocUrls([parts.text, ...parts.shares, ...parts.urls].join('\n'))
      : []
    const officeFiles = config.scanDocs
      ? parts.files.filter(file => isOfficeFile(file.name) || isOfficeFile(file.src))
      : []
    const docCards = config.scanDocs ? parts.shares.filter(isTencentDocCard) : []
    const docCardText = docCards.map(extractShareCardText).filter(Boolean).join('\n')
    const needInvite = config.scanGroupInvite && parts.shares.some(isGroupInviteCard)
    const needQr = config.scanQrcode && parts.images.length > 0
    const needDocs = Boolean(docUrls.length || officeFiles.length || docCards.length)

    if (config.debug) {
      logger.info(
        'seen user=%s guild=%s types=%j images=%d shares=%d files=%d docs=%d invite=%s',
        session.userId,
        resolveGuildId(moderate),
        elementTypes(session.elements ?? []),
        parts.images.length,
        parts.shares.length,
        parts.files.length,
        docUrls.length + officeFiles.length,
        needInvite,
      )
    }

    if (!needInvite && !needQr && !needDocs) return

    const guildId = resolveGuildId(moderate)
    const resolveFile = createFileResolver(session.bot, guildId)
    const download = (src: string) => downloadImage(ctx.http, src, resolveFile)

    try {
      if (needInvite) {
        await enforce(session, config, logger, 'group-invite')
        return
      }

      if (needQr) {
        try {
          const hit = await findQrInImages(
            parts.images,
            download,
            decodeQr,
            (src, status) => {
              if (config.debug) logger.info('qr %s %s', status, summarizeSrc(src))
            },
          )
          if (hit) {
            await enforce(session, config, logger, 'qrcode')
            return
          }
        } catch (error) {
          logger.warn(error)
        }
      }

      if (!needDocs) {
        if (config.debug) logger.info('no-hit user=%s guild=%s', session.userId, resolveGuildId(moderate))
        return
      }

      let fetchedDoc = false
      for (const url of docUrls) {
        try {
          const doc = await fetchTencentDoc(docHttp, url)
          if (!doc) {
            if (config.debug) logger.info('doc empty %s', url)
            continue
          }
          if (doc.text.trim()) fetchedDoc = true
          const ad = detectAdContent(doc.text, doc.title, config.adKeywords)
          if (config.debug) {
            logger.info('doc %s title=%s ad=%s images=%d', url, doc.title || '-', Boolean(ad), doc.images.length)
          }
          if (ad) {
            await enforce(session, config, logger, 'ad-doc')
            return
          }
          if (config.scanQrcode && doc.images.length) {
            const qr = await findQrInImages(
              doc.images,
              download,
              decodeQr,
              (src, status) => {
                if (config.debug) logger.info('doc-qr %s %s', status, summarizeSrc(src))
              },
            )
            if (qr) {
              await enforce(session, config, logger, 'qrcode')
              return
            }
          }
        } catch (error) {
          if (config.debug) logger.info('doc error %s', url)
          logger.warn(error)
        }
      }

      if (!fetchedDoc && docCardText) {
        const ad = detectAdContent(docCardText, '', config.adKeywords)
        if (config.debug) logger.info('doc card ad=%s', Boolean(ad))
        if (ad) {
          await enforce(session, config, logger, 'ad-doc')
          return
        }
      }

      for (const file of officeFiles) {
        try {
          const doc = extractOfficeText(
            await downloadFile(ctx.http, { ...file, groupId: guildId }, resolveFile),
            file.name,
            Math.floor(config.maxOfficeMb * 1024 * 1024),
          )
          const ad = doc ? detectAdContent(doc.text, doc.title || file.name, config.adKeywords) : null
          if (config.debug) logger.info('office %s ad=%s', file.name, Boolean(ad))
          if (doc && ad) {
            await enforce(session, config, logger, 'ad-doc')
            return
          }
        } catch (error) {
          if (config.debug) logger.info('office error %s %s', file.name, errorMessage(error))
          logger.warn(error)
        }
      }

      if (config.debug) logger.info('no-hit user=%s guild=%s', session.userId, resolveGuildId(moderate))
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
  isDirect?: boolean
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
  const guildId = resolveGuildId(session)
  logger.info('%s from %s in %s', reason, session.userId, guildId)

  if (config.recall && session.messageId && session.channelId) {
    try {
      await session.bot.deleteMessage(session.channelId, session.messageId)
      if (config.debug) logger.info('recall ok %s', session.messageId)
    } catch (error) {
      logger.warn(error)
    }
  } else if (config.debug && config.recall) {
    logger.info('recall skipped messageId=%s channelId=%s', session.messageId, session.channelId)
  }

  const duration = muteDurationMs(config.muteSeconds)
  if (duration > 0 && guildId && session.userId) {
    try {
      await session.bot.muteGuildMember(guildId, session.userId, duration)
      if (config.debug) logger.info('mute ok %s %sms', session.userId, duration)
    } catch (error) {
      logger.warn(error)
    }
  } else if (config.debug && duration > 0) {
    logger.info('mute skipped guild=%s user=%s', guildId, session.userId)
  }

  if (config.notify) {
    await session.send(config.notifyText || defaultNotify(config.muteSeconds, reason))
  }
}

function looksRelevant(
  parts: { images: string[], shares: string[], files: { name: string }[], urls: string[], text: string },
  config: Config,
) {
  if (config.scanQrcode && parts.images.length) return true
  if (config.scanGroupInvite && parts.shares.length) return true
  if (config.scanDocs && (
    parts.files.some(file => isOfficeFile(file.name))
    || collectTencentDocUrls([parts.text, ...parts.shares, ...parts.urls].join('\n')).length
    || parts.shares.some(isTencentDocCard)
  )) {
    return true
  }
  return false
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

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unknown'
}

function cookiesFromHeaders(headers: Headers): string | undefined {
  const parts = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : String(headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/)
  const cookies = parts.map(item => item.split(';', 1)[0].trim()).filter(Boolean)
  return cookies.length ? cookies.join('; ') : undefined
}
