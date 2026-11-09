import type { HourlyPeriod } from "../../shared/types";

export function HourlyStrip({ hours }: { hours: HourlyPeriod[] }) {
  if (!hours.length) return null;

  return (
    <section className="panel hourly-panel" aria-labelledby="hourly-heading">
      <div className="section-heading">
        <h2 id="hourly-heading">Next 12 hours</h2>
        <span>NWS hourly forecast</span>
      </div>

      <div className="hourly-strip">
        {hours.map((hour, index) => (
          <article
            className="hour-card"
            key={hour.startTime}
            title={hour.shortForecast}
          >
            <span className="hour-label">
              {index === 0 ? "Now" : hour.label}
            </span>
            <img
              className="hour-icon"
              src={hour.icon}
              alt=""
              loading="lazy"
            />
            <span className="hour-temp">{hour.temperature}°</span>
            <span className="hour-precip">
              {hour.precipProbability ?? 0}%
            </span>
            <span className="hour-wind">
              {hour.windDirection} {hour.windSpeed}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
