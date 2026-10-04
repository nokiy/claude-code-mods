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

export type PrData = {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  base: string;
  head: string;
  url: string;
  updatedAt: string;
  ci: PrCi;
  tickets: PrTicket[];
  /** The closing issue labelled `spec`; kept out of tickets and every count. */
  spec: { number: number; title: string } | null;
};

declare module 'claude-code' {
  interface PluginState {
    'pr-hint': { pr: PrData | null };
  }
}
