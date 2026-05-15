/**
 * Produce vendor weekly roster: Sunday–Saturday in America/New_York.
 * Enrollment cutoff for roster week starting Sunday S: Friday 23:59:59.999 Eastern
 * in the same calendar week as (S − 2 days), i.e. the Friday immediately before that Sunday.
 */

import { DAY_NAME_TO_NUMBER } from './order-dates';
import {
  easternWallClockToUtcInstant,
  getWeekdayOfDateInAppTz,
  toDateStringInAppTz,
} from './timezone';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Add calendar days to a YYYY-MM-DD key in app timezone (small deltas; noon anchor per day). */
export function addCalendarDaysAppTz(dateKey: string, deltaDays: number): string {
  if (!DATE_KEY.test(dateKey)) throw new RangeError(`Invalid dateKey: ${dateKey}`);
  if (deltaDays === 0) return dateKey;
  const step = deltaDays >= 0 ? 1 : -1;
  let cur = dateKey;
  for (let i = 0; i < Math.abs(deltaDays); i++) {
    const noon = easternWallClockToUtcInstant(cur, 12, 0, 0, 0);
    cur = toDateStringInAppTz(new Date(noon.getTime() + step * 24 * 60 * 60 * 1000));
  }
  return cur;
}

/** Sunday YYYY-MM-DD of the roster week that contains `now` (Eastern calendar). */
export function getRosterWeekStartSundayDateKey(now: Date = new Date()): string {
  const todayKey = toDateStringInAppTz(now);
  const wd = getWeekdayOfDateInAppTz(todayKey);
  return addCalendarDaysAppTz(todayKey, -wd);
}

/** Sunday YYYY-MM-DD of the roster week that contains the given calendar date (Eastern). */
export function getRosterWeekStartSundayForCalendarDateKey(dateKey: string): string {
  if (!DATE_KEY.test(dateKey)) throw new RangeError(`Invalid dateKey: ${dateKey}`);
  const wd = getWeekdayOfDateInAppTz(dateKey);
  return addCalendarDaysAppTz(dateKey, -wd);
}

/**
 * Friday 23:59:59.999 America/New_York at the end of the week before roster week `rosterWeekStartSundayKey`.
 * (= two calendar days before that Sunday, same Eastern week as that Friday.)
 */
export function getRosterCutoffInstantIsoForWeek(rosterWeekStartSundayKey: string): string {
  if (!DATE_KEY.test(rosterWeekStartSundayKey)) {
    throw new RangeError(`Invalid rosterWeekStartSundayKey: ${rosterWeekStartSundayKey}`);
  }
  const fridayKey = addCalendarDaysAppTz(rosterWeekStartSundayKey, -2);
  return easternWallClockToUtcInstant(fridayKey, 23, 59, 59, 999).toISOString();
}

/** Saturday YYYY-MM-DD (end of roster week) for a given roster Sunday. */
export function getRosterWeekEndSaturdayDateKey(rosterWeekStartSundayKey: string): string {
  return addCalendarDaysAppTz(rosterWeekStartSundayKey, 6);
}

/**
 * Client appears on the vendor roster for roster week `rosterWeekStartSundayKey` iff
 * produce_roster_effective_at <= end of the enrollment Friday cutoff for that week.
 */
export function isEligibleForRosterWeek(
  produceRosterEffectiveAtIso: string | null | undefined,
  rosterWeekStartSundayKey: string
): boolean {
  if (!produceRosterEffectiveAtIso) return false;
  const t = new Date(produceRosterEffectiveAtIso).getTime();
  if (Number.isNaN(t)) return false;
  const cutoffEnd = new Date(getRosterCutoffInstantIsoForWeek(rosterWeekStartSundayKey)).getTime();
  return t <= cutoffEnd;
}

/**
 * Which roster week (Sunday key) weekly Produce orders should target right now.
 * After the Friday cutoff for week (sunNext), we advance to sunNext; otherwise we stay on sunThis.
 */
export function getProduceOrderRosterWeekSundayKey(now: Date = new Date()): string {
  const sunThis = getRosterWeekStartSundayDateKey(now);
  const sunNext = addCalendarDaysAppTz(sunThis, 7);
  const cutNextEnd = new Date(getRosterCutoffInstantIsoForWeek(sunNext)).getTime();
  if (now.getTime() > cutNextEnd) return sunNext;
  return sunThis;
}

/**
 * First calendar date in [rosterSunday, rosterSunday+6] whose weekday matches `deliveryDayName` (e.g. "Tuesday").
 * If `deliveryDayName` is missing/invalid, returns rosterSunday.
 */
export function firstDeliveryDayDateKeyInRosterWeek(
  rosterWeekStartSundayKey: string,
  deliveryDayName: string | null | undefined
): string {
  if (!deliveryDayName) return rosterWeekStartSundayKey;
  const targetWd = DAY_NAME_TO_NUMBER[deliveryDayName];
  if (targetWd === undefined) return rosterWeekStartSundayKey;
  for (let i = 0; i <= 6; i++) {
    const dk = addCalendarDaysAppTz(rosterWeekStartSundayKey, i);
    if (getWeekdayOfDateInAppTz(dk) === targetWd) return dk;
  }
  return rosterWeekStartSundayKey;
}

/** True if dateKey (YYYY-MM-DD) lies in the roster week starting rosterSunday (inclusive). */
export function isDateKeyInRosterWeek(dateKey: string | null | undefined, rosterWeekStartSundayKey: string): boolean {
  if (!dateKey || !DATE_KEY.test(String(dateKey).slice(0, 10))) return false;
  const d = String(dateKey).slice(0, 10);
  const sun = rosterWeekStartSundayKey;
  const sat = getRosterWeekEndSaturdayDateKey(sun);
  return d >= sun && d <= sat;
}
