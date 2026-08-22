export interface ImageNode {
  type: string
  attrs?: Record<string, unknown>
  children?: ImageNode[]
}

export type RoleLike = string | { id?: string; name?: string }

export interface ModerateInput {
  guildId?: string
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

export interface FileRef {
  src: string
  name: string
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

const SHARE_TYPES = new Set(['json', 'xml', 'share', 'ark', 'lightapp'])
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
  const seenImage = new Set<string>()
  const seenShare = new Set<string>()
  const seenFile = new Set<string>()

  const addShare = (raw: unknown) => {
    if (typeof raw !== 'string' || !raw.trim()) return
    const value = raw.trim()
    if (seenShare.has(value)) return
    seenShare.add(value)
    shares.push(value)
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
      if (SHARE_TYPES.has(node.type)) {
        addShare(node.attrs?.data ?? node.attrs?.content ?? node.attrs?.value)
      }
      if (FILE_TYPES.has(node.type)) {
        const src = pickSrc(node.attrs)
        const name = String(node.attrs?.filename ?? node.attrs?.name ?? node.attrs?.file ?? '')
        if (src && !seenFile.has(src)) {
          seenFile.add(src)
          files.push({ src, name })
        }
      }
      if (node.children?.length) visit(node.children)
    }
  }

  visit(nodes)

  if (extra) {
    texts.push(extra)
    for (const match of extra.matchAll(/\[(?:CQ:)?json(?:,data=|:data=)([\s\S]+?)\]/gi)) addShare(match[1])
    for (const match of extra.matchAll(/\[(?:CQ:)?xml(?:,data=|:data=)([\s\S]+?)\]/gi)) addShare(match[1])
    for (const match of extra.matchAll(/<(?:json|xml)\s[^>]*\bdata="([^"]+)"/gi)) addShare(decodeEntities(match[1]))
  }

  const text = texts.join('\n')
  return {
    images,
    shares,
    files,
    urls: collectUrls([text, ...shares].join('\n')),
    text,
  }
}

export function collectUrls(text: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
    const url = decodeEntities(match[0]).replace(/[),.;]+$/, '')
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function pickSrc(attrs?: Record<string, unknown>): string | undefined {
  const src = attrs?.src ?? attrs?.url
  return typeof src === 'string' && src.trim() ? src.trim() : undefined
}

export function shouldModerate(input: ModerateInput): boolean {
  if (input.isDirect) return false
  if (!input.guildId || !input.userId) return false
  if (input.guilds.length && !input.guilds.includes(input.guildId)) return false
  if (input.userId === input.selfId) return false
  if (input.ignoreUsers.includes(input.userId)) return false
  if (input.skipAdmins && isAdminRole(input.roles)) return false
  return true
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

export async function findQrInImages(
  srcs: readonly string[],
  download: (src: string) => Promise<Buffer>,
  decode: (buffer: Buffer) => Promise<string | null>,
): Promise<QrHit | null> {
  for (const src of srcs) {
    try {
      const text = await decode(await download(src))
      if (text !== null) return { src, text }
    } catch {
      // skip a single failed image
    }
  }
  return null
}
