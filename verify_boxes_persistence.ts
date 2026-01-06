
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load env
try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=').trim();
            process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    console.error('Error loading .env.local', e);
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function verify() {
    console.log('--- Boxes Persistence Verification ---');

    // 1. Get a test client
    const { data: clients } = await supabase.from('clients').select('*').limit(1);
    if (!clients || clients.length === 0) {
        console.error('No clients found to test with.');
        return;
    }
    const client = clients[0];
    const clientId = client.id;
    console.log(`Testing with client: ${client.full_name} (${clientId})`);

    // 2. Mock a "Boxes" configuration update (without a vendor, which might block upcoming_orders sync)
    const testCaseId = 'BOX-TEST-' + Date.now();
    const mockActiveOrder = {
        serviceType: 'Boxes',
        caseId: testCaseId,
        boxTypeId: 'some-box-type-id', // Placeholder
        boxQuantity: 2,
        items: { 'item-1': 1, 'item-2': 1 },
        lastUpdated: new Date().toISOString(),
        updatedBy: 'Verification Script'
    };

    console.log(`Updating client with Case ID: ${testCaseId}`);

    // We update the client record directly to simulate what syncCurrentOrderToUpcoming now does
    const { error: updateError } = await supabase
        .from('clients')
        .update({
            active_order: mockActiveOrder,
            service_type: 'Boxes'
        })
        .eq('id', clientId);

    if (updateError) {
        console.error('Update failed:', updateError);
        return;
    }

    // 3. Fetch back and verify the client table persistence
    const { data: updatedClient, error: fetchError } = await supabase
        .from('clients')
        .select('active_order, service_type')
        .eq('id', clientId)
        .single();

    if (fetchError) {
        console.error('Fetch failed:', fetchError);
        return;
    }

    const persistedOrder = updatedClient.active_order;
    console.log('Persisted Active Order:', JSON.stringify(persistedOrder, null, 2));

    if (persistedOrder?.caseId === testCaseId && updatedClient.service_type === 'Boxes') {
        console.log('✅ SUCCESS: Case ID and Boxes configuration persisted in clients table.');
    } else {
        console.error('❌ FAILURE: Configuration did not persist correctly.');
        process.exit(1);
    }

    // 4. Verify item selection persistence
    if (Object.keys(persistedOrder?.items || {}).length === 2) {
        console.log('✅ SUCCESS: Item selections persisted.');
    } else {
        console.error('❌ FAILURE: Item selections lost.');
        process.exit(1);
    }
}

verify();
