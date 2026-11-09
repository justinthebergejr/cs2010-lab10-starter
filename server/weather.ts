import { createHash } from "node:crypto";
import * as SunCalc from "suncalc";
import type {
  CurrentConditions,
  DailyPeriod,
  HourlyPeriod,
  TodaySummary,
  Weather,
} from "../shared/types";
import {
  IMAGE_ASPECT_RATIO,
  IMAGE_MODEL,
  IMAGE_RESOLUTION,
  LOCATION,
  NWS_USER_AGENT,
  PROMPT_MODEL,
  PROMPT_VERSION,
  REFERENCE_HASH,
  TIME_ZONE,
  WEATHER_CACHE_MS,
} from "./config";

interface NwsValue<T> {
  value: T | null;
}

interface NwsPeriod {
  number?: number;
  name?: string;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  temperatureUnit: string;
  temperatureTrend?: string | null;
  shortForecast: string;
  detailedForecast: string;
  windSpeed: string;
  windDirection: string;
  icon: string;
  probabilityOfPrecipitation?: NwsValue<number> | null;
  relativeHumidity?: NwsValue<number> | null;
  dewpoint?: NwsValue<number> | null;
}

interface NwsForecast {
  properties: {
    updateTime?: string;
    generatedAt?: string;
    periods: NwsPeriod[];
  };
}

interface NwsPoints {
  properties: {
    forecast: string;
    forecastHourly: string;
    timeZone: string;
    relativeLocation?: {
      properties?: {
        city?: string;
        state?: string;
      };
    };
  };
}

interface PointsCache {
  data: NwsPoints;
  fetchedAt: number;
}

interface WeatherCache {
  data: Weather;
  fetchedAt: number;
}

let pointsCache: PointsCache | null = null;
let weatherCache: WeatherCache | null = null;

const POINTS_CACHE_MS = 24 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(url: string, label: string, attempt = 1): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": NWS_USER_AGENT,
        Accept: "application/geo+json, application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    if (attempt < 2) {
      await sleep(1000);
      return fetchJson<T>(url, label, attempt + 1);
    }
    throw new Error(
      `${label} request failed: ${err instanceof Error ? err.message : "network error"}`,
    );
  }

  if (!response.ok) {
    if (response.status >= 500 && attempt < 2) {
      await sleep(1000);
      return fetchJson<T>(url, label, attempt + 1);
    }
    throw new Error(`${label} failed: HTTP ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

async function getPoints(): Promise<NwsPoints> {
  if (pointsCache && Date.now() - pointsCache.fetchedAt < POINTS_CACHE_MS) {
    return pointsCache.data;
  }

  const url = `https://api.weather.gov/points/${LOCATION.latitude},${LOCATION.longitude}`;
  const data = await fetchJson<NwsPoints>(url, "NWS points");
  pointsCache = { data, fetchedAt: Date.now() };
  return data;
}

function valueOf<T>(field: NwsValue<T> | null | undefined): T | null {
  return field?.value ?? null;
}

/** NWS dew points come back in Celsius; the display uses the period's temperature unit. */
function dewpointFor(period: NwsPeriod): number | null {
  const raw = valueOf(period.dewpoint);
  if (raw == null) return null;
  return period.temperatureUnit === "F"
    ? Math.round((raw * 9) / 5 + 32)
    : Math.round(raw);
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const result: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") result[part.type] = part.value;
  }
  return result;
}

function localDateKey(date: Date | string, timeZone = TIME_ZONE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const p = partsInTimeZone(d, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function formatLocal(
  date: Date | string | null,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(d);
}

function formatHour(iso: string, timeZone: string): string {
  return formatLocal(iso, timeZone, { hour: "numeric" });
}

function localHour(date: Date, timeZone: string): number {
  const p = partsInTimeZone(date, timeZone);
  return Number(p.hour);
}

function round5(value: number): number {
  return Math.round(value / 5) * 5;
}

function computeSeason(date: Date, timeZone: string): string {
  const month = Number(partsInTimeZone(date, timeZone).month);
  const groups: Record<string, number[]> = {
    winter: [12, 1, 2],
    spring: [3, 4, 5],
    summer: [6, 7, 8],
    autumn: [9, 10, 11],
  };

  let season = "autumn";
  for (const [name, months] of Object.entries(groups)) {
    if (months.includes(month)) {
      season = name;
      break;
    }
  }

  const index = groups[season].indexOf(month);
  const phase = ["early", "mid", "late"][index] ?? "";
  return `${phase} ${season}`.trim();
}

function computeTimeOfDay(date: Date, timeZone: string): string {
  const times = SunCalc.getTimes(date, LOCATION.latitude, LOCATION.longitude);
  const t = date.getTime();
  const hour = localHour(date, timeZone);

  if (!times.dawn || t < times.dawn.getTime()) return "night";
  if (!times.sunrise || t < times.sunrise.getTime()) return "dawn";
  if (!times.goldenHourEnd || t < times.goldenHourEnd.getTime()) return "early morning";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (!times.goldenHour || t < times.goldenHour.getTime()) return "afternoon";
  if (!times.sunset || t < times.sunset.getTime()) return "golden hour";
  if (!times.dusk || t < times.dusk.getTime()) return "dusk";
  return "evening";
}

function toHourly(period: NwsPeriod, timeZone: string): HourlyPeriod {
  return {
    startTime: period.startTime,
    endTime: period.endTime,
    label: formatHour(period.startTime, timeZone),
    temperature: period.temperature,
    temperatureUnit: period.temperatureUnit,
    shortForecast: period.shortForecast,
    precipProbability: valueOf(period.probabilityOfPrecipitation),
    windSpeed: period.windSpeed,
    windDirection: period.windDirection,
    relativeHumidity: valueOf(period.relativeHumidity),
    dewpoint: dewpointFor(period),
    icon: period.icon,
    isDaytime: period.isDaytime,
  };
}

function toCurrent(period: NwsPeriod): CurrentConditions {
  return {
    temperature: period.temperature,
    temperatureUnit: period.temperatureUnit,
    shortForecast: period.shortForecast,
    detailedForecast: period.detailedForecast,
    windSpeed: period.windSpeed,
    windDirection: period.windDirection,
    precipProbability: valueOf(period.probabilityOfPrecipitation),
    relativeHumidity: valueOf(period.relativeHumidity),
    dewpoint: dewpointFor(period),
    icon: period.icon,
    isDaytime: period.isDaytime,
    startTime: period.startTime,
    endTime: period.endTime,
  };
}

function groupDaily(periods: NwsPeriod[], timeZone: string): DailyPeriod[] {
  const byDate = new Map<string, NwsPeriod[]>();

  for (const period of periods) {
    const key = localDateKey(period.startTime, timeZone);
    const list = byDate.get(key) ?? [];
    list.push(period);
    byDate.set(key, list);
  }

  const todayKey = localDateKey(new Date(), timeZone);
  const tomorrowKey = localDateKey(new Date(Date.now() + 86_400_000), timeZone);

  const days: DailyPeriod[] = [];
  for (const [date, list] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const day = list.find((p) => p.isDaytime) ?? null;
    const night = list.find((p) => !p.isDaytime) ?? null;
    const primary = day ?? night;
    if (!primary) continue;

    const precipValues = list
      .map((p) => valueOf(p.probabilityOfPrecipitation))
      .filter((v): v is number => v != null);

    const detailed = [day?.detailedForecast, night?.detailedForecast]
      .filter(Boolean)
      .join(" ");

    let dayName: string;
    if (date === todayKey) dayName = "Today";
    else if (date === tomorrowKey) dayName = "Tomorrow";
    else {
      dayName = formatLocal(primary.startTime, timeZone, { weekday: "long" });
    }

    days.push({
      date,
      dayName,
      high: day?.temperature ?? null,
      low: night?.temperature ?? null,
      shortForecast: primary.shortForecast,
      detailedForecast: detailed || primary.detailedForecast,
      precipProbability: precipValues.length ? Math.max(...precipValues) : null,
      icon: primary.icon,
      isToday: date === todayKey,
    });
  }

  return days.slice(0, 7);
}

function buildToday(daily: DailyPeriod[], current: CurrentConditions): TodaySummary {
  const today = daily.find((d) => d.isToday) ?? daily[0];
  return {
    high: today?.high ?? current.temperature,
    low: today?.low ?? null,
    shortForecast: today?.shortForecast ?? current.shortForecast,
    detailedForecast: today?.detailedForecast ?? current.detailedForecast,
    precipProbability: today?.precipProbability ?? current.precipProbability,
  };
}

export function weatherHints(forecast: string, precip: number | null): string {
  const text = forecast.toLowerCase();
  if (text.includes("snow") || text.includes("flurr") || text.includes("blizzard")) {
    return "Cover the ground, branches, and surfaces with fresh snow and add falling snow in the air.";
  }
  if (
    text.includes("rain") ||
    text.includes("shower") ||
    text.includes("drizzle") ||
    text.includes("thunder") ||
    (precip ?? 0) >= 50
  ) {
    return "Make the ground and surfaces wet, add rain in the air, and use a damp, overcast atmosphere.";
  }
  if (text.includes("fog") || text.includes("mist") || text.includes("haze")) {
    return "Add fog or mist with soft, reduced visibility and diffused light.";
  }
  if (text.includes("clear") || text.includes("sunny") || text.includes("fair")) {
    return "Use a clear sky with crisp sunlight and clean shadows.";
  }
  if (text.includes("cloud") || text.includes("overcast")) {
    return "Use a cloudy sky with soft, diffused light.";
  }
  return "Match the sky, light, ground, and atmosphere to the reported conditions.";
}

function buildImageContext(
  current: CurrentConditions,
  today: TodaySummary,
  hourly: HourlyPeriod[],
  daily: DailyPeriod[],
  localTime: string,
  timeOfDay: string,
  season: string,
  sunrise: string | null,
  sunset: string | null,
  timeZone: string,
): string {
  const unit = `°${current.temperatureUnit}`;
  const sunriseLabel = formatLocal(sunrise, timeZone, { hour: "numeric", minute: "2-digit" });
  const sunsetLabel = formatLocal(sunset, timeZone, { hour: "numeric", minute: "2-digit" });
  const precip = current.precipProbability ?? 0;
  const humidity =
    current.relativeHumidity != null ? `, humidity ${current.relativeHumidity}%` : "";
  const dewpoint = current.dewpoint != null ? `, dew point ${current.dewpoint}${unit}` : "";

  const lines = [
    `Location: ${LOCATION.name} ${LOCATION.zip} (${LOCATION.latitude} N, ${LOCATION.longitude} W)`,
    `Local time: ${localTime}`,
    `Time of day: ${timeOfDay} (sunrise ${sunriseLabel}, sunset ${sunsetLabel})`,
    `Season: ${season}`,
    `Current: ${current.temperature}${unit}, ${current.shortForecast}, wind ${current.windDirection} ${current.windSpeed}, ${precip}% chance of precipitation${humidity}${dewpoint}`,
    `Today: high ${today.high ?? "—"}${unit}, low ${today.low ?? "—"}${unit}, ${today.shortForecast}`,
    "Next 12 hours:",
    ...hourly
      .slice(0, 12)
      .map(
        (h) =>
          `- ${h.label}: ${h.temperature}${unit}, ${h.shortForecast}, ${h.precipProbability ?? 0}% precip, wind ${h.windDirection} ${h.windSpeed}`,
      ),
    "Next 3 days:",
    ...daily
      .slice(0, 3)
      .map(
        (d) =>
          `- ${d.dayName}: high ${d.high ?? "—"}${unit}, low ${d.low ?? "—"}${unit}, ${d.shortForecast}, ${d.precipProbability ?? 0}% precip`,
      ),
    "",
    `Art-direction note: ${weatherHints(current.shortForecast, current.precipProbability)} If the reference photo has snow but the report is not snowy, remove the snow. Keep any statue or sculpture as a statue.`,
  ];

  return lines.join("\n");
}

function buildSignature(
  localDate: string,
  timeOfDay: string,
  season: string,
  current: CurrentConditions,
  hourly: HourlyPeriod[],
  daily: DailyPeriod[],
): string {
  const input = {
    v: PROMPT_VERSION,
    ref: REFERENCE_HASH,
    date: localDate,
    timeOfDay,
    season,
    current: {
      temp: round5(current.temperature),
      forecast: current.shortForecast,
      wind: current.windSpeed,
      precip: current.precipProbability,
    },
    hourly: hourly.slice(0, 6).map((h) => ({
      temp: round5(h.temperature),
      forecast: h.shortForecast,
      precip: h.precipProbability,
    })),
    daily: daily.slice(0, 3).map((d) => ({
      date: d.date,
      high: d.high,
      low: d.low,
      forecast: d.shortForecast,
      precip: d.precipProbability,
    })),
    models: { prompt: PROMPT_MODEL, image: IMAGE_MODEL },
    image: { aspect: IMAGE_ASPECT_RATIO, resolution: IMAGE_RESOLUTION },
  };

  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20);
}

async function fetchWeather(): Promise<Weather> {
  const points = await getPoints();
  const hourlyUrl = points.properties.forecastHourly;
  const dailyUrl = points.properties.forecast;

  if (!hourlyUrl || !dailyUrl) {
    throw new Error("NWS points response did not include forecast URLs.");
  }

  const [hourlyForecast, dailyForecast] = await Promise.all([
    fetchJson<NwsForecast>(hourlyUrl, "NWS hourly forecast"),
    fetchJson<NwsForecast>(dailyUrl, "NWS daily forecast"),
  ]);

  const now = new Date();
  const timeZone = points.properties.timeZone || TIME_ZONE;

  const allHourly = hourlyForecast.properties.periods;
  const allDaily = dailyForecast.properties.periods;

  if (!allHourly.length) {
    throw new Error("NWS hourly forecast returned no periods.");
  }

  const currentPeriod =
    allHourly.find((p) => {
      const start = new Date(p.startTime).getTime();
      const end = new Date(p.endTime).getTime();
      return start <= now.getTime() && now.getTime() < end;
    }) ?? allHourly[0];

  const hourly = allHourly
    .filter((p) => new Date(p.endTime).getTime() > now.getTime())
    .map((p) => toHourly(p, timeZone));

  const current = toCurrent(currentPeriod);
  const daily = groupDaily(allDaily, timeZone);
  const today = buildToday(daily, current);

  const timeOfDay = computeTimeOfDay(now, timeZone);
  const season = computeSeason(now, timeZone);
  const sunTimes = SunCalc.getTimes(now, LOCATION.latitude, LOCATION.longitude);
  const sunrise = sunTimes.sunrise?.toISOString() ?? null;
  const sunset = sunTimes.sunset?.toISOString() ?? null;

  const localTime = formatLocal(now, timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const localDate = localDateKey(now, timeZone);
  const imageContext = buildImageContext(
    current,
    today,
    hourly,
    daily,
    localTime,
    timeOfDay,
    season,
    sunrise,
    sunset,
    timeZone,
  );
  const imageSignature = buildSignature(localDate, timeOfDay, season, current, hourly, daily);

  const forecastUpdatedAt =
    hourlyForecast.properties.updateTime ??
    dailyForecast.properties.updateTime ??
    hourlyForecast.properties.generatedAt ??
    dailyForecast.properties.generatedAt ??
    null;

  return {
    location: {
      name: LOCATION.name,
      zip: LOCATION.zip,
      latitude: LOCATION.latitude,
      longitude: LOCATION.longitude,
    },
    timeZone,
    fetchedAt: now.toISOString(),
    forecastUpdatedAt,
    localTime,
    localDate,
    timeOfDay,
    season,
    sunrise,
    sunset,
    current,
    today,
    hourly,
    daily,
    imageSignature,
    imageContext,
    source: {
      name: "NOAA / National Weather Service",
      url: "https://www.weather.gov/",
      forecastUrl: `https://forecast.weather.gov/MapClick.php?lat=${LOCATION.latitude}&lon=${LOCATION.longitude}`,
    },
  };
}

export async function getWeather(force = false): Promise<Weather> {
  if (!force && weatherCache && Date.now() - weatherCache.fetchedAt < WEATHER_CACHE_MS) {
    return weatherCache.data;
  }

  try {
    const data = await fetchWeather();
    weatherCache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    if (weatherCache) {
      console.warn("[weather] fetch failed; serving stale cache:", err);
      return { ...weatherCache.data, stale: true };
    }
    throw err;
  }
}
