import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageState, Weather } from "../shared/types";
import { fetchImageState, fetchWeather, startGeneration } from "./api";
import { DailyForecast } from "./components/DailyForecast";
import { Header } from "./components/Header";
import { HourlyStrip } from "./components/HourlyStrip";
import { PromptDetails } from "./components/PromptDetails";
import { WeatherHero } from "./components/WeatherHero";

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function WeatherSkeleton() {
  return (
    <div className="hero skeleton-hero" aria-label="Loading Plymouth weather">
      <div className="skeleton skeleton-image" />
      <div className="skeleton-copy">
        <div className="skeleton skeleton-line skeleton-line-lg" />
        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line skeleton-line-short" />
        <div className="skeleton skeleton-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton skeleton-cell" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Footer({ weather }: { weather: Weather | null }) {
  return (
    <footer className="site-footer">
      <p>
        Weather data from{" "}
        <a href="https://www.weather.gov/" target="_blank" rel="noreferrer">
          NOAA / National Weather Service
        </a>
        . Imagery generated with Qwen Image 2.1 Turbo via OpenRouter.
      </p>
      <p>
        Reference photo:{" "}
        <a href="/panther-snow.jpg" target="_blank" rel="noreferrer">
          panther-snow.jpg
        </a>
        {weather
          ? ` · ${weather.location.name} ${weather.location.zip}`
          : ""}
      </p>
    </footer>
  );
}

export default function App() {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(true);
  const [image, setImage] = useState<ImageState | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const autoTried = useRef(false);
  const didFetch = useRef(false);

  const loadWeather = useCallback(async (refresh = false) => {
    setLoadingWeather(true);
    try {
      const data = await fetchWeather(refresh);
      setWeather(data);
      setWeatherError(null);
    } catch (err) {
      setWeatherError(errorMessage(err));
    } finally {
      setLoadingWeather(false);
    }
  }, []);

  const loadImage = useCallback(async () => {
    try {
      const next = await fetchImageState();
      setImage(next);
      if (next.status === "error") {
        setImageError(next.error ?? "Image generation failed.");
      }
    } catch (err) {
      setImageError(errorMessage(err));
    }
  }, []);

  const generate = useCallback(async (force = false) => {
    setImageError(null);
    try {
      const next = await startGeneration(force);
      setImage(next);
      if (next.status === "error") {
        setImageError(next.error ?? "Image generation failed.");
      }
    } catch (err) {
      setImageError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (!didFetch.current) {
      didFetch.current = true;
      void loadWeather();
      void loadImage();
    }

    const clock = setInterval(() => setNow(new Date()), 30_000);
    const weatherTimer = setInterval(
      () => void loadWeather(true),
      10 * 60 * 1000,
    );

    return () => {
      clearInterval(clock);
      clearInterval(weatherTimer);
    };
  }, [loadWeather, loadImage]);

  useEffect(() => {
    if (!weather || !image || autoTried.current) return;
    if (image.status === "idle" && image.canGenerate !== false) {
      autoTried.current = true;
      void generate(false);
    }
  }, [weather, image, generate]);

  useEffect(() => {
    if (image?.status !== "generating") return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await fetchImageState();
        if (cancelled) return;
        setImage(next);
        if (next.status === "error") {
          setImageError(next.error ?? "Image generation failed.");
        }
      } catch (err) {
        if (!cancelled) setImageError(errorMessage(err));
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [image?.status]);

  const stale = useMemo(
    () =>
      Boolean(
        weather?.imageSignature &&
          image?.signature &&
          weather.imageSignature !== image.signature,
      ),
    [weather?.imageSignature, image?.signature],
  );

  const retryAll = () => {
    autoTried.current = false;
    setImageError(null);
    void loadWeather(true);
    void loadImage();
  };

  return (
    <div className="app">
      <Header weather={weather} now={now} />

      <main>
        {weatherError && (
          <div className="notice notice-error" role="alert">
            <div>
              <strong>Weather unavailable.</strong> {weatherError}
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={() => void loadWeather(true)}
            >
              Retry weather
            </button>
          </div>
        )}

        {!weather && loadingWeather && <WeatherSkeleton />}

        {!weather && !loadingWeather && !weatherError && (
          <div className="notice">
            <div>No weather data yet.</div>
            <button type="button" className="button" onClick={retryAll}>
              Try again
            </button>
          </div>
        )}

        {weather && (
          <>
            <WeatherHero
              weather={weather}
              image={image}
              stale={stale}
              imageError={imageError}
              showReference={showReference}
              onToggleReference={() => setShowReference((value) => !value)}
              onGenerate={generate}
            />
            <HourlyStrip hours={weather.hourly.slice(0, 12)} />
            <DailyForecast days={weather.daily} />
            <PromptDetails image={image} weather={weather} />
          </>
        )}
      </main>

      <Footer weather={weather} />
    </div>
  );
}
