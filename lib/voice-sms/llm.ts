import Anthropic from '@anthropic-ai/sdk';
import type { VoiceSmsProvider } from './config';

export async function runVoiceSmsLlmTurn(opts: {
  llm_provider: VoiceSmsProvider;
  llm_model: string;
  system_prompt: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userText: string;
}): Promise<string> {
  const system = opts.system_prompt?.trim() || 'You are a helpful assistant. Be concise.';
  const messages = [...opts.history, { role: 'user' as const, content: opts.userText }];

  if (opts.llm_provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY');
    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: opts.llm_model,
      max_tokens: 600,
      system,
      messages,
    });
    const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    return (textBlocks.map(b => b.text).join('\n').trim() || '').slice(0, 4000);
  }

  if (opts.llm_provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: opts.llm_model,
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: 600,
        temperature: 0.3,
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || 'error'}`);
    return String(data?.choices?.[0]?.message?.content || '').trim().slice(0, 4000);
  }

  if (opts.llm_provider === 'google') {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('Missing GOOGLE_API_KEY');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.llm_model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${system}\n\n${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}` }] },
        ],
        generationConfig: { maxOutputTokens: 600, temperature: 0.3 },
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Google ${res.status}: ${data?.error?.message || 'error'}`);
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') || '';
    return String(text).trim().slice(0, 4000);
  }

  throw new Error(`Unsupported provider: ${opts.llm_provider}`);
}

