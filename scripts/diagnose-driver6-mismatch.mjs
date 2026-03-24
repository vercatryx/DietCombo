#!/usr/bin/env node
/**
 * Diagnostic script: Investigate the mismatch between
 *   Routes page (11 stops for Driver 6) vs
 *   Drivers app (6 bags at 3 addresses)
 *
 * Traces the exact data flow for both code paths.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
        "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (e.g. from .env.local) before running this script."
    );
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Today's date
const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, "0");
const dd = String(today.getDate()).padStart(2, "0");
const deliveryDate = `${yyyy}-${mm}-${dd}`;
const nextDay = (() => {
    const d = new Date(yyyy, today.getMonth(), today.getDate() + 1);
    return d.toISOString().slice(0, 10);
})();

console.log(`\n========================================`);
console.log(`  DRIVER 6 MISMATCH DIAGNOSTIC`);
console.log(`  Delivery date: ${deliveryDate}`);
console.log(`========================================\n`);

// ─── 1. Find "Driver 6" in the drivers table ───
console.log("=== STEP 1: Find Driver 6 in drivers table ===");
const { data: allDrivers } = await supabase
    .from("drivers")
    .select("id, name, day, color, stop_ids")
    .order("id");

const driver6Candidates = (allDrivers || []).filter(
    (d) => /driver\s+6/i.test(d.name)
);
console.log(`Total drivers: ${allDrivers?.length || 0}`);
console.log(`Drivers matching "Driver 6": ${driver6Candidates.length}`);
for (const d of driver6Candidates) {
    const stopIdsLen = Array.isArray(d.stop_ids) ? d.stop_ids.length : 0;
    console.log(`  - id=${d.id}, name="${d.name}", day="${d.day}", stop_ids count=${stopIdsLen}`);
}

if (driver6Candidates.length === 0) {
    console.log("\nNo Driver 6 found! Listing all drivers:");
    for (const d of allDrivers || []) {
        console.log(`  - id=${d.id}, name="${d.name}", day="${d.day}"`);
    }
    process.exit(1);
}

// Use the first match (or the one with day="all")
const driver6 = driver6Candidates[0];
const driverId = driver6.id;
console.log(`\nUsing Driver 6: id=${driverId}, day="${driver6.day}"`);

// ─── 2. Check driver_route_order for this driver ───
console.log("\n=== STEP 2: driver_route_order entries for Driver 6 ===");
const { data: routeOrderRows } = await supabase
    .from("driver_route_order")
    .select("driver_id, client_id, position")
    .eq("driver_id", driverId)
    .order("position");

console.log(`driver_route_order rows: ${routeOrderRows?.length || 0}`);
for (const row of routeOrderRows || []) {
    console.log(`  position=${row.position}, client_id=${row.client_id}`);
}

// ─── 3. Fetch clients for these client_ids ───
const clientIdsFromRouteOrder = (routeOrderRows || []).map((r) => r.client_id);
console.log("\n=== STEP 3: Clients from driver_route_order ===");
if (clientIdsFromRouteOrder.length > 0) {
    const { data: clients } = await supabase
        .from("clients")
        .select("id, first_name, last_name, full_name, address, apt, city, state, zip, paused, delivery, assigned_driver_id, lat, lng")
        .in("id", clientIdsFromRouteOrder);

    const clientById = new Map((clients || []).map((c) => [c.id, c]));

    for (const row of routeOrderRows || []) {
        const c = clientById.get(row.client_id);
        const name = c ? (c.full_name || `${c.first_name || ""} ${c.last_name || ""}`.trim()) : "NOT FOUND";
        const assignedTo = c?.assigned_driver_id || "null";
        const matchesDriver6 = assignedTo === driverId ? "YES" : `NO (assigned to ${assignedTo})`;
        const paused = c?.paused ? "PAUSED" : "active";
        const delivery = c?.delivery === false ? "delivery OFF" : "delivery ON";
        console.log(
            `  pos=${row.position} client=${row.client_id.slice(0, 8)}... name="${name}" assigned_driver_matches=${matchesDriver6} ${paused} ${delivery}`
        );
    }
}

// ─── 4. Fetch stops for today assigned to Driver 6 ───
console.log(`\n=== STEP 4: Stops for ${deliveryDate} ===`);

// 4a. Stops by delivery_date range (same as route API with day=all)
const { data: stopsForDate } = await supabase
    .from("stops")
    .select("id, client_id, name, address, apt, city, delivery_date, day, assigned_driver_id, completed, order_id, lat, lng")
    .gte("delivery_date", deliveryDate)
    .lt("delivery_date", nextDay);

console.log(`Total stops for ${deliveryDate}: ${stopsForDate?.length || 0}`);

// 4b. Which stops are assigned to Driver 6?
// Need to check BOTH stop.assigned_driver_id AND client.assigned_driver_id
const stopsClientIds = [...new Set((stopsForDate || []).map((s) => s.client_id).filter(Boolean))];
const { data: stopsClients } = stopsClientIds.length > 0
    ? await supabase.from("clients").select("id, assigned_driver_id, paused, delivery, full_name, first_name, last_name, address, apt").in("id", stopsClientIds)
    : { data: [] };
const clientByIdForStops = new Map((stopsClients || []).map((c) => [c.id, c]));

const stopsForDriver6 = (stopsForDate || []).filter((s) => {
    const c = clientByIdForStops.get(s.client_id);
    const effectiveDriverId = c?.assigned_driver_id || s.assigned_driver_id;
    return effectiveDriverId === driverId;
});

console.log(`Stops assigned to Driver 6 (via client.assigned_driver_id or stop.assigned_driver_id): ${stopsForDriver6.length}`);
for (const s of stopsForDriver6) {
    const c = clientByIdForStops.get(s.client_id);
    const clientName = c ? (c.full_name || `${c.first_name || ""} ${c.last_name || ""}`.trim()) : s.name;
    const paused = c?.paused ? "PAUSED" : "active";
    const delivery = c?.delivery === false ? "delivery OFF" : "delivery ON";
    const stopAssigned = s.assigned_driver_id || "null";
    const clientAssigned = c?.assigned_driver_id || "null";
    console.log(
        `  stop=${s.id.slice(0, 8)}... client=${(s.client_id || "").slice(0, 8)}... name="${clientName}" ` +
        `addr="${s.address}, ${s.city}" delivery_date="${s.delivery_date}" ` +
        `stop.assigned=${stopAssigned === driverId ? "D6" : stopAssigned.slice(0, 8)} ` +
        `client.assigned=${clientAssigned === driverId ? "D6" : clientAssigned.slice(0, 8)} ` +
        `${paused} ${delivery}`
    );
}

// ─── 5. Simulate the route API path (what both routes page and drivers page use) ───
console.log("\n=== STEP 5: Simulating route API (day=all, delivery_date) ===");

// Build stopByDriverAndClient (same as route API)
const stopByDriverAndClient = new Map();
for (const s of stopsForDate || []) {
    const c = clientByIdForStops.get(s.client_id);
    const effectiveDriverId = c?.assigned_driver_id || s.assigned_driver_id;
    if (effectiveDriverId && s.client_id) {
        stopByDriverAndClient.set(`${effectiveDriverId}|${s.client_id}`, s);
    }
}

// Build route for Driver 6 using driver_route_order
const routeStops = [];
const routeStopIdSet = new Set();

// Phase 1: from driver_route_order
const orderList = routeOrderRows || [];
for (const row of orderList) {
    const stop = stopByDriverAndClient.get(`${driverId}|${row.client_id}`);
    if (stop && !routeStopIdSet.has(stop.id)) {
        // Check shouldShowStop
        const client = clientByIdForStops.get(stop.client_id);
        if (client?.paused) continue;
        if (client?.delivery === false) continue;
        routeStops.push(stop);
        routeStopIdSet.add(stop.id);
    }
}
console.log(`After driver_route_order phase: ${routeStops.length} stops`);

// Phase 2: tail - other stops assigned to this driver not yet in list
for (const s of stopsForDate || []) {
    const c = clientByIdForStops.get(s.client_id);
    const assignedDriverId = c?.assigned_driver_id || s.assigned_driver_id;
    if (assignedDriverId === driverId && !routeStopIdSet.has(s.id)) {
        if (c?.paused) continue;
        if (c?.delivery === false) continue;
        routeStops.push(s);
        routeStopIdSet.add(s.id);
        console.log(`  TAIL stop added: ${s.id.slice(0, 8)}... client=${(s.client_id || "").slice(0, 8)}... name="${s.name}"`);
    }
}
console.log(`After tail phase: ${routeStops.length} stops (this is what the ROUTE API returns)`);

// ─── 6. Simulate DriversGrid filtering (what the drivers app shows) ───
console.log("\n=== STEP 6: Simulating DriversGrid filtering ===");

// The route API returns stops with these fields for delivery_date:
// delivery_date: s.delivery_date || null
// deliveryDate: order.actual_delivery_date || order.scheduled_delivery_date || null
// DriversGrid.filteredStops checks: stop.delivery_date || stop.deliveryDate

const filteredStops = routeStops.filter((s) => {
    const stopDate = s.delivery_date;
    if (!stopDate) return false;
    const dateStr = String(stopDate).split("T")[0].split(" ")[0];
    return dateStr === deliveryDate;
});

console.log(`Route API total stops for Driver 6: ${routeStops.length}`);
console.log(`After DriversGrid date filter: ${filteredStops.length}`);

// Check which stops were filtered out
const filteredOut = routeStops.filter((s) => {
    const stopDate = s.delivery_date;
    if (!stopDate) return true; // would be filtered out
    const dateStr = String(stopDate).split("T")[0].split(" ")[0];
    return dateStr !== deliveryDate;
});
if (filteredOut.length > 0) {
    console.log(`\n  FILTERED OUT (${filteredOut.length} stops):`);
    for (const s of filteredOut) {
        console.log(`    stop=${s.id.slice(0, 8)}... delivery_date="${s.delivery_date}" name="${s.name}"`);
    }
}

// ─── 7. Check the mobile/routes API path (alternative data source) ───
console.log("\n=== STEP 7: Simulating mobile/routes API ===");

// Mobile routes fetches stops by delivery_date
const { data: mobileStops } = await supabase
    .from("stops")
    .select("id, completed, delivery_date, client_id, assigned_driver_id")
    .eq("delivery_date", deliveryDate);

console.log(`Mobile stops query (eq delivery_date): ${mobileStops?.length || 0}`);

const mobileCids = [...new Set((mobileStops || []).map((s) => s.client_id).filter(Boolean))];
const { data: mobileClients } = mobileCids.length > 0
    ? await supabase.from("clients").select("id, assigned_driver_id").in("id", mobileCids)
    : { data: [] };
const mobileClientById = new Map((mobileClients || []).map((c) => [c.id, c]));

const mobileStopsForDriver6 = (mobileStops || []).filter((s) => {
    const c = mobileClientById.get(s.client_id);
    const effectiveDriverId = c?.assigned_driver_id || s.assigned_driver_id;
    return effectiveDriverId === driverId;
});

console.log(`Mobile stops for Driver 6: ${mobileStopsForDriver6.length}`);

// Build stopByDriverAndClient for mobile
const mobileStopByDC = new Map();
for (const s of mobileStops || []) {
    const c = mobileClientById.get(s.client_id);
    const eid = c?.assigned_driver_id || s.assigned_driver_id;
    if (eid && s.client_id) {
        mobileStopByDC.set(`${eid}|${s.client_id}`, s);
    }
}

// Use driver_route_order to build mobile route
const mobileRouteStops = [];
for (const row of orderList) {
    const stop = mobileStopByDC.get(`${driverId}|${row.client_id}`);
    if (stop) mobileRouteStops.push(stop);
}
// Also add stops not in route order (fallback)
const mobileRouteIds = new Set(mobileRouteStops.map((s) => s.id));
for (const s of mobileStopsForDriver6) {
    if (!mobileRouteIds.has(s.id)) {
        mobileRouteStops.push(s);
    }
}
console.log(`Mobile route stops for Driver 6 (via driver_route_order + tail): ${mobileRouteStops.length}`);

// ─── 8. Check stops with NULL delivery_date that match day ───
console.log("\n=== STEP 8: Stops with NULL delivery_date ===");
const { data: nullDateStops } = await supabase
    .from("stops")
    .select("id, client_id, name, address, delivery_date, day, assigned_driver_id")
    .is("delivery_date", null);

const nullDateForDriver6 = (nullDateStops || []).filter((s) => {
    const c = clientByIdForStops.get(s.client_id) || {};
    const effectiveDriverId = c.assigned_driver_id || s.assigned_driver_id;
    return effectiveDriverId === driverId;
});
console.log(`Stops with NULL delivery_date assigned to Driver 6: ${nullDateForDriver6.length}`);
for (const s of nullDateForDriver6) {
    console.log(`  stop=${s.id.slice(0, 8)}... client=${(s.client_id || "").slice(0, 8)}... name="${s.name}" day="${s.day}"`);
}

// ─── 9. Address grouping analysis ───
console.log("\n=== STEP 9: Address grouping (unique addresses) ===");
function makeAddressKey(stop) {
    if (!stop) return "";
    let addr = String(stop.address || "").toLowerCase().replace(/\s+/g, " ").trim();
    addr = addr
        .replace(/\b(apt|apartment|ste|suite|unit|fl|floor|bldg|building)\b\.?\s*[a-z0-9-]+/gi, "")
        .replace(/#\s*\w+/g, "")
        .replace(/[.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    addr = addr
        .replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave").replace(/\broad\b/g, "rd")
        .replace(/\bdrive\b/g, "dr").replace(/\bcourt\b/g, "ct").replace(/\blane\b/g, "ln")
        .replace(/\bboulevard\b/g, "blvd").replace(/\bparkway\b/g, "pkwy").replace(/\bcircle\b/g, "cir")
        .replace(/\bplace\b/g, "pl")
        .replace(/\bnorth\b/g, "n").replace(/\bsouth\b/g, "s").replace(/\beast\b/g, "e").replace(/\bwest\b/g, "w");
    return addr.replace(/[.,;:]/g, "").replace(/\s+/g, " ").trim();
}

const addressGroups = new Map();
for (const s of routeStops) {
    const key = makeAddressKey(s);
    if (!key) continue;
    if (!addressGroups.has(key)) addressGroups.set(key, []);
    addressGroups.get(key).push(s);
}
console.log(`Total stops for Driver 6: ${routeStops.length}`);
console.log(`Unique addresses: ${addressGroups.size}`);
for (const [addr, stops] of addressGroups) {
    console.log(`  "${addr}" → ${stops.length} stop(s):`);
    for (const s of stops) {
        console.log(`    - ${s.name} (client=${(s.client_id || "").slice(0, 8)}... apt="${s.apt || ""}")`);
    }
}

// ─── 10. Check if delivery_date exact match vs range match gives different results ───
console.log("\n=== STEP 10: delivery_date exact vs range match ===");
const { data: exactMatch } = await supabase
    .from("stops")
    .select("id, delivery_date, client_id, assigned_driver_id")
    .eq("delivery_date", deliveryDate);

const { data: rangeMatch } = await supabase
    .from("stops")
    .select("id, delivery_date, client_id, assigned_driver_id")
    .gte("delivery_date", deliveryDate)
    .lt("delivery_date", nextDay);

console.log(`Stops with delivery_date = '${deliveryDate}' (exact): ${exactMatch?.length || 0}`);
console.log(`Stops with delivery_date >= '${deliveryDate}' AND < '${nextDay}' (range): ${rangeMatch?.length || 0}`);

// Find stops in range but not in exact
const exactIds = new Set((exactMatch || []).map((s) => s.id));
const rangeIds = new Set((rangeMatch || []).map((s) => s.id));
const inRangeNotExact = (rangeMatch || []).filter((s) => !exactIds.has(s.id));
const inExactNotRange = (exactMatch || []).filter((s) => !rangeIds.has(s.id));

if (inRangeNotExact.length > 0) {
    console.log(`\n  In range but NOT exact match: ${inRangeNotExact.length}`);
    for (const s of inRangeNotExact) {
        const c = clientByIdForStops.get(s.client_id) || {};
        const isD6 = (c.assigned_driver_id || s.assigned_driver_id) === driverId;
        console.log(`    stop=${s.id.slice(0, 8)}... delivery_date="${s.delivery_date}" driver6=${isD6}`);
    }
}
if (inExactNotRange.length > 0) {
    console.log(`\n  In exact but NOT in range match: ${inExactNotRange.length}`);
    for (const s of inExactNotRange) {
        console.log(`    stop=${s.id.slice(0, 8)}... delivery_date="${s.delivery_date}"`);
    }
}

// ─── 11. Check for duplicate stops (same client_id for same delivery_date) ───
console.log("\n=== STEP 11: Duplicate stops check ===");
const clientDateCounts = new Map();
for (const s of stopsForDate || []) {
    const key = `${s.client_id}|${String(s.delivery_date).split("T")[0]}`;
    clientDateCounts.set(key, (clientDateCounts.get(key) || 0) + 1);
}
const duplicates = [...clientDateCounts.entries()].filter(([_, count]) => count > 1);
if (duplicates.length > 0) {
    console.log(`Found ${duplicates.length} client_id+date combos with multiple stops:`);
    for (const [key, count] of duplicates) {
        const [cid] = key.split("|");
        const c = clientByIdForStops.get(cid);
        const isD6 = c?.assigned_driver_id === driverId;
        console.log(`  client=${cid.slice(0, 8)}... count=${count} driver6=${isD6} name="${c?.full_name || ""}"`);
    }
} else {
    console.log("No duplicate stops found.");
}

// ─── 12. Summary ───
console.log("\n========================================");
console.log("  SUMMARY");
console.log("========================================");
console.log(`Driver 6 id: ${driverId}`);
console.log(`Driver 6 day: ${driver6.day}`);
console.log(`Delivery date: ${deliveryDate}`);
console.log(`driver_route_order entries: ${routeOrderRows?.length || 0}`);
console.log(`Stops for date (range match): ${stopsForDate?.length || 0}`);
console.log(`Stops for date (exact match): ${exactMatch?.length || 0}`);
console.log(`Stops assigned to Driver 6: ${stopsForDriver6.length}`);
console.log(`Route API simulation (driver_route_order + tail): ${routeStops.length}`);
console.log(`After DriversGrid date filter: ${filteredStops.length}`);
console.log(`Mobile route simulation: ${mobileRouteStops.length}`);
console.log(`NULL delivery_date stops for Driver 6: ${nullDateForDriver6.length}`);
console.log(`Unique addresses: ${addressGroups.size}`);
console.log();
console.log(`EXPECTED on Routes page: ${routeStops.length} stops`);
console.log(`EXPECTED on Drivers app: ${filteredStops.length} bags, ${addressGroups.size} addresses`);
console.log();

if (routeStops.length !== filteredStops.length) {
    console.log("⚠️  MISMATCH FOUND: Route API returns more stops than DriversGrid shows!");
    console.log("   Likely cause: Some stops have delivery_date=null or mismatched date format.");
} else if (routeStops.length === 11 && filteredStops.length === 6) {
    console.log("⚠️  MISMATCH: 11 vs 6 — check address grouping and paused/delivery-off clients.");
} else {
    console.log("Counts match between route API and DriversGrid path.");
}

console.log("\n========================================");
console.log("  DONE");
console.log("========================================\n");
