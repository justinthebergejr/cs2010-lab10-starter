# Lab 10 - APIs and Media Generation

**Cleanup**

- Log out of github: `gh auth logout`
- If you used OpenCode, delete the provider: `/connect`, select provider, ctrl+d
- If you have a key in an env var, close the terminal window.
- If you wrote a key to an env file, remove it: `rm openrouter.env`

**Setup**

- Important: Do not commit API keys to your repo on github.
- Log in to github: `gh auth login`
- Create a project directory to work in, either with `mkdir` or in the GUI file
  manager. Work in that directory (either `cd` or in the GUI file manager do
  "Open Terminal Here")
- Make sure some basic tools are installed: `sudo apt install kate jq
python-is-python3`
- Make sure Mise is installed: <https://mise.jdx.dev/>
- Generate an OpenRouter key, limited to 1 day and 2 dollars, and save it here
in a file called `openrouter.env`  containing
`export OPENROUTER_API_KEY=sk-your-key...`

## Part 1: Christmas Song (no OpenCode)

- Start with the provided scripts and generate a Christmas song. Come up with
a better prompt
- Use Qwen-Image 2.1 Turbo to generate an illustration for your song.
- Using the API docs on OpenRouter generate a 5 second video clip to go
with your song (maybe wth hailuo-3-max)

## Part 2: Weather App (with OpenCode)

- Set up OpenCode
- Feed today's lecture notes into it: <https://homework.quest/classes/2026-09/cs2010/notes/11-09-introducing-apis/>
- Generate a express-vite / React app that does the thing:
  - Pulls the current weather.
  - Changes the image to match the time of day, time of year, and forecaseted
  weather

## Submit to Inkfish

- This git repo.
- Including your song mp3, your video mp4, your lyrics, and your app.

**Some Model Links**

- <https://openrouter.ai/qwen/qwen-image-2.1-turbo>
- <https://openrouter.ai/heygen/heygen-video-1>
- <https://openrouter.ai/minimax/hailuo-3-max>

---

## Weather App: how it works

Plymouth, NH (ZIP 03264, 43.7589° N / 71.6892° W) weather turned into an
AI-reimagined postcard. Express backend + Vite/React frontend.

### Architecture

1. **Weather** — `server/weather.ts` calls the NWS API
   (`/points` → hourly + daily forecast for the `GYX/24,54` grid point),
   normalizes it, and computes local time, time-of-day (dawn/morning/
   golden hour/night, via `suncalc`), and season. Cached for 10 minutes.
2. **Art direction** — `server/imageGen.ts` sends the reference photo
   (`public/panther-snow.jpg`) plus a compact weather brief to a multimodal
   LLM (`google/gemini-3.5-flash-lite`) and asks for a JSON image-editing
   prompt that keeps the panther statue, pose, and framing but changes sky,
   light, ground cover, foliage, and precipitation to match the report. If
   that call fails, a deterministic fallback prompt is used instead.
3. **Image-to-image** — that prompt plus the reference photo go to
   `qwen/qwen-image-2.1-turbo` via `POST /api/v1/images` with
   `input_references`. The result is cached to disk under
   `output/weather/<signature>.png` + `.json`, keyed by a signature of the
   date, time-of-day bucket, season, rounded temperature, and forecast — so
   repeat loads are instant and don't re-spend money.
4. **Frontend** — shows live weather immediately, auto-generates an image on
   first load if none is cached for the current signature, shows a progress
   overlay (~20s), and offers "Regenerate" / "Update image for this weather"
   once weather drifts from the cached signature. A "How this image was
   made" panel shows the exact prompt, weather context, models, cost, and
   timing.

### Run it

```bash
mise use -g node@24      # first time only
npm install               # first time only
npm run dev                # http://localhost:5173 (Vite, proxies /api to :3000)
```

Or production mode:

```bash
npm run build
npm start                  # http://localhost:3000
```

The server loads `openrouter.env` automatically. Without
`OPENROUTER_API_KEY` set, weather still works; the image panel explains how
to enable generation. One generation costs roughly $0.02 and takes about
15-20 seconds (prompt model + Qwen Image 2.1 Turbo).

## Part 1 generated deliverables

- `output/lyrics.txt` — song prompt, music direction, and lyrics.
- `output/song.mp3` — generated Christmas song.
- `output/illustration.png` — Qwen Image 2.1 Turbo cover illustration.
- `output/video.mp4` — 5-second Hailuo 3 Max clip, guided by the illustration.

To reproduce the image and video (requires `OPENROUTER_API_KEY` in
`openrouter.env`):

```bash
./gen-illustration.sh
./gen-video.sh
```

The video script submits the job, polls until completion, then downloads the
MP4. By default it uses `output/illustration.png` as its first frame. The
required media files above are explicitly unignored by `.gitignore` so they
are included in the repository submission; intermediate API responses and
weather-image cache files remain ignored.
