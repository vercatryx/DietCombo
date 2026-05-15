export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextResponse } from "next/server";
import { ensureWeeklyProduceOrdersFromCron } from "@/lib/actions";

/**
 * Creates pending Produce orders for the active roster week (Sunday–Saturday, America/New_York)
 * after the weekly Friday 11:59:59 PM ET enrollment cutoff. Idempotent per (client, scheduled_delivery_date).
 *
 * Vercel cron: two UTC triggers around end-of-Friday Eastern (EST vs EDT). Safe to run twice.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await ensureWeeklyProduceOrdersFromCron();
  if (!result.success) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
