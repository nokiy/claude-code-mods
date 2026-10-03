import { test, expect } from 'claude-code/testing'

import { pickLang, strings } from './strings'

test('pickLang: the option wins; auto follows the Claude Code language setting, then the locale', () => {
  expect(pickLang('zh', 'English', 'en_US.UTF-8')).toBe('zh')
  expect(pickLang('en', 'chinese', 'zh_CN.UTF-8')).toBe('en')
  expect(pickLang('auto', 'chinese', 'en_US.UTF-8')).toBe('zh')
  expect(pickLang('auto', undefined, 'zh_CN.UTF-8')).toBe('zh')
  expect(pickLang('auto', undefined, 'en_US.UTF-8')).toBe('en')
  expect(pickLang(undefined, undefined, undefined)).toBe('en')
})

test('strings: both tables have the same keys, English is the default', () => {
  const en = strings('en')
  const zh = strings('zh')
  expect(Object.keys(zh)).toEqual(Object.keys(en))
  expect(Object.keys(zh.gloss)).toEqual(Object.keys(en.gloss))
  expect(en.close).toBe('close')
  expect(zh.close).toBe('关闭')
})
