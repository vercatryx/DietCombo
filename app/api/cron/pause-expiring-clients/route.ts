export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";

const NOTIFY_EMAIL = "stslansky@gmail.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Returns the date of "this week's Friday" for the purpose of the pause window.
 * When run on Friday: that Friday. When run any other day: the next upcoming Friday.
 * Window is then Friday (inclusive) through the following Thursday (inclusive).
 */
function getWindowStartFriday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  // getDay: 0 = Sun, 5 = Fri. (5 - day + 7) % 7 = days until next/this Friday.
  const day = d.getDay();
  const daysUntilFriday = (5 - day + 7) % 7;
  d.setDate(d.getDate() + daysUntilFriday);
  return d;
}

function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dryRun = ["1", "true", "yes"].includes(
    (searchParams.get("dry_run") ?? "").toLowerCase()
  );

  try {
    const now = new Date();
    const friday = getWindowStartFriday(now);
    const thursday = new Date(friday);
    thursday.setDate(thursday.getDate() + 6);

    const startDate = toYYYYMMDD(friday);
    const endDate = toYYYYMMDD(thursday);

    const { data: clients, error } = await supabase
      .from("clients")
      .select("id, full_name, first_name, last_name, expiration_date, paused")
      .not("expiration_date", "is", null)
      .gte("expiration_date", startDate)
      .lte("expiration_date", endDate)
      .eq("paused", false)
      .order("expiration_date", { ascending: true });

    if (error) {
      console.error("[pause-expiring-clients]", error);
      return NextResponse.json(
        { error: "Failed to fetch clients", details: error.message },
        { status: 500 }
      );
    }

    const list = (clients ?? []).map((c) => ({
      id: c.id,
      fullName: c.full_name,
      firstName: c.first_name,
      lastName: c.last_name,
      expirationDate: c.expiration_date,
    }));

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        message:
          "Dry run: no clients were updated. This is who would be paused when the cron runs on Friday.",
        window: {
          start: startDate,
          end: endDate,
          description: `${startDate} (Friday) through ${endDate} (Thursday)`,
        },
        count: list.length,
        clients: list,
      });
    }

    if (list.length === 0) {
      return NextResponse.json({
        dryRun: false,
        paused: 0,
        clientIds: [],
        window: { start: startDate, end: endDate },
      });
    }

    const ids = list.map((c) => c.id);
    const { error: updateError } = await supabase
      .from("clients")
      .update({ paused: true, updated_at: new Date().toISOString() })
      .in("id", ids);

    if (updateError) {
      console.error("[pause-expiring-clients]", updateError);
      return NextResponse.json(
        {
          error: "Failed to pause clients",
          details: updateError.message,
          clientIds: ids,
        },
        { status: 500 }
      );
    }

    // Email who was paused (best-effort; don't fail the cron if email fails)
    const rows = list
      .map(
        (c) =>
          `<tr><td>${escapeHtml(c.fullName ?? "")}</td><td>${escapeHtml(String(c.expirationDate ?? ""))}</td></tr>`
      )
      .join("");
    const html = `
      <p><strong>Paused ${list.length} client(s)</strong> with expiration date between ${startDate} and ${endDate}.</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <thead><tr><th>Client</th><th>Expiration date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    const emailResult = await sendEmail({
      to: NOTIFY_EMAIL,
      subject: `Diet Fantasy: ${list.length} client(s) paused (expiration ${startDate}–${endDate})`,
      html,
    });
    if (!emailResult.success) {
      console.error("[pause-expiring-clients] Email failed:", emailResult.error);
    }

    return NextResponse.json({
      dryRun: false,
      paused: ids.length,
      clientIds: ids,
      window: { start: startDate, end: endDate },
      clients: list,
      emailSent: emailResult.success,
    });
  } catch (e) {
    console.error("[pause-expiring-clients]", e);
    return NextResponse.json(
      { error: "Unexpected error", details: String(e) },
      { status: 500 }
    );
  }
}
