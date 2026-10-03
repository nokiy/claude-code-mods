import { test, expect } from 'claude-code/testing'

import { parseSubArg } from './subarg'

test('parseSubArg: the four forms; a number, hide and show are gone', () => {
  expect(parseSubArg('')).toEqual({ kind: 'toggle' })
  expect(parseSubArg('  ')).toEqual({ kind: 'toggle' })
  expect(parseSubArg('top')).toEqual({ kind: 'place', where: 'top' })
  expect(parseSubArg(' RIGHT ')).toEqual({ kind: 'place', where: 'right' })
  expect(parseSubArg('set')).toEqual({ kind: 'set' })
  expect(parseSubArg(' Set ')).toEqual({ kind: 'set' })
  for (const bad of ['3', '#12', '0', 'left', '2 3', 'hide tier', 'show time', 'set top']) expect(parseSubArg(bad)).toEqual({ kind: 'bad' })
})
