import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 16, bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 15, totalRows: 0 }, view: {} },
}
const OUT = { stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false }

/** The world beneath: a draft holding two pasted images, a pasteboard with a 1280×720 PNG, blits as given. */
function world(on: On, blitDeny: string | undefined) {
  on('prompt.read', () => ({ value: { text: 'look [Image #1] [Image #2]', cursor: 26 } }) as never)
  on('process.run', (_$, e) => {
    const argv = (e as { argv: readonly string[] }).argv
    // Real osascript takes a leading '-' in an argument as an option and fails.
    if (argv[0] === 'osascript' && argv.slice(5).some(a => a.startsWith('-'))) {
      return { value: { ...OUT, exitCode: 1, stdout: '', stderr: 'osascript: illegal option' } }
    }
    const stdout = argv[0] === 'osascript'
      ? JSON.stringify({ count: 7, file: `/tmp/paste-peek/t/${argv[6]?.split('/').pop()}`, width: 1280, height: 720, bytes: 188416 })
      : ''
    return { value: { ...OUT, stdout } }
  })
  on('ui.blit', () => ({ value: blitDeny === undefined ? {} : { deny: blitDeny } }) as never)
  on('ui.open', () => ({ value: {} }) as never)
  on('ui.close', () => ({ value: undefined }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

test('pasted images show as real pictures; ⌥↑ zooms the selected one', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  world(on, undefined)
  const mount = () => $.ui.mount({ plugin: 'paste-peek', surface: 'terminal', ...BAND } as never)

  const sentinel = await mount()
  expect(await sentinel.find({ type: 'Image', key: 'probe' })).toBeDefined()
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()
  expect((await $.command.run({ command: 'peek', args: 'why' } as never)).text).toMatch(/pixel mode: file/)

  await clock.advance(1100)
  await clock.settle()
  const band = await mount()
  expect(await band.find({ type: 'Image', key: 't1' })).toBeDefined()
  expect(await band.find({ type: 'Image', key: 't2' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /\[Image #2\] 1280×720 · 184 KB/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /⌥← ⌥→ Switch/ })).toBeDefined()
  await band.press({ key: 'zoom' })
  await band.unmount()

  const zoomed = await mount()
  expect(await zoomed.find({ type: 'Image', key: 'big2' })).toBeDefined()
  expect(await zoomed.find({ type: 'Image', key: 't1' })).toBeUndefined()
  await zoomed.unmount()
})

test('where the engine draws no pictures, the band draws nothing at all', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  world(on, 'the Image draws its alt here: the terminal draws no placeholder images (bg worker)')
  const sentinel = await $.ui.mount({ plugin: 'paste-peek', surface: 'terminal', ...BAND } as never)
  await clock.advance(600)
  await clock.settle()
  await sentinel.unmount()
  expect((await $.command.run({ command: 'peek', args: 'why' } as never)).text).toMatch(/pixel mode: none/)

  await clock.advance(1100)
  await clock.settle()
  const band = await $.ui.mount({ plugin: 'paste-peek', surface: 'terminal', ...BAND } as never)
  expect(await band.find({ type: 'Image', key: 't1' })).toBeUndefined()
  await band.unmount()
})
