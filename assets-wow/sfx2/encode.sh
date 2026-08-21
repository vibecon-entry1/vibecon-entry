#!/usr/bin/env bash
# Encode rendered WAV candidates into small distribution files.
# AAC-LC in .m4a: the one compressed format every browser's decodeAudioData
# accepts (Safari included — ogg/opus do not qualify). 64 kbps mono is
# transparent for these short designed sounds; container overhead is ~1KB.
# Usage: ./encode.sh [wavdir=wav] [outdir=dist]
set -euo pipefail
cd "$(dirname "$0")"
wavdir="${1:-wav}" outdir="${2:-dist}"
mkdir -p "$outdir"
for f in "$wavdir"/*.wav; do
  base="$(basename "$f" .wav)"
  ffmpeg -hide_banner -loglevel error -y -i "$f" -c:a aac -b:a 64k -movflags +faststart "$outdir/$base.m4a"
done
ls -l "$outdir" | awk '{s+=$5} END {print "total bytes:", s}'
