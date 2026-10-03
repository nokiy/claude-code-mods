import { expect, test } from 'claude-code/testing'

import { caption, fit, imageFile, imageRoots, keep, parkCursor, parseCellAspect, pick, placeholders, pngSize, saysNoPixels, stripRows } from './logic'
import { pickLang, strings } from './strings'

const shot = (n: number) => ({ n, file: `/t/${n}.png`, width: 10, height: 10 })

test('placeholders, what the draft still holds', async () => {
  expect(placeholders('look [Image #1] and [Image #12]')).toEqual([1, 12])
  expect(keep([shot(1), shot(2)], 'only [Image #2]').map(s => s.n)).toEqual([2])
})

test('picking a shot; the caption is the placeholder and nothing else', async () => {
  expect(pick(2, [shot(2)], [shot(1)])?.n).toBe(2)
  expect(pick(null, [], [shot(1)])?.n).toBe(1)
  expect(caption(3)).toBe('[Image #3]')
})

test('PNG size comes from the IHDR header; anything else is not a PNG', async () => {
  const png1280x720 = 'iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAAAA='
  expect(pngSize(png1280x720)).toEqual({ width: 1280, height: 720 })
  expect(pngSize('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull()
})

test('Claude Code image paths: default root, an override, the file of N', async () => {
  expect(imageRoots(undefined, '501')).toEqual(['/tmp/claude-501'])
  expect(imageRoots('/var/t/', '501')).toEqual(['/var/t/claude-501', '/var/t'])
  expect(imageFile('/tmp/claude-501/p/s/images', 2)).toBe('/tmp/claude-501/p/s/images/2.png')
})

test('the strip leaves a row for the caption and one for the keys; pictures keep at least one row', async () => {
  expect(stripRows(5)).toBe(3)
  expect(stripRows(8)).toBe(6)
  expect(stripRows(20)).toBe(6)
  expect(stripRows(2)).toBe(1)
})

test('fit keeps the shape inside the box and under the 255-cell cap', async () => {
  expect(fit(764, 950, 70, 12)).toEqual({ columns: 19, rows: 12 })
  expect(fit(4000, 100, 999, 999).columns).toBeLessThanOrEqual(255)
  expect(fit(1000, 1000, 40, 40, 2.5).rows).toBe(16)
})

test('a consumed ⌥←/⌥→ parks the cursor before a trailing space, so the next ⌥→ moves', async () => {
  expect(parkCursor('[Image #1]', 10)).toEqual({ text: '[Image #1] ', cursor: 10 })
  expect(parkCursor('[Image #1] ', 10)).toEqual({ text: '[Image #1] ', cursor: 10 })
  expect(parkCursor('ab [Image #1]', 2)).toEqual({ text: 'ab [Image #1]', cursor: 2 })
})

test('cell shape from TIOCGWINSZ; bogus sizes are ignored', async () => {
  expect(Math.round((parseCellAspect('46 175 1750 1012') ?? 0) * 10) / 10).toBe(2.2)
  expect(parseCellAspect('46 175 0 0')).toBeUndefined()
  expect(parseCellAspect('')).toBeUndefined()
})

test('pixel denies are told apart from element denies', async () => {
  expect(saysNoPixels('the Image draws its alt here: the terminal draws no placeholder images (bg worker)')).toBe(true)
  expect(saysNoPixels('nothing of this plugin is mounted there')).toBe(false)
})

test('English unless the option, Claude Code language or locale says Chinese', async () => {
  expect(pickLang('auto', undefined, 'en_US.UTF-8')).toBe('en')
  expect(pickLang('auto', 'Chinese', 'en_US.UTF-8')).toBe('zh')
  expect(pickLang('auto', undefined, 'zh_CN.UTF-8')).toBe('zh')
  expect(pickLang('en', 'Chinese', 'zh_CN.UTF-8')).toBe('en')
  expect(strings('en').zoom).toBe('⌥↑ Zoom')
})
