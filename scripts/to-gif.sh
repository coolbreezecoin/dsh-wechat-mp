#!/usr/bin/env bash
# Convert a screen recording into a README-sized GIF.
#
# Two passes: ffmpeg builds a palette from the whole clip first, because a GIF
# holds 256 colours and the default per-frame palette makes UI text mushy.
#
#   scripts/to-gif.sh demo.mov [out.gif] [width] [fps]
#
# Defaults suit a README: 900px wide, 12fps. Trim with START/DURATION first if
# the recording has dead air:
#   START=3 DURATION=25 scripts/to-gif.sh demo.mov

set -euo pipefail

SRC=${1:?用法: scripts/to-gif.sh <录屏文件> [输出.gif] [宽度] [fps]}
OUT=${2:-assets/demo.gif}
WIDTH=${3:-900}
FPS=${4:-12}

# Optional trimming, applied before every other filter.
# bash 3.2 (macOS 自带) 下 set -u 会把空数组展开当成未定义变量,
# 所以下面统一用 ${TRIM[@]+"${TRIM[@]}"} 这种写法。
TRIM=()
[[ -n ${START:-} ]] && TRIM+=(-ss "$START")
[[ -n ${DURATION:-} ]] && TRIM+=(-t "$DURATION")

PALETTE=$(mktemp -t dsh-gif-palette).png
FILTERS="fps=${FPS},scale=${WIDTH}:-1:flags=lanczos"

mkdir -p "$(dirname "$OUT")"

echo "→ 1/2 统计整段的配色"
ffmpeg -loglevel error -y ${TRIM[@]+"${TRIM[@]}"} -i "$SRC" \
  -vf "${FILTERS},palettegen=stats_mode=diff" "$PALETTE"

echo "→ 2/2 用该配色编码"
# bayer dithering keeps flat UI backgrounds from developing visible noise, which
# a photo-oriented dither would introduce.
ffmpeg -loglevel error -y ${TRIM[@]+"${TRIM[@]}"} -i "$SRC" -i "$PALETTE" \
  -lavfi "${FILTERS} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 "$OUT"

rm -f "$PALETTE"

SIZE=$(du -h "$OUT" | cut -f1)
DIMS=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT")
echo
echo "✅ $OUT  ($SIZE, ${DIMS//,/×}, ${FPS}fps)"
echo
# GitHub serves READMEs over a CDN but a large GIF still stalls the page on
# mobile, and npm re-hosts it as-is.
if [[ $(du -k "$OUT" | cut -f1) -gt 5120 ]]; then
  echo "⚠️  超过 5MB,README 里会加载很慢。试试降到 10fps 或 720 宽:"
  echo "   scripts/to-gif.sh $SRC $OUT 720 10"
fi
