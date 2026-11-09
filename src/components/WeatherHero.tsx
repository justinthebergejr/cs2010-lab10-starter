import { useEffect, useState } from "react";
import type { ImageStage, ImageState, Weather } from "../../shared/types";

interface WeatherHeroProps {
  weather: Weather;
  image: ImageState | null;
  stale: boolean;
  imageError: string | null;
  showReference: boolean;
  onToggleReference: () => void;
  onGenerate: (force: boolean) => void;
}

function formatTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatTemp(value: number | null): string {
  return value == null ? "—" : `${value}°`;
}

function stageLabel(stage?: ImageStage): string {
  switch (stage) {
    case "weather":
      return "Reading the latest forecast";
    case "prompt":
      return "Writing the art direction";
    case "image":
      return "Painting Plymouth";
    default:
      return "Starting the image model";
  }
}

function stageHint(stage?: ImageStage): string {
  switch (stage) {
    case "prompt":
      return "The multimodal model is looking at the reference photo and today’s weather report.";
    case "image":
      return "Qwen Image is repainting the scene. This usually takes about 20 seconds.";
    default:
      return "This can take a few seconds.";
  }
}

export function WeatherHero({
  weather,
  image,
  stale,
  imageError,
  showReference,
  onToggleReference,
  onGenerate,
}: WeatherHeroProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (image?.status !== "generating" || !image.startedAt) {
      setElapsed(0);
      return;
    }

    const startedAt = image.startedAt;
    const update = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [image?.status, image?.startedAt]);

  const generating = image?.status === "generating";
  const generatedSrc = image?.imageUrl;
  const usingGenerated = Boolean(generatedSrc) && !showReference;
  const imageSrc =
    usingGenerated && generatedSrc ? generatedSrc : "/panther-snow.jpg";
  const imageAlt = usingGenerated
    ? image?.caption ||
      `AI-generated Plymouth scene matching ${weather.current.shortForecast}`
    : "Reference photo of the Plymouth State panther statue in snow";

  const errorText = imageError ?? image?.error ?? null;
  const showError = Boolean(errorText) && !generating;
  const showDisabled = image?.status === "disabled" && !generating;
  const showIdle =
    image?.status === "idle" && !generating && !errorText;

  const generateLabel = generating
    ? "Generating…"
    : stale
      ? "Update image for this weather"
      : image?.status === "ready"
        ? "Regenerate image"
        : "Generate image";

  return (
    <section className="hero" aria-label="Current conditions and weather postcard">
      <figure
        className={`image-card${generating ? " is-generating" : ""}`}
        aria-busy={generating}
      >
        <img className="hero-image" src={imageSrc} alt={imageAlt} />

        <div className="image-badges">
          <span className={`badge${usingGenerated ? " badge-ai" : ""}`}>
            {usingGenerated ? "AI-generated" : "Reference photo"}
          </span>
          {usingGenerated && stale && !generating && (
            <span className="badge badge-warn">Weather changed</span>
          )}
          {usingGenerated && image?.cached && (
            <span className="badge">Cached</span>
          )}
        </div>

        {generating && (
          <div className="image-overlay">
            <div
              className="status-card status-card-progress"
              role="status"
              aria-live="polite"
            >
              <div className="progress-head">
                <span className="spinner" aria-hidden="true" />
                <strong>{stageLabel(image?.stage)}</strong>
                <span className="elapsed">{elapsed}s</span>
              </div>
              <p>{stageHint(image?.stage)}</p>
              <div className="progress-track" aria-hidden="true">
                <span
                  style={{ width: `${Math.min(92, 8 + elapsed * 2.4)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {showError && (
          <div className="image-overlay">
            <div className="status-card status-card-error">
              <strong>Image generation failed</strong>
              <p>{errorText}</p>
              <button
                type="button"
                className="button"
                onClick={() => onGenerate(true)}
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {showDisabled && (
          <div className="image-overlay">
            <div className="status-card">
              <strong>Image generation is off</strong>
              <p>
                {image?.message ??
                  "Set OPENROUTER_API_KEY in openrouter.env and restart the server."}
              </p>
            </div>
          </div>
        )}

        {showIdle && (
          <div className="image-overlay">
            <div className="status-card">
              <strong>No postcard for this forecast yet</strong>
              <p>
                Generate an image that matches the current time, season, and
                weather.
              </p>
              <button
                type="button"
                className="button"
                onClick={() => onGenerate(false)}
              >
                Generate image
              </button>
            </div>
          </div>
        )}

        <figcaption className="image-caption">
          <button
            type="button"
            className="link-button"
            onClick={onToggleReference}
            aria-pressed={showReference}
            disabled={!generatedSrc}
          >
            {showReference ? "Show generated image" : "Compare with reference photo"}
          </button>
          <span>
            {usingGenerated
              ? image?.caption
              : "Plymouth State panther statue in snow"}
          </span>
        </figcaption>
      </figure>

      <div className="current">
        <div className="current-top">
          <div className="temp-block">
            <span className="temp">{weather.current.temperature}</span>
            <span className="temp-unit">°{weather.current.temperatureUnit}</span>
          </div>
          <div className="current-copy">
            <h2>{weather.current.shortForecast}</h2>
            <p className="current-time">{weather.localTime}</p>
          </div>
        </div>

        <div className="chips">
          <span className="chip chip-accent">{weather.timeOfDay}</span>
          <span className="chip">{weather.season}</span>
          <span className="chip">
            {weather.current.precipProbability ?? 0}% precipitation
          </span>
          <span className="chip">
            {weather.current.windDirection} {weather.current.windSpeed}
          </span>
        </div>

        <dl className="metrics">
          <div>
            <dt>High / low</dt>
            <dd>
              {formatTemp(weather.today.high)} / {formatTemp(weather.today.low)}
            </dd>
          </div>
          <div>
            <dt>Humidity</dt>
            <dd>
              {weather.current.relativeHumidity != null
                ? `${weather.current.relativeHumidity}%`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Dew point</dt>
            <dd>
              {weather.current.dewpoint != null
                ? `${weather.current.dewpoint}°`
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Sunrise</dt>
            <dd>{formatTime(weather.sunrise, weather.timeZone)}</dd>
          </div>
          <div>
            <dt>Sunset</dt>
            <dd>{formatTime(weather.sunset, weather.timeZone)}</dd>
          </div>
          <div>
            <dt>Forecast updated</dt>
            <dd>{formatTime(weather.forecastUpdatedAt, weather.timeZone)}</dd>
          </div>
        </dl>

        <div className="actions">
          <button
            type="button"
            className="button"
            onClick={() => onGenerate(true)}
            disabled={generating || image?.status === "disabled"}
          >
            {generateLabel}
          </button>
          <span className="button-note">
            About 20 seconds · roughly $0.02 per image
          </span>
        </div>

        {image?.message && <p className="action-note">{image.message}</p>}

        <p className="updated">
          {weather.stale ? "Showing the last forecast — refresh failed. " : ""}
          NWS data fetched {formatTime(weather.fetchedAt, weather.timeZone)}.{" "}
          <a
            href={weather.source.forecastUrl}
            target="_blank"
            rel="noreferrer"
          >
            View the NWS forecast ↗
          </a>
        </p>
      </div>
    </section>
  );
}
