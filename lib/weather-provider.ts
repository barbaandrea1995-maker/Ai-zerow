import { env } from "cloudflare:workers";

export type WeatherProviderLocation = {
  latitude: number;
  longitude: number;
};

export type WeatherCurrent = {
  observedAt: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  humidityPct: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windDirection: string;
  weatherCode: number | null;
  condition: string;
  isDay: boolean;
};

export type WeatherHourly = {
  time: string;
  temperatureC: number | null;
  precipitationProbabilityPct: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  weatherCode: number | null;
  condition: string;
};

export type WeatherDaily = {
  date: string;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  precipitationProbabilityPct: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  condition: string;
};

export type WeatherSnapshot = {
  provider: "WEATHERAPI";
  timezone: string;
  current: WeatherCurrent;
  hourly: WeatherHourly[];
  daily: WeatherDaily[];
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nestedRecord(value: unknown, key: string): JsonObject {
  if (!isRecord(value)) return {};
  const child = value[key];
  return isRecord(child) ? child : {};
}

function conditionText(value: unknown) {
  return stringValue(nestedRecord(value, "condition").text) || "Condizione non disponibile";
}

export function windDirectionLabel(degrees: number | null) {
  if (degrees === null) return "—";
  const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return directions[Math.round(degrees / 45) % directions.length] ?? "—";
}

function runtimeSecret() {
  const names = ["WEATHER_API_KEY", "WEATHERAPI_API_KEY", "weather_api_key"] as const;
  const bindings = env as unknown as Record<string, unknown>;
  for (const name of names) {
    const bound = bindings[name];
    if (typeof bound === "string" && bound.trim()) return bound.trim();
  }
  for (const name of names) {
    const local = process.env[name];
    if (typeof local === "string" && local.trim()) return local.trim();
  }
  return "";
}

export interface WeatherProvider {
  readonly provider: "WEATHERAPI";
  getForecast(location: WeatherProviderLocation): Promise<WeatherSnapshot>;
}

export class WeatherApiAdapter implements WeatherProvider {
  readonly provider = "WEATHERAPI" as const;

  async getForecast(location: WeatherProviderLocation): Promise<WeatherSnapshot> {
    const apiKey = runtimeSecret();
    if (!apiKey) throw new Error("weatherapi_not_configured");

    const endpoint = new URL("https://api.weatherapi.com/v1/forecast.json");
    endpoint.searchParams.set("key", apiKey);
    endpoint.searchParams.set("q", `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`);
    endpoint.searchParams.set("days", "3");
    endpoint.searchParams.set("aqi", "no");
    endpoint.searchParams.set("alerts", "no");
    endpoint.searchParams.set("lang", "it");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`weatherapi_http_${response.status}`);
      const payload = await response.json() as unknown;
      if (!isRecord(payload)) throw new Error("weatherapi_invalid_payload");
      return this.normalize(payload);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("weatherapi_")) throw error;
      throw new Error("weatherapi_unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalize(payload: JsonObject): WeatherSnapshot {
    const location = isRecord(payload.location) ? payload.location : {};
    const current = isRecord(payload.current) ? payload.current : {};
    const forecastDays = arrayValue(nestedRecord(payload, "forecast").forecastday).filter(isRecord);
    if (!isRecord(payload.location) || !isRecord(payload.current) || forecastDays.length === 0) {
      throw new Error("weatherapi_invalid_payload");
    }

    const currentCondition = nestedRecord(current, "condition");
    const currentWindDirection = numberValue(current.wind_degree);
    const currentEpoch = numberValue(current.last_updated_epoch);
    const hourlyRows = forecastDays.flatMap((day) => arrayValue(day.hour).filter(isRecord));
    const upcomingHours = hourlyRows
      .filter((hour) => currentEpoch === null || numberValue(hour.time_epoch) === null || numberValue(hour.time_epoch)! >= currentEpoch)
      .slice(0, 8);
    const selectedHours = upcomingHours.length ? upcomingHours : hourlyRows.slice(0, 8);

    return {
      provider: this.provider,
      timezone: stringValue(location.tz_id) || "auto",
      current: {
        observedAt: stringValue(current.last_updated),
        temperatureC: numberValue(current.temp_c),
        apparentTemperatureC: numberValue(current.feelslike_c),
        humidityPct: numberValue(current.humidity),
        precipitationMm: numberValue(current.precip_mm),
        windSpeedKmh: numberValue(current.wind_kph),
        windDirectionDeg: currentWindDirection,
        windDirection: windDirectionLabel(currentWindDirection),
        weatherCode: numberValue(currentCondition.code),
        condition: stringValue(currentCondition.text) || "Condizione non disponibile",
        isDay: numberValue(current.is_day) === 1,
      },
      hourly: selectedHours.map((hour) => {
        const condition = nestedRecord(hour, "condition");
        return {
          time: stringValue(hour.time),
          temperatureC: numberValue(hour.temp_c),
          precipitationProbabilityPct: numberValue(hour.chance_of_rain),
          precipitationMm: numberValue(hour.precip_mm),
          windSpeedKmh: numberValue(hour.wind_kph),
          weatherCode: numberValue(condition.code),
          condition: stringValue(condition.text) || "Condizione non disponibile",
        };
      }),
      daily: forecastDays.slice(0, 3).map((day) => {
        const dayForecast = nestedRecord(day, "day");
        return {
          date: stringValue(day.date),
          temperatureMaxC: numberValue(dayForecast.maxtemp_c),
          temperatureMinC: numberValue(dayForecast.mintemp_c),
          precipitationProbabilityPct: numberValue(dayForecast.daily_chance_of_rain),
          precipitationMm: numberValue(dayForecast.totalprecip_mm),
          weatherCode: numberValue(nestedRecord(dayForecast, "condition").code),
          condition: conditionText(dayForecast),
        };
      }),
    };
  }
}

export function weatherProvider(): WeatherProvider {
  return new WeatherApiAdapter();
}
