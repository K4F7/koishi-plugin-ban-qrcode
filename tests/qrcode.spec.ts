import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HTTP } from 'koishi'
import { detectAdContent } from '../src/ad'
import { extractOfficeText } from '../src/document'
import { createFileResolver, downloadFile, downloadImage } from '../src/qrcode'

function boundInternal(payload: unknown = { base64: Buffer.from('img').toString('base64') }) {
  return {
    _get(src: string) {
      return { src, ...(payload as object) }
    },
    getImage(this: { _get: (src: string) => unknown }, src: string) {
      return this._get(src)
    },
  }
}

describe('createFileResolver', () => {
  it('calls internal.getImage as a method so this._get stays bound', async () => {
    const resolve = createFileResolver({ internal: boundInternal() })
    const result = await resolve('{C0F1}.image')
    assert.ok(Buffer.isBuffer(result))
    assert.equal(result.toString(), 'img')
  })

  it('returns null when getImage throws', async () => {
    const resolve = createFileResolver({
      internal: {
        getImage() {
          throw new TypeError("Cannot read properties of undefined (reading '_get')")
        },
      },
    })
    assert.equal(await resolve('{C0F1}.image'), null)
  })

  it('returns null when Internal is missing', async () => {
    assert.equal(await createFileResolver({})('{C0F1}.image'), null)
  })

  it('keeps this on a OneBot-like Internal proxy', async () => {
    const target = {
      _get(src: string) {
        return { base64: Buffer.from(src).toString('base64') }
      },
    }
    const internal = new Proxy(target, {
      get(obj, key, receiver) {
        if (key === 'getImage') {
          return function (this: typeof target, src: string) {
            return this._get(src)
          }
        }
        return Reflect.get(obj, key, receiver)
      },
    })
    const result = await createFileResolver({ internal })('file-id')
    assert.ok(Buffer.isBuffer(result))
    assert.equal(result.toString(), 'file-id')
  })
})

describe('downloadImage', () => {
  it('does not call getImage for https urls when http download succeeds', async () => {
    let called = false
    const resolve = createFileResolver({
      internal: {
        getImage() {
          called = true
          throw new Error('getImage should not run')
        },
      },
    })
    const http = {
      async get() {
        return new Uint8Array([1, 2, 3]).buffer
      },
    }
    const buffer = await downloadImage(http as HTTP, 'https://example.test/a.png', resolve)
    assert.deepEqual(buffer, Buffer.from([1, 2, 3]))
    assert.equal(called, false)
  })

  it('uses bound getImage for onebot file ids', async () => {
    const resolve = createFileResolver({ internal: boundInternal() })
    const http = {
      async get() {
        throw new Error('http should not run for file ids')
      },
    }
    const buffer = await downloadImage(http as HTTP, '{C0F1}.image', resolve)
    assert.equal(buffer.toString(), 'img')
  })
})

function boundFileInternal(payload: unknown = { base64: Buffer.from('docx').toString('base64') }) {
  return {
    _get(src: string) {
      return { src, ...(payload as object) }
    },
    getImage() {
      throw new Error('getImage should not run')
    },
    getFile(this: { _get: (src: string) => unknown }, payload: { file: string }) {
      return this._get(payload.file)
    },
  }
}

describe('office file resolver', () => {
  it('calls internal.getFile as a method so this._get stays bound', async () => {
    const internal = boundFileInternal()
    const unbound = internal.getFile
    assert.throws(() => unbound({ file: '{FILE}' }))

    const resolve = createFileResolver({ internal })
    const result = await resolve({ src: '{FILE}', name: '清单.docx', fileId: '{FILE}' })
    assert.ok(Buffer.isBuffer(result))
    assert.equal(result.toString(), 'docx')
  })

  it('does not call getImage for a docx file id', async () => {
    let imageCalled = false
    const resolve = createFileResolver({
      internal: {
        getImage() {
          imageCalled = true
          throw new Error('getImage should not run')
        },
        getFile() {
          return { base64: Buffer.from('ok').toString('base64') }
        },
      },
    })
    const result = await resolve({ src: '{FILE}', name: 'list.docx', fileId: '{FILE}' })
    assert.ok(Buffer.isBuffer(result))
    assert.equal(result.toString(), 'ok')
    assert.equal(imageCalled, false)
  })

  it('downloads office files via getFile and throws cannot download file on miss', async () => {
    const resolve = createFileResolver({ internal: boundFileInternal() })
    const http = {
      async get() {
        throw new Error('http should not run for file ids')
      },
    }
    const buffer = await downloadFile(http as HTTP, {
      src: '{FILE}',
      name: '清单.docx',
      fileId: '{FILE}',
    }, resolve)
    assert.equal(buffer.toString(), 'docx')

    await assert.rejects(
      () => downloadFile(http as HTTP, { src: 'list.docx', name: 'list.docx' }),
      { message: 'cannot download file' },
    )
  })

  it('uses getGroupFileUrl when getFile is unavailable', async () => {
    const resolve = createFileResolver({
      internal: {
        getImage() {
          throw new Error('getImage should not run')
        },
        getGroupFileUrl(payload: { group_id: unknown, file_id: string, busid: number }) {
          assert.equal(payload.group_id, 882034819)
          assert.equal(payload.file_id, 'FID')
          assert.equal(payload.busid, 102)
          return { url: 'https://files.test/list.docx' }
        },
      },
    }, '882034819')
    const http = {
      async get() {
        return Buffer.from('from-url')
      },
    }
    const buffer = await downloadFile(http as HTTP, {
      src: 'list.docx',
      name: 'list.docx',
      fileId: 'FID',
      busid: 102,
      groupId: '882034819',
    }, resolve)
    assert.equal(buffer.toString(), 'from-url')
  })

  it('feeds downloaded office text into the ad detector', async () => {
    const resolve = createFileResolver({
      internal: {
        getFile() {
          return { base64: Buffer.from('校园麦芽送货到寝买被子').toString('base64') }
        },
      },
    })
    const http = {
      async get() {
        throw new Error('http should not run')
      },
    }
    const doc = extractOfficeText(await downloadFile(http as HTTP, {
      src: '{FILE}',
      name: '清单.txt',
    }, resolve), '清单.txt')
    const hit = detectAdContent(doc?.text ?? '', doc?.title ?? '')
    assert.ok(hit)
    assert.ok(hit.matches.includes('校园麦芽'))
  })
})
