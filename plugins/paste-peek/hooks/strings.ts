// UI strings, English and Chinese; English unless the session's language says Chinese.

export type Lang = 'en' | 'zh'

const EN = {
  zoom: '⌥↑ Zoom',
  zoomClose: '⌥↑ Close',
  side: '⌥↓ Side pane',
  sideClose: '⌥↓ Close pane',
  switch: '⌥← ⌥→ Switch',
  paneKeys: '⌥↓ close · ⌥← ⌥→ switch · ⌥↑ zoom',
  noPixels: 'This session draws no pictures (a background session, or a terminal without kitty graphics). Use a foreground Ghostty or kitty session.',
  noImage: 'No image yet. Paste one into the prompt.',
  sent: 'sent',
  noClipImage: 'clipboard holds no image',
  debugOff: 'The debug log is off. Turn on "Debug log" for paste-peek in /config.',
  cleared: 'paste-peek cleared (the pixel probe runs again)',
  usage: '/peek (pane) · /peek why · /peek log · /peek clear',
  unknown: 'unknown',
  notProbed: 'not probed yet',
}

const ZH: typeof EN = {
  zoom: '⌥↑ 居中放大',
  zoomClose: '⌥↑ 收起',
  side: '⌥↓ 右侧放大',
  sideClose: '⌥↓ 收起右侧',
  switch: '⌥← ⌥→ 换图',
  paneKeys: '⌥↓ 收起右侧 · ⌥← ⌥→ 换图 · ⌥↑ 居中放大',
  noPixels: '这个会话画不了图片（后台会话，或终端不支持 kitty 图形协议）。请在前台的 Ghostty 或 kitty 会话里使用。',
  noImage: '还没有图片，往输入框粘贴一张。',
  sent: '已发送',
  noClipImage: '剪贴板里没有图片',
  debugOff: '调试日志未开启。在 /config 里打开 paste-peek 的「Debug log」。',
  cleared: 'paste-peek 已清空（会重新检测能否画图）',
  usage: '/peek（面板）· /peek why · /peek log · /peek clear',
  unknown: '未知命令',
  notProbed: '尚未检测',
}

export type Strings = typeof EN

export function strings(lang: Lang): Strings {
  return lang === 'zh' ? ZH : EN
}

/**
 * The UI language: the config option when set, else Claude Code's `language`
 * setting, else the locale; Chinese only when one of them says so.
 */
export function pickLang(option: unknown, setting: unknown, locale: string | undefined): Lang {
  if (option === 'en' || option === 'zh') return option
  const said = `${typeof setting === 'string' ? setting : ''} ${locale ?? ''}`.toLowerCase()
  return /chinese|中文|^zh|\szh/.test(said.trim()) || said.includes('zh_') || said.includes('zh-') ? 'zh' : 'en'
}
