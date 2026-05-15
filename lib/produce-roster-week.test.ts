/**
 * Run: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' lib/produce-roster-week.test.ts
 */
import assert from 'assert';
import {
  addCalendarDaysAppTz,
  getRosterCutoffInstantIsoForWeek,
  getRosterWeekStartSundayDateKey,
  getRosterWeekStartSundayForCalendarDateKey,
  getProduceOrderRosterWeekSundayKey,
  isEligibleForRosterWeek,
  firstDeliveryDayDateKeyInRosterWeek,
  isRosterWeekSundayDateKeyInAppTz,
} from './produce-roster-week';
import { easternWallClockToUtcInstant } from './timezone';

function eq<T>(a: T, b: T, m?: string) {
  assert.strictEqual(a, b, m);
}

// 2026-05-17 is Sunday (America/New_York). Cutoff Friday is 2026-05-15.
const rosterSun = '2026-05-17';
const cut = getRosterCutoffInstantIsoForWeek(rosterSun);
eq(cut, easternWallClockToUtcInstant('2026-05-15', 23, 59, 59, 999).toISOString());

eq(addCalendarDaysAppTz(rosterSun, -2), '2026-05-15');
eq(addCalendarDaysAppTz(rosterSun, 6), '2026-05-23');

eq(getRosterWeekStartSundayForCalendarDateKey('2026-05-20'), rosterSun);

eq(firstDeliveryDayDateKeyInRosterWeek(rosterSun, 'Tuesday'), '2026-05-19');
eq(firstDeliveryDayDateKeyInRosterWeek(rosterSun, 'Sunday'), rosterSun);

// Thu May 14 2026 (ET) → roster week starts Sun May 10
const thu = new Date('2026-05-14T16:00:00.000Z');
const sunThis = getRosterWeekStartSundayDateKey(thu);
eq(sunThis, '2026-05-10');
eq(getProduceOrderRosterWeekSundayKey(thu), '2026-05-10');

// Sun May 17 2026 6am ET → still in “order week” May 17 until cutoff for May 24 week
const afterCut = new Date('2026-05-17T06:00:00.000-04:00');
eq(getRosterWeekStartSundayDateKey(afterCut), rosterSun);
eq(getProduceOrderRosterWeekSundayKey(afterCut), rosterSun);

const satAfter = new Date('2026-05-24T06:00:00.000-04:00');
eq(getProduceOrderRosterWeekSundayKey(satAfter), '2026-05-24');

// Eligibility vs cutoff for week starting rosterSun
const cutEnd = new Date(getRosterCutoffInstantIsoForWeek(rosterSun)).getTime();
eq(isEligibleForRosterWeek(new Date(cutEnd - 60_000).toISOString(), rosterSun), true);
eq(isEligibleForRosterWeek(new Date(cutEnd + 60_000).toISOString(), rosterSun), false);
eq(isEligibleForRosterWeek(null, rosterSun), false);

eq(isRosterWeekSundayDateKeyInAppTz('2026-05-17'), true);
eq(isRosterWeekSundayDateKeyInAppTz('2026-05-18'), false);

console.log('produce-roster-week tests passed');
