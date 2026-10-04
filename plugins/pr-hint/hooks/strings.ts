// UI strings of pr-hint, English and Chinese; English unless the session's language says Chinese. Called by card.ts, parse.ts and register.tsx.
// Pure; tested in strings.test.ts.

export type Lang = 'en' | 'zh';

const plural = (n: number, one: string) => (n === 1 ? `1 ${one}` : `${n} ${one}s`);

const EN = {
  merged: 'merged',
  accepted: 'accepted',
  status: { todo: 'not started', doing: 'in progress', merged: 'merged', done: 'accepted' },
  integration: 'integration branch',
  behind: (n: number) => `${plural(n, 'commit')} behind`,
  noCi: 'no CI',
  noTickets: 'no linked tickets',
  openPr: 'Open PR',
  updated: (rel: string) => ` · updated ${rel}`,
  rel: {
    unknown: 'unknown',
    now: 'just now',
    min: (n: number) => `${n} min ago`,
    hour: (n: number) => `${n} h ago`,
    day: (n: number) => `${n} d ago`,
  },
};

export type Strings = typeof EN;

const ZH: Strings = {
  merged: '合入',
  accepted: '验收',
  status: { todo: '未开始', doing: '进行中', merged: '已合入', done: '已验收' },
  integration: '集成分支',
  behind: n => `还差 ${n} 个提交`,
  noCi: 'CI 无',
  noTickets: 'Tickets 无关联',
  openPr: '打开 PR',
  updated: rel => ` · 更新于 ${rel}`,
  rel: {
    unknown: '未知',
    now: '刚刚',
    min: n => `${n} 分钟前`,
    hour: n => `${n} 小时前`,
    day: n => `${n} 天前`,
  },
};

export const strings = (lang: Lang): Strings => (lang === 'zh' ? ZH : EN);

/**
 * The UI language: the config option when set, else Claude Code's `language`
 * setting, else the locale; Chinese only when one of them says so.
 */
export function pickLang(option: unknown, setting: unknown, locale: string | undefined): Lang {
  if (option === 'en' || option === 'zh') return option;
  const said = `${typeof setting === 'string' ? setting : ''} ${locale ?? ''}`.toLowerCase();
  return /chinese|中文|^zh|\szh/.test(said.trim()) || said.includes('zh_') || said.includes('zh-') ? 'zh' : 'en';
}
