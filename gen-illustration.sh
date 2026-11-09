#!/usr/bin/env bash
# Generate a cover illustration for the song with qwen/qwen-image-2.1-turbo.
#
#   ./gen-illustration.sh                      -> output/illustration.png
#   NAME=cover ./gen-illustration.sh            -> output/cover.png
#   ./gen-illustration.sh "some other prompt"   explicit prompt, overrides the default
#   ASPECT_RATIO=16:9 RESOLUTION=1K ./gen-illustration.sh
#
# Layout:
#   tmp/     request body, raw JSON response
#   output/  the finished image
#
# The full HTTP response body is written straight to a file by curl (-o) and is
# never parsed on the way in. Decoding (base64 -> bytes) happens afterwards, as
# a separate step, from that saved file.

set -uo pipefail

cd "$(dirname "$0")" || exit 1

if [ -f openrouter.env ]; then
  # shellcheck disable=SC1091
  . ./openrouter.env
fi
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is not set (source openrouter.env)}"

MODEL="${MODEL:-qwen/qwen-image-2.1-turbo}"
NAME="${NAME:-illustration}"
ASPECT_RATIO="${ASPECT_RATIO:-1:1}"
RESOLUTION="${RESOLUTION:-2K}"

TMP=tmp
OUTDIR=output
REQ="$TMP/$NAME-request.json"
RAW="$TMP/$NAME-response.json"

# Matches the "$20 Under the Tree (Santa's AI Slop Surprise)" song: Santa has
# swapped the elves for Italian brainrot characters, and Tung Tung Tung Sahur
# runs the workshop.
PROMPT="${1:-$(cat <<'EOF'
Whimsical 3D-animated Christmas album cover illustration. Santa Claus sits at
a glowing control desk deep inside a reimagined North Pole workshop, wearing
half-moon glasses and a knowing smirk, one hand holding a candy cane like a
stylus over a holographic screen that reads "$20 GIFT CARD" in warm pixel
text. Behind him, the elf workbenches have been taken over by a chaotic
lineup of absurd Italian "brainrot" creatures -- a crocodile in a bomber
jacket, a ballerina with an espresso-cup head, a sandaled shark -- wrapping
presents and hammering tiny glowing circuit boards instead of toys. Front and
center, towering slightly over the rest on a drum-shaped pedestal, stands
Tung Tung Tung Sahur: a carved wooden-log figure with a drum for a belly,
mid-beat, sticks raised, lit by a dramatic spotlight as confetti and sleigh
bells swirl around him. Snow falls softly outside tall frosted windows, fairy
lights and tinsel frame the scene, warm golden candlelight mixes with cool
blue moonlight. Rich reds and forest greens, polished Pixar-style rendering,
dramatic rim lighting, playful and theatrical mood, no readable text other
than the gift card screen, no watermark, no logos.
EOF
)}"

mkdir -p "$TMP" "$OUTDIR"

jq -n \
  --arg model "$MODEL" \
  --arg prompt "$PROMPT" \
  --arg aspect_ratio "$ASPECT_RATIO" \
  --arg resolution "$RESOLUTION" \
  '{
     model: $model,
     prompt: $prompt,
     n: 1,
     aspect_ratio: $aspect_ratio,
     resolution: $resolution
   }' > "$REQ" || { echo "failed to build $REQ" >&2; exit 1; }

echo "model      : $MODEL"
echo "aspect     : $ASPECT_RATIO @ $RESOLUTION"
echo "request    : $REQ"
echo "POST https://openrouter.ai/api/v1/images"
echo

# -o writes the raw response body to $RAW. Nothing touches it on the way.
# -w's output goes to stdout, so it is captured here rather than in the body.
stats=$(curl -sS --max-time 120 \
  -o "$RAW" \
  -w '%{http_code} %{size_download} %{time_total}' \
  -X POST https://openrouter.ai/api/v1/images \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary "@$REQ")
rc=$?

read -r status bytes secs <<<"$stats"
echo "curl exit  : $rc"
echo "HTTP       : ${status:-?}  ${bytes:-0} bytes  ${secs:-?}s"
echo "body       : $RAW ($(wc -c < "$RAW" 2>/dev/null || echo 0) bytes)"

if [ "$rc" -ne 0 ] || [ "${status:-}" != "200" ]; then
  echo >&2
  echo "request failed; raw body left in $RAW" >&2
  # Errors are small, so showing one is safe. Never echo an image-sized body.
  if [ "$(wc -c < "$RAW" 2>/dev/null || echo 0)" -lt 2000 ]; then
    echo >&2
    cat "$RAW" >&2
    echo >&2
  fi
  exit 1
fi

b64=$(jq -r '.data[0].b64_json // empty' "$RAW")
if [ -z "$b64" ]; then
  echo "no image data in $RAW" >&2
  exit 1
fi

media_type=$(jq -r '.data[0].media_type // "image/png"' "$RAW")
case "$media_type" in
  */jpeg) ext=jpg ;;
  */webp) ext=webp ;;
  *) ext=png ;;
esac
IMG="$OUTDIR/$NAME.$ext"

echo "$b64" | base64 -d > "$IMG" || exit 1

cost=$(jq -r '.usage.cost // empty' "$RAW")
echo
echo "image      : $IMG ($(wc -c < "$IMG") bytes)"
[ -n "$cost" ] && printf 'cost       : \$%s\n' "$cost"
file -b "$IMG" | sed 's/^/details    : /'
