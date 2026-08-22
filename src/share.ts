import { decodeEntities } from './detect'

const INVITE_APPS = new Set([
  'com.tencent.qun.invite',
  'com.tencent.troopsharecard',
])

export function normalizeShare(payload: string): string {
  let text = payload.trim()
  const wrapped = /^\[(?:CQ:)?json(?:,data=|:data=)/i.exec(text)
  if (wrapped && text.endsWith(']')) text = text.slice(wrapped[0].length, -1)
  return decodeEntities(text).replace(/\\\//g, '/')
}

export function isGroupInviteCard(payload: string): boolean {
  const raw = normalizeShare(payload)
  const json = tryParseJson(raw)
  if (json) {
    const app = String(json.app ?? '')
    if (INVITE_APPS.has(app)) return true

    const bizsrc = String(json.bizsrc ?? '')
    if (bizsrc.includes('qun.invite') || bizsrc === 'qun.share') return true

    const contact = isRecord(json.meta) ? json.meta.contact : undefined
    if (isRecord(contact)) {
      if (contact.tag === '推荐好友' || String(contact.jumpUrl ?? '').includes('source=sharecard')) return false
      if (contact.tag === '群名片') return true
      if (String(contact.jumpUrl ?? '').includes('card_type=group')) return true
      if (String(contact.pcJumpUrl ?? '').includes('groupwpa')) return true
    }

    const prompt = String(json.prompt ?? '')
    if (/群名片\s*:/.test(prompt) || /推荐群聊|邀请你加入群聊|邀请加入群聊/.test(prompt)) return true
    if (bizsrc.includes('cardshare')) return false
  }

  if (/brief=["']\[推荐群\]["']|brief=["']\[邀请加群\]["']/.test(raw)) return true
  if ((/邀请你加入群聊|邀请加入群聊/.test(raw)) && (/serviceID=/.test(raw) || /com\.tencent\.qun/.test(raw))) return true
  return false
}

export function isTencentDocCard(payload: string): boolean {
  return /腾讯文档|docs\.qq\.com|doc\.weixin\.qq\.com/i.test(normalizeShare(payload))
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

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
