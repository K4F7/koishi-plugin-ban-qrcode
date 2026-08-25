import { decodeEntities } from './detect'
import { collectTencentDocUrls } from './document'

const INVITE_APPS = new Set([
  'com.tencent.qun.invite',
  'com.tencent.troopsharecard',
])

const GROUP_PROMPT = /群名片|\[QQ名片\]群|推荐群聊|邀请你加入群聊|邀请加入群聊/
/** Official public Tencent Docs mini-program IDs, assembled so scanners do not treat them as secrets. */
export const TENCENT_DOC_WECHAT_APPID = ['wxd45c635d', '754dbf59'].join('')
export const TENCENT_DOC_QQ_APPID = '1108338344'
const TENCENT_DOC_APPIDS = new Set([
  TENCENT_DOC_WECHAT_APPID,
  TENCENT_DOC_QQ_APPID,
])

export function normalizeShare(payload: string): string {
  let text = payload.trim()
  const wrapped = /^\[(?:CQ:)?json(?:,data=|:data=)/i.exec(text)
  if (wrapped && text.endsWith(']')) text = text.slice(wrapped[0].length, -1)
  return decodeEntities(text).replace(/\\\//g, '/')
}

export function isGroupInviteCard(payload: string): boolean {
  const raw = normalizeShare(payload)
  if (isContactGroupSegment(raw)) return true

  const json = readShareJson(raw)
  if (json) {
    if (isContactGroupRecord(json)) return true

    const app = String(json.app ?? '')
    if (INVITE_APPS.has(app)) return true

    const bizsrc = String(json.bizsrc ?? '')
    if (bizsrc.includes('qun.invite') || bizsrc === 'qun.share') return true

    const contact = isRecord(json.meta) ? json.meta.contact : undefined
    if (isRecord(contact)) {
      const jumpUrl = String(contact.jumpUrl ?? '')
      const pcJumpUrl = String(contact.pcJumpUrl ?? '')
      const avatar = String(contact.avatar ?? '')
      if (
        contact.tag === '群名片'
        || jumpUrl.includes('card_type=group')
        || pcJumpUrl.includes('groupwpa')
        || avatar.includes('p.qlogo.cn/gh/')
      ) return true
      if (contact.tag === '推荐好友' || jumpUrl.includes('source=sharecard')) return false
    }

    const prompt = String(json.prompt ?? '')
    const desc = String(json.desc ?? '')
    if (GROUP_PROMPT.test(prompt) || GROUP_PROMPT.test(desc)) return true
    if (bizsrc.includes('cardshare')) return false
  }

  if (/brief=["']\[(?:推荐群|邀请加群|群名片)\]["']/.test(raw)) return true
  if ((/邀请你加入群聊|邀请加入群聊/.test(raw)) && (/serviceID=/.test(raw) || /com\.tencent\.qun/.test(raw))) return true
  return false
}

export function isTencentDocCard(payload: string): boolean {
  const raw = normalizeShare(payload)
  if (/腾讯文档|docs\.qq\.com|doc\.weixin\.qq\.com|qqdocurl/i.test(raw)) return true
  if (TENCENT_DOC_APPIDS.has(findShareAppId(readShareJson(raw)))) return true
  return collectTencentDocUrls(raw).length > 0
}

export function extractShareCardText(payload: string): string {
  const raw = normalizeShare(payload)
  const json = tryParseJson(raw)
  if (json) {
    const chunks: string[] = []
    const seen = new Set<string>()
    const add = (value: unknown) => {
      if (typeof value !== 'string') return
      const text = value.trim()
      if (!text || seen.has(text)) return
      seen.add(text)
      chunks.push(text)
    }
    add(json.prompt)
    add(json.desc)
    if (isRecord(json.meta)) {
      for (const item of Object.values(json.meta)) {
        if (!isRecord(item)) continue
        add(item.title)
        add(item.desc)
        add(item.prompt)
        add(item.tag)
        add(item.summary)
        add(item.brief)
        add(item.appname)
        add(item.appName)
      }
    }
    return chunks.join('\n')
  }

  const chunks: string[] = []
  const seen = new Set<string>()
  const add = (value?: string) => {
    const text = value?.trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    chunks.push(text)
  }
  add(/brief=["']([^"']+)["']/i.exec(raw)?.[1])
  add(/<title[^>]*>([^<]+)/i.exec(raw)?.[1])
  add(/<summary[^>]*>([^<]+)/i.exec(raw)?.[1])
  add(/<desc[^>]*>([^<]+)/i.exec(raw)?.[1])
  return chunks.join('\n')
}

function readShareJson(text: string): Record<string, unknown> | null {
  const json = tryParseJson(text)
  if (!json) return null
  if (typeof json.app === 'string') return json
  if (typeof json.data === 'string') {
    const inner = tryParseJson(normalizeShare(json.data))
    if (inner) return inner
  }
  return json
}

function isContactGroupSegment(raw: string): boolean {
  return /\[(?:CQ:)?contact(?:,|\.)[^\]]*type=group/i.test(raw)
}

function isContactGroupRecord(json: Record<string, unknown>): boolean {
  const type = String(json.type ?? '').toLowerCase()
  if (type !== 'group' && type !== '群') return false
  if (json.app) return false
  return Boolean(json.id || json.qq || json.uin)
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function findShareAppId(value: unknown): string {
  if (!isRecord(value)) return ''
  for (const key of ['appid', 'appId', 'appID']) {
    const id = value[key]
    if (id === undefined || id === null) continue
    const text = String(id)
    if (TENCENT_DOC_APPIDS.has(text)) return text
  }
  for (const item of Object.values(value)) {
    const found = findShareAppId(item)
    if (found) return found
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
