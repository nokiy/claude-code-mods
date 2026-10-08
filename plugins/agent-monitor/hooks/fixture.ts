// Test fixture for agent-monitor: a View with every field filled, so a test names only what it cares about.
import type { View } from './views'

export const view = (over: Partial<View> = {}): View => ({
  id: 'x', type: 'worker', task: 'task', desc: '', status: 'running',
  files: [], editCount: 0, toolCounts: {}, denied: 0, refusals: 0, reasons: [], clashes: [], recent: [], fileLines: {}, skills: [],
  ...over,
})
