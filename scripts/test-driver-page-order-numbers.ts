/**
 * Test that the driver page gets order numbers for a specific driver and date.
 * This script:
 * 1. Fetches the route API (same as the driver page) for the given delivery_date
 * 2. Finds the route for the given driver id
 * 3. Queries the orders table for that date (same source as /orders page)
 * 4. Asserts every stop whose client has an order on that date has orderNumber set and correct
 *
 * Run (dev server must be running):
 *   DELIVERY_DATE=2026-02-16 DRIVER_ID=1c9b3148-9ab1-4a47-b217-7ebd53f546de npm run test-driver-page-order-numbers
 * Or: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/test-driver-page-order-numbers.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const DELIVERY_DATE = process.env.DELIVERY_DATE || "2026-02-16";
const DRIVER_ID = process.env.DRIVER_ID || "1c9b3148-9ab1-4a47-b217-7ebd53f546de";

async function main() {
  console.log("=== Test: Driver page order numbers ===\n");
  console.log("Config: BASE_URL=", BASE_URL, " DELIVERY_DATE=", DELIVERY_DATE, " DRIVER_ID=", DRIVER_ID);

  // 1) Fetch route API (exactly what the driver page uses); add debug=1 to see direct order-number map size
  const apiUrl = `${BASE_URL}/api/route/routes?delivery_date=${encodeURIComponent(DELIVERY_DATE)}&light=1&debug=1`;
  console.log("\n1) Fetching route API:", apiUrl);

  let res: Response;
  try {
    res = await fetch(apiUrl);
  } catch (e) {
    console.error("Fetch failed. Is the dev server running (npm run dev)?", e);
    process.exit(1);
  }
  if (!res.ok) {
    console.error("API returned", res.status, res.statusText, await res.text().then((t) => t.slice(0, 500)));
    process.exit(1);
  }

  const data = await res.json();
  if (data._debug) {
    console.log("   API _debug:", data._debug, "(orderNumbersByClientCount = direct orders-by-date map size in API)");
  } else {
    console.log("   API _debug: (not present — restart dev server with 'npm run dev' and run this test again to load latest code)");
  }
  const routes: any[] = data?.routes || [];
  const driverRoute = routes.find((r: any) => String(r.driverId) === String(DRIVER_ID));

  if (!driverRoute) {
    console.error("\nFAIL: No route found for driver", DRIVER_ID);
    console.log("Available driverIds:", routes.map((r: any) => r.driverId));
    process.exit(1);
  }

  const stops: any[] = driverRoute.stops || [];
  console.log("   Driver route found. Stops count:", stops.length);

  if (stops.length === 0) {
    console.log("\nNo stops on this route for this date. Nothing to assert.");
    return;
  }

  // 2) From DB: orders for this date (same source as /orders page)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.warn("Supabase env not set; skipping DB comparison. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to compare.");
  }

  const orderNumberByClientId = new Map<string, number>();
  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: orders, error } = await supabase
      .from("orders")
      .select("client_id, order_number")
      .eq("scheduled_delivery_date", DELIVERY_DATE)
      .not("order_number", "is", null);

    if (error) {
      console.error("DB query error:", error.message);
    } else if (orders?.length) {
      for (const o of orders) {
        const cid = String(o.client_id);
        const num = o.order_number != null ? Number(o.order_number) : null;
        if (cid && num != null && Number.isFinite(num)) {
          orderNumberByClientId.set(cid, num);
        }
      }
      console.log("\n2) Orders in DB for", DELIVERY_DATE, ":", orderNumberByClientId.size, "clients with order_number");
    } else {
      console.log("\n2) Orders in DB for", DELIVERY_DATE, ": 0 rows (no orders for this date)");
    }
  }

  // 3) Report each stop and assert
  console.log("\n3) Stops on driver route (first 20):");
  let failed = 0;
  let passed = 0;
  const missing: any[] = [];

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    const clientId = String(s.userId ?? s.client_id ?? "");
    const deliveryDate = s.delivery_date ? String(s.delivery_date).split("T")[0].split(" ")[0] : null;
    const orderNumber = s.orderNumber ?? s.order_number;
    const expectedNumber = clientId ? orderNumberByClientId.get(clientId) ?? null : null;

    const hasExpected = expectedNumber != null;
    const hasActual = orderNumber != null && orderNumber !== "";
    const match = hasExpected && hasActual && Number(orderNumber) === Number(expectedNumber);

    if (i < 20) {
      console.log(
        `   [${i + 1}] client_id=${clientId} delivery_date=${deliveryDate} orderNumber=${orderNumber} expected=${expectedNumber ?? "n/a"} ${match ? "OK" : hasExpected && !hasActual ? "MISSING" : !hasExpected ? "no order in DB" : "MISMATCH"}`
      );
    }

    if (hasExpected && !hasActual) {
      failed++;
      missing.push({ clientId, expectedNumber, stop: s });
    } else if (hasExpected && hasActual && Number(orderNumber) !== Number(expectedNumber)) {
      failed++;
      missing.push({ clientId, expectedNumber, actual: orderNumber, stop: s });
    } else if (hasExpected) {
      passed++;
    }
  }

  if (stops.length > 20) {
    console.log("   ... and", stops.length - 20, "more stops");
  }

  console.log("\n--- Result ---");
  console.log("Stops with order in DB for this date:", orderNumberByClientId.size);
  console.log("Stops on route:", stops.length);
  console.log("Stops that should have order number (client has order on this date):", passed + failed);
  console.log("  Passed (orderNumber present and correct):", passed);
  console.log("  Failed (missing or wrong orderNumber):", failed);

  if (failed > 0) {
    console.error("\nFAIL: Some stops that have an order in the orders table for", DELIVERY_DATE, "are missing or have wrong orderNumber in the API.");
    console.error("First 5 failures:", missing.slice(0, 5));
    process.exit(1);
  }

  if (orderNumberByClientId.size > 0 && passed === 0 && failed === 0) {
    console.warn("\nWARN: There are orders in DB for this date but no stop on this driver's route has a matching client_id. So no stop was asserted.");
  } else {
    console.log("\nOK: All stops that have an order for this date in the orders table have the correct orderNumber in the API response.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
