import Anthropic from '@anthropic-ai/sdk';

/**
 * Detects carrier/bounce/OOTO/auto-reply SMS that causes ping-pong with our own canned responses.
 * Strong patterns → no AI. Weak signals → optional Haiku YES/NO (unknown-number path only).
 */

const STRONG =
  /\b(auto[\s-]?reply|automatic reply|automated response|automated message|autoresponder)\b/i;

const OFFICE =
  /\b(out of office|ooo\b|away from (my )?(phone|desk)|on vacation|away until)\b/i;

const DELIVERY_FAIL =
  /\b(message (failed|was not delivered|could not be delivered)|delivery failed|not delivered|undeliverable|failed to send|unable to deliver|send failed)\b/i;

const CANNOT_RECEIVE =
  /\b(does not accept|unable to receive|cannot receive|can't receive|not accepting|no longer accept(s|ing)?)\s+(sms|text|texts|messages|incoming)?\b/i;

const INVALID_DEST =
  /\b(invalid (number|destination|recipient)|unknown subscriber|no longer (valid|in service|available)|recipient (invalid|not found)|number (disconnected|inactive))\b/i;

const NOT_REACHABLE =
  /\b(not (reachable|available)|unable to reach|cannot be reached|mailbox (full|not accepting))\b/i;

const CARRIER =
  /\b(carrier|network|operator) (error|reject|blocked|restriction)\b/i;

/** Other systems echoing our own “can’t receive replies” canned SMS back — stop the loop. */
function heuristicEchoOfOurUnknownNumberReply(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    t.includes('this number is not able to receive replies') ||
    (t.includes('not able to receive replies') && t.includes('845') && t.includes('478'))
  );
}

function heuristicStrong(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  if (heuristicEchoOfOurUnknownNumberReply(t)) return true;
  return (
    STRONG.test(t) ||
    OFFICE.test(t) ||
    DELIVERY_FAIL.test(t) ||
    CANNOT_RECEIVE.test(t) ||
    INVALID_DEST.test(t) ||
    NOT_REACHABLE.test(t) ||
    CARRIER.test(t)
  );
}

/** Possible bounce wording — worth a cheap AI check when strong heuristic missed. */
function weakSignalForAi(text: string): boolean {
  if (text.length > 700) return false;
  return /\b(receive|accept|deliver|sms|text(ed)?|message|sent|fail|reply|subscriber|blocked|reject)\b/i.test(
    text,
  );
}

async function classifyWithHaiku(text: string): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.SMS_BOT_AUTO_REPLY_AI === 'false') return false;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const truncated = text.trim().slice(0, 900);

  const res = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 8,
    messages: [
      {
        role: 'user',
        content:
          `Reply with exactly YES or NO.\n\nDoes this SMS appear to be ONLY an automated bounce notice, delivery failure, out-of-office reply, autoresponder, or a message stating this number cannot receive SMS/texts — not a human asking for help?\n\n"""${truncated}"""`,
      },
    ],
  });

  const block = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const raw = block?.text?.trim().toUpperCase() ?? '';
  return raw.startsWith('YES');
}

/**
 * Use when identifyClientByPhone returned no rows: inbound may be another bot/carrier reply.
 */
export async function detectInboundAutomatedPingPongReply(messageText: string): Promise<boolean> {
  const t = messageText.trim();
  if (!t) return false;

  if (heuristicStrong(t)) return true;

  if (!weakSignalForAi(t)) return false;

  try {
    return await classifyWithHaiku(t);
  } catch (err) {
    console.error('[sms-auto-reply-detection] Haiku classify failed:', err);
    return false;
  }
}
