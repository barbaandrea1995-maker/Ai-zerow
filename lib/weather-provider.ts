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
  provider: "OPEN_METEO";
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
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function weatherCondition(code: number | null) {
  if (code === null) return "Condizione non disponibile";
  if (code === 0) return "Sereno";
  if (code === 1) return "Prevalentemente sereno";
  if (code === 2) return "Parzialmente nuvoloso";
  if (code === 3) return "Coperto";
  if ([45, 48].includes(code)) return "Nebbia";
  if ([51, 53, 55, 56, 57].includes(code)) return "Pioviggine";
  if ([61, 63, 65, 66, 67].includes(code)) return "Pioggia";
  if ([71, 73, 75, 77].includes(code)) return "Neve";
  if ([80, 81, 82].includes(code)) return "Rovesci";
  if ([85, 86].includes(code)) return "Rovesci di neve";
  if ([95, 96, 99].includes(code)) return "Temporale";
  return "Condizioni variabili";
}

export function windDirectionLabel(degrees: number | null) {
  if (degrees === null) return "—";
  const directions = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return directions[Math.round(degrees / 45) % directions.length] ?? "—";
}

function listNumber(value: unknown, index: number) {
  return numberValue(arrayValue(value)[index]);
}

function listString(value: unknown, index: number) {
  return stringValue(arrayValue(value)[index]);
}

export interface WeatherProvider {
  readonly provider: "OPEN_METEO";
  getForecast(location: WeatherProviderLocation): Promise<WeatherSnapshot>;
}

export class OpenMeteoAdapter implements WeatherProvider {
  readonly provider = "OPEN_METEO" as const;

  async getForecast(location: WeatherProviderLocation): Promise<WeatherSnapshot> {
    const endpoint = new URL("https://api.open-meteo.com/v1/forecast");
    endpoint.searchParams.set("latitude", location.latitude.toFixed(6));
    endpoint.searchParams.set("longitude", location.longitude.toFixed(6));
    endpoint.searchParams.set("timezone", "auto");
    endpoint.searchParams.set("forecast_days", "3");
    endpoint.searchParams.set("current", [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "is_day",
    ].join(","));
    endpoint.searchParams.set("hourly", [
      "temperature_2m",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
    ].join(","));
    endpoint.searchParams.set("daily", [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "precipitation_sum",
      "weather_code",
    ].join(","));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`open_meteo_http_${response.status}`);
      const payload = await response.json() as unknown;
      if (!isRecord(payload)) throw new Error("open_meteo_invalid_payload");
      return this.normalize(payload);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("open_meteo_")) throw error;
      throw new Error("open_meteo_unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalize(payload: JsonObject): WeatherSnapshot {
    const current = isRecord(payload.current) ? payload.current : {};
    const hourly = isRecord(payload.hourly) ? payload.hourly : {};
    const daily = isRecord(payload.daily) ? payload.daily : {};
    const currentCode = numberValue(current.weather_code);
    const currentWindDirection = numberValue(current.wind_direction_10m);
    const hourlyTimes = arrayValue(hourly.time);
    const dailyDates = arrayValue(daily.time);

    return {
      provider: this.provider,
      timezone: stringValue(payload.timezone) || "auto",
      current: {
        observedAt: stringValue(current.time),
        temperatureC: numberValue(current.temperature_2m),
        apparentTemperatureC: numberValue(current.apparent_temperature),
        humidityPct: numberValue(current.relative_humidity_2m),
        precipitationMm: numberValue(current.precipitation),
        windSpeedKmh: numberValue(current.wind_speed_10m),
        windDirectionDeg: currentWindDirection,
        windDirection: windDirectionLabel(currentWindDirection),
        weatherCode: currentCode,
        condition: weatherCondition(currentCode),
        isDay: numberValue(current.is_day) === 1,
      },
      hourly: hourlyTimes.slice(0, 8).map((_, index) => {
        const code = listNumber(hourly.weather_code, index);
        return {
          time: listString(hourly.time, index),
          temperatureC: listNumber(hourly.temperature_2m, index),
          precipitationProbabilityPct: listNumber(hourly.precipitation_probability, index),
          precipitationMm: listNumber(hourly.precipitation, index),
          windSpeedKmh: listNumber(hourly.wind_speed_10m, index),
          weatherCode: code,
          condition: weatherCondition(code),
        };
      }),
      daily: dailyDates.slice(0, 3).map((_, index) => {
        const code = listNumber(daily.weather_code, index);
        return {
          date: listString(daily.time, index),
          temperatureMaxC: listNumber(daily.temperature_2m_max, index),
          temperatureMinC: listNumber(daily.temperature_2m_min, index),
          precipitationProbabilityPct: listNumber(daily.precipitation_probability_max, index),
          precipitationMm: listNumber(daily.precipitation_sum, index),
          weatherCode: code,
          condition: weatherCondition(code),
        };
      }),
    };
  }
}

export function weatherProvider(): WeatherProvider {
  return new OpenMeteoAdapter();
}
