/**
 * Set all current clients to:
 *   - status: Active
 *   - 21 Meals/Week (approved_meals_per_week)
 *   - navigator: Orit Freid (single navigator)
 *
 * Usage:
 *   node scripts/set-all-clients-active-21-meals-orit.js [--dry-run]
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const MEALS_PER_WEEK = 21;
const TARGET_STATUS_NAME = "Active";
const TARGET_NAVIGATOR_NAME = "Orit Fried";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error("Missing env:", name);
    process.exit(1);
  }
  return v;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("DRY RUN – no database writes.\n");

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Resolve Active status id
  const { data: statuses, error: statusErr } = await supabase
    .from("client_statuses")
    .select("id, name");
  if (statusErr) {
    console.error("Error fetching client_statuses:", statusErr.message);
    process.exit(1);
  }
  const activeStatus = (statuses || []).find(
    (s) => s.name && s.name.trim().toLowerCase() === TARGET_STATUS_NAME.toLowerCase()
  );
  if (!activeStatus) {
    console.error(
      `Status "${TARGET_STATUS_NAME}" not found. Available:`,
      (statuses || []).map((s) => s.name).join(", ")
    );
    process.exit(1);
  }
  const statusId = activeStatus.id;
  console.log("Using status:", activeStatus.name, "id:", statusId);

  // Resolve Orit Freid navigator id
  const { data: navigators, error: navErr } = await supabase
    .from("navigators")
    .select("id, name");
  if (navErr) {
    console.error("Error fetching navigators:", navErr.message);
    process.exit(1);
  }
  let orit = (navigators || []).find(
    (n) => n.name && n.name.trim() === TARGET_NAVIGATOR_NAME
  );
  if (!orit) {
    orit = (navigators || []).find(
      (n) => n.name && n.name.trim().toLowerCase() === TARGET_NAVIGATOR_NAME.toLowerCase()
    );
  }
  if (!orit) {
    console.error(
      `Navigator "${TARGET_NAVIGATOR_NAME}" not found. Available:`,
      (navigators || []).map((n) => n.name).join(", ")
    );
    process.exit(1);
  }
  const navigatorId = orit.id;
  console.log("Using navigator:", orit.name, "id:", navigatorId);

  // Fetch all client ids (only independent clients if you want; here we do ALL clients)
  const { data: clients, error: clientsErr } = await supabase
    .from("clients")
    .select("id, full_name, status_id, approved_meals_per_week, navigator_id");
  if (clientsErr) {
    console.error("Error fetching clients:", clientsErr.message);
    process.exit(1);
  }
  const list = clients || [];
  console.log("Total clients to update:", list.length);
  if (list.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const payload = {
    status_id: statusId,
    approved_meals_per_week: MEALS_PER_WEEK,
    navigator_id: navigatorId,
    updated_at: new Date().toISOString(),
  };

  if (dryRun) {
    console.log("\nWould set for all clients:", payload);
    console.log("Dry run done. Run without --dry-run to apply.");
    return;
  }

  // Update in batches (Supabase may limit in() size)
  const BATCH = 100;
  let updated = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const ids = batch.map((c) => c.id);
    const { error: updateErr } = await supabase
      .from("clients")
      .update(payload)
      .in("id", ids);
    if (updateErr) {
      console.error("Batch update error:", updateErr.message);
      process.exit(1);
    }
    updated += batch.length;
    console.log("Updated", updated, "/", list.length);
  }
  console.log("Done. All clients set to Active, 21 Meals/Week, navigator Orit Freid.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
