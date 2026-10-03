// The argument of `/sub`: close/back toggle, a placement, or the settings page. Pure; tested in subarg.test.ts.

export type SubArg = { kind: 'toggle' } | { kind: 'place'; where: 'top' | 'right' } | { kind: 'set' } | { kind: 'bad' }

export function parseSubArg(args: string): SubArg {
  const a = args.trim().toLowerCase()
  if (a === '') return { kind: 'toggle' }
  if (a === 'top' || a === 'right') return { kind: 'place', where: a }
  return a === 'set' ? { kind: 'set' } : { kind: 'bad' }
}
