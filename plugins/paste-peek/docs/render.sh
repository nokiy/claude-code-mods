#!/bin/sh
# Re-render the README images and the demo video from banner.html / scene.html (headless Chrome + ffmpeg).
# Illustrations of paste-peek, not screenshots.
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --screenshot="$1" --window-size="$2" --force-device-scale-factor="$3" "file://$PWD/$4" >/dev/null 2>&1; }

shot banner.png 1280,720 2 banner.html
shot zoom-center.png 1280,632 2 "scene.html#state=center&caption=0"
shot side-pane.png 1280,632 2 "scene.html#state=side&caption=0"

FRAMES=$(mktemp -d)
i=0
for s in type paste1 paste2 switch center side sent end; do
  i=$((i + 1)); shot "$FRAMES/$i.png" 1280,720 1.5 "scene.html#state=$s"
done
# Each scene's seconds; scenes cross-fade over 0.35 s.
ffmpeg -y -loglevel error \
  -loop 1 -t 1.6 -i "$FRAMES/1.png" -loop 1 -t 1.8 -i "$FRAMES/2.png" -loop 1 -t 1.8 -i "$FRAMES/3.png" -loop 1 -t 1.8 -i "$FRAMES/4.png" \
  -loop 1 -t 2.2 -i "$FRAMES/5.png" -loop 1 -t 2.2 -i "$FRAMES/6.png" -loop 1 -t 1.8 -i "$FRAMES/7.png" -loop 1 -t 2.6 -i "$FRAMES/8.png" \
  -filter_complex "[0:v][1:v]xfade=transition=fade:duration=0.35:offset=1.25[v1];[v1][2:v]xfade=transition=fade:duration=0.35:offset=2.70[v2];[v2][3:v]xfade=transition=fade:duration=0.35:offset=4.15[v3];[v3][4:v]xfade=transition=fade:duration=0.35:offset=5.60[v4];[v4][5:v]xfade=transition=fade:duration=0.35:offset=7.45[v5];[v5][6:v]xfade=transition=fade:duration=0.35:offset=9.30[v6];[v6][7:v]xfade=transition=fade:duration=0.35:offset=10.75[v7];[v7]format=yuv420p,fps=30[out]" \
  -map "[out]" -c:v libx264 -crf 20 -preset slow -movflags +faststart demo.mp4
ffmpeg -y -loglevel error -i demo.mp4 \
  -vf "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" demo.gif
rm -rf "$FRAMES"
