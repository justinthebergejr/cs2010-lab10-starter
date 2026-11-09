#!/usr/bin/env bash
# Ask a chat model for song lyrics + a music description, save the text.
#
#   ./gen-lyrics.sh             -> output/lyrics.txt
#   NAME=noel ./gen-lyrics.sh   -> output/noel.txt
#
# Layout:
#   tmp/     request body, raw JSON response
#   output/  the extracted lyrics
#
# The raw response is written straight to a file by curl (-o) and is not parsed
# on the way in; jq reads it back out of that saved file afterwards.

set -uo pipefail

cd "$(dirname "$0")" || exit 1

if [ -f openrouter.env ]; then
  # shellcheck disable=SC1091
  . ./openrouter.env
fi
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is not set (source openrouter.env)}"

MODEL="${MODEL:-qwen/qwen3.8-flash}"
NAME="${NAME:-lyrics}"

TMP=tmp
OUTDIR=output
REQ="$TMP/$NAME-request.json"
RAW="$TMP/$NAME-response.json"
TXT="$OUTDIR/$NAME.txt"

PROMPT='I want song lyrics and music description for a christmas song. The song is about Santa Claus realized that the kids just straight up suck and are addicted to ai slop. he decided this christmas, kids will get $20 worth of OpenAI ChatGPT credit. He then replaces the elves with italian brainrots, such as Tralalero Tralala, Bombardino Crocodilo, Tung Tung Tung Sahur, Ballerina Cappuccina, La Vaca Saturno Saturnita, Chimpanzini Bananini, Cappuccino Assassino, Bobritto Bandito, Lirilì Larilà. Make sure Tung Tung Tung Sahur is the most important out of all of them. This should be a typical length christmas song, with a chorus and two or three verses.'

mkdir -p "$TMP" "$OUTDIR"

# Build the request body. jq -n --arg handles all the quoting for us.
jq -n \
  --arg model "$MODEL" \
  --arg prompt "$PROMPT" \
  '{
     model: $model,
     messages: [{ role: "user", content: $prompt }],
     reasoning: { enabled: true }
   }' > "$REQ" || { echo "failed to build $REQ" >&2; exit 1; }

echo "model      : $MODEL"
echo "request    : $REQ"
echo "POST https://openrouter.ai/api/v1/chat/completions"
echo

# -o writes the raw response body to $RAW. -w's output goes to stdout, so the
# status is captured here rather than mixed into the body.
stats=$(curl -sS --max-time 300 \
  -o "$RAW" \
  -w '%{http_code} %{size_download} %{time_total}' \
  -X POST https://openrouter.ai/api/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  --data-binary "@$REQ")
rc=$?

read -r status bytes secs <<<"$stats"
echo "curl exit  : $rc"
echo "HTTP       : ${status:-?}  ${bytes:-0} bytes  ${secs:-?}s"
echo "body       : $RAW"

if [ "$rc" -ne 0 ] || [ "${status:-}" != "200" ]; then
  echo >&2
  echo "request failed; raw body left in $RAW" >&2
  cat "$RAW" >&2
  echo >&2
  exit 1
fi

jq -r '.choices[0].message.content' "$RAW" > "$TXT" || exit 1

echo
echo "lyrics     : $TXT ($(wc -l < "$TXT") lines, $(wc -c < "$TXT") bytes)"
echo
cat "$TXT"
