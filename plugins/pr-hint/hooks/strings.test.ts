// Tests the language pick and that both string tables carry the same keys.
import { expect, test } from 'claude-code/testing';
import { pickLang, strings } from './strings';

test('pickLang: the option wins; auto follows the Claude Code language setting, then the locale', () => {
  expect(pickLang('zh', 'English', 'en_US.UTF-8')).toBe('zh');
  expect(pickLang('en', 'chinese', 'zh_CN.UTF-8')).toBe('en');
  expect(pickLang('auto', 'chinese', 'en_US.UTF-8')).toBe('zh');
  expect(pickLang('auto', undefined, 'zh_CN.UTF-8')).toBe('zh');
  expect(pickLang('auto', undefined, 'en_US.UTF-8')).toBe('en');
  expect(pickLang(undefined, undefined, undefined)).toBe('en');
});

test('strings: both tables have the same keys, English is the default', () => {
  const en = strings('en');
  const zh = strings('zh');
  expect(Object.keys(zh)).toEqual(Object.keys(en));
  expect(Object.keys(zh.status)).toEqual(Object.keys(en.status));
  expect(Object.keys(zh.rel)).toEqual(Object.keys(en.rel));
  expect(en.openPr).toBe('Open PR');
  expect(zh.openPr).toBe('打开 PR');
  expect([en.refresh, zh.refresh]).toEqual(['↻ refresh', '↻ 刷新']);
  expect([en.fetched('5 min ago'), zh.fetched('5 分钟前')]).toEqual([' · fetched 5 min ago', ' · 拉取于 5 分钟前']);
  expect(en.behind(1)).toBe('1 commit behind');
  expect(en.behind(3)).toBe('3 commits behind');
});
