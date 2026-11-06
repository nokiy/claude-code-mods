#!/usr/bin/env bash
# Drives a real Claude Code session in tmux, for what `claude plugin test` cannot see: real drawing, clicks, scrolling.
#
#   scripts/e2e-session.sh start <dir> [columns] [rows]   open a session in <dir>, 120x40 by default
#   scripts/e2e-session.sh send <text>                    type the text and press Enter
#   scripts/e2e-session.sh click <x> <y>                  plain left click, 1-based cells; a press lands about a second later
#   scripts/e2e-session.sh wheel <up|down> <x> <y>        one wheel notch
#   scripts/e2e-session.sh key <key>                      one tmux key, such as C-o
#   scripts/e2e-session.sh find <text>                    print "<x> <y>" of the text's last match, for click
#   scripts/e2e-session.sh shot [file]                    print the screen, or save it
#   scripts/e2e-session.sh stop                           close the session
#
# The session loads what CLAUDE_CODE_PLUGIN_DIRS names, with the machine's own login. Its cwd decides which repository a mod reads.
# E2E_SESSION names the tmux session (default mod-e2e), so two runs can stand side by side.
set -euo pipefail

session=${E2E_SESSION:-mod-e2e}
mouse() { tmux send-keys -t "$session" -l $'\e'"[<$1;$2;$3$4"; }

case "${1:-}" in
  start)
    tmux kill-session -t "$session" 2>/dev/null || true
    tmux new-session -d -s "$session" -x "${3:-120}" -y "${4:-40}" -c "$2" claude
    sleep 12
    ;;
  send)
    tmux send-keys -t "$session" -l "$2"
    sleep 1
    tmux send-keys -t "$session" Enter
    ;;
  click)
    mouse 35 "$2" "$3" M
    sleep 0.2
    mouse 0 "$2" "$3" M
    sleep 0.05
    mouse 0 "$2" "$3" m
    ;;
  wheel)
    case "$2" in up) button=64 ;; down) button=65 ;; *) echo "wheel: up or down" >&2; exit 1 ;; esac
    mouse "$button" "$3" "$4" M
    ;;
  key) tmux send-keys -t "$session" "$2" ;;
  find)
    tmux capture-pane -t "$session" -p | NEEDLE="$2" python3 -c '
import os, sys, unicodedata
width = lambda s: sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)
hits = [(width(l[:l.index(os.environ["NEEDLE"])]) + 1, y) for y, l in enumerate(sys.stdin, 1) if os.environ["NEEDLE"] in l]
if not hits: sys.exit("find: no such text on screen")
print(*hits[-1])'
    ;;
  shot)
    if [ -n "${2:-}" ]; then tmux capture-pane -t "$session" -p >"$2"; else tmux capture-pane -t "$session" -p; fi
    ;;
  stop) tmux kill-session -t "$session" ;;
  *) sed -n '2,12p' "$0" >&2; exit 1 ;;
esac
