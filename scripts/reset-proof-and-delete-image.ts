/**
 * Reset proof for an order and (optionally) delete the proof image from R2.
 *
 * What it does:
 * - Finds the order by order_number (numeric) or id (UUID fallback)
 * - Deletes the proof image from R2 if it looks like one of our storage URLs
 * - Clears proof url fields (proof_of_delivery_url, proof_of_delivery_image, delivery_proof_url if present)
 * - Sets status back to waiting_for_proof
 * - Clears actual_delivery_date
 * - Clears stops.proof_url for the order_id
 * - If a billing record was auto-generated on proof upload, deletes it and restores client's authorized_amount
 *
 * Run:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/reset-proof-and-delete-image.ts 100992
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { deleteFile } from '../lib/storage';
import { getSupabaseDbApiKey } from '../lib/supabase-env';

const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://storage.thedietfantasy.com';
const R2_DELIVERY_BUCKET = process.env.R2_DELIVERY_BUCKET_NAME;

function usageAndExit(msg?: string): never {
  if (msg) console.error(msg);
  console.error('Usage: reset-proof-and-delete-image <orderNumberOrId>');
  process.exit(1);
}

function looksLikeOurStorageUrl(url: string): boolean {
  const trimmed = (url || '').trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    const base = new URL(R2_PUBLIC_BASE);
    return u.host === base.host;
  } catch {
    return false;
  }
}

function extractKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const key = u.pathname.replace(/^\/+/, '');
    return key || null;
  } catch {
    // fallback: last path segment
    const seg = url.split('?')[0].split('#')[0].split('/').pop();
    return seg ? seg.trim() : null;
  }
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function main() {
  const arg = (process.argv[2] || '').trim();
  if (!arg) usageAndExit('Missing order number.');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabaseDbApiKey();
  if (!supabaseUrl || !key) {
    usageAndExit('Missing NEXT_PUBLIC_SUPABASE_URL or a Supabase DB key in env.');
  }

  const sb = createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log('=== Reset proof ===');
  console.log('Order identifier:', arg);

  const asNumber = Number(arg);
  const isNumeric = Number.isFinite(asNumber) && String(asNumber) === arg;

  // 1) Find order
  let order: any | null = null;
  if (isNumeric) {
    const { data } = await sb.from('orders').select('*').eq('order_number', asNumber).maybeSingle();
    order = data ?? null;
  }
  if (!order && isUuid(arg)) {
    const { data } = await sb.from('orders').select('*').eq('id', arg).maybeSingle();
    order = data ?? null;
  }
  if (!order) {
    usageAndExit(`Order not found in orders for "${arg}".`);
  }

  const orderId = String(order.id);
  const clientId = String(order.client_id);
  const proofUrl: string =
    (order.proof_of_delivery_url || order.proof_of_delivery_image || order.delivery_proof_url || '').trim();

  console.log('Found order id:', orderId, ' client_id:', clientId);
  console.log('Existing proof url:', proofUrl || '(none)');

  // 2) Delete image from R2 (best-effort)
  if (proofUrl && looksLikeOurStorageUrl(proofUrl)) {
    if (!R2_DELIVERY_BUCKET) {
      console.warn('R2_DELIVERY_BUCKET_NAME not set; skipping delete.');
    } else {
      const keyToDelete = extractKeyFromUrl(proofUrl);
      if (keyToDelete) {
        console.log('Deleting from R2 bucket:', R2_DELIVERY_BUCKET, ' key:', keyToDelete);
        try {
          await deleteFile(keyToDelete, R2_DELIVERY_BUCKET);
          console.log('Deleted proof image from R2.');
        } catch (e) {
          console.warn('Failed to delete proof image from R2 (continuing):', e);
        }
      }
    }
  } else if (proofUrl) {
    console.log('Proof URL is not under our public storage domain; not deleting.');
  }

  // 3) Undo billing record + authorized amount (only if it was auto-generated)
  const { data: billing } = await sb
    .from('billing_records')
    .select('id, remarks, amount')
    .eq('order_id', orderId)
    .maybeSingle();

  const autoRemarks =
    (billing?.remarks || '').includes('Auto-generated upon proof upload') ||
    (billing?.remarks || '').includes('Auto-generated upon produce proof upload');

  if (billing?.id && autoRemarks) {
    console.log('Found auto-generated billing record:', billing.id, '— deleting and restoring authorized_amount');

    // Restore authorized amount (delivery flow deducts total_value)
    const restoreAmount = Number(order.total_value ?? 0) || 0;

    // Load client row
    const { data: clientRow } = await sb.from('clients').select('authorized_amount').eq('id', clientId).maybeSingle();
    const currentAuth = Number(clientRow?.authorized_amount ?? 0) || 0;
    const newAuth = currentAuth + restoreAmount;

    const delRes = await sb.from('billing_records').delete().eq('id', billing.id);
    if (delRes.error) {
      console.warn('Failed to delete billing record (continuing):', delRes.error);
    } else {
      console.log('Deleted billing record.');
    }

    const updClient = await sb.from('clients').update({ authorized_amount: newAuth }).eq('id', clientId);
    if (updClient.error) {
      console.warn('Failed to restore authorized_amount (continuing):', updClient.error);
    } else {
      console.log('Restored authorized_amount:', currentAuth, '->', newAuth);
    }
  }

  // 4) Update order row: clear proof + reset status/dates
  const updatePayload: Record<string, any> = {};
  if ('proof_of_delivery_url' in order) updatePayload.proof_of_delivery_url = null;
  if ('proof_of_delivery_image' in order) updatePayload.proof_of_delivery_image = null;
  if ('delivery_proof_url' in order) updatePayload.delivery_proof_url = null;
  if ('actual_delivery_date' in order) updatePayload.actual_delivery_date = null;
  if ('status' in order) updatePayload.status = 'waiting_for_proof';

  console.log('Updating order with:', updatePayload);
  const updOrder = await sb.from('orders').update(updatePayload).eq('id', orderId);
  if (updOrder.error) {
    console.error('Failed to update order:', updOrder.error);
    process.exit(1);
  }

  // 5) Clear stops.proof_url for this order
  const updStops = await sb.from('stops').update({ proof_url: null }).eq('order_id', orderId);
  if (updStops.error) {
    console.warn('Failed to clear stops.proof_url (continuing):', updStops.error);
  } else {
    console.log('Cleared stops.proof_url for order.');
  }

  console.log('✅ Done. Proof cleared and order reset.');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});

