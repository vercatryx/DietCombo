import { cookies } from 'next/headers';

/**
 * Returns the current time.
 * On component/server actions (where cookies() is available), it checks for the 'x-fake-time' cookie.
 * On client (if this were used directly, though strictly this uses next/headers so it's server-only),
 * it would fail.
 * 
 * For Client Components, use the TimeContext.
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
