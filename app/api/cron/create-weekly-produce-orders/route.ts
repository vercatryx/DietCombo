export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { ensureWeeklyProduceOrdersFromCron } from "@/lib/actions";
import { addCalendarDaysAppTz, getProduceOrderRosterWeekSundayKey } from "@/lib/produce-roster-week";

/**
 * Creates pending Produce orders for the active roster week (Sunday–Saturday, America/New_York)
 * after the weekly Friday 11:59:59 PM ET enrollment cutoff. Idempotent per (client, scheduled_delivery_date).
 *
 * Vercel cron: one weekly run (e.g. Saturday 07:15 UTC) after Friday 11:59:59 PM Eastern in both
 * EST and EDT. The job is idempotent if invoked more than once.
 *
 * Manual (requires CRON_SECRET + Bearer token):
 * - `?nextWeek=1` — roster week **after** the one {@link getProduceOrderRosterWeekSundayKey} would use for "now".
 * - `?rosterWeekSunday=YYYY-MM-DD` — explicit roster Sunday (must be Sunday in America/New_York).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";

  const url = new URL(req.url);
  const nextWeek = url.searchParams.get("nextWeek");
  const rosterSundayParam = url.searchParams.get("rosterWeekSunday")?.trim();

  const wantsManualWeek =
    nextWeek === "1" ||
    nextWeek === "true" ||
    (rosterSundayParam != null && rosterSundayParam !== "");

  if (wantsManualWeek) {
    if (!secret) {
      return NextResponse.json(
        {
          error:
            "Set CRON_SECRET and send Authorization: Bearer <CRON_SECRET> to use nextWeek or rosterWeekSunday.",
        },
        { status: 403 }
      );
    }
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rosterWeekSundayOverride: string | undefined;
  if (rosterSundayParam) {
    rosterWeekSundayOverride = rosterSundayParam.slice(0, 10);
  } else if (nextWeek === "1" || nextWeek === "true") {
    const automated = getProduceOrderRosterWeekSundayKey(new Date());
    rosterWeekSundayOverride = addCalendarDaysAppTz(automated, 7);
  }

  const result = await ensureWeeklyProduceOrdersFromCron(
    rosterWeekSundayOverride ? { rosterWeekSundayOverride } : undefined
  );
  if (!result.success) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
