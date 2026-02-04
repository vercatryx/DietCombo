import { cookies } from 'next/headers';

/**
 * Returns the current time (moment in time).
 * On component/server actions (where cookies() is available), it checks for the 'x-fake-time' cookie.
 * For Client Components, use the TimeContext.
 *
 * For "today" in business logic (order creation, delivery dates, cutoffs), use Eastern time
 * via getTodayDateInAppTzAsReference(currentTime) or getTodayInAppTz(currentTime) from lib/timezone.ts
 * so that server UTC does not shift the calendar day.
 */
export async function getCurrentTime(): Promise<Date> {
    try {
        const cookieStore = await cookies();
        const fakeTimeCookie = cookieStore.get('x-fake-time');

        if (fakeTimeCookie && fakeTimeCookie.value) {
            const fakeDate = new Date(fakeTimeCookie.value);
            if (!isNaN(fakeDate.getTime())) {
                return fakeDate;
            }
        }
    } catch (error) {
        // cookies() might fail if called outside of request context (e.g. static gen), fallback to real time
    }

    return new Date();
}
