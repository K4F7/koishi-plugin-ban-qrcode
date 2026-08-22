import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { HTTP } from 'koishi'
import Jimp from 'jimp'
import jsQR from 'jsqr'
import { isDownloadableSrc, parseDataUrl } from './detect'

type WechatScan = (input: {
  data: Uint8ClampedArray
  width: number
  height: number
}) => Promise<{ text?: string | null } | null | undefined>

let wechatScan: WechatScan | undefined
let wechatLoad: Promise<WechatScan | null> | undefined

type FileInternal = {
  getImage?(src: string): unknown
}

export function createFileResolver(bot: { internal?: FileInternal }) {
  return async (src: string): Promise<Buffer | string | null> => {
    const internal = bot.internal
    if (!internal) return null
    try {
      const info = unwrapFileInfo(await internal.getImage?.(src))
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
  let lastError: unknown
  const remote = /^https?:/i.test(src)
  if (isDownloadableSrc(src)) {
    try {
      return await downloadDirect(http, src)
    } catch (error) {
      lastError = error
    }
    if (!remote) {
      throw lastError instanceof Error ? lastError : new Error('cannot download image')
    }
  }

  if (resolveFile) {
    try {
      const resolved = await resolveFile(src)
      if (Buffer.isBuffer(resolved)) return resolved
      if (typeof resolved === 'string' && resolved && resolved !== src) {
        return downloadDirect(http, resolved)
      }
    } catch (error) {
      lastError = lastError ?? error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('cannot download image')
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
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>
  }
  return record
}
