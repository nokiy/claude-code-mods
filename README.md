# claude-code-mods

Claude Code mods by [nokiy](https://github.com/nokiy). A mod is a Claude Code plugin whose hooks run inside your session and can draw their own UI.

| Mod | What it does |
| --- | --- |
| [paste-peek](plugins/paste-peek) | See the images you paste into the prompt, in real pixels, right above it. Switch with ⌥←/⌥→, zoom with ⌥↑, side pane with ⌥↓. |

## Install

In Claude Code (2.1.287 or later):

```
/plugin marketplace add nokiy/claude-code-mods
/plugin install paste-peek@nokiy-mods
```

The first command adds this repository as a plugin marketplace (once); the second installs a mod from it. Start a new session afterwards.

## License

MIT
