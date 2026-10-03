import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 16, bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 15, totalRows: 0 }, view: {} },
}
const OUT = { stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false }
const IMAGES = '/tmp/claude-501/-Users-me-proj/sess-1/images'
const PNG_1280x720 = 'iVBORw0KGgoAAAANSUhEUgAABQAAAALQCAYAAAA=' // signature + IHDR, as Claude Code writes it

/** The world beneath: a draft, Claude Code's image folder holding the files in `files`, blits as given. */
function world(on: On, blitDeny: string | undefined, draft: { text: string }, files: Set<number>) {
  mock.env(on, {})
  on('session.id', () => ({ value: 'sess-1' }) as never)
  on('prompt.read', () => ({ value: { text: draft.text, cursor: draft.text.length } }) as never)
  on('process.run', (_$, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    return { value: { ...OUT, stdout: argv[0] === 'id' ? '501\n' : '' } }
  })
  const seen = { list: 0, failRead: new Set<number>(), big: new Set<number>() } // fs.list calls; reads that fail; files over the cap
  on('fs.list', (_$, e) => {
    seen.list++
    const path = (e as { path: string }).path
    const entries = path === '/tmp/claude-501' ? [{ name: '-Users-me-proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : []
    return { value: entries } as never
  })
  const has = (path: string) => path === IMAGES || [...files].some(n => path === `${IMAGES}/${n}.png`)
  on('fs.exists', (_$, e) => ({ value: has((e as { path: string }).path) }) as never)
  const nOf = (path: string) => Number(path.split('/').pop()?.replace('.png', ''))
  on('fs.stat', (_$, e) => {
    const path = (e as { path: string }).path
    if (!has(path)) throw new Error('ENOENT')
    return { value: { kind: 'file', size: seen.big.has(nOf(path)) ? 9_000_000 : 1000, mtimeMs: 0, isLink: false } } as never
  })
  on('fs.read', (_$, e) => {
    if (seen.failRead.has(nOf((e as { path: string }).path))) throw new Error('EIO')
    return { value: { base64: PNG_1280x720 } } as never
  })
  on('ui.blit', () => ({ value: blitDeny === undefined ? {} : { deny: blitDeny } }) as never)
  on('ui.open', () => ({ value: {} }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  const renders = { count: 0 } // draws of the band reaching the engine beneath the plugin
  on('ui.render', ($, e) => {
    renders.count++
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return { renders, seen }
}

const mountBand = ($: Engine, props = {}) =>
  $.ui.mount({ plugin: 'paste-peek', surface: 'terminal', ...BAND, props: { ...BAND.props, ...props } } as never)

test('pasted images show as real pictures; ⌥↑ zooms the selected one', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  world(on, undefined, { text: 'look [Image #1] [Image #2]' }, new Set([1, 2]))

  const sentinel = await mountBand($)
  expect(await sentinel.find({ type: 'Image', key: 'probe' })).toBeDefined()
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()
  expect((await $.command.run({ command: 'peek', args: 'why' } as never)).text).toMatch(/pixel mode: file/)

  const band = await mountBand($)
  const first = await band.find({ type: 'Image', key: 't1' })
  expect(first?.props.source).toEqual({ file: `${IMAGES}/1.png`, format: 'png' })
  expect(await band.find({ type: 'Image', key: 't2' })).toBeDefined()
  expect((await band.find({ type: 'Text', text: /\[Image #2\]/ }))?.text).toBe('[Image #2]')
  expect(await band.find({ type: 'Text', text: /×|KB|MB/ })).toBeUndefined()
  expect(first?.props.alt).toBe('[Image #1]')
  expect(await band.find({ type: 'Text', text: /⌥← ⌥→ Switch/ })).toBeDefined()
  await band.press({ key: 'zoom' })
  await band.unmount()

  const zoomed = await mountBand($)
  const big = await zoomed.find({ type: 'Image', key: 'big2' })
  expect(big?.props.alt).toBe('[Image #2]')
  expect((await zoomed.find({ type: 'Text', text: /\[Image #2\]/ }))?.text).toBe('[Image #2]')
  expect(await zoomed.find({ type: 'Image', key: 't1' })).toBeUndefined()
  await zoomed.unmount()
})

test('a file not written yet draws nothing; a later 300ms poll picks it up', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const draft = { text: '[Image #1]' }
  const files = new Set([1])
  world(on, undefined, draft, files)
  const sentinel = await mountBand($)
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()

  const band = await mountBand($)
  expect(await band.find({ type: 'Image', key: 't1' })).toBeDefined()
  draft.text = '[Image #1] [Image #2]'
  await clock.advance(300) // a poll runs; 2.png is not there
  expect(await band.find({ type: 'Image', key: 't2' })).toBeUndefined()
  expect(await band.find({ type: 'Image', key: 't1' })).toBeDefined()
  files.add(2)
  await clock.advance(299)
  expect(await band.find({ type: 'Image', key: 't2' })).toBeUndefined()
  await clock.advance(1) // 300ms after the last poll
  expect(await band.find({ type: 'Image', key: 't2' })).toBeDefined()
  await band.unmount()
})

test('the whole strip (pictures, caption row, keys row) fits maxRows of 5, 8 and 20', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  world(on, undefined, { text: '[Image #1] [Image #2]' }, new Set([1, 2]))
  const sentinel = await mountBand($)
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()

  for (const [maxRows, pictureRows] of [[5, 3], [8, 6], [20, 6]] as const) {
    const band = await mountBand($, { maxRows })
    const rows = (await band.find({ type: 'Image', key: 't1' }))?.props.rows as number
    expect(rows).toBe(pictureRows)
    expect(rows + 2).toBeLessThanOrEqual(maxRows) // + caption row + keys row
    await band.unmount()
  }
})

test('where the engine draws no pictures, the band draws nothing at all', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  world(on, 'the Image draws its alt here: the terminal draws no placeholder images (bg worker)', { text: '[Image #1]' }, new Set([1]))
  const sentinel = await mountBand($)
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()
  expect((await $.command.run({ command: 'peek', args: 'why' } as never)).text).toMatch(/pixel mode: none/)

  const band = await mountBand($)
  expect(await band.find({ type: 'Image', key: 't1' })).toBeUndefined()
  await band.unmount()
})

test('polls with an unchanged draft redraw nothing; only a real change does', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const draft = { text: '[Image #1]' }
  const { renders } = world(on, undefined, draft, new Set([1]))
  const sentinel = await mountBand($)
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()
  const band = await mountBand($)
  expect(await band.find({ type: 'Image', key: 't1' })).toBeDefined()
  await clock.advance(300) // lets a one-off redraw (cell measurement) pass

  const before = renders.count
  await clock.advance(3000) // ten polls, same draft
  expect(await band.find({ type: 'Image', key: 't1' })).toBeDefined() // reading the drawing is not a redraw
  expect(renders.count).toBe(before)

  draft.text = '' // the placeholder leaves: the shot is dropped, one redraw
  await clock.advance(300)
  expect(await band.find({ type: 'Image', key: 't1' })).toBeUndefined()
  expect(renders.count).toBeGreaterThan(before)
  await band.unmount()
})

/** Mounts a probed band over a world; `setup` may tweak the world first. */
async function probed($: Engine, on: On, draft: string, files: number[], setup?: (w: ReturnType<typeof world>) => void) {
  const clock = mock.clock(on, { now: 0 })
  const w = world(on, undefined, { text: draft }, new Set(files))
  setup?.(w)
  const sentinel = await mountBand($)
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()
  return { clock, w, band: await mountBand($) }
}

test('a read that fails draws nothing and is retried; a file over the read cap shows with unknown size', async ($, on) => {
  const { clock, w, band } = await probed($, on, '[Image #1] [Image #2]', [1, 2], w => {
    w.seen.failRead.add(1)
    w.seen.big.add(2)
  })
  expect(await band.find({ type: 'Image', key: 't1' })).toBeUndefined() // read error: not a 0x0 shot
  expect(await band.find({ type: 'Image', key: 't2' })).toBeDefined() // over the cap: unknown size, still shown
  w.seen.failRead.delete(1)
  await clock.advance(300)
  expect(await band.find({ type: 'Image', key: 't1' })).toBeDefined()
  await band.unmount()
})

test('while the images folder is not found, the tmp root is scanned at most every 2s', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  const { seen } = world(on, undefined, { text: '[Image #1]' }, new Set()) // no files: the folder does not exist
  const sentinel = await mountBand($)
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()
  const after600 = seen.list
  await clock.advance(3000)
  expect(seen.list - after600).toBeLessThanOrEqual(2) // 3s of 300ms polls, one scan per 2s
  expect(after600).toBeLessThanOrEqual(1)
})

test('the keys row is one row that cannot wrap, so the strip fits maxRows with two pictures', async ($, on) => {
  const { band } = await probed($, on, '[Image #1] [Image #2]', [1, 2])
  const keys = await band.find({ type: 'Box', key: 'keys' })
  expect(keys?.props).toMatchObject({ height: 1, overflow: 'hidden', flexWrap: 'nowrap' })
  await band.unmount()
})
