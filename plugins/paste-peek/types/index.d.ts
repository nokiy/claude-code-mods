/** One image pasted into the draft as [Image #n], as Claude Code saved it for this session. */
export type Shot = {
  n: number
  file: string // <tmp>/<project>/<session>/images/<n>.png, Claude Code's own
  width: number // 0 when unknown; layout only, never shown
  height: number
}

/** Where 放大 shows the picture: centered above the prompt, or in the pane on the right. */
export type ZoomSite = 'center' | 'right'

/** How an Image reaches the terminal here, as probed; none = this session draws no pixels. */
export type PixelMode = 'file' | 'png' | 'none'

declare module 'claude-code' {
  interface PluginState {
    'paste-peek': {
      shots: Shot[] // images in the current draft
      history: Shot[] // images sent, newest last
      zoom: number | null // n shown zoomed
      selected: number | null // n the keys act on; null = the newest
      zoomOpen: ZoomSite | null
      pixelMode: PixelMode | null // null = not probed yet
      probeReason: string | null // the engine's answer to the probe, for /peek why
    }
  }
}
