import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { runAssistantTurn } from '@/lib/bot-core';
import { answerCall, speakText, startTranscription, stopTranscription } from '@/lib/telnyx-voice';

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

type CallState = {
  callControlId: string;
  phone: string;
  isSpeaking: boolean;
  buffer: string;
  lastHeardAt: number;
  timer?: ReturnType<typeof setTimeout>;
  utteranceSeq: number;
};

const callStateById = new Map<string, CallState>();
const SILENCE_MS = 1200;

function getOrInitState(callControlId: string, phone: string): CallState {
  const existing = callStateById.get(callControlId);
  if (existing) return existing;
  const s: CallState = {
    callControlId,
    phone,
    isSpeaking: false,
    buffer: '',
    lastHeardAt: 0,
    utteranceSeq: 0,
  };
  callStateById.set(callControlId, s);
  return s;
}

function cleanupState(callControlId: string) {
  const s = callStateById.get(callControlId);
  if (s?.timer) clearTimeout(s.timer);
  callStateById.delete(callControlId);
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

    // IMPORTANT: For Voice, execute commands inline (not deferred).
    // If the request ends before commands are sent, the call will be silent.
    const supabase = getSupabaseAdmin();
    const clientId = null;

    // Voice AI flow
    if (callControlId) {
      const state = getOrInitState(callControlId, primaryPhone);

      if (eventType === 'call.initiated') {
        const cmdBase = `${telnyxEventId || callControlId}-${Date.now()}`;
        const ans = await answerCall(callControlId, `answer-${cmdBase}`);
        if (!ans.ok) console.error('[Telnyx Voice] Answer failed:', ans.error);
      }

      // Speak only once the call is answered (more reliable than on initiated).
      if (eventType === 'call.answered') {
        const cmdBase = `${telnyxEventId || callControlId}-${Date.now()}`;
        if (!state.isSpeaking) {
          state.isSpeaking = true;
          const sp = await speakText(
            callControlId,
            'Hi, this is The Diet Fantasy. How can I help you today?',
            { commandId: `greet-${cmdBase}`, voice: 'female' },
          );
          if (!sp.ok) console.error('[Telnyx Voice] Greet speak failed:', sp.error);
        }

        const tx = await startTranscription(callControlId, { language: 'en', commandId: `tx-${cmdBase}` });
        if (!tx.ok) console.error('[Telnyx Voice] Transcription start failed:', tx.error);
      }

      if (eventType === 'call.speak.ended') {
        state.isSpeaking = false;
        const cmdBase = `${telnyxEventId || callControlId}-${Date.now()}`;
        await startTranscription(callControlId, { language: 'en', commandId: `tx-${cmdBase}` });
      }

      if (eventType === 'call.transcription' && !state.isSpeaking) {
        const transcript =
          payload?.transcription?.text ||
          payload?.transcription_data?.transcript ||
          payload?.transcription_data?.text ||
          payload?.text ||
          '';

        const text = String(transcript || '').trim();
        if (text) {
          state.buffer = (state.buffer ? state.buffer + ' ' : '') + text;
          state.lastHeardAt = Date.now();
        }

        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(async () => {
          try {
            const elapsed = Date.now() - state.lastHeardAt;
            if (elapsed < SILENCE_MS - 50) return;
            const utterance = state.buffer.trim();
            state.buffer = '';
            if (!utterance) return;

            state.utteranceSeq++;
            const utteranceId = `${callControlId}-${state.utteranceSeq}`;

            await stopTranscription(callControlId, { commandId: `stop-${utteranceId}` }).catch(() => {});

            const { replyText } = await runAssistantTurn({
              supabase,
              channel: 'voice',
              phone: state.phone,
              conversationTable: 'call_conversations',
              where: { call_control_id: callControlId, phone_number: state.phone },
              messageText: utterance,
              restoreActiveClientFromTable: true,
              clientIdRestoreWhere: { call_control_id: callControlId, phone_number: state.phone },
            });

            state.isSpeaking = true;
            const cmdBase = `${utteranceId}-${Date.now()}`;
            const sp = await speakText(callControlId, replyText, { commandId: `speak-${cmdBase}`, voice: 'female' });
            if (!sp.ok) console.error('[Telnyx Voice] Speak failed:', sp.error);
          } catch (err) {
            console.error('[Telnyx Voice] Utterance handler failed:', err);
          }
        }, SILENCE_MS);
      }

      if (eventType === 'call.hangup') {
        cleanupState(callControlId);
      }
    }

    try {
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Telnyx Voice] Webhook error:', err);
    // Always 200 so Telnyx doesn't spam retries while we're iterating.
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

