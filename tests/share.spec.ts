import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectAdContent } from '../src/ad'
import { collectMessageParts } from '../src/detect'
import { collectShareJumpUrls, collectTencentDocUrls, extractTencentDocUrlsFromShare } from '../src/document'
import {
  extractShareCardText,
  isGroupInviteCard,
  isTencentDocCard,
  looksLikeFreshmanListDocCard,
  summarizeShare,
  TENCENT_DOC_QQ_APPID,
  TENCENT_DOC_WECHAT_APPID,
} from '../src/share'

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

const realGroupCard = JSON.stringify({
  app: 'com.tencent.contact.lua',
  view: 'contact',
  prompt: '[QQ名片]群聊',
  meta: {
    contact: {
      avatar: 'https://p.qlogo.cn/gh/123456/123456/100',
      nickname: '新生补给站',
      tag: '群名片',
      jumpUrl: 'mqqapi://card/show_pslcard?src_type=internal&source=sharecard&version=1&uin=123456&card_type=group',
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

const miniDocCard = JSON.stringify({
  app: 'com.tencent.miniapp_01',
  prompt: '[QQ小程序]腾讯文档',
  meta: {
    detail_1: {
      appid: TENCENT_DOC_WECHAT_APPID,
      title: '大一新生必备清单',
      desc: '腾讯文档',
      appname: '腾讯文档',
      url: 'mqqapi://miniapp/open?_miniappid=' + TENCENT_DOC_QQ_APPID + '&_path=' + encodeURIComponent(
        'pages/detail/detail?url=' + encodeURIComponent('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh'),
      ),
      qqdocurl: 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    },
  },
})

const weixinMiniDocCard = JSON.stringify({
  app: 'com.tencent.miniapp_01',
  prompt: '[QQ小程序]',
  meta: {
    detail_1: {
      appid: TENCENT_DOC_QQ_APPID,
      title: '入学清单',
      url: 'mqqapi://miniapp/open?_path=' + encodeURIComponent(
        'pages/detail/detail?url=' + encodeURIComponent('https://doc.weixin.qq.com/doc/w3_AMkAXgaQACcKN0abc'),
      ),
    },
  },
})

const weixinLuaDocCard = {
  app: 'com.tencent.miniapp.lua',
  view: 'miniapp',
  bizsrc: 'miniapp.nativeshare',
  prompt: '[微信小程序]大一新生必备清单(详细版)(2) (1)',
  meta: {
    miniapp: {
      tag: '微信小程序',
      title: '大一新生必备清单(详细版)(2) (1)',
      source: '腾讯文档',
      jumpUrl: 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh#',
      pcJumpUrl: 'miniapp://open/1036?url=' + encodeURIComponent(
        'pages/detail/detail?url=' + encodeURIComponent('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh#'),
      ),
    },
  },
}

const weixinLuaEncodedOnly = {
  app: 'com.tencent.miniapp.lua',
  view: 'miniapp',
  prompt: '[微信小程序]大一新生必备清单(详细版)(2) (1)',
  meta: {
    miniapp: {
      tag: '微信小程序',
      source: '腾讯文档',
      title: '大一新生必备清单(详细版)(2) (1)',
      jumpUrl: 'https://m.q.qq.com/a/s/deadbeef',
      pcJumpUrl: 'miniapp://open/1036?url=' + encodeURIComponent(
        'pages/detail/detail.html?url=' + encodeURIComponent('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh#'),
      ),
    },
  },
}

const weixinDocXml = [
  '<?xml version="1.0"?>',
  '<msg><appmsg>',
  '<title>大一新生必备清单(详细版)(2) (1)</title>',
  '<type>33</type>',
  '<sourcedisplayname>腾讯文档</sourcedisplayname>',
  '<url>https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh#</url>',
  '<weappinfo>',
  `<appid>${TENCENT_DOC_WECHAT_APPID}</appid>`,
  '<pagepath>pages/detail/detail.html?url=https%3A%2F%2Fdocs.qq.com%2Fdoc%2FDWHNhYk1iZVZMY1Rh%23</pagepath>',
  '</weappinfo>',
  '</appmsg></msg>',
].join('')

describe('isGroupInviteCard', () => {
  it('detects invite apps, group business cards, and xml briefs', () => {
    assert.equal(isGroupInviteCard(inviteApp), true)
    assert.equal(isGroupInviteCard(groupCard), true)
    assert.equal(isGroupInviteCard(`[json:data=${groupCard}]`), true)
    assert.equal(isGroupInviteCard('<?xml version="1.0"?><msg serviceID="14" brief="[推荐群]"><summary>来</summary></msg>'), true)
    assert.equal(isGroupInviteCard('<?xml version="1.0"?><msg serviceID="1">邀请你加入群聊</msg>'), true)
  })

  it('detects real QQ 群名片 even when jumpUrl includes source=sharecard', () => {
    assert.equal(isGroupInviteCard(realGroupCard), true)
    assert.equal(isGroupInviteCard(JSON.stringify({ data: realGroupCard })), true)
    assert.equal(isGroupInviteCard('[CQ:contact,type=group,id=123456]'), true)
    assert.equal(isGroupInviteCard(JSON.stringify({ type: 'group', id: '123456' })), true)
    assert.equal(isGroupInviteCard(`[CQ:json,data=${realGroupCard.replace(/,/g, '&#44;')}]`), true)
  })

  it('ignores friend cards and tencent-doc news cards', () => {
    assert.equal(isGroupInviteCard(friendCard), false)
    assert.equal(isGroupInviteCard(docCard), false)
    assert.equal(isGroupInviteCard('普通文本邀请大家晚上一起自习'), false)
    assert.equal(isGroupInviteCard('[CQ:contact,type=qq,id=123456]'), false)
    assert.equal(isGroupInviteCard(JSON.stringify({ type: 'qq', id: '123456' })), false)
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

  it('treats weixin / QQ mini-program cards as tencent docs and reads the hidden url', () => {
    assert.equal(isTencentDocCard(miniDocCard), true)
    assert.equal(isTencentDocCard(weixinMiniDocCard), true)
    assert.equal(isGroupInviteCard(miniDocCard), false)
    const text = extractShareCardText(miniDocCard)
    assert.match(text, /腾讯文档/)
    assert.match(text, /大一新生必备清单/)
    assert.deepEqual(collectTencentDocUrls(miniDocCard), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
    assert.deepEqual(collectTencentDocUrls(weixinMiniDocCard), [
      'https://docs.qq.com/doc/w3_AMkAXgaQACcKN0abc',
    ])
  })

  it('parses the weixin miniapp.lua 腾讯文档 card back to docs.qq.com', () => {
    const payload = JSON.stringify(weixinLuaDocCard)
    assert.equal(isTencentDocCard(payload), true)
    assert.deepEqual(extractTencentDocUrlsFromShare(payload), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
    assert.deepEqual(extractTencentDocUrlsFromShare(JSON.stringify(weixinLuaEncodedOnly)), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
    assert.deepEqual(extractTencentDocUrlsFromShare(weixinDocXml), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
  })

  it('collects a flattened weixin mini-program card even when attrs has no data wrapper', () => {
    const parts = collectMessageParts([
      { type: 'json', attrs: weixinLuaDocCard },
      { type: 'xml', attrs: { data: weixinDocXml } },
    ])
    assert.ok(parts.shares.some(item => item.includes('com.tencent.miniapp.lua')))
    assert.ok(parts.urls.includes('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh#'))
    assert.deepEqual(extractTencentDocUrlsFromShare(parts.shares.find(item => item.includes('miniapp.lua')) ?? ''), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
  })

  it('treats a weixin mini-program freshman list as a doc card even without a docs.qq.com url', () => {
    const noUrlCard = JSON.stringify({
      app: 'com.tencent.miniapp.lua',
      view: 'miniapp',
      bizsrc: 'miniapp.nativeshare',
      prompt: '[微信小程序]大一新生必备清单(详细版)(2) (1)',
      meta: {
        miniapp: {
          tag: '微信小程序',
          title: '大一新生必备清单(详细版)(2) (1)',
          source: '腾讯文档',
          jumpUrl: 'https://m.q.qq.com/a/s/deadbeefcafebabe',
          pcJumpUrl: 'miniapp://open/1036?url=' + encodeURIComponent('https://m.q.qq.com/a/s/deadbeefcafebabe'),
        },
      },
    })
    assert.equal(isTencentDocCard(noUrlCard), true)
    assert.equal(looksLikeFreshmanListDocCard(noUrlCard), true)
    assert.deepEqual(extractTencentDocUrlsFromShare(noUrlCard), [])
    assert.deepEqual(collectShareJumpUrls(noUrlCard), [])
    assert.match(summarizeShare(noUrlCard), /miniapp\.lua/)
    assert.match(summarizeShare(noUrlCard), /大一新生必备清单/)
  })

  it('does not treat a timetable mini-program or a news card title as the freshman-list fallback', () => {
    const timetable = JSON.stringify({
      app: 'com.tencent.miniapp.lua',
      prompt: '[微信小程序]本学期课程表',
      meta: {
        miniapp: {
          tag: '微信小程序',
          title: '本学期课程表',
          source: '腾讯文档',
          jumpUrl: 'https://m.q.qq.com/a/s/abcdef',
        },
      },
    })
    assert.equal(isTencentDocCard(timetable), true)
    assert.equal(looksLikeFreshmanListDocCard(timetable), false)
    assert.equal(looksLikeFreshmanListDocCard(docCard), false)
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
      { type: 'lightapp', attrs: { data: miniDocCard } },
      { type: 'json', attrs: { data: groupCard } },
      { type: 'contact', attrs: { type: 'group', id: '123456' } },
      { type: 'file', attrs: { src: 'https://a.test/list.docx', filename: '大一新生必备清单.docx' } },
      { type: 'img', attrs: { src: 'https://a.test/1.png' } },
    ], `[json:data=${inviteApp}]`)

    assert.deepEqual(parts.images, ['https://a.test/1.png'])
    assert.deepEqual(parts.files, [{ src: 'https://a.test/list.docx', name: '大一新生必备清单.docx' }])
    assert.ok(parts.shares.includes(groupCard))
    assert.ok(parts.shares.includes(inviteApp))
    assert.ok(parts.shares.includes(miniDocCard))
    assert.ok(parts.shares.some(item => item.includes('"type":"group"') && item.includes('123456')))
    assert.ok(parts.urls.includes('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh'))
  })
})
