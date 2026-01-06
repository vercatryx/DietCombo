
import { getEarliestEffectiveDate, isDeliveryDateLocked, getWeekStart } from '../lib/weekly-lock';
import { AppSettings } from '../lib/types';

// Mock Settings
const mockSettings: AppSettings = {
    weeklyCutoffDay: 'Friday',
    weeklyCutoffTime: '12:00',
    reportEmail: 'test@example.com'
};

function runTest(name: string, fn: () => void) {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (e: any) {
        console.error(`❌ ${name} FAILED: ${e.message}`);
    }
}

function assert(condition: boolean, message: string) {
    if (!condition) {
        throw new Error(message);
    }
}

function date(str: string): Date {
    return new Date(str);
}

console.log('--- STARTING WEEKLY LOCK TESTS ---');

// CANONICAL JANUARY EXAMPLE
// Week 1: Jan 4 (Sun) - Jan 10 (Sat) -> Active Week
// Week 2: Jan 11 (Sun) - Jan 17 (Sat) -> First Possible Effective Week
// Cutoff: Friday Jan 9, 12:00 PM

runTest('Scenario A: Sunday Jan 5 (Before Cutoff)', () => {
    // Current Time: Sunday Jan 5, 2026 10:00 AM
    const now = new Date('2026-01-05T10:00:00');

    // 1. Active Week (Jan 4-10) should be LOCKED
    const jan6 = new Date('2026-01-06T10:00:00'); // Tuesday
    assert(isDeliveryDateLocked(jan6, mockSettings, now) === true, 'Active week date (Jan 6) must be locked');

    // 2. Next Week (Jan 11-17) should be OPEN (because Jan 5 < Jan 9 cutoff)
    const jan12 = new Date('2026-01-12T10:00:00'); // Monday
    assert(isDeliveryDateLocked(jan12, mockSettings, now) === false, 'Next week date (Jan 12) must be open before cutoff');

    // 3. Earliest Effective Date should be Jan 11 (Start of next week)
    const effective = getEarliestEffectiveDate(mockSettings, now);
    assert(effective.toISOString().startsWith('2026-01-11'), `Earliest effective should be Jan 11, got ${effective.toISOString()}`);
});

runTest('Scenario B: Friday Jan 9, 13:00 PM (After Cutoff)', () => {
    // Current Time: Friday Jan 9, 2026 13:00 PM
    const now = new Date('2026-01-09T13:00:00');

    // 1. Active Week (Jan 4-10) should be LOCKED
    const jan6 = new Date('2026-01-06T10:00:00');
    assert(isDeliveryDateLocked(jan6, mockSettings, now) === true, 'Active week date must be locked');

    // 2. Next Week (Jan 11-17) should be LOCKED (because Jan 9 13:00 > Jan 9 12:00 cutoff)
    const jan12 = new Date('2026-01-12T10:00:00');
    assert(isDeliveryDateLocked(jan12, mockSettings, now) === true, 'Next week must be locked after cutoff passes');

    // 3. Week After Next (Jan 18-24) should be OPEN
    const jan19 = new Date('2026-01-19T10:00:00');
    assert(isDeliveryDateLocked(jan19, mockSettings, now) === false, 'Week after next must be open');

    // 4. Earliest Effective Date should be Jan 18
    const effective = getEarliestEffectiveDate(mockSettings, now);
    assert(effective.toISOString().startsWith('2026-01-18'), `Earliest effective should be Jan 18, got ${effective.toISOString()}`);
});

runTest('Edge Case: Exact Cutoff Time', () => {
    // Current Time: Friday Jan 9, 12:00:00
    const now = new Date('2026-01-09T12:00:00');

    // Should still be OPEN (inclusive or whatever logic? usually <= is allowed)
    // My implementation uses currentTime <= cutoff -> Next Week Start.
    const effective = getEarliestEffectiveDate(mockSettings, now);
    assert(effective.toISOString().startsWith('2026-01-11'), `Exact cutoff time should allow next week. Got ${effective.toISOString()}`);
});

runTest('Edge Case: Saturday Jan 10 (After Cutoff)', () => {
    // Current Time: Saturday Jan 10
    const now = new Date('2026-01-10T10:00:00');

    // Cutoff was Jan 9. Now > Cutoff.
    // Next Week (Jan 11) is Locked.
    // Effective -> Jan 18.
    const effective = getEarliestEffectiveDate(mockSettings, now);
    assert(effective.toISOString().startsWith('2026-01-18'), `Saturday post-cutoff should push to week after next. Got ${effective.toISOString()}`);
});

runTest('Edge Case: Sunday Jan 11 (New Active Week)', () => {
    // Current Time: Sunday Jan 11 08:00
    const now = new Date('2026-01-11T08:00:00');

    // New Active Week = Jan 11-17.
    // Cutoff for NEXT week (Jan 18-24) is Friday Jan 16.
    // Now (Jan 11) < Cutoff (Jan 16).
    // So Next Week (Jan 18) should be OPEN.

    // Active Week (Jan 11-17) Locked? YES.
    const jan12 = new Date('2026-01-12T10:00:00');
    assert(isDeliveryDateLocked(jan12, mockSettings, now) === true, 'New active week must be locked immediately');

    // Next Week (Jan 18-24) Open? YES.
    const jan19 = new Date('2026-01-19T10:00:00');
    assert(isDeliveryDateLocked(jan19, mockSettings, now) === false, 'Next week must be open start of week');

    // Effective -> Jan 18.
    const effective = getEarliestEffectiveDate(mockSettings, now);
    assert(effective.toISOString().startsWith('2026-01-18'), `New week start effective date should be next Sunday. Got ${effective.toISOString()}`);
});

console.log('--- TESTS COMPLETE ---');
