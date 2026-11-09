import type { Weather } from "../../shared/types";

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function Header({
  weather,
  now,
}: {
  weather: Weather | null;
  now: Date;
}) {
  const timeZone = weather?.timeZone ?? "America/New_York";
  const forecastUrl =
    weather?.source.forecastUrl ??
    "https://forecast.weather.gov/MapClick.php?lat=43.7589&lon=-71.6892";

  return (
    <header className="site-header">
      <div className="brand">
        <p className="eyebrow">Plymouth State University · CS 2010</p>
        <h1>Plymouth Weather Postcard</h1>
        <p className="tagline">
          Live NWS forecast, reimagined as a picture of the day.
        </p>
      </div>

      <div className="header-meta">
        <span className="location">
          Plymouth, NH {weather?.location.zip ?? "03264"}
        </span>
        <span className="clock">{formatDate(now, timeZone)}</span>
        <span className="clock-time">{formatTime(now, timeZone)}</span>
        <a
          className="header-link"
          href={forecastUrl}
          target="_blank"
          rel="noreferrer"
        >
          NWS forecast ↗
        </a>
      </div>
    </header>
  );
}
