import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { identifyClientByPhone } from '@/lib/sms-bot';
import { answerCall, transferCall } from '@/lib/telnyx-voice';

function getSupabaseAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);
}

// In-memory set for fast dedup within the same instance; DB handles cross-instance.
const recentlyProcessed = new Set<string>();

async function isAlreadyProcessed(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  if (recentlyProcessed.has(eventId)) return true;
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('call_events')
      .select('id')
      .eq('telnyx_event_id', eventId)
      .limit(1);
    return (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

function markProcessed(eventId: string) {
  if (!eventId) return;
  recentlyProcessed.add(eventId);
  if (recentlyProcessed.size > 2000) {
    const first = recentlyProcessed.values().next().value;
    if (first) recentlyProcessed.delete(first);
  }
}

function pickBestClientId(clients: any[]): string | null {
  if (!clients || clients.length === 0) return null;
  const foodClients = clients.filter((c: any) => c.service_type === 'Food');
  const client = foodClients[0] ?? clients[0];
  return client?.id ?? null;
}

function asIsoOrNull(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function asIntOrNull(v: any): number | null {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? Math.trunc(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Telnyx Voice] Webhook received:', JSON.stringify(body).slice(0, 500));

    const eventType =
      body?.data?.event_type ||
      body?.event_type ||
      body?.data?.eventType ||
      'unknown';

    const payload = body?.data?.payload || body?.data || body?.payload || {};

    const callControlId =
      payload?.call_control_id ||
      payload?.callControlId ||
      payload?.call_control?.id ||
      null;

    const telnyxEventId =
      body?.data?.id ||
      body?.id ||
      payload?.id ||
      null;

    const fromNumber =
      payload?.from ||
      payload?.from_number ||
      payload?.from?.phone_number ||
      payload?.caller_id_number ||
      null;

    const toNumber =
      payload?.to ||
      payload?.to_number ||
      payload?.to?.phone_number ||
      payload?.called_number ||
      null;

    // Prefer storing the caller as the primary phone_number for easy lookup.
    const primaryPhone = fromNumber || toNumber;
    if (!primaryPhone) {
      return NextResponse.json({ ok: true });
    }

    // Skip duplicate webhook deliveries
    if (telnyxEventId && await isAlreadyProcessed(telnyxEventId)) {
      console.log(`[Telnyx Voice] Skipping duplicate event ${telnyxEventId} (${eventType})`);
      return NextResponse.json({ ok: true });
    }
    markProcessed(telnyxEventId || '');

    const status =
      payload?.state ||
      payload?.status ||
      payload?.call_status ||
      null;

    const startedAt =
      asIsoOrNull(payload?.started_at) ||
      asIsoOrNull(payload?.start_time) ||
      asIsoOrNull(payload?.timestamp) ||
      null;

    const endedAt =
      asIsoOrNull(payload?.ended_at) ||
      asIsoOrNull(payload?.end_time) ||
      null;

    const durationSeconds =
      asIntOrNull(payload?.duration_seconds) ??
      asIntOrNull(payload?.duration) ??
      null;

    after(async () => {
      try {
        const supabase = getSupabaseAdmin();
        const matched = await identifyClientByPhone(supabase, primaryPhone);
        const clientId = pickBestClientId(matched);

        // If this is a brand new inbound call, immediately answer + transfer it to the work number.
        // Without issuing call control commands, the caller will just ring until timeout.
        if (eventType === 'call.initiated' && callControlId) {
          const forwardTo = process.env.TELNYX_VOICE_FORWARD_TO;
          if (!forwardTo) {
            console.warn('[Telnyx Voice] TELNYX_VOICE_FORWARD_TO not set; not transferring call.');
          } else {
            const cmdBase = `${telnyxEventId || callControlId}-${Date.now()}`;
            const ans = await answerCall(callControlId, `answer-${cmdBase}`);
            if (!ans.ok) console.error('[Telnyx Voice] Answer failed:', ans.error);

            const tx = await transferCall(callControlId, forwardTo, `transfer-${cmdBase}`);
            if (!tx.ok) console.error('[Telnyx Voice] Transfer failed:', tx.error);
          }
        }

        await supabase.from('call_events').insert({
          phone_number: primaryPhone,
          client_id: clientId,
          direction: 'inbound',
          provider: 'telnyx',
          telnyx_event_id: telnyxEventId,
          telnyx_call_control_id: callControlId,
          event_type: eventType,
          status,
          started_at: startedAt,
          ended_at: endedAt,
          duration_seconds: durationSeconds,
          from_number: fromNumber,
          to_number: toNumber,
          raw_payload: body,
        });
      } catch (err) {
        console.error('[Telnyx Voice] Failed to log call event:', err);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Telnyx Voice] Webhook error:', err);
    // Always 200 so Telnyx doesn't spam retries while we're iterating.
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

