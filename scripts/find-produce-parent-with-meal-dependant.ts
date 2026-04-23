/**
 * Lists Produce household parents who have at least one Food or Meal dependant (same rule as client portal).
 * Use the parent's email on /login — session stays on the parent; meal allowances follow householdPeople.
 *
 * Usage: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/find-produce-parent-with-meal-dependant.ts
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { isFoodOrMealHouseholdMember } from '../lib/meal-dependant-portal-login';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
    const { data: dependants, error: dErr } = await supabase
        .from('clients')
        .select('id, full_name, service_type, parent_client_id')
        .not('parent_client_id', 'is', null)
        .or('service_type.ilike.%food%,service_type.ilike.%meal%');

    if (dErr) {
        console.error('Dependants query failed:', dErr.message);
        process.exit(1);
    }

    const eligibleDeps = (dependants || []).filter((d: { service_type?: string | null }) =>
        isFoodOrMealHouseholdMember(d.service_type)
    );
    if (!eligibleDeps.length) {
        console.log('No dependants with Food/Meal (non-Produce) service_type found.');
        return;
    }

    const parentIds = [...new Set(eligibleDeps.map((d: { parent_client_id: string }) => String(d.parent_client_id)))];
    const { data: parents, error: pErr } = await supabase
        .from('clients')
        .select('id, full_name, email, service_type')
        .in('id', parentIds)
        .ilike('service_type', 'produce');

    if (pErr) {
        console.error('Parents query failed:', pErr.message);
        process.exit(1);
    }

    const produceParentIds = new Set((parents || []).map((p: { id: string }) => String(p.id)));
    if (!produceParentIds.size) {
        console.log('No Produce parents among those households found.');
        return;
    }

    const parentById = new Map((parents || []).map((p: any) => [String(p.id), p]));

    const byParent = new Map<string, typeof eligibleDeps>();
    for (const d of eligibleDeps) {
        const pid = String(d.parent_client_id);
        if (!produceParentIds.has(pid)) continue;
        if (!byParent.has(pid)) byParent.set(pid, []);
        byParent.get(pid)!.push(d);
    }

    console.log(`Found ${byParent.size} Produce household(s) with Food/Meal dependant(s):\n`);
    for (const [parentId, deps] of byParent) {
        const p = parentById.get(parentId);
        console.log('— Parent (Produce — sign in with this email; session stays this account):');
        console.log('   Name: ', p?.full_name);
        console.log('   Email:', p?.email || '(no email)');
        console.log('   ID:   ', parentId);
        console.log('  Food/Meal dependants (meal allowance count = this list’s size; Produce deps excluded):');
        const sorted = [...deps].sort((a: any, b: any) =>
            (a.full_name || '').localeCompare(b.full_name || '', undefined, { sensitivity: 'base' })
        );
        for (const d of sorted) {
            console.log('    -', d.full_name, '|', d.id, '| service_type:', d.service_type);
        }
        console.log('');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
