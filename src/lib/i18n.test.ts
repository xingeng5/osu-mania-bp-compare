import { describe, expect, it } from 'vitest'
import { DICT, joinReasons, t, type MsgKey } from './i18n'

const keys = Object.keys(DICT) as MsgKey[]

describe('i18n 字典', () => {
  it('每条都有中英两份，且都不为空', () => {
    for (const key of keys) {
      const [zh, en] = DICT[key]
      expect(zh.trim(), `zh: ${key}`).not.toBe('')
      expect(en.trim(), `en: ${key}`).not.toBe('')
    }
  })

  it('中英两侧的占位符集合一致', () => {
    const holders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of keys) {
      const [zh, en] = DICT[key]
      expect(holders(en), `placeholder mismatch: ${key}`).toEqual(holders(zh))
    }
  })

  it('t() 替换占位符，缺值保留占位', () => {
    expect(t('zh', 'viewBoth', { n: 3 })).toBe('同图 3')
    expect(t('en', 'viewBoth', { n: 3 })).toBe('Same map 3')
    expect(t('zh', 'viewBoth')).toBe('同图 {n}')
  })

  it('joinReasons 用中文分号 / 英文分号加空格', () => {
    expect(joinReasons('zh', ['甲', '乙'])).toBe('甲；乙')
    expect(joinReasons('en', ['a', 'b'])).toBe('a; b')
  })

  it('两个语言的 key 数量一致（同一个对象，不会漂移）', () => {
    expect(keys.length).toBeGreaterThan(40)
  })
})