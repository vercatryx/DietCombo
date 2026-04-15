type TelnyxCommandResult = { ok: true; data: any } | { ok: false; error: string; status?: number; data?: any };

async function telnyxPost(path: string, body: any): Promise<TelnyxCommandResult> {
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return { ok: false, error: 'Missing TELNYX_API_KEY' };

  try {
    const res = await fetch(`https://api.telnyx.com/v2${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body ?? {}),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || 'Unknown Telnyx error';
      return { ok: false, error: `Telnyx ${res.status}: ${detail}`, status: res.status, data };
    }

    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Network error' };
  }
}

export async function answerCall(callControlId: string, commandId?: string): Promise<TelnyxCommandResult> {
  return telnyxPost(`/calls/${encodeURIComponent(callControlId)}/actions/answer`, commandId ? { command_id: commandId } : {});
}

export async function transferCall(callControlId: string, to: string, commandId?: string): Promise<TelnyxCommandResult> {
  return telnyxPost(
    `/calls/${encodeURIComponent(callControlId)}/actions/transfer`,
    { to, ...(commandId ? { command_id: commandId } : {}) },
  );
}

export async function speakText(
  callControlId: string,
  payload: string,
  options?: {
    voice?: 'female' | 'male';
    language?: string;
    payloadType?: 'text' | 'ssml';
    serviceLevel?: 'basic' | 'premium';
    commandId?: string;
  },
): Promise<TelnyxCommandResult> {
  return telnyxPost(`/calls/${encodeURIComponent(callControlId)}/actions/speak`, {
    payload,
    voice: options?.voice ?? 'female',
    ...(options?.language ? { language: options.language } : {}),
    ...(options?.payloadType ? { payload_type: options.payloadType } : {}),
    ...(options?.serviceLevel ? { service_level: options.serviceLevel } : {}),
    ...(options?.commandId ? { command_id: options.commandId } : {}),
  });
}

export async function startTranscription(
  callControlId: string,
  options?: { language?: string; transcriptionEngine?: string; commandId?: string },
): Promise<TelnyxCommandResult> {
  return telnyxPost(`/calls/${encodeURIComponent(callControlId)}/actions/transcription_start`, {
    ...(options?.language ? { language: options.language } : {}),
    ...(options?.transcriptionEngine ? { transcription_engine: options.transcriptionEngine } : {}),
    ...(options?.commandId ? { command_id: options.commandId } : {}),
  });
}

export async function stopTranscription(
  callControlId: string,
  options?: { commandId?: string },
): Promise<TelnyxCommandResult> {
  return telnyxPost(`/calls/${encodeURIComponent(callControlId)}/actions/transcription_stop`, {
    ...(options?.commandId ? { command_id: options.commandId } : {}),
  });
}

