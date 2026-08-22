import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { HTTP } from 'koishi'
import Jimp from 'jimp'
import jsQR from 'jsqr'
import { FileRef, isDownloadableSrc, isOfficeFile, parseDataUrl } from './detect'

type WechatScan = (input: {
  data: Uint8ClampedArray
  width: number
  height: number
}) => Promise<{ text?: string | null } | null | undefined>

let wechatScan: WechatScan | undefined
let wechatLoad: Promise<WechatScan | null> | undefined

export type FileDownload = FileRef & { groupId?: string }

type FileInternal = {
  getImage?(src: string): unknown
  getFile?(...args: unknown[]): unknown
  get_file?(...args: unknown[]): unknown
  getGroupFileUrl?(...args: unknown[]): unknown
  get_group_file_url?(...args: unknown[]): unknown
}

export function createFileResolver(bot: { internal?: FileInternal }, groupId?: string) {
  return async (input: string | FileDownload): Promise<Buffer | string | null> => {
    const internal = bot.internal
    if (!internal) return null
    const file = typeof input === 'string' ? { src: input, name: input } : input
    try {
      if (isOfficeFile(file.name) || isOfficeFile(file.src)) {
        return await resolveOfficeFile(internal, { ...file, groupId: file.groupId ?? groupId })
      }
      return await resolveFromInfo(unwrapFileInfo(await internal.getImage?.(file.src)))
    } catch {
      return null
    }
  }
}

export async function downloadImage(
  http: HTTP,
  src: string,
  resolveFile?: (src: string) => Promise<Buffer | string | null>,
): Promise<Buffer> {
  return downloadBuffer(http, src, resolveFile, 'cannot download image')
}

export async function downloadFile(
  http: HTTP,
  file: FileDownload,
  resolveFile?: (file: FileDownload) => Promise<Buffer | string | null>,
): Promise<Buffer> {
  return downloadBuffer(http, file, resolveFile, 'cannot download file')
}

async function downloadBuffer<T extends string | FileDownload>(
  http: HTTP,
  target: T,
  resolveFile: ((input: T) => Promise<Buffer | string | null>) | undefined,
  fallback: string,
): Promise<Buffer> {
  const src = typeof target === 'string' ? target : target.src
  let lastError: unknown
  const remote = /^https?:/i.test(src)
  if (isDownloadableSrc(src)) {
    try {
      return await downloadDirect(http, src)
    } catch (error) {
      lastError = error
    }
    if (!remote) {
      throw lastError instanceof Error ? lastError : new Error(fallback)
    }
  }

  if (resolveFile) {
    try {
      const resolved = await resolveFile(target)
      if (Buffer.isBuffer(resolved)) return resolved
      if (typeof resolved === 'string' && resolved && resolved !== src) {
        return isDownloadableSrc(resolved) ? downloadDirect(http, resolved) : readFile(resolved)
      }
    } catch (error) {
      lastError = lastError ?? error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(fallback)
}

async function downloadDirect(http: HTTP, src: string): Promise<Buffer> {
  if (src.startsWith('data:')) {
    const data = parseDataUrl(src)
    if (!data) throw new Error('invalid data url')
    return data
  }
  if (src.startsWith('file:')) {
    return readFile(fileURLToPath(src))
  }
  if (typeof http.file === 'function') {
    const file = await http.file(src)
    return Buffer.from(file.data as ArrayBuffer)
  }
  return Buffer.from(await http.get<ArrayBuffer>(src, { responseType: 'arraybuffer' }))
}

async function resolveOfficeFile(internal: FileInternal, file: FileDownload): Promise<Buffer | string | null> {
  const keys = uniqueKeys([
    file.fileId,
    file.src && !isDownloadableSrc(file.src) ? file.src : undefined,
  ])

  for (const key of keys) {
    const fromFile = await firstResolved([
      () => internal.getFile?.({ file: key }),
      () => internal.get_file?.({ file: key }),
    ])
    if (fromFile) return fromFile
  }

  const groupId = file.groupId
  if (!groupId) return null
  const busid = file.busid ?? 102
  const gid = /^\d+$/.test(groupId) ? Number(groupId) : groupId

  for (const key of keys) {
    const payload = { group_id: gid, file_id: key, busid }
    const fromUrl = await firstResolved([
      () => internal.getGroupFileUrl?.(payload),
      () => internal.get_group_file_url?.(payload),
      () => internal.getGroupFileUrl?.(gid, key, busid),
      () => internal.get_group_file_url?.(gid, key, busid),
    ])
    if (fromUrl) return fromUrl
  }

  return null
}

async function firstResolved(calls: Array<() => unknown>): Promise<Buffer | string | null> {
  for (const call of calls) {
    try {
      const result = await resolveFromInfo(unwrapFileInfo(await call()))
      if (result) return result
    } catch {
      // adapter methods may be missing or reject; try the next one
    }
  }
  return null
}

async function resolveFromInfo(info: Record<string, unknown> | null): Promise<Buffer | string | null> {
  if (!info) return null
  if (typeof info.base64 === 'string' && info.base64) {
    return Buffer.from(info.base64, 'base64')
  }
  if (typeof info.url === 'string' && isDownloadableSrc(info.url)) return info.url
  if (typeof info.file === 'string' && info.file) {
    if (isDownloadableSrc(info.file)) return info.file
    return readFile(info.file)
  }
  return null
}

function uniqueKeys(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    keys.push(value)
  }
  return keys
}

export async function decodeQr(buffer: Buffer): Promise<string | null> {
  const image = await prepareImage(buffer)
  const { data, width, height } = image.bitmap
  const pixels = new Uint8ClampedArray(data)
  const quick = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' })
  if (quick?.data) return quick.data

  const scan = await loadWechatScan()
  if (!scan) return null
  const result = await scan({ data: pixels, width, height })
  return result?.text ?? null
}

async function prepareImage(buffer: Buffer) {
  const image = await Jimp.read(buffer)
  const max = 2000
  if (image.bitmap.width > max || image.bitmap.height > max) {
    return image.scaleToFit(max, max)
  }
  return image
}

export function warmupQrDecoder() {
  return loadWechatScan()
}

function loadWechatScan() {
  if (wechatScan) return Promise.resolve(wechatScan)
  wechatLoad ??= (Function('return import("qr-scanner-wechat")')() as Promise<{ scan: WechatScan }>)
    .then(mod => {
      wechatScan = mod.scan
      return wechatScan
    })
    .catch(() => null)
  return wechatLoad
}

function unwrapFileInfo(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string' && value) {
    return isDownloadableSrc(value) ? { url: value } : { file: value }
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>
  }
  return record
}
