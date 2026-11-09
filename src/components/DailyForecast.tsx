import type { DailyPeriod } from "../../shared/types";

export function DailyForecast({ days }: { days: DailyPeriod[] }) {
  if (!days.length) return null;

  return (
    <section className="panel" aria-labelledby="daily-heading">
      <div className="section-heading">
        <h2 id="daily-heading">7-day outlook</h2>
        <span>High / low · precipitation chance</span>
      </div>

      <div className="daily-list">
        {days.map((day) => (
          <details className="day-row" key={day.date}>
            <summary>
              <span className="day-name">{day.dayName}</span>
              <img
                className="day-icon"
                src={day.icon}
                alt=""
                loading="lazy"
              />
              <span className="day-forecast">{day.shortForecast}</span>
              <span className="day-precip">
                {day.precipProbability ?? 0}%
              </span>
              <span className="day-temps">
                <strong>{day.high ?? "—"}°</strong>
                <span> / {day.low ?? "—"}°</span>
              </span>
            </summary>
            <p className="day-detail">
              {day.detailedForecast || day.shortForecast}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
