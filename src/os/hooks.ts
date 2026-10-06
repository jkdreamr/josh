import { useEffect, useState } from 'react';

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

let weatherPromise: Promise<Weather | null> | null = null;

function fetchWeather(): Promise<Weather | null> {
  weatherPromise ??= fetch(
    'https://api.open-meteo.com/v1/forecast?latitude=37.4275&longitude=-122.1697&current=temperature_2m,weather_code,is_day&temperature_unit=fahrenheit',
  )
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j) => {
      const c = j?.current;
      if (!c || typeof c.temperature_2m !== 'number') return null;
      return { temp: Math.round(c.temperature_2m), ...codeToWeather(Number(c.weather_code), c.is_day === 1) };
    })
    .catch(() => null);
  return weatherPromise;
}

export function useWeather() {
  const [w, setW] = useState<Weather | null>(null);
  useEffect(() => {
    let alive = true;
    fetchWeather().then((v) => alive && setW(v));
    return () => {
      alive = false;
    };
  }, []);
  return w;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
