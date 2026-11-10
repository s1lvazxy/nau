#!/bin/sh
# Rebuilds the launch images and videos from the running app. Needs: `pnpm dev` on :3100, Playwright with Chromium, ffmpeg, Python with Pillow.
# Intermediates go to src/build (ignored); the finished files land next to the README.
set -e
cd "$(dirname "$0")" && mkdir -p build/outro && cd build

# 1 · The glass mark, rendered from the site's own shader (src/components/landing/rose/rose.wgsl)
node ../rose.cjs ../jobs-final.json
node ../rose.cjs ../jobs-outro.json

# 2 · The Operator panel, from the live demo
node ../shots.cjs
python3 -c "from PIL import Image; Image.open('s-op2.png').crop((2068, 792, 2864, 1448)).save('ui-operator.png')"

# 3 · The four images
node ../shoot.cjs
i=0; for n in 01-hook 02-problem 03-operator 04-open-source; do i=$((i+1)); python3 -c "from PIL import Image; Image.open('c$i.png').convert('RGB').save('../../$n.jpg', quality=94, subsampling=0, optimize=True)"; done

# 4 · The three demo videos, each ending on the animated mark
node ../outro-shot.cjs
ffmpeg -y -loglevel error -framerate 30 -i outro/r%03d.png -i outro/text.png -filter_complex "[0][1]overlay,format=yuv420p" -c:v libx264 -crf 16 -preset slow clips-outro.mp4
for n in 1 2 3; do node ../clip$n.cjs; done
for n in 01-dashboard 02-operator 03-approvals; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 clips/$n.mp4)
  off=$(python3 -c "print(round($d - 0.6, 3))")
  ffmpeg -y -loglevel error -i clips/$n.mp4 -i clips-outro.mp4 -filter_complex "[0:v]fps=30,settb=AVTB,fade=t=in:st=0:d=0.35[a];[1:v]fps=30,settb=AVTB[b];[a][b]xfade=transition=fade:duration=0.6:offset=$off,format=yuv420p[v]" -map "[v]" -c:v libx264 -profile:v high -crf 18 -preset slow -movflags +faststart -r 30 ../../nau-$n.mp4
done
echo done
