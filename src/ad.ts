import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AdHit {
  matches: string[]
}

export interface AdKeywordLists {
  strong: string[]
  commerce: string[]
}

const SECTION = /^\[(strong|commerce)\]$/i

export function parseAdKeywords(source: string): AdKeywordLists {
  const lists: AdKeywordLists = { strong: [], commerce: [] }
  let section: keyof AdKeywordLists = 'strong'
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const marker = line.match(SECTION)
    if (marker) {
      section = marker[1].toLowerCase() as keyof AdKeywordLists
      continue
    }
    lists[section].push(line)
  }
  return lists
}

function loadAdKeywords(): AdKeywordLists {
  return parseAdKeywords(readFileSync(join(__dirname, 'ad-keywords.txt'), 'utf8'))
}

const { strong: VERY_STRONG, commerce: COMMERCE } = loadAdKeywords()

const PRODUCT = /被子|床品|四件套|六件套|九件套|被芯|床垫/
const SELL = /购买|预订|预定|下单|代购|团购|包邮|厂家|品牌|优惠|联系.{0,8}负责/
const CONTACT = /微信|加v|加微|vx[:：]|v信/i

export function detectAdContent(text: string, title = '', extraKeywords: readonly string[] = []): AdHit | null {
  const hay = `${title}\n${text}`
  if (!hay.trim()) return null

  const matches: string[] = []
  for (const keyword of VERY_STRONG) {
    if (hay.includes(keyword)) matches.push(keyword)
  }
  for (const keyword of extraKeywords) {
    if (keyword && hay.includes(keyword)) matches.push(keyword)
  }
  if (matches.length) return { matches }

  const commerce = COMMERCE.filter(keyword => hay.includes(keyword))
  if (PRODUCT.test(hay) && commerce.length >= 2) {
    return { matches: ['product-sell', ...commerce] }
  }
  if (PRODUCT.test(hay) && SELL.test(hay) && CONTACT.test(hay)) {
    return { matches: ['product-contact'] }
  }
  return null
}
