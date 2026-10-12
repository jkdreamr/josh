import { useEffect, useState, useSyncExternalStore } from 'react';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return match;
}

/** Hour (fractional) in Palo Alto, where the wallpaper's sky lives. */
export function pacificHour(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 12) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

export function pacificTime(d: Date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }).format(d);
}

export type Weather = { temp: number; label: string; icon: 'sun' | 'moon' | 'cloud' | 'rain' | 'fog' | 'snow' | 'storm' };
export type WeatherHour = { label: string; temp: number; icon: Weather['icon'] };
export type WeatherReport = Weather & { high: number | null; low: number | null; hours: WeatherHour[] };

const codeToWeather = (code: number, isDay: boolean): Pick<Weather, 'label' | 'icon'> => {
  if (code === 0) return { label: 'Clear', icon: isDay ? 'sun' : 'moon' };
  if (code <= 2) return { label: 'Partly Cloudy', icon: isDay ? 'sun' : 'moon' };
  if (code === 3) return { label: 'Cloudy', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: 'fog' };
  if (code >= 51 && code <= 67) return { label: 'Rain', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: 'rain' };
  if (code >= 95) return { label: 'Storms', icon: 'storm' };
  return { label: 'Cloudy', icon: 'cloud' };
};

export function hourLabel(h: number): string {
  const hour = h % 12 || 12;
  return `${hour} ${h < 12 ? 'AM' : 'PM'}`;
}

export function parseWeather(j: unknown): WeatherReport | null {
  if (typeof j !== 'object' || j === null) return null;
  const current = (j as Record<string, unknown>).current;
  if (typeof current !== 'object' || current === null) return null;
  const c = current as Record<string, unknown>;
  if (typeof c.temperature_2m !== 'number') return null;

  const dailyValue = (j as Record<string, unknown>).daily;
  const daily = typeof dailyValue === 'object' && dailyValue !== null ? dailyValue as Record<string, unknown> : null;
  const maxTemps = Array.isArray(daily?.temperature_2m_max) ? daily.temperature_2m_max : [];
  const minTemps = Array.isArray(daily?.temperature_2m_min) ? daily.temperature_2m_min : [];
  const high = typeof maxTemps[0] === 'number' ? Math.round(maxTemps[0]) : null;
  const low = typeof minTemps[0] === 'number' ? Math.round(minTemps[0]) : null;

  const hourlyValue = (j as Record<string, unknown>).hourly;
  const hourly = typeof hourlyValue === 'object' && hourlyValue !== null ? hourlyValue as Record<string, unknown> : null;
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const temperatures = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  const dayFlags = Array.isArray(hourly?.is_day) ? hourly.is_day : [];
  const hours: WeatherHour[] = [];
  if (typeof c.time === 'string') {
    const currentHour = c.time.slice(0, 13);
    for (let index = 0; index < times.length && hours.length < 4; index += 1) {
      const time = times[index];
      const temperature = temperatures[index];
      if (typeof time !== 'string' || time.slice(0, 13) <= currentHour || typeof temperature !== 'number') continue;
      hours.push({
        label: hourLabel(Number(time.slice(11, 13))),
        temp: Math.round(temperature),
        icon: codeToWeather(Number(codes[index]), dayFlags[index] === 1).icon,
      });
    }
  }

  return {
    temp: Math.round(c.temperature_2m),
    ...codeToWeather(Number(c.weather_code), c.is_day === 1),
    high,
    low,
    hours,
  };
}

export type WeatherStatus = 'loading' | 'ready' | 'failed';

type WeatherStore = { status: WeatherStatus; report: WeatherReport | null; at: number };

const initialWeatherStore: WeatherStore = { status: 'loading', report: null, at: 0 };
let weatherStore = initialWeatherStore;
let weatherFetchInFlight = false;
const weatherListeners = new Set<() => void>();
const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=37.4275&longitude=-122.1697&current=temperature_2m,weather_code,is_day&hourly=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America%2FLos_Angeles&forecast_days=2';

function subscribeWeather(listener: () => void): () => void {
  weatherListeners.add(listener);
  return () => weatherListeners.delete(listener);
}

function publishWeather(next: WeatherStore): void {
  weatherStore = next;
  weatherListeners.forEach((listener) => listener());
}

function refreshWeather(force = false): void {
  if (weatherFetchInFlight) return;
  if (!force && weatherStore.status === 'ready' && Date.now() - weatherStore.at < 30 * 60 * 1000) return;

  weatherFetchInFlight = true;
  publishWeather({ ...weatherStore, status: weatherStore.report ? 'ready' : 'loading' });
  void fetch(weatherUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
      return response.json();
    })
    .then((data: unknown) => {
      const report = parseWeather(data);
      if (!report) throw new Error('Weather response was invalid');
      publishWeather({ status: 'ready', report, at: Date.now() });
    })
    .catch(() => {
      publishWeather({ ...weatherStore, status: weatherStore.report ? 'ready' : 'failed' });
    })
    .finally(() => {
      weatherFetchInFlight = false;
    });
}

export function useWeatherReport(): { status: WeatherStatus; report: WeatherReport | null; refresh: (force?: boolean) => void } {
  const snapshot = useSyncExternalStore(subscribeWeather, () => weatherStore, () => initialWeatherStore);
  useEffect(() => {
    refreshWeather();
  }, []);
  return { ...snapshot, refresh: refreshWeather };
}

export function useWeather(): Weather | null {
  return useWeatherReport().report;
}

export type BatteryReading = { level: number; charging: boolean } | null;
export type BatteryView = { percent: number; level: number; plugged: boolean; charging: boolean; source: 'Power Adapter' | 'Battery'; status: string | null };

export function batteryView(r: BatteryReading): BatteryView {
  if (r === null) return { percent: 100, level: 1, plugged: true, charging: false, source: 'Power Adapter', status: 'Battery Is Charged' };
  const level = Number.isNaN(r.level) ? 1 : clamp(r.level, 0, 1);
  const percent = Math.round(level * 100);
  const plugged = r.charging;
  return {
    percent,
    level,
    plugged,
    charging: plugged && percent < 100,
    source: plugged ? 'Power Adapter' : 'Battery',
    status: plugged ? (percent >= 100 ? 'Battery Is Charged' : 'Charging') : null,
  };
}

export function useBattery(): BatteryView {
  const [battery, setBattery] = useState(() => batteryView(null));
  useEffect(() => {
    type BatteryManager = EventTarget & { level: number; charging: boolean };
    type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (typeof navigator === 'undefined' || typeof (navigator as NavigatorWithBattery).getBattery !== 'function') return;

    let mounted = true;
    let manager: BatteryManager | null = null;
    const update = () => {
      if (manager && mounted) setBattery(batteryView({ level: manager.level, charging: manager.charging }));
    };
    (navigator as NavigatorWithBattery).getBattery!()
      .then((batteryManager) => {
        if (!mounted) return;
        manager = batteryManager;
        update();
        manager.addEventListener('levelchange', update);
        manager.addEventListener('chargingchange', update);
      })
      .catch(() => {});

    return () => {
      mounted = false;
      manager?.removeEventListener('levelchange', update);
      manager?.removeEventListener('chargingchange', update);
    };
  }, []);
  return battery;
}

export function monthGrid(year: number, month: number): (number | null)[][] {
  const leading = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<number | null>(leading).fill(null)];
  for (let day = 1; day <= days; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
