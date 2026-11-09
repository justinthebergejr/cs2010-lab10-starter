export type ImageStatus = "idle" | "generating" | "ready" | "error" | "disabled";

export type ImageStage = "weather" | "prompt" | "image";

export interface LocationInfo {
  name: string;
  zip: string;
  latitude: number;
  longitude: number;
}

export interface HourlyPeriod {
  startTime: string;
  endTime: string;
  label: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  precipProbability: number | null;
  windSpeed: string;
  windDirection: string;
  relativeHumidity: number | null;
  dewpoint: number | null;
  icon: string;
  isDaytime: boolean;
}

export interface DailyPeriod {
  date: string;
  dayName: string;
  high: number | null;
  low: number | null;
  shortForecast: string;
  detailedForecast: string;
  precipProbability: number | null;
  icon: string;
  isToday: boolean;
}

export interface CurrentConditions {
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  detailedForecast: string;
  windSpeed: string;
  windDirection: string;
  precipProbability: number | null;
  relativeHumidity: number | null;
  dewpoint: number | null;
  icon: string;
  isDaytime: boolean;
  startTime: string;
  endTime: string;
}

export interface TodaySummary {
  high: number | null;
  low: number | null;
  shortForecast: string;
  detailedForecast: string;
  precipProbability: number | null;
}

export interface Weather {
  location: LocationInfo;
  timeZone: string;
  fetchedAt: string;
  forecastUpdatedAt: string | null;
  localTime: string;
  localDate: string;
  timeOfDay: string;
  season: string;
  sunrise: string | null;
  sunset: string | null;
  current: CurrentConditions;
  today: TodaySummary;
  hourly: HourlyPeriod[];
  daily: DailyPeriod[];
  imageSignature: string;
  imageContext: string;
  source: {
    name: string;
    url: string;
    forecastUrl: string;
  };
  stale?: boolean;
}

export interface ImageMetadata {
  signature: string;
  imageFile: string;
  prompt: string;
  caption: string;
  promptSource: "llm" | "fallback";
  weatherContext: string;
  models: {
    prompt: string;
    image: string;
  };
  generatedAt: string;
  costUsd: number | null;
  referenceUrl: string;
  durationMs: number;
}

export interface ImageState {
  status: ImageStatus;
  stage?: ImageStage;
  imageUrl?: string;
  signature?: string;
  stale?: boolean;
  cached?: boolean;
  generatedAt?: string;
  prompt?: string;
  caption?: string;
  promptSource?: "llm" | "fallback";
  weatherContext?: string;
  models?: {
    prompt: string;
    image: string;
  };
  costUsd?: number | null;
  durationMs?: number;
  startedAt?: number;
  error?: string;
  message?: string;
  canGenerate?: boolean;
  referenceUrl?: string;
}
