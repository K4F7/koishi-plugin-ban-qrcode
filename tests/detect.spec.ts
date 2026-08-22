import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import QRCode from 'qrcode'
import {
  collectImageSrcs,
  defaultNotify,
  findQrInImages,
  isAdminRole,
  muteDurationMs,
  parseDataUrl,
  shouldModerate,
} from '../src/detect'
import { decodeQr } from '../src/qrcode'

describe('collectImageSrcs', () => {
  it('reads img and image src, keeps order, drops duplicates, and walks nested nodes', () => {
    assert.deepEqual(collectImageSrcs([
      { type: 'text', attrs: { content: 'hi' } },
      { type: 'img', attrs: { src: 'https://a.test/1.png' } },
      { type: 'image', attrs: { url: 'https://a.test/2.png' } },
      { type: 'img', attrs: { src: 'https://a.test/1.png' } },
      {
        type: 'quote',
        children: [{ type: 'img', attrs: { src: 'https://a.test/3.png' } }],
      },
    ]), [
      'https://a.test/1.png',
      'https://a.test/2.png',
      'https://a.test/3.png',
    ])
  })

  it('ignores empty src', () => {
    assert.deepEqual(collectImageSrcs([{ type: 'img', attrs: { src: '  ' } }]), [])
  })
})

describe('shouldModerate', () => {
  const base = {
    guildId: 'g1',
    userId: 'u1',
    selfId: 'bot',
    ignoreUsers: [] as string[],
    guilds: [] as string[],
    skipAdmins: true,
  }

  it('allows ordinary group members', () => {
    assert.equal(shouldModerate(base), true)
  })

  it('rejects direct messages, missing ids, self, ignored users, and other guilds', () => {
    assert.equal(shouldModerate({ ...base, isDirect: true }), false)
    assert.equal(shouldModerate({ ...base, guildId: undefined }), false)
    assert.equal(shouldModerate({ ...base, userId: undefined }), false)
    assert.equal(shouldModerate({ ...base, userId: 'bot' }), false)
    assert.equal(shouldModerate({ ...base, ignoreUsers: ['u1'] }), false)
    assert.equal(shouldModerate({ ...base, guilds: ['g2'] }), false)
  })

  it('skips admin roles when configured', () => {
    assert.equal(shouldModerate({ ...base, roles: ['admin'] }), false)
    assert.equal(shouldModerate({ ...base, roles: [{ name: 'admin' }] }), false)
    assert.equal(shouldModerate({ ...base, roles: ['admin'], skipAdmins: false }), true)
    assert.equal(isAdminRole(['member']), false)
    assert.equal(isAdminRole(['owner']), true)
    assert.equal(isAdminRole([{ id: 'r1', name: 'owner' }]), true)
    assert.equal(isAdminRole([{ id: 'admin' }]), true)
  })
})

describe('helpers', () => {
  it('converts mute seconds to milliseconds', () => {
    assert.equal(muteDurationMs(60), 60000)
    assert.equal(muteDurationMs(1.9), 1000)
    assert.equal(muteDurationMs(-3), 0)
  })

  it('parses base64 data urls', () => {
    assert.deepEqual(parseDataUrl('data:image/png;base64,aGVsbG8='), Buffer.from('hello'))
    assert.equal(parseDataUrl('https://a.test/x.png'), null)
  })

  it('builds a notify line from mute seconds', () => {
    assert.equal(defaultNotify(60), '检测到二维码，已撤回并禁言 60 秒。')
    assert.equal(defaultNotify(0), '检测到二维码，已撤回。')
    assert.equal(defaultNotify(60, 'group-invite'), '检测到拉群卡片，已撤回并禁言 60 秒。')
    assert.equal(defaultNotify(0, 'ad-doc'), '检测到文档广告，已撤回。')
  })
})

describe('findQrInImages', () => {
  it('returns the first successful decode and skips failed downloads', async () => {
    const hit = await findQrInImages(
      ['bad', 'ok'],
      async src => {
        if (src === 'bad') throw new Error('fail')
        return Buffer.from(src)
      },
      async buffer => buffer.toString() === 'ok' ? 'payload' : null,
    )
    assert.deepEqual(hit, { src: 'ok', text: 'payload' })
  })

  it('returns null when no image contains a qrcode', async () => {
    const hit = await findQrInImages(
      ['a'],
      async () => Buffer.from('a'),
      async () => null,
    )
    assert.equal(hit, null)
  })
})

describe('decodeQr', () => {
  it('reads a generated png qrcode', async () => {
    const buffer = await QRCode.toBuffer('ban-qrcode-test', { type: 'png', margin: 2, width: 200 })
    assert.equal(await decodeQr(buffer), 'ban-qrcode-test')
  })
})
