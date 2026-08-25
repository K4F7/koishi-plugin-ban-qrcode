import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { describe, it } from 'node:test'
import {
  DEFAULT_MAX_OFFICE_BYTES,
  collectTencentDocUrls,
  extractOfficeText,
  fetchTencentDoc,
  parseOpendocBody,
  parseTencentDocUrl,
} from '../src/document'

function zipLocal(name: string, data: Buffer, method: number, uncompSize: number): Buffer {
  const nameBuf = Buffer.from(name)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(method, 8)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(uncompSize, 22)
  header.writeUInt16LE(nameBuf.length, 26)
  return Buffer.concat([header, nameBuf, data])
}

function zipStore(name: string, content: string): Buffer {
  const data = Buffer.from(content, 'utf8')
  return zipLocal(name, data, 0, data.length)
}

function zipDeflate(name: string, content: Buffer): Buffer {
  return zipLocal(name, deflateRawSync(content), 8, content.length)
}

describe('tencent doc urls', () => {
  it('parses docs.qq.com links and keeps the first unique id', () => {
    assert.deepEqual(parseTencentDocUrl('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh?_t=1'), {
      kind: 'doc',
      id: 'DWHNhYk1iZVZMY1Rh',
      pageUrl: 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    })
    assert.deepEqual(collectTencentDocUrls([
      '看 https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh 和 https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
      'https://example.test/other',
    ].join('\n')), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
    assert.deepEqual(collectTencentDocUrls('{"jumpUrl":"https:\\/\\/docs.qq.com\\/doc\\/DWHNhYk1iZVZMY1Rh"}'), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
  })

  it('parses weixin mini-program urls, form pages, and percent-encoded paths', () => {
    assert.deepEqual(parseTencentDocUrl('https://doc.weixin.qq.com/doc/w3_AMkAXgaQACcKN0abc'), {
      kind: 'doc',
      id: 'w3_AMkAXgaQACcKN0abc',
      pageUrl: 'https://docs.qq.com/doc/w3_AMkAXgaQACcKN0abc',
    })
    assert.deepEqual(parseTencentDocUrl('https://docs.qq.com/form/page/DT3VGc0FmT3JhZ3ZE'), {
      kind: 'form',
      id: 'DT3VGc0FmT3JhZ3ZE',
      pageUrl: 'https://docs.qq.com/form/page/DT3VGc0FmT3JhZ3ZE',
    })
    assert.deepEqual(collectTencentDocUrls(
      'pages/detail/detail?url=' + encodeURIComponent('https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh'),
    ), [
      'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh',
    ])
    assert.deepEqual(collectTencentDocUrls(
      'mqqapi://miniapp/open?_path=' + encodeURIComponent(
        'pages/detail/detail?url=' + encodeURIComponent('https://doc.weixin.qq.com/doc/w3_AMkAXgaQACcKN0abc'),
      ),
    ), [
      'https://docs.qq.com/doc/w3_AMkAXgaQACcKN0abc',
    ])
  })
})

describe('parseOpendocBody', () => {
  it('reads title, chinese text, and embedded images from jsonp', () => {
    const payload = {
      clientVars: {
        title: '大一新生必备清单(详细版)(2) (1)',
        collab_client_vars: {
          initialAttributedText: {
            text: [
              Buffer.from('校园麦芽送货到寝买被子 https://docimg6.docs.qq.com/image/AgAAEQOd.jpeg', 'utf8').toString('base64'),
            ],
          },
        },
      },
    }
    const doc = parseOpendocBody(`clientVarsCallback(${JSON.stringify(payload)})`)
    assert.equal(doc?.title, '大一新生必备清单(详细版)(2) (1)')
    assert.match(doc?.text ?? '', /校园麦芽/)
    assert.deepEqual(doc?.images, ['https://docimg6.docs.qq.com/image/AgAAEQOd.jpeg'])
  })
})

describe('fetchTencentDoc', () => {
  it('opens the public page then the opendoc jsonp with cookies', async () => {
    const calls: Array<{ url: string, headers?: Record<string, string> }> = []
    const doc = await fetchTencentDoc({
      async text(url, headers) {
        calls.push({ url, headers })
        if (url.includes('/doc/')) {
          return {
            body: '<link href="//docs.qq.com/dop-api/opendoc?id=DWHNhYk1iZVZMY1Rh&callback=clientVarsCallback">',
            cookies: 'TOK=abc',
          }
        }
        return {
          body: `clientVarsCallback(${JSON.stringify({
            clientVars: {
              title: '清单',
              collab_client_vars: {
                initialAttributedText: { text: ['校园麦芽送货到寝'] },
              },
            },
          })})`,
        }
      },
    }, 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh')

    assert.equal(doc?.title, '清单')
    assert.match(doc?.text ?? '', /校园麦芽/)
    assert.equal(calls[0]?.url, 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh')
    assert.match(calls[1]?.url ?? '', /opendoc/)
    assert.equal(calls[1]?.headers?.cookie, 'TOK=abc')
    assert.equal(calls[1]?.headers?.referer, 'https://docs.qq.com/doc/DWHNhYk1iZVZMY1Rh')
  })

  it('falls back to the weixin page when the docs.qq.com view is empty', async () => {
    const calls: string[] = []
    const doc = await fetchTencentDoc({
      async text(url) {
        calls.push(url)
        if (url.includes('docs.qq.com/doc/')) return { body: '<html></html>' }
        if (url.includes('docs.qq.com/dop-api/opendoc')) return { body: 'clientVarsCallback({})' }
        if (url.includes('doc.weixin.qq.com/doc/')) {
          return {
            body: '<link href="//doc.weixin.qq.com/dop-api/opendoc?id=w3_AMkAXgaQACcKN0abc&callback=clientVarsCallback">',
          }
        }
        return {
          body: `clientVarsCallback(${JSON.stringify({
            clientVars: {
              title: '微信清单',
              collab_client_vars: {
                initialAttributedText: { text: ['校园麦芽送货到寝'] },
              },
            },
          })})`,
        }
      },
    }, 'https://doc.weixin.qq.com/doc/w3_AMkAXgaQACcKN0abc')

    assert.equal(doc?.title, '微信清单')
    assert.ok(calls.some(url => url.includes('docs.qq.com/doc/w3_AMkAXgaQACcKN0abc')))
    assert.ok(calls.some(url => url.includes('doc.weixin.qq.com/doc/w3_AMkAXgaQACcKN0abc')))
    assert.ok(calls.some(url => url.includes('doc.weixin.qq.com/dop-api/opendoc')))
  })
})

describe('extractOfficeText', () => {
  it('reads advertising copy from docx xml and utf-16 doc files', () => {
    const xml = '<?xml version="1.0"?><w:document><w:p><w:r><w:t>校园麦芽送货到寝</w:t></w:r></w:p></w:document>'
    const docx = extractOfficeText(zipStore('word/document.xml', xml), '大一新生必备清单.docx')
    assert.match(docx?.text ?? '', /校园麦芽送货到寝/)

    const doc = extractOfficeText(Buffer.from('校园麦芽送货到寝', 'utf16le'), '清单.doc')
    assert.match(doc?.text ?? '', /校园麦芽/)

    const txt = extractOfficeText(Buffer.from('普通清单：牙刷牙膏'), '清单.txt')
    assert.equal(txt?.text, '普通清单：牙刷牙膏')
  })

  it('skips office files that exceed the configured size cap', () => {
    const xml = '<?xml version="1.0"?><w:document><w:p><w:r><w:t>校园麦芽送货到寝</w:t></w:r></w:p></w:document>'
    const inflated = Buffer.concat([
      Buffer.from('<?xml version="1.0"?><w:document><w:p><w:r><w:t>', 'utf8'),
      Buffer.alloc(DEFAULT_MAX_OFFICE_BYTES + 1, 0x61),
      Buffer.from('</w:t></w:r></w:p></w:document>', 'utf8'),
    ])

    assert.equal(extractOfficeText(Buffer.alloc(DEFAULT_MAX_OFFICE_BYTES + 1, 0x61), '清单.txt'), null)
    assert.equal(extractOfficeText(zipStore('word/document.xml', xml), '清单.docx', xml.length - 1), null)
    assert.equal(extractOfficeText(zipDeflate('word/document.xml', inflated), '清单.docx'), null)
    assert.equal(extractOfficeText(zipLocal('word/document.xml', deflateRawSync(inflated), 8, 0), '清单.docx'), null)

    const deflated = extractOfficeText(zipDeflate('word/document.xml', Buffer.from(xml, 'utf8')), '清单.docx')
    assert.match(deflated?.text ?? '', /校园麦芽送货到寝/)
  })
})
