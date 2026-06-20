#!/bin/bash
# golden-snapshot.sh — behavior-preservation harness for the Theme engine (make-theme.cjs).
#
# Compiles EVERY themes/*.json against a fixed, bundled fixture and hashes the generated output
# (index.html + rail.html + _postfx.sh). make-theme.cjs is deterministic for fixed inputs (seeded
# mulberry32, no Date.now/Math.random in output), so a changed hash == a changed rendered frame.
#
# USE IT AROUND ANY RISKY make-theme.cjs REFACTOR to PROVE zero degrade:
#     bash scripts/golden-snapshot.sh /tmp/before          # baseline (before your change)
#     ...edit make-theme.cjs / themes/*.json ...
#     bash scripts/golden-snapshot.sh /tmp/after           # after
#     diff <(awk '{print $1,$NF}' /tmp/before/manifest.txt) \
#          <(awk '{print $1,$NF}' /tmp/after/manifest.txt)  # empty == byte-identical == 0 degrade
#
# Two fixtures because the coverage check wants the hero word placed differently per theme:
#   A = hero word SEPARATE from the body lines (what most themes expect)
#   B = hero word INSIDE the lines (lastpage / stardust / stomp / terminal)
# Each theme is compiled with whichever fixture it accepts (A first, then B), so all 38 compile.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL="$(cd "$HERE/.." && pwd)"
A="$HERE/golden/fixtureA"
B="$HERE/golden/fixtureB"
OUT="${1:?usage: golden-snapshot.sh <out-dir>}"
rm -rf "$OUT"; mkdir -p "$OUT"

compile() { # $1=project dir -> prints hash, returns nonzero on compile failure
  node "$SKILL/scripts/make-theme.cjs" "$1" >"$1/_c.log" 2>&1 || return 1
  { cat "$1/index.html" "$1/rail.html" "$1/_postfx.sh"; } 2>/dev/null | shasum -a 256 | cut -d' ' -f1
}

for t in "$SKILL"/identities/themes/*.json; do
  name=$(basename "$t" .json); d="$OUT/$name"; mkdir -p "$d"
  cp "$A/transcript.json" "$A/safe-zones.json" "$d/"
  python3 -c "import json;a=json.load(open('$A/theme.auth.json'));a['dna']='$name';json.dump(a,open('$d/theme.json','w'))"
  if h=$(compile "$d"); then echo "$name OK A $h"; continue; fi
  rm -f "$d/index.html" "$d/rail.html" "$d/_postfx.sh"
  cp "$B/transcript.json" "$B/safe-zones.json" "$d/"
  python3 -c "import json;a=json.load(open('$B/theme.auth.json'));a['dna']='$name';json.dump(a,open('$d/theme.json','w'))"
  if h=$(compile "$d"); then echo "$name OK B $h"; else echo "$name FAIL"; fi
done | sort | tee "$OUT/manifest.txt"
