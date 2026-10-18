import { Cron } from 'croner';
import { defaultSunTimes, localParts, type SiteInfo, type SunTimes } from './conditions.js';

export type SunEvent = 'sunrise' | 'sunset';
export type SunTimesFn = (at: number, site: SiteInfo) => SunTimes | null;

const DAY_MS = 86_400_000;

/** Daily sun recompute (FR-H08): 00:05 site-local time. */
export const SUN_RECOMPUTE_CRON = '5 0 * * *';

export const hasCoordinates = (site: SiteInfo | null | undefined): site is SiteInfo & { lat: number; lng: number } =>
  !!site && typeof site.lat === 'number' && typeof site.lng === 'number';

/** ≈ local noon of the site-local day containing `now` (suncalc picks the solar day nearest to it). */
export function localNoon(now: number, tz: string): number {
  const { minutes } = localParts(now, tz);
  const secMs = now % 60_000;
  return now - secMs + (12 * 60 - minutes) * 60_000;
}

/**
 * Sun event (+ offset) for the site-local day containing `now`.
 * null = coordinates missing or no such event that day (polar day/night).
 */
export function sunEventAt(now: number, site: SiteInfo, event: SunEvent, offsetMin = 0, sunTimes: SunTimesFn = defaultSunTimes): number | null {
  if (!hasCoordinates(site)) return null;
  const st = sunTimes(localNoon(now, site.timezone), site);
  if (!st) return null;
  return st[event] + offsetMin * 60_000;
}

/** Next sun fire strictly after `after` (today's, else tomorrow's, else the day after). */
export function nextSunFire(after: number, site: SiteInfo, event: SunEvent, offsetMin = 0, sunTimes: SunTimesFn = defaultSunTimes): number | null {
  for (let d = 0; d <= 2; d++) {
    const t = sunEventAt(after + d * DAY_MS, site, event, offsetMin, sunTimes);
    if (t !== null && t > after) return t;
  }
  return null;
}

/** Next daily recompute instant (00:05 in site tz) strictly after `after`. */
export function nextSunRecompute(after: number, tz: string): number {
  const next = new Cron(SUN_RECOMPUTE_CRON, { timezone: tz, paused: true }).nextRun(new Date(after));
  return next ? next.getTime() : after + DAY_MS;
}
