export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendEmail } from "@/lib/email";

const NOTIFY_EMAILS = [
  "stslansky@gmail.com",
  "customersupport@thedietfantasy.com",
  
];

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

type PausedReportRow = {
  id: string;
  fullName: string | null;
  expirationDate: string | null;
  /** Shown in email: "Primary" or "Dependent of …" */
  roleLabel: string;
};

function isPrimaryRow(parentClientId: string | null | undefined): boolean {
  return parentClientId == null || parentClientId === "";
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
      .select(
        "id, full_name, first_name, last_name, expiration_date, paused, parent_client_id"
      )
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

    const expiringRows = (clients ?? []).map((c) => ({
      id: c.id as string,
      fullName: c.full_name as string | null,
      firstName: c.first_name as string | null,
      lastName: c.last_name as string | null,
      expirationDate: c.expiration_date as string | null,
      parentClientId:
        c.parent_client_id != null && String(c.parent_client_id).trim() !== ""
          ? String(c.parent_client_id)
          : null,
    }));

    const primaryIdsExpiring = expiringRows
      .filter((r) => isPrimaryRow(r.parentClientId))
      .map((r) => r.id);

    const primaryFullNameById = new Map(
      expiringRows
        .filter((r) => isPrimaryRow(r.parentClientId))
        .map((r) => [r.id, r.fullName ?? ""])
    );

    const displayNameById = new Map(primaryFullNameById);
    const missingParentIdsForLabel = [
      ...new Set(
        expiringRows
          .filter(
            (r) =>
              !isPrimaryRow(r.parentClientId) &&
              r.parentClientId &&
              !displayNameById.has(r.parentClientId)
          )
          .map((r) => r.parentClientId!)
      ),
    ];
    if (missingParentIdsForLabel.length > 0) {
      const { data: parentNames, error: parentNameErr } = await supabase
        .from("clients")
        .select("id, full_name")
        .in("id", missingParentIdsForLabel);
      if (parentNameErr) {
        console.error("[pause-expiring-clients] parent names", parentNameErr);
        return NextResponse.json(
          {
            error: "Failed to load parent names for dependents",
            details: parentNameErr.message,
          },
          { status: 500 }
        );
      }
      for (const p of parentNames ?? []) {
        displayNameById.set(String(p.id), (p.full_name as string | null) ?? "");
      }
    }

    const expiringRowsById = new Map(expiringRows.map((r) => [r.id, r]));
    const expiringIds = new Set(expiringRows.map((r) => r.id));

    let dependentRows: typeof expiringRows = [];
    if (primaryIdsExpiring.length > 0) {
      const { data: dependents, error: depError } = await supabase
        .from("clients")
        .select(
          "id, full_name, first_name, last_name, expiration_date, paused, parent_client_id"
        )
        .in("parent_client_id", primaryIdsExpiring)
        .eq("paused", false);

      if (depError) {
        console.error("[pause-expiring-clients] dependents fetch", depError);
        return NextResponse.json(
          {
            error: "Failed to fetch dependents",
            details: depError.message,
          },
          { status: 500 }
        );
      }

      dependentRows = (dependents ?? []).map((c) => ({
        id: c.id as string,
        fullName: c.full_name as string | null,
        firstName: c.first_name as string | null,
        lastName: c.last_name as string | null,
        expirationDate: c.expiration_date as string | null,
        parentClientId:
          c.parent_client_id != null && String(c.parent_client_id).trim() !== ""
            ? String(c.parent_client_id)
            : null,
      }));
    }

    /** Dependents paused only because their primary is expiring (not already in expiring batch). */
    const dependentsExtra = dependentRows.filter((d) => !expiringIds.has(d.id));

    const reportRows: PausedReportRow[] = [
      ...expiringRows.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        expirationDate: r.expirationDate,
        roleLabel: isPrimaryRow(r.parentClientId)
          ? "Primary"
          : `Dependent of ${
              (r.parentClientId && displayNameById.get(r.parentClientId)) ||
              "primary account"
            }`,
      })),
      ...dependentsExtra.map((d) => {
        const parentId = d.parentClientId ?? "";
        const parentName =
          primaryFullNameById.get(parentId) ?? displayNameById.get(parentId) ?? "primary account";
        const parentExp =
          d.expirationDate ??
          (parentId ? expiringRowsById.get(parentId)?.expirationDate : null) ??
          null;
        return {
          id: d.id,
          fullName: d.fullName,
          expirationDate: parentExp,
          roleLabel: `Dependent of ${parentName}`,
        };
      }),
    ];

    const listForApi = reportRows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      expirationDate: r.expirationDate,
      roleLabel: r.roleLabel,
    }));

    const dependentsPausedWithPrimaryCount = dependentsExtra.length;

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
        count: reportRows.length,
        expiringWithAuthorizationCount: expiringRows.length,
        dependentsPausedWithPrimaryCount,
        clients: listForApi,
      });
    }

    const allIds = [...new Set(reportRows.map((r) => r.id))];

    if (allIds.length === 0) {
      return NextResponse.json({
        dryRun: false,
        paused: 0,
        clientIds: [],
        window: { start: startDate, end: endDate },
      });
    }

    const { error: updateError } = await supabase
      .from("clients")
      .update({ paused: true, updated_at: new Date().toISOString() })
      .in("id", allIds);

    if (updateError) {
      console.error("[pause-expiring-clients]", updateError);
      return NextResponse.json(
        {
          error: "Failed to pause clients",
          details: updateError.message,
          clientIds: allIds,
        },
        { status: 500 }
      );
    }

    // Email who was paused (best-effort; don't fail the cron if email fails)
    const totalPaused = reportRows.length;
    const rowsHtml = reportRows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.fullName ?? "")}</td><td>${escapeHtml(String(r.expirationDate ?? ""))}</td><td>${escapeHtml(r.roleLabel)}</td></tr>`
      )
      .join("");
    const html = `
      <p><strong>Paused ${totalPaused} client record(s)</strong> with expiration date between ${startDate} and ${endDate}.</p>
      <p>Includes clients whose authorization expires in this window, plus any active dependents of those households (primaries).</p>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <thead><tr><th>Client</th><th>Expiration date</th><th>Role</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
    const emailResult = await sendEmail({
      to: NOTIFY_EMAILS.join(", "),
      subject: `Diet Fantasy: ${totalPaused} client record(s) paused (expiration ${startDate}–${endDate})`,
      html,
    });
    if (!emailResult.success) {
      console.error("[pause-expiring-clients] Email failed:", emailResult.error);
    }

    return NextResponse.json({
      dryRun: false,
      paused: allIds.length,
      clientIds: allIds,
      window: { start: startDate, end: endDate },
      expiringWithAuthorizationCount: expiringRows.length,
      dependentsPausedWithPrimaryCount,
      clients: listForApi,
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
