import { Context, Schema } from 'koishi'
import {
  collectImageSrcs,
  defaultNotify,
  findQrInImages,
  muteDurationMs,
  shouldModerate,
} from './detect'
import { decodeQr, downloadImage } from './qrcode'

export const name = 'ban-qrcode'

export const inject = ['http']

export const usage = `
群内检测到图片二维码时自动撤回，并禁言发送者（默认 60 秒）。用于拦截广告码。

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
}

export const Config: Schema<Config> = Schema.object({
  muteSeconds: Schema.number().min(0).default(60).description('禁言秒数。0 表示只撤回不禁言。'),
  recall: Schema.boolean().default(true).description('撤回含二维码的消息。'),
  notify: Schema.boolean().default(true).description('处理后在群内发送提示。'),
  notifyText: Schema.string().default('').description('自定义提示。留空则按禁言秒数生成。'),
  skipAdmins: Schema.boolean().default(true).description('跳过群主和管理员。'),
  ignoreUsers: Schema.array(Schema.string()).role('table').default([]).description('忽略的用户 ID。'),
  guilds: Schema.array(Schema.string()).role('table').default([]).description('只在这些群生效。留空表示全部群。'),
})

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('ban-qrcode')

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

    const srcs = collectImageSrcs(session.elements ?? [])
    if (!srcs.length) return

    try {
      const hit = await findQrInImages(
        srcs,
        src => downloadImage(ctx.http, src),
        decodeQr,
      )
      if (!hit) return

      logger.info('qrcode from %s in %s', session.userId, session.guildId)

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
        await session.send(config.notifyText || defaultNotify(config.muteSeconds))
      }
    } catch (error) {
      logger.warn(error)
    }
  })
}
