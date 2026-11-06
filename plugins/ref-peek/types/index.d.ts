// State contract of ref-peek: what the drawings read. Cached content itself lives in `$.store`.

/** One PR or issue of one repository. */
export type PeekRef = { repo: string; number: number };

/** The session directory and the GitHub repository of its `origin` (null: none). */
export type OriginRepo = { cwd: string; repo: string | null };

/** An open bubble. Where it stands and what it shows part ways once a related row is pressed. */
export type PeekState = { requestId: string; href: string; shown: PeekRef };

declare module 'claude-code' {
  interface PluginState {
    'ref-peek': {
      /** Bumped by every finished fetch, so whatever drew from the cache draws again. */
      revision: number;
      /** The open bubble: it stands at the link `href` of block `requestId` and shows `shown`. */
      peek: PeekState | null;
      /** The repository this session last worked on, seen in its Bash calls. */
      lastRepo: string | null;
      /** The session directory's own repository. */
      originRepo: OriginRepo | null;
      /** The repository a transcript block settled on when first drawn, so a later move elsewhere leaves it alone. */
      blockRepo: StateFamily<string | null>;
    };
  }
}
