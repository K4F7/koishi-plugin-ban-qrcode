import { inflateRawSync } from 'node:zlib'
import { collectUrls, unescapePayload } from './detect'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const DOC_HOST = '(?:docs\\.qq\\.com|doc\\.weixin\\.qq\\.com)'
const DOC_KIND = 'doc|sheet|slide|pdf|form|mind|smartsheet|smartpage'
const DOC_ID = '[A-Za-z0-9][A-Za-z0-9_-]{5,}'
const DOC_RE = new RegExp(`https?:\\/\\/${DOC_HOST}\\/(${DOC_KIND})(?:\\/page)?\\/(${DOC_ID})`, 'i')
const ZIP_LOCAL = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const IMAGE_RE = /https?:\/\/docimg\d+\.docs\.qq\.com\/image\/[A-Za-z0-9_-]+(?:\.(?:jpe?g|png|webp))?/gi
export const DEFAULT_MAX_OFFICE_BYTES = 5 * 1024 * 1024

export interface DocContent {
  title: string
  text: string
  images: string[]
}

export interface DocHttp {
  text(url: string, headers?: Record<string, string>): Promise<{ body: string, cookies?: string }>
}

export function parseTencentDocUrl(url: string): { kind: string, id: string, pageUrl: string } | null {
  const match = DOC_RE.exec(decodePercents(unescapePayload(url)))
  if (!match) return null
  const kind = match[1].toLowerCase()
  const id = match[2]
  const path = kind === 'form' ? `form/page/${id}` : `${kind}/${id}`
  return {
    kind,
    id,
    pageUrl: `https://docs.qq.com/${path}`,
  }
}

export function collectTencentDocUrls(text: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  const decoded = decodePercents(unescapePayload(text))
  const re = new RegExp(DOC_RE.source, 'gi')
  for (const match of decoded.matchAll(re)) {
    const parsed = parseTencentDocUrl(match[0])
    if (!parsed || seen.has(parsed.pageUrl)) continue
    seen.add(parsed.pageUrl)
    urls.push(parsed.pageUrl)
  }
  return urls
}

export function parseOpendocBody(body: string): DocContent | null {
  const data = parseJsonp(body)
  if (!data) return null
  const client = isRecord(data.clientVars) ? data.clientVars : data
  const collab = isRecord(client.collab_client_vars) ? client.collab_client_vars : {}
  const attributed = isRecord(collab.initialAttributedText) ? collab.initialAttributedText : {}
  const chunks = Array.isArray(attributed.text) ? attributed.text : []
  const pieces: string[] = []
  const images: string[] = []
  const seenImage = new Set<string>()

  const title = firstString(
    client.title,
    client.padTitle,
    client.initialTitle,
    isRecord(client.bodyData) ? client.bodyData.initialTitle : undefined,
  )

  for (const chunk of chunks) {
    if (typeof chunk !== 'string' || !chunk) continue
    const decoded = maybeBase64(chunk)
    pieces.push(extractReadableText(decoded))
    for (const src of decoded.toString('utf8').match(IMAGE_RE) ?? []) {
      if (seenImage.has(src)) continue
      seenImage.add(src)
      images.push(src)
    }
  }

  const text = pieces.filter(Boolean).join('\n')
  if (!title && !text) return null
  return { title, text, images }
}

export async function fetchTencentDoc(http: DocHttp, url: string): Promise<DocContent | null> {
  const parsed = parseTencentDocUrl(url)
  if (!parsed) return null

  const pageUrls = [parsed.pageUrl]
  if (/doc\.weixin\.qq\.com/i.test(url) || parsed.id.includes('_')) {
    const weixinPath = parsed.kind === 'form' ? `form/page/${parsed.id}` : `${parsed.kind}/${parsed.id}`
    const weixinUrl = `https://doc.weixin.qq.com/${weixinPath}`
    if (!pageUrls.includes(weixinUrl)) pageUrls.push(weixinUrl)
  }

  let lastError: unknown
  for (const pageUrl of pageUrls) {
    try {
      const doc = await fetchOpendocFromPage(http, parsed.id, pageUrl)
      if (doc) return doc
    } catch (error) {
      lastError = error
    }
  }
  if (lastError) throw lastError
  return null
}

async function fetchOpendocFromPage(http: DocHttp, id: string, pageUrl: string): Promise<DocContent | null> {
  const page = await http.text(pageUrl, {
    'user-agent': UA,
    accept: 'text/html',
  })
  const opendocUrl = extractOpendocUrl(page.body, id) ?? defaultOpendocUrl(id)
  const headers: Record<string, string> = {
    'user-agent': UA,
    referer: pageUrl,
    accept: '*/*',
  }
  if (page.cookies) headers.cookie = page.cookies

  const opendoc = await http.text(opendocUrl, headers)
  return parseOpendocBody(opendoc.body)
}

export function extractOfficeText(
  buffer: Buffer,
  name: string,
  maxBytes = DEFAULT_MAX_OFFICE_BYTES,
): DocContent | null {
  if (buffer.length > maxBytes) return null
  const lower = name.toLowerCase()
  if (lower.endsWith('.txt')) {
    const text = buffer.toString('utf8').trim()
    return text ? { title: name, text, images: [] } : null
  }
  if (lower.endsWith('.docx')) {
    const xml = readZipEntry(buffer, 'word/document.xml', maxBytes)
    if (!xml) return null
    const text = xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\s*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
    return text ? { title: name, text, images: collectUrls(xml) } : null
  }
  if (lower.endsWith('.doc')) {
    const text = extractUtf16LeText(buffer)
    return text ? { title: name, text, images: [] } : null
  }
  return null
}

function defaultOpendocUrl(id: string): string {
  return `https://docs.qq.com/dop-api/opendoc?u=&id=${id}&normal=1&outformat=1&noEscape=1&commandsFormat=1&doc_chunk_version=3&preview_token=&doc_chunk_flag=1&callback=clientVarsCallback`
}

function extractOpendocUrl(html: string, id: string): string | undefined {
  const match = html.match(/\/\/(?:docs\.qq\.com|doc\.weixin\.qq\.com)\/dop-api\/opendoc\?[^"'<\s]+/)
  if (!match) return undefined
  const url = `https:${match[0]}`
  return url.includes(id) ? url : undefined
}

function parseJsonp(body: string): Record<string, unknown> | null {
  const start = body.indexOf('(')
  const end = body.lastIndexOf(')')
  const json = start >= 0 && end > start ? body.slice(start + 1, end) : body
  try {
    const value = JSON.parse(json)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function maybeBase64(text: string): Buffer {
  const compact = text.replace(/\s+/g, '')
  if (compact.length > 80 && /^[A-Za-z0-9+/=]+$/.test(compact)) {
    try {
      return Buffer.from(compact, 'base64')
    } catch {
      // fall through
    }
  }
  return Buffer.from(text, 'utf8')
}

export function extractReadableText(input: string | Buffer): string {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : input
  return (text.match(/[\u4e00-\u9fff0-9A-Za-z，。、：:（）()【】“”"'！!？?·\-—]{2,}/g) ?? []).join('\n')
}

function extractUtf16LeText(buffer: Buffer): string {
  const chars: string[] = []
  let run = ''
  for (let i = 0; i + 1 < buffer.length; i += 2) {
    const code = buffer.readUInt16LE(i)
    if ((code >= 0x4e00 && code <= 0x9fff) || code === 0x3002 || code === 0xff0c || code === 0x3001) {
      run += String.fromCharCode(code)
      continue
    }
    if (run.length >= 2) chars.push(run)
    run = ''
  }
  if (run.length >= 2) chars.push(run)
  return chars.join('\n')
}

function readZipEntry(buffer: Buffer, suffix: string, maxBytes: number): string | null {
  let offset = 0
  while (offset < buffer.length) {
    const found = buffer.indexOf(ZIP_LOCAL, offset)
    if (found < 0) return null
    if (found + 30 > buffer.length) return null
    const method = buffer.readUInt16LE(found + 8)
    const compSize = buffer.readUInt32LE(found + 18)
    const uncompSize = buffer.readUInt32LE(found + 22)
    const nameLen = buffer.readUInt16LE(found + 26)
    const extraLen = buffer.readUInt16LE(found + 28)
    const nameStart = found + 30
    const dataStart = nameStart + nameLen + extraLen
    if (dataStart + compSize > buffer.length) return null
    const name = buffer.subarray(nameStart, nameStart + nameLen).toString('utf8')
    if (name === suffix || name.endsWith(`/${suffix}`)) {
      if (uncompSize > 0 && uncompSize <= 0xffff_fffe && uncompSize > maxBytes) return null
      const data = buffer.subarray(dataStart, dataStart + compSize)
      if (method === 0) return data.length > maxBytes ? null : data.toString('utf8')
      if (method === 8) {
        try {
          return inflateRawSync(data, { maxOutputLength: maxBytes }).toString('utf8')
        } catch {
          return null
        }
      }
    }
    offset = dataStart + Math.max(compSize, 1)
  }
  return null
}

function decodePercents(text: string, times = 3): string {
  let current = text
  for (let i = 0; i < times; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(current)) break
    try {
      const next = decodeURIComponent(current)
      if (next === current) break
      current = next
    } catch {
      break
    }
  }
  return current
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
