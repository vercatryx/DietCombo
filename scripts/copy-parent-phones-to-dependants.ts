/**
 * One-time script: copies parent phone numbers to dependants that don't already have one.
 *
 * Only copies if the dependant's phone_number is NULL or empty AND the parent has a non-empty phone.
 * Same logic for secondary_phone_number.
 *
 * Usage: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/copy-parent-phones-to-dependants.ts
 * Add --dry-run to only print what would be updated (no DB writes).
 */

import dotenv from "dotenv";

const DRY_RUN = process.argv.includes("--dry-run");
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function hasPhone(val: unknown): boolean {
    return val != null && String(val).trim() !== "";
}

async function main() {
    console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Copying parent phone numbers to dependants...\n`);

    const { data: dependants, error: depErr } = await supabase
        .from("clients")
        .select("id, full_name, parent_client_id, phone_number, secondary_phone_number")
        .not("parent_client_id", "is", null);

    if (depErr) {
        console.error("Failed to fetch dependants:", depErr.message);
        process.exit(1);
    }

    const list = dependants || [];
    if (list.length === 0) {
        console.log("No dependants found. Exiting.");
        return;
    }

    console.log(`Found ${list.length} dependant(s).`);

    const parentIds = [...new Set(list.map((d: any) => String(d.parent_client_id)).filter(Boolean))];
    const { data: parents, error: parErr } = await supabase
        .from("clients")
        .select("id, full_name, phone_number, secondary_phone_number")
        .in("id", parentIds);

    if (parErr) {
        console.error("Failed to fetch parents:", parErr.message);
        process.exit(1);
    }

    const parentById = new Map<string, any>();
    for (const p of parents || []) {
        parentById.set(String(p.id), p);
    }

    let phoneCopied = 0;
    let secondaryPhoneCopied = 0;
    const updates: { id: string; name: string; parentName: string; payload: Record<string, unknown> }[] = [];

    for (const d of list) {
        const parent = d.parent_client_id ? parentById.get(String(d.parent_client_id)) : undefined;
        if (!parent) {
            console.warn(`  Dependant ${d.full_name} (${d.id}) has missing parent ${d.parent_client_id}, skipping.`);
            continue;
        }

        const payload: Record<string, unknown> = {};

        if (!hasPhone(d.phone_number) && hasPhone(parent.phone_number)) {
            payload.phone_number = parent.phone_number;
            phoneCopied++;
        }

        if (!hasPhone(d.secondary_phone_number) && hasPhone(parent.secondary_phone_number)) {
            payload.secondary_phone_number = parent.secondary_phone_number;
            secondaryPhoneCopied++;
        }

        if (Object.keys(payload).length > 0) {
            updates.push({ id: String(d.id), name: d.full_name, parentName: parent.full_name, payload });
        }
    }

    if (updates.length === 0) {
        console.log("\nNo dependants need phone number updates (all already have phone numbers or parents have none).");
        return;
    }

    console.log(`\n${DRY_RUN ? "[DRY RUN] Would update" : "Updating"} ${updates.length} dependant(s) (primary: ${phoneCopied}, secondary: ${secondaryPhoneCopied}).`);

    for (const { id, name, parentName, payload } of updates) {
        console.log(`  ${name} (${id}) ← parent: ${parentName} → ${JSON.stringify(payload)}`);
    }

    if (DRY_RUN) {
        console.log("\nRun without --dry-run to apply.");
        return;
    }

    let success = 0;
    let failed = 0;
    for (const { id, name, payload } of updates) {
        const { error: updateErr } = await supabase.from("clients").update(payload).eq("id", id);
        if (updateErr) {
            console.error(`  Failed to update ${name} (${id}):`, updateErr.message);
            failed++;
        } else {
            success++;
        }
    }

    console.log(`\nDone. Updated: ${success}, Failed: ${failed}.`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
