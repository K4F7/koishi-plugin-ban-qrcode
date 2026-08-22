export interface AdHit {
  matches: string[]
}

const VERY_STRONG = [
  '校园麦芽',
  '送货到寝',
  '配送到寝',
  '送寝',
  '名额有限',
  '营业执照',
  '联系本校的负责人',
  '联系本校负责人',
  '整套四五百',
]

const COMMERCE = [
  '提前预订',
  '提前预定',
  '买被子',
  '购买链接',
  '质保四年',
  '厂家直销',
  '真空包装',
  '代发到寝',
]

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
