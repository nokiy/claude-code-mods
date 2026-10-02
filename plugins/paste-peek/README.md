# paste-peek

See the images you paste into Claude Code, in real pixels, right above the prompt — before you send them.

[中文说明](README.zh-CN.md)

```
 ┌────────────┐  ┌────────────┐
 │  picture   │  │  picture   │      ← every image pasted into this prompt
 └────────────┘  └────────────┘
 [Image #1] 1304×400 · 76 KB   [Image #2] 926×864 · 113 KB   ← the selected one is highlighted
 ⌥↑ Zoom   ⌥↓ Side pane   ⌥← ⌥→ Switch
 > what is wrong in these two screenshots? [Image #1] [Image #2]
```

<!-- Screenshots: docs/01-paste.png, 02-switch.png, 03-zoom.png, 04-side-pane.png (coming) -->

## What it does

- **Paste an image** (ctrl+v) and a thumbnail appears above the prompt of *that* session within a second. Copying alone shows nothing, and other sessions stay quiet.
- **Several images** sit side by side; the selected one's caption is highlighted.
- **Zoom** the selected image centered above the prompt, or open it in a **side pane** that fills the screen's height (docked on the right in the fullscreen layout).
- **Send** the prompt and the previews clear.

## Keys

| Key | Does |
| --- | --- |
| **⌥←  ⌥→** | Select the previous / next image (two or more images) |
| **⌥↑** | Zoom the selected image, centered above the prompt; again to close |
| **⌥↓** | Open the selected image in the side pane; again to close |
| ⌥→ (one image) | Same as ⌥↓ |

While zoomed, ⌥← / ⌥→ switch the zoomed image. With no picture in the draft, every key keeps its usual meaning (⌥← / ⌥→ jump by word).

## Requirements

- **Claude Code 2.1.287 or later** (mods).
- **macOS**: the clipboard is read through `osascript`.
- **Ghostty or kitty, in a foreground session.** Pictures use the kitty graphics protocol. Other terminals, and background sessions (`claude --bg`), draw nothing; the mod checks once per session and stays silent there.
- `python3` (optional) to measure the terminal's cell shape for exact proportions; without it cells are taken as twice as tall as wide.

## Limitations

- The centered zoom is as large as the area above the prompt allows — about half the screen in the fullscreen layout. For a bigger view use the side pane (⌥↓).
- ⌥↑ / ⌥↓ borrow the diff panel's "previous / next file" chords; while the diff panel is open they belong to it.
- Right after a paste, the cursor sits at the end of the prompt, where ⌥→ is not reported to mods; press ⌥← once first. The mod then parks the cursor before one trailing space so both directions work.
- An image is matched to `[Image #N]` by reading the clipboard when the placeholder appears, so it should be pasted from the clipboard (not dragged in as a file).

## Settings (`/config`)

| Setting | Default | |
| --- | --- | --- |
| Language | `auto` | `auto` follows Claude Code's `language` setting, then the locale; `en`, `zh` |
| Debug log | off | Writes what the mod sees (pastes, the pixel check, sizes) to `/tmp/paste-peek/debug.log` |

Commands: `/peek` opens the pane · `/peek why` says whether this session can draw pictures · `/peek log` (debug log on) · `/peek clear`.

## Privacy

Nothing leaves your Mac. The mod makes no network requests and uses no model tokens.

| Program | When | Why |
| --- | --- | --- |
| `osascript` (JavaScript) | when a new `[Image #N]` appears in the prompt | reads the clipboard image and saves it as a PNG in the session's temp folder; text on the clipboard is never read |
| `sips` | only if the terminal cannot read files | scales the PNG to send it as bytes |
| `python3` | when the terminal width changes | asks the terminal for its pixel size (cell shape) |
| `sh` / `mkdir` / `base64` | at session start | writes a 1×1 PNG used to check whether pictures can be drawn |
| `rm` | at session end | deletes the session's temp folder `/tmp/paste-peek/<session id>/` |
| `tail` / `sh` | only with Debug log on | reads / appends `/tmp/paste-peek/debug.log` |

The prompt draft is read only to find `[Image #N]` placeholders; it is not stored.

## Install

```
/plugin marketplace add nokiy/claude-code-mods
/plugin install paste-peek@nokiy-mods
```

Or try it from a clone: `claude --plugin-dir ./plugins/paste-peek`.

## Develop

```
claude plugin validate ./plugins/paste-peek
claude plugin test ./plugins/paste-peek
```

## Credits

The cell-shape measurement follows [hedingerm/image-preview](https://github.com/hedingerm/image-preview) (MIT), which follows Grok Build.

## License

MIT
