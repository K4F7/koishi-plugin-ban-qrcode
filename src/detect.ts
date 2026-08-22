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

export function collectImageSrcs(nodes: readonly ImageNode[]): string[] {
  const srcs: string[] = []
  const seen = new Set<string>()

  const visit = (items: readonly ImageNode[]) => {
    for (const node of items) {
      if (node.type === 'img' || node.type === 'image') {
        const src = pickSrc(node.attrs)
        if (src && !seen.has(src)) {
          seen.add(src)
          srcs.push(src)
        }
      }
      if (node.children?.length) visit(node.children)
    }
  }

  visit(nodes)
  return srcs
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

export function defaultNotify(muteSeconds: number): string {
  if (muteSeconds <= 0) return '检测到二维码，已撤回。'
  return `检测到二维码，已撤回并禁言 ${muteSeconds} 秒。`
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
