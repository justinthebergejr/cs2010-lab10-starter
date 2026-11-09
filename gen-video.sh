#!/usr/bin/env bash
# Generate a short video clip to go with the song, using minimax/hailuo-3-max.
#
#   ./gen-video.sh                     -> output/video.mp4 (5s, 768p, 16:9)
#   DURATION=8 ./gen-video.sh          -> an 8-second clip
#   NAME=clip ./gen-video.sh           -> output/clip.mp4
#   FRAME_IMAGE= ./gen-video.sh        disable the first-frame image below
#
# If output/illustration.(png|jpg|jpeg|webp) exists (see gen-illustration.sh),
# it is sent as the first frame so the clip picks up where the cover art
# leaves off. Set FRAME_IMAGE to another path to use a different image, or to
# an empty string to generate from the text prompt alone.
#
# Video generation is asynchronous: this script submits the job, polls it
# until it finishes, then downloads the finished clip. Every HTTP response
# body is written straight to a file by curl (-o) and is never parsed on the
# way in; jq reads it back out of that saved file afterwards.
#
# Layout:
#   tmp/     request body, raw submit/poll responses
#   output/  the finished .mp4

set -uo pipefail

cd "$(dirname "$0")" || exit 1

if [ -f openrouter.env ]; then
  # shellcheck disable=SC1091
  . ./openrouter.env
fi
: "${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is not set (source openrouter.env)}"

MODEL="${MODEL:-minimax/hailuo-3-max}"
NAME="${NAME:-video}"
DURATION="${DURATION:-5}"
RESOLUTION="${RESOLUTION:-768p}"
ASPECT_RATIO="${ASPECT_RATIO:-16:9}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
POLL_TIMEOUT="${POLL_TIMEOUT:-600}"

TMP=tmp
OUTDIR=output
REQ="$TMP/$NAME-request.json"
SUBMIT_RAW="$TMP/$NAME-submit.json"
POLL_RAW="$TMP/$NAME-poll.json"
MP4="$OUTDIR/$NAME.mp4"

# Matches the "$20 Under the Tree (Santa's AI Slop Surprise)" song and the
# gen-illustration.sh cover art: Santa's workshop, run by Italian brainrot
# characters, with Tung Tung Tung Sahur taking center stage.
PROMPT="${1:-$(cat <<'EOF'
Cinematic 3D-animated Christmas short, exactly 5 seconds. Inside Santa's
reimagined North Pole workshop, warm golden light and falling snow outside
frosted windows. Santa Claus leans back in his chair, grinning, and slides a
glowing holographic card reading "$20 GIFT CARD" across a workbench toward
the camera. Behind him, a chaotic lineup of absurd Italian "brainrot"
creatures -- a jacketed crocodile, an espresso-cup ballerina, a sandaled
shark -- are wrapping presents and hammering tiny circuit boards instead of
toys. The camera pushes in past them to Tung Tung Tung Sahur, a carved
wooden-log figure with a drum for a belly, who steps into a dramatic
spotlight and slams his drumsticks down on the beat as confetti and sleigh
bells burst into the air. Rich reds and forest greens, polished Pixar-style
rendering, dramatic rim lighting, playful and theatrical mood, fluid
character motion, no dialogue, no subtitles, no logos, no watermark.
EOF
)}"

mkdir -p "$TMP" "$OUTDIR"

# Auto-detect the illustration as a first frame unless FRAME_IMAGE is set
# (including set to "" to disable it) in the environment.
FRAME_IMAGE="${FRAME_IMAGE-__AUTO__}"
if [ "$FRAME_IMAGE" = "__AUTO__" ]; then
  FRAME_IMAGE=""
  for ext in png jpg jpeg webp; do
    if [ -f "$OUTDIR/illustration.$ext" ]; then
      FRAME_IMAGE="$OUTDIR/illustration.$ext"
      break
    fi
  done
fi

if [ -n "$FRAME_IMAGE" ]; then
  if [ ! -f "$FRAME_IMAGE" ]; then
    echo "frame image not found: $FRAME_IMAGE" >&2
    exit 1
  fi

  ext_lower=$(echo "${FRAME_IMAGE##*.}" | tr 'A-Z' 'a-z')
  case "$ext_lower" in
    png) mime=image/png ;;
    jpg | jpeg) mime=image/jpeg ;;
    webp) mime=image/webp ;;
    gif) mime=image/gif ;;
    *)
      echo "unsupported frame image type: $FRAME_IMAGE" >&2
      exit 1
      ;;
  esac

  FRAME_B64="$TMP/$NAME-frame.b64"
  base64 -w0 "$FRAME_IMAGE" > "$FRAME_B64" || {
    echo "could not encode frame image: $FRAME_IMAGE" >&2
    exit 1
  }

  jq -n \
    --arg model "$MODEL" \
    --arg prompt "$PROMPT" \
    --argjson duration "$DURATION" \
    --arg resolution "$RESOLUTION" \
    --arg aspect_ratio "$ASPECT_RATIO" \
    --arg mime "$mime" \
    --rawfile frame_b64 "$FRAME_B64" \
    '{
       model: $model,
       prompt: $prompt,
       duration: $duration,
       resolution: $resolution,
       aspect_ratio: $aspect_ratio,
       frame_images: [{ type: "image_url", image_url: { url: ("data:" + $mime + ";base64," + $frame_b64) }, frame_type: "first_frame" }]
     }' > "$REQ" || { echo "failed to build $REQ" >&2; exit 1; }
else
  jq -n \
    --arg model "$MODEL" \
    --arg prompt "$PROMPT" \
    --argjson duration "$DURATION" \
    --arg resolution "$RESOLUTION" \
    --arg aspect_ratio "$ASPECT_RATIO" \
    '{
       model: $model,
       prompt: $prompt,
       duration: $duration,
       resolution: $resolution,
       aspect_ratio: $aspect_ratio
     }' > "$REQ" || { echo "failed to build $REQ" >&2; exit 1; }
fi

echo "model      : $MODEL"
echo "duration   : ${DURATION}s"
echo "aspect     : $ASPECT_RATIO @ $RESOLUTION"
echo "frame image: ${FRAME_IMAGE:-(none, text-to-video)}"
echo "request    : $REQ"
echo "POST https://openrouter.ai/api/v1/videos"
echo

# -o writes the raw response body to $SUBMIT_RAW. Nothing touches it on the
# way. -w's output goes to stdout, so it is captured here rather than mixed
# into the body.
stats=$(curl -sS --max-time 60 \
  -o "$SUBMIT_RAW" \
  -w '%{http_code} %{size_download} %{time_total}' \
  -X POST https://openrouter.ai/api/v1/videos \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary "@$REQ")
rc=$?

read -r status bytes secs <<<"$stats"
echo "curl exit  : $rc"
echo "HTTP       : ${status:-?}  ${bytes:-0} bytes  ${secs:-?}s"
echo "body       : $SUBMIT_RAW ($(wc -c < "$SUBMIT_RAW" 2>/dev/null || echo 0) bytes)"

if [ "$rc" -ne 0 ] || { [ "${status:-}" != "200" ] && [ "${status:-}" != "202" ]; }; then
  echo >&2
  echo "submit failed; raw body left in $SUBMIT_RAW" >&2
  if [ "$(wc -c < "$SUBMIT_RAW" 2>/dev/null || echo 0)" -lt 2000 ]; then
    echo >&2
    cat "$SUBMIT_RAW" >&2
    echo >&2
  fi
  exit 1
fi

job_id=$(jq -r '.id // empty' "$SUBMIT_RAW")
polling_path=$(jq -r '.polling_url // empty' "$SUBMIT_RAW")

if [ -z "$job_id" ]; then
  echo "no job id in response; raw body left in $SUBMIT_RAW" >&2
  exit 1
fi

case "$polling_path" in
  http*) poll_url="$polling_path" ;;
  "") poll_url="https://openrouter.ai/api/v1/videos/$job_id" ;;
  *) poll_url="https://openrouter.ai${polling_path}" ;;
esac

echo
echo "job id     : $job_id"
echo "polling    : $poll_url"
echo

elapsed=0
job_status="pending"
while :; do
  curl -sS --max-time 60 \
    -o "$POLL_RAW" \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" \
    "$poll_url"

  job_status=$(jq -r '.status // "unknown"' "$POLL_RAW")
  echo "  [${elapsed}s] status: $job_status"

  case "$job_status" in
    completed)
      break
      ;;
    failed | cancelled | expired)
      echo >&2
      echo "job ended with status: $job_status" >&2
      jq -r '.error // "no error message provided"' "$POLL_RAW" >&2
      exit 1
      ;;
  esac

  if [ "$elapsed" -ge "$POLL_TIMEOUT" ]; then
    echo >&2
    echo "timed out after ${POLL_TIMEOUT}s waiting for job $job_id" >&2
    exit 1
  fi

  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
done

content_url="https://openrouter.ai/api/v1/videos/$job_id/content"
echo
echo "downloading -> $MP4"

stats=$(curl -sS --max-time 300 \
  -o "$MP4" \
  -w '%{http_code} %{size_download} %{time_total}' \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  "$content_url")
rc=$?

read -r status bytes secs <<<"$stats"
echo "curl exit  : $rc"
echo "HTTP       : ${status:-?}  ${bytes:-0} bytes  ${secs:-?}s"

if [ "$rc" -ne 0 ] || [ "${status:-}" != "200" ]; then
  echo "download failed" >&2
  rm -f "$MP4"
  exit 1
fi

cost=$(jq -r '.usage.cost // empty' "$POLL_RAW")
echo
echo "video      : $MP4 ($(wc -c < "$MP4") bytes)"
[ -n "$cost" ] && printf 'cost       : \$%s\n' "$cost"
file -b "$MP4" | sed 's/^/details    : /'
