import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HTTP } from 'koishi'
import { createFileResolver, downloadImage } from '../src/qrcode'

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
