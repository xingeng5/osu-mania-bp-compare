import { describe, expect, it } from 'vitest'
import { decodeShare, encodeShare, filtersFromShare, type ShareState } from './url'
import { DEFAULT_FILTERS } from './compare'

const base: ShareState = {
  a: 'Kalkai',
  b: 'dressurf',
  keys: '7K',
  platform: 'all',
  rate: 'all',
  starMin: null,
  starMax: null,
  year: 'all',
  minAbsDelta: null,
  view: 'side',
  sort: 'none',
}

describe('url 分享', () => {
  it('默认值不写进 URL', () => {
    expect(encodeShare(base)).toBe('a=Kalkai&b=dressurf&keys=7K')
  })

  it('非默认值全部往返', () => {
    const s: ShareState = {
      ...base,
      platform: 'stable',
      rate: 'DT',
      starMin: 5.5,
      starMax: 7,
      year: 2024,
      minAbsDelta: 20,
      view: 'both',
      sort: 'absDesc',
    }
    const q = encodeShare(s)
    expect(q).toContain('da=20')
    const back = decodeShare(q)
    expect(back).toMatchObject({
      a: 'Kalkai',
      b: 'dressurf',
      keys: '7K',
      platform: 'stable',
      rate: 'DT',
      starMin: 5.5,
      starMax: 7,
      year: 2024,
      minAbsDelta: 20,
      view: 'both',
      sort: 'absDesc',
    })
  })

  it('非法值被丢掉，不炸', () => {
    const back = decodeShare(
      '?a=x&b=y&keys=3K&platform=nope&rate=HD&view=bogus&sort=zzz&starMin=-5&year=1800',
    )
    expect(back.keys).toBeUndefined()
    expect(back.platform).toBeUndefined()
    expect(back.rate).toBeUndefined()
    expect(back.view).toBeUndefined()
    expect(back.sort).toBeUndefined()
    expect(back.starMin).toBeUndefined()
    expect(back.year).toBeUndefined()
    expect(back.a).toBe('x')
    expect(back.b).toBe('y')
  })

  it('空字符串 / 缺参也能解', () => {
    expect(decodeShare('')).toEqual({})
  })

  it('filtersFromShare 用默认值补缺项', () => {
    const f = filtersFromShare({ rate: 'HT', starMin: 4 }, DEFAULT_FILTERS)
    expect(f).toMatchObject({ rate: 'HT', starMin: 4, starMax: null, year: 'all', minAbsDelta: null })
  })
})