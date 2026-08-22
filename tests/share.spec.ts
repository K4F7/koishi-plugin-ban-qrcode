import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectAdContent } from '../src/ad'
import { collectMessageParts } from '../src/detect'
import { extractShareCardText, isGroupInviteCard, isTencentDocCard } from '../src/share'

const groupCard = JSON.stringify({
  app: 'com.tencent.contact.lua',
  prompt: '群名片: 新生补给站',
  bizsrc: 'qun.share',
  meta: {
    contact: {
      tag: '群名片',
      nickname: '新生补给站',
      jumpUrl: 'mqqapi://card/show_pslcard?card_type=group&uin=123',
    },
  },
})

const inviteApp = JSON.stringify({
  app: 'com.tencent.qun.invite',
  prompt: '邀请你加入群聊',
  meta: { news: { desc: '快来', jumpUrl: 'https://example.test/join?groupcode=1' } },
})

const friendCard = JSON.stringify({
  app: 'com.tencent.contact.lua',
  prompt: '推荐联系人：张三',
  bizsrc: 'cardshare.cardshare',
  meta: {
    contact: {
      tag: '推荐好友',
      jumpUrl: 'mqqapi://card/show_pslcard?src_type=internal&source=sharecard&uin=1',
    },
  },
})

const docCard = JSON.stringify({
  app: 'com.tencent.structmsg',
  prompt: '[腾讯文档] 大一新生必备清单',
  meta: {
    news: {
      title: '大一新生必备清单',
      jumpUrl: 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
      tag: '腾讯文档',
    },
  },
})

describe('isGroupInviteCard', () => {
  it('detects invite apps, group business cards, and xml briefs', () => {
    assert.equal(isGroupInviteCard(inviteApp), true)
    assert.equal(isGroupInviteCard(groupCard), true)
    assert.equal(isGroupInviteCard(`[json:data=${groupCard}]`), true)
    assert.equal(isGroupInviteCard('<?xml version="1.0"?><msg serviceID="14" brief="[推荐群]"><summary>来</summary></msg>'), true)
    assert.equal(isGroupInviteCard('<?xml version="1.0"?><msg serviceID="1">邀请你加入群聊</msg>'), true)
  })

  it('ignores friend cards and tencent-doc news cards', () => {
    assert.equal(isGroupInviteCard(friendCard), false)
    assert.equal(isGroupInviteCard(docCard), false)
    assert.equal(isGroupInviteCard('普通文本邀请大家晚上一起自习'), false)
  })
})

describe('tencent doc share cards', () => {
  it('reads title prompt and desc without treating a checklist title as an ad', () => {
    assert.equal(isTencentDocCard(docCard), true)
    const text = extractShareCardText(docCard)
    assert.match(text, /腾讯文档/)
    assert.match(text, /大一新生必备清单/)
    assert.equal(detectAdContent(text, ''), null)
  })

  it('flags a share card when desc already contains ad keywords', () => {
    const adCard = JSON.stringify({
      app: 'com.tencent.structmsg',
      prompt: '[腾讯文档] 大一新生必备清单',
      meta: {
        news: {
          title: '大一新生必备清单',
          desc: '校园麦芽送货到寝，联系本校的负责人',
          jumpUrl: 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
          tag: '腾讯文档',
        },
      },
    })
    const text = extractShareCardText(adCard)
    const hit = detectAdContent(text, '')
    assert.ok(hit)
    assert.ok(hit.matches.includes('校园麦芽'))
  })
})

describe('collectMessageParts', () => {
  it('collects share payloads, office files, and urls from nodes and raw content', () => {
    const parts = collectMessageParts([
      { type: 'text', attrs: { content: '看这个 https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh' } },
      { type: 'json', attrs: { data: groupCard } },
      { type: 'file', attrs: { src: 'https://a.test/list.docx', filename: '大一新生必备清单.docx' } },
      { type: 'img', attrs: { src: 'https://a.test/1.png' } },
    ], `[json:data=${inviteApp}]`)

    assert.deepEqual(parts.images, ['https://a.test/1.png'])
    assert.deepEqual(parts.files, [{ src: 'https://a.test/list.docx', name: '大一新生必备清单.docx' }])
    assert.ok(parts.shares.includes(groupCard))
    assert.ok(parts.shares.includes(inviteApp))
    assert.ok(parts.urls.includes('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh'))
  })
})
