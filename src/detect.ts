export interface ImageNode {
  type: string
  attrs?: Record<string, unknown>
  children?: ImageNode[]
}

export type RoleLike = string | { id?: string; name?: string }

export interface ModerateInput {
  guildId?: string
  channelId?: string
  isDirect?: boolean
  userId?: string
  selfId?: string
  ignoreUsers: string[]
  guilds: string[]
  roles?: RoleLike[]
  skipAdmins: boolean
}

export interface QrHit {
  src: string
  text: string
}

export type HitReason = 'qrcode' | 'group-invite' | 'ad-doc'

export type SkipReason = 'direct' | 'no-guild' | 'no-user' | 'guild-filter' | 'self' | 'ignored' | 'admin'

export interface FileRef {
  src: string
  name: string
  fileId?: string
  busid?: number
}

export interface MessageParts {
  images: string[]
  shares: string[]
  files: FileRef[]
  urls: string[]
  text: string
}

const ADMIN_ROLES = new Set([
  'owner',
  'admin',
  'administrator',
  'ADMINISTRATOR',
])

export function roleLabels(roles?: RoleLike[]): string[] {
  if (!roles?.length) return []
  const labels: string[] = []
  for (const role of roles) {
    if (typeof role === 'string') {
      if (role) labels.push(role)
      continue
    }
    if (role.name) labels.push(role.name)
    if (role.id && role.id !== role.name) labels.push(role.id)
  }
  return labels
}

export function isAdminRole(roles?: RoleLike[]): boolean {
  return roleLabels(roles).some(role => ADMIN_ROLES.has(role) || role.toLowerCase() === 'owner')
}

const SHARE_TYPES = new Set([
  'json',
  'xml',
  'share',
  'ark',
  'lightapp',
  'miniapp',
  'onebot:json',
  'onebot:xml',
  'onebot:share',
  'onebot:ark',
  'onebot:lightapp',
  'onebot:miniapp',
  'weapp',
  'wxapp',
  'miniprogram',
  'onebot:weapp',
])
const CONTACT_TYPES = new Set([
  'contact',
  'onebot:contact',
])
const FILE_TYPES = new Set(['file'])
const OFFICE_FILE = /\.(docx?|txt)$/i

export function collectImageSrcs(nodes: readonly ImageNode[]): string[] {
  return collectMessageParts(nodes).images
}

export function isOfficeFile(name: string): boolean {
  return OFFICE_FILE.test(name)
}

export function collectMessageParts(nodes: readonly ImageNode[], extra = ''): MessageParts {
  const images: string[] = []
  const shares: string[] = []
  const files: FileRef[] = []
  const texts: string[] = []
  const extraUrls: string[] = []
  const seenImage = new Set<string>()
  const seenShare = new Set<string>()
  const seenFile = new Set<string>()

  const addShare = (raw: unknown) => {
    const value = stringifyShare(raw)
    if (!value || seenShare.has(value)) return
    seenShare.add(value)
    shares.push(value)
    extraUrls.push(...collectUrlsFromJson(raw), ...collectUrls(value))
  }

  const visit = (items: readonly ImageNode[]) => {
    for (const node of items) {
      if (node.type === 'img' || node.type === 'image') {
        const src = pickSrc(node.attrs)
        if (src && !seenImage.has(src)) {
          seenImage.add(src)
          images.push(src)
        }
      }
      if (node.type === 'text' || node.type === 'plain') {
        const content = node.attrs?.content ?? node.attrs?.text
        if (typeof content === 'string' && content) texts.push(content)
      }
      if (SHARE_TYPES.has(node.type) || looksLikeShareAttrs(node.attrs)) {
        addShare(sharePayloadFromAttrs(node.attrs))
      }
      if (CONTACT_TYPES.has(node.type)) {
        addShare(node.attrs)
      }
      if (FILE_TYPES.has(node.type)) {
        const fileId = pickFileId(node.attrs)
        const src = pickSrc(node.attrs) ?? fileId
        const name = String(node.attrs?.filename ?? node.attrs?.name ?? node.attrs?.file_name ?? node.attrs?.file ?? '')
        if (src && !seenFile.has(fileId || src)) {
          seenFile.add(fileId || src)
          const busid = pickBusid(node.attrs)
          files.push({
            src,
            name,
            ...(fileId ? { fileId } : {}),
            ...(busid !== undefined ? { busid } : {}),
          })
        }
      }
      if (node.children?.length) visit(node.children)
    }
  }

  visit(nodes)

  if (extra) {
    texts.push(extra)
    const normalized = unescapePayload(extra)
    for (const match of extra.matchAll(/\[(?:CQ:)?json(?:,data=|:data=)([\s\S]+?)\]/gi)) addShare(match[1])
    for (const match of extra.matchAll(/\[(?:CQ:)?xml(?:,data=|:data=)([\s\S]+?)\]/gi)) addShare(match[1])
    for (const match of extra.matchAll(/\[(?:CQ:)?contact(?:,|\.)[^\]]+\]/gi)) addShare(match[0])
    for (const match of extra.matchAll(/<(?:json|xml|onebot:json|onebot:xml)\s[^>]*\bdata="([^"]+)"/gi)) {
      addShare(decodeEntities(match[1]))
    }
    if (/^\s*\{[\s\S]*"app"\s*:/.test(normalized)) addShare(normalized)
  }

  const text = texts.join('\n')
  const urls = uniqueUrls([
    ...collectUrls(text),
    ...extraUrls,
    ...shares.flatMap(collectUrls),
  ])
  return { images, shares, files, urls, text }
}

export function collectUrls(text: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const match of unescapePayload(text).matchAll(/https?:\/\/[^\s<>"'`\\]+/gi)) {
    const url = match[0].replace(/[),.;]+$/, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

export function unescapePayload(text: string): string {
  return decodeEntities(text).replace(/\\\//g, '/')
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#44;/g, ',')
    .replace(/&#91;/g, '[')
    .replace(/&#93;/g, ']')
}

export function stringifyShare(raw: unknown): string | undefined {
  const unwrapped = unwrapShareData(raw)
  if (unwrapped && typeof unwrapped === 'object') {
    try {
      return JSON.stringify(unwrapped)
    } catch {
      return undefined
    }
  }
  if (typeof unwrapped !== 'string' || !unwrapped.trim()) return undefined
  return unescapePayload(unwrapped.trim())
}

function unwrapShareData(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const record = raw as Record<string, unknown>
  if (typeof record.app === 'string') return raw
  if (typeof record.data === 'string' && record.data.trim().startsWith('{')) {
    return unescapePayload(record.data.trim())
  }
  return raw
}

function looksLikeShareAttrs(attrs?: Record<string, unknown>): boolean {
  if (!attrs) return false
  if (typeof attrs.app === 'string') return true
  if (attrs.meta && (attrs.prompt || attrs.view || attrs.bizsrc)) return true
  const wrapped = attrs.data ?? attrs.content ?? attrs.value
  if (typeof wrapped === 'string' && /"app"\s*:/.test(wrapped)) return true
  if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    return typeof (wrapped as Record<string, unknown>).app === 'string'
  }
  return false
}

function sharePayloadFromAttrs(attrs?: Record<string, unknown>): unknown {
  if (!attrs) return undefined
  const wrapped = attrs.data ?? attrs.content ?? attrs.value
  if (wrapped !== undefined && wrapped !== null && wrapped !== '') {
    return unwrapShareData(wrapped)
  }
  if (typeof attrs.app === 'string' || attrs.meta) return attrs
  return undefined
}

export function isDownloadableSrc(src: string): boolean {
  return /^(https?:|data:|file:)/i.test(src)
}

export function summarizeSrc(src: string): string {
  if (src.startsWith('data:')) return `data:(${src.length})`
  return src.length > 160 ? `${src.slice(0, 157)}...` : src
}

export function elementTypes(nodes: readonly ImageNode[]): string[] {
  return nodes.map(node => node.type)
}

function pickSrc(attrs?: Record<string, unknown>): string | undefined {
  const values = [attrs?.src, attrs?.url, attrs?.file]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(value => value.trim())
  return values.find(isDownloadableSrc) ?? values[0]
}

function pickFileId(attrs?: Record<string, unknown>): string | undefined {
  const values = [attrs?.file_id, attrs?.fileId]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(value => value.trim())
  return values[0]
}

function pickBusid(attrs?: Record<string, unknown>): number | undefined {
  const value = attrs?.busid ?? attrs?.busId
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function collectUrlsFromJson(raw: unknown): string[] {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(unescapePayload(raw))
    } catch {
      return []
    }
  }
  const urls: string[] = []
  walkJson(value, urls)
  return urls
}

function walkJson(value: unknown, urls: string[]) {
  if (typeof value === 'string') {
    urls.push(...collectUrls(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, urls)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walkJson(item, urls)
  }
}

function uniqueUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const url of urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    result.push(url)
  }
  return result
}

export function resolveGuildId(input: Pick<ModerateInput, 'guildId' | 'channelId' | 'isDirect'>): string | undefined {
  if (input.guildId) return input.guildId
  if (!input.isDirect && input.channelId && !input.channelId.startsWith('private:')) return input.channelId
  return undefined
}

export function skipModerateReason(input: ModerateInput): SkipReason | null {
  if (input.isDirect) return 'direct'
  if (!resolveGuildId(input)) return 'no-guild'
  if (!input.userId) return 'no-user'
  const guildId = resolveGuildId(input)!
  if (input.guilds.length && !input.guilds.includes(guildId)) return 'guild-filter'
  if (input.userId === input.selfId) return 'self'
  if (input.ignoreUsers.includes(input.userId)) return 'ignored'
  if (input.skipAdmins && isAdminRole(input.roles)) return 'admin'
  return null
}

export function shouldModerate(input: ModerateInput): boolean {
  return skipModerateReason(input) === null
}

export function muteDurationMs(seconds: number): number {
  return Math.max(0, Math.floor(seconds)) * 1000
}

export function parseDataUrl(src: string): Buffer | null {
  const match = /^data:[^;,]+;base64,([\s\S]+)$/i.exec(src)
  if (!match) return null
  try {
    return Buffer.from(match[1], 'base64')
  } catch {
    return null
  }
}

const NOTIFY_LABEL: Record<HitReason, string> = {
  qrcode: '二维码',
  'group-invite': '拉群卡片',
  'ad-doc': '文档广告',
}

export function defaultNotify(muteSeconds: number, reason: HitReason = 'qrcode'): string {
  const label = NOTIFY_LABEL[reason]
  if (muteSeconds <= 0) return `检测到${label}，已撤回。`
  return `检测到${label}，已撤回并禁言 ${muteSeconds} 秒。`
}

export type QrImageStatus = 'hit' | 'miss' | 'error'

export async function findQrInImages(
  srcs: readonly string[],
  download: (src: string) => Promise<Buffer>,
  decode: (buffer: Buffer) => Promise<string | null>,
  onImage?: (src: string, status: QrImageStatus) => void,
): Promise<QrHit | null> {
  for (const src of srcs) {
    try {
      const text = await decode(await download(src))
      if (text !== null) {
        onImage?.(src, 'hit')
        return { src, text }
      }
      onImage?.(src, 'miss')
    } catch {
      onImage?.(src, 'error')
    }
  }
  return null
}
