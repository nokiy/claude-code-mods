// State contract of pr-hint: the PR snapshot the hint line and hover card draw from.

export type PrCi = { ok: number; fail: number; pending: number; total: number };

/** Acceptance-table progress of one ticket body; null when the body has no table. */
export type PrProgress = { done: number; total: number; maxRounds: number };

/** todo not started · doing in progress · merged into the PR head · done (issue closed or table all ✓) */
export type TicketStatus = 'todo' | 'doing' | 'merged' | 'done';

export type PrTicket = {
  number: number;
  title: string;
  state: string;
  progress: PrProgress | null;
  status: TicketStatus;
  /** The ticket's branch shown on the card (the one furthest ahead, else the first local one). */
  branch: string | null;
  /** Commits that branch has beyond the PR head. */
  ahead: number;
};

/** Where the session stands: its directory, the repository root above it, and the checked-out branch (`HEAD` when detached). */
export type Where = { cwd: string; root: string; branch: string };

export type PrData = {
  /** Where the PR was read; drawn only while the session is still in that repository root (any subfolder) on that branch. */
  where: Where;
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  base: string;
  head: string;
  url: string;
  /** When pr-hint last read this PR from gh (ms, the engine clock); bumped by each gh fetch, kept by the git recompute. */
  fetchedAt: number;
  ci: PrCi;
  tickets: PrTicket[];
  /** The closing issue labelled `spec`; kept out of tickets and every count. */
  spec: { number: number; title: string } | null;
};

/**
 * One PR's subagent totals as agent-monitor publishes them (docs/adr/0001-cross-mod-state.md).
 * A mirror of `PrStat` in plugins/agent-monitor/types/index.d.ts, which is canonical: keep the two identical.
 */
export type PrStat = { tokens: number; cost: number; ms: number; refusals: number };

declare module 'claude-code' {
  interface PluginState {
    /**
     * agent-monitor's published value, read only (its owner alone writes it). pr-hint lists no `dependencies`, so
     * agent-monitor's own contract is not laid here; this mirrors the one key pr-hint reads. Absent = never written.
     */
    'agent-monitor': {
      /** Subagent totals per PR, keyed by the PR number as a string. */
      prStats: Record<string, PrStat>;
    };
    'pr-hint': {
      /** Kept under a shape tag (see register.tsx); bump the tag when PrData changes. */
      pr: Shaped<PrData | null>;
      /** The card is pinned open by a press on the hint row's pin. */
      pinned: boolean;
      /** A manual ↻ refresh is running. */
      refreshing: boolean;
    };
  }
}
