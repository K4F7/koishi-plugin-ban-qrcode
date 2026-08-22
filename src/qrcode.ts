import { HTTP } from 'koishi'
import Jimp from 'jimp'
import jsQR from 'jsqr'
import { parseDataUrl } from './detect'

export async function downloadImage(http: HTTP, src: string): Promise<Buffer> {
  if (src.startsWith('data:')) {
    const data = parseDataUrl(src)
    if (!data) throw new Error('invalid data url')
    return data
  }
  return Buffer.from(await http.get<ArrayBuffer>(src, { responseType: 'arraybuffer' }))
}

export async function decodeQr(buffer: Buffer): Promise<string | null> {
  const image = await Jimp.read(buffer)
  const { data, width, height } = image.bitmap
  const result = jsQR(new Uint8ClampedArray(data), width, height, {
    inversionAttempts: 'attemptBoth',
  })
  return result?.data ?? null
}
