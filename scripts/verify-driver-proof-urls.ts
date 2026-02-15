/**
 * Verifies that the route API returns proofUrl on stops when orders have proof_of_delivery_url.
 * Run: DELIVERY_DATE=YYYY-MM-DD npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/verify-driver-proof-urls.ts
 * Or with dev server: npm run dev, then in another terminal run the script (optionally set BASE_URL).
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

function normalizeDate(d: string | null | undefined): string | null {
  if (!d) return null;
  return String(d).split("T")[0].split(" ")[0];
}

async function main() {
  const deliveryDate = process.env.DELIVERY_DATE;
  if (!deliveryDate) {
    console.error("Set DELIVERY_DATE=YYYY-MM-DD (e.g. 2026-02-16)");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1) From DB: orders with proof_of_delivery_url for this date (or any date if we need to find one)
  const { data: ordersWithProof, error: ordErr } = await supabase
    .from("orders")
    .select("id, client_id, scheduled_delivery_date, proof_of_delivery_url")
    .not("proof_of_delivery_url", "is", null)
    .neq("proof_of_delivery_url", "");

  if (ordErr) {
    console.error("DB orders query error:", ordErr.message);
    process.exit(1);
  }

  const ordersWithProofList = (ordersWithProof || []).filter(
    (o: any) => o.proof_of_delivery_url && String(o.proof_of_delivery_url).trim()
  );
  const forDate = (ordersWithProofList as any[]).filter(
    (o) => normalizeDate(o.scheduled_delivery_date) === deliveryDate
  );

  console.log("=== Verify driver proof URLs ===\n");
  console.log("DELIVERY_DATE:", deliveryDate);
  console.log("DB: orders with proof_of_delivery_url (all dates):", ordersWithProofList.length);
  console.log("DB: orders with proof for this date:", forDate.length);
  if (forDate.length === 0 && ordersWithProofList.length > 0) {
    const sample = ordersWithProofList[0];
    const d = normalizeDate((sample as any).scheduled_delivery_date);
    console.log("Hint: try DELIVERY_DATE=" + d);
  }

  // 2) Fetch route API (same as driver page)
  const url = `${BASE_URL}/api/route/routes?delivery_date=${encodeURIComponent(deliveryDate)}&light=1`;
  console.log("\nFetching API:", url);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    console.error("Fetch failed. Is the dev server running?", e);
    process.exit(1);
  }
  if (!res.ok) {
    console.error("API returned", res.status, await res.text().then((t) => t.slice(0, 300)));
    process.exit(1);
  }

  const data = await res.json();
  const routes = data?.routes || [];
  const unrouted = data?.unrouted || [];
  const allStops = [...routes.flatMap((r: any) => r.stops || []), ...unrouted];
  console.log("API: routes:", routes.length, "allStops:", allStops.length);

  const withProof = allStops.filter((s: any) => !!((s?.proofUrl ?? s?.proof_url) || "").trim());
  console.log("API: stops with proofUrl:", withProof.length, "/", allStops.length);

  // 3) Expected: for each order with proof for this date, there should be a stop with same client_id and date that has proofUrl
  const dateNorm = deliveryDate;
  const stopKey = (s: any) => `${s.userId ?? s.client_id}|${normalizeDate(s.delivery_date)}`;
  const stopsByKey = new Map<string, any>();
  for (const s of allStops) {
    const k = stopKey(s);
    if (k && !stopsByKey.has(k)) stopsByKey.set(k, s);
  }

  let failed = 0;
  for (const order of forDate) {
    const cid = String(order.client_id);
    const key = `${cid}|${dateNorm}`;
    const stop = stopsByKey.get(key);
    const proofUrl = stop ? (stop.proofUrl ?? stop.proof_url) : null;
    const hasProof = !!(proofUrl && String(proofUrl).trim());
    if (!hasProof) {
      failed++;
      if (failed <= 10) {
        console.log("FAIL expected proof: client_id=" + cid + " order_id=" + order.id + " stop_id=" + (stop?.id ?? "no stop"));
      }
    }
  }

  if (forDate.length === 0) {
    console.log("\nNo orders with proof for this date; nothing to verify.");
    return;
  }

  const passed = forDate.length - failed;
  console.log("\nResult: " + passed + "/" + forDate.length + " orders-with-proof have a matching stop with proofUrl");
  if (failed > 0) {
    console.error("\nFAIL: " + failed + " expected proof(s) missing.");
    process.exit(1);
  }
  console.log("\nOK: All orders with proof for this date have a stop with proofUrl.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
