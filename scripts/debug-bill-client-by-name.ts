import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

type AccountFilter = 'regular' | 'brooklyn' | 'both';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Supabase disabled legacy JWT keys on this project; prefer new sb_* keys.
const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error(
        'Missing Supabase credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (preferred) are set in .env.local.'
    );
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

function parseArgs() {
    const args = process.argv.slice(2);
    let name = '';
    let account: AccountFilter = 'both';

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--name' && args[i + 1]) {
            name = String(args[i + 1]);
            i++;
        } else if (a === '--account' && args[i + 1]) {
            const v = String(args[i + 1]).toLowerCase();
            if (v === 'regular' || v === 'brooklyn' || v === 'both') account = v;
            i++;
        }
    }

    if (!name) name = 'EVA WEINSTEIN';
    return { name, account };
}

function normalize(s: unknown): string {
    return String(s ?? '').trim();
}

function matchesAccount(uniteAccount: unknown, account: AccountFilter): boolean {
    const ua = normalize(uniteAccount);
    if (account === 'both') return true;
    if (account === 'brooklyn') return ua.toLowerCase() === 'brooklyn';
    // regular: /api/bill treats Regular OR null as regular
    return ua === '' || ua.toLowerCase() === 'regular';
}

async function fetchClientById(id: string) {
    const { data, error } = await supabase
        .from('clients')
        .select('id, full_name, parent_client_id, service_type, unite_account, case_id_external, client_id_external, bill')
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data as any | null;
}

async function main() {
    const { name, account } = parseArgs();
    const needle = normalize(name);

    console.log('=== debug-bill-client-by-name ===');
    console.log('Name query:', JSON.stringify(needle));
    console.log('Account filter:', account);
    console.log('');

    // Search with ilike to handle casing and partial matches.
    const { data: matches, error } = await supabase
        .from('clients')
        .select('id, full_name, parent_client_id, unite_account, service_type, bill')
        .ilike('full_name', `%${needle}%`)
        .order('id', { ascending: true });

    if (error) {
        console.error('Error searching clients:', error);
        process.exit(1);
    }

    if (!matches || matches.length === 0) {
        console.log('No client rows matched by full_name ilike.');
        console.log('If the name is spelled differently, try:');
        console.log('  npx ts-node --compiler-options \'{"module":"CommonJS","moduleResolution":"node"}\' scripts/debug-bill-client-by-name.ts --name "EVA"');
        return;
    }

    console.log(`Found ${matches.length} matching client row(s):`);
    for (const c of matches as any[]) {
        console.log(
            '-',
            JSON.stringify({
                id: c.id,
                full_name: c.full_name,
                parent_client_id: c.parent_client_id,
                unite_account: c.unite_account,
                service_type: c.service_type,
            })
        );
    }
    console.log('');

    for (const c of matches as any[]) {
        const id = normalize(c.id);
        const fullName = normalize(c.full_name);
        const parentId = c.parent_client_id == null ? null : normalize(c.parent_client_id);
        const ua = normalize(c.unite_account);

        console.log('---');
        console.log('Client:', `${fullName} (${id})`);
        console.log('unite_account:', ua || '(null/empty)');
        console.log('parent_client_id:', parentId ?? '(null)');

        const passesAccount = matchesAccount(c.unite_account, account);
        const passesBill = c.bill !== false;
        console.log('Passes /api/bill account filter?:', passesAccount ? 'YES' : 'NO');
        console.log('Passes /api/bill bill filter (bill !== false)?:', passesBill ? 'YES' : 'NO');

        if (parentId == null) {
            console.log(
                'Would appear in /api/bill output as its own household row?:',
                passesAccount && passesBill ? 'YES' : 'NO'
            );
        } else {
            console.log(
                'Would appear in /api/bill output as its own household row?: NO (it is a dependent, not a parent)'
            );

            const parent = await fetchClientById(parentId).catch((e) => {
                console.error('Error fetching parent client:', e);
                return null;
            });

            if (!parent) {
                console.log('Parent lookup:', `NOT FOUND (parent_client_id=${parentId})`);
                console.log(
                    'If the parent record is missing, /api/bill will not attach this dependent under any household.'
                );
            } else {
                const parentPassesAccount = matchesAccount(parent.unite_account, account);
                const parentPassesBill = parent.bill !== false;
                console.log(
                    'Parent household:',
                    JSON.stringify({
                        id: parent.id,
                        full_name: parent.full_name,
                        unite_account: parent.unite_account,
                        service_type: parent.service_type,
                        bill: parent.bill,
                    })
                );
                console.log(
                    'Would appear under parent household in /api/bill (dependants list)?:',
                    passesAccount && parentPassesAccount && parentPassesBill ? 'YES' : 'NO'
                );
                if (!parentPassesAccount) {
                    console.log(
                        'Note: parent fails account filter; /api/bill will omit the entire household row for this parent.'
                    );
                }
                if (!parentPassesBill) {
                    console.log(
                        'Note: parent has bill=false; /api/bill will omit the entire household row for this parent.'
                    );
                }
            }
        }
    }
}

main().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
});

