import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectAdContent } from '../src/ad'

const quiltAd = `
如果你还没有准备床品的话，建议参考校园麦芽
往届很多学长学姐都有校园麦芽品牌的床品
校园麦芽最大的优势就是已经做学生床品且送货到寝
提前预订好套件，他们家主要是六件套、九件套
在麦芽买被子，开学前一个周发货，到时候给大家送寝室
价格方面其实跟学校周边差不多整套四五百
可以联系本校的负责人提前预订，送货到寝名额有限哦
下面有营业执照
`

const genuineList = `
大一新生必备清单
一定不能忘记：录取通知书；身份证复印件；一寸登记照
洗护用品：洗面奶，牙刷，牙膏，洗发水
住宿床上用品：被子、枕头、床单，学校一般会统一采购
文具：签字笔、笔记本
`

describe('detectAdContent', () => {
  it('flags freshman-list docs that sell bedding', () => {
    const hit = detectAdContent(quiltAd, '大一新生必备清单(详细版)')
    assert.ok(hit)
    assert.ok(hit.matches.includes('校园麦芽'))
    assert.ok(hit.matches.includes('送货到寝'))
  })

  it('allows a genuine checklist that only mentions bedding as items', () => {
    assert.equal(detectAdContent(genuineList, '大一新生必备清单'), null)
  })

  it('honors extra keywords from config', () => {
    assert.equal(detectAdContent('今晚一起看球赛', '通知'), null)
    const hit = detectAdContent('今晚一起看球赛', '通知', ['看球赛'])
    assert.deepEqual(hit, { matches: ['看球赛'] })
  })
})
