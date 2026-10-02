# claude-code-mods

![paste-peek demo: paste screenshots, switch between them, zoom one, open it in the side pane](plugins/paste-peek/docs/demo.gif)

| Mod | What it does |
| --- | --- |
| [paste-peek](plugins/paste-peek) | See the images you paste into the prompt, in real pixels, right above it. Switch with ⌥←/⌥→, zoom with ⌥↑, side pane with ⌥↓. **Terminal: Ghostty or kitty** (macOS). |

### Zoom — ⌥↑

Pick an image with ⌥← / ⌥→, then press **⌥↑**: it opens centered above the prompt, as large as that area allows (about half the screen in the fullscreen layout). Press ⌥↑ again to close.

![Zoom: the selected image centered above the prompt](plugins/paste-peek/docs/zoom-center.png)

### Side pane — ⌥↓

Press **⌥↓** to open the selected image in a pane that fills the screen's height, docked on the right in the fullscreen layout; the thumbnails stay above the prompt and ⌥← / ⌥→ still switch. Press ⌥↓ again to close.

![Side pane: the selected image large on the right](plugins/paste-peek/docs/side-pane.png)

## Install

In Claude Code (2.1.287 or later):

```
/plugin marketplace add nokiy/claude-code-mods
/plugin install paste-peek@nokiy-mods
```

The first command adds this repository as a plugin marketplace (once); the second installs a mod from it. Start a new session afterwards.

## License

MIT
