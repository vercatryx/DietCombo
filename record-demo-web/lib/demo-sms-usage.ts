import type { ClientProfile } from '../../lib/types';

export type DemoSmsClientUsage = {
  clientId: string | null;
  clientName: string;
  total: number;
  botReply: number;
  delivery: number;
  other: number;
  failed: number;
  numbers: string[];
};

export type DemoSmsUsagePayload = {
  clients: DemoSmsClientUsage[];
  totalMessages: number;
  totalFailed: number;
  from: string;
  to: string;
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Deterministic plausible SMS stats per client for the selected date range */
export function buildFakeSmsUsage(from: string, to: string, profiles: ClientProfile[]): DemoSmsUsagePayload {
  const fromD = from.trim().slice(0, 10);
  const toD = to.trim().slice(0, 10);
  const seedKey = `${fromD}|${toD}`;

  const clients: DemoSmsClientUsage[] = [];

  for (const c of profiles) {
    if (c.parentClientId) continue;

    const h = hashStr(`${c.id}:${seedKey}`);
    const total = 4 + (h % 52);
    const failed = h % 11 === 0 ? 1 + (h % 4) : h % 17 === 0 ? 1 : 0;

    const botReply = Math.floor(total * (0.24 + ((h >> 4) % 8) / 100));
    const delivery = Math.floor(total * (0.52 + ((h >> 8) % 8) / 100));
    const other = total - botReply - delivery;

    const phone = (c.phoneNumber || '').trim() || `(614) 555-${String(1000 + (h % 9000)).padStart(4, '0')}`;
    const alt =
      h % 5 === 0 ? [`${phone}`, `(614) 555-${String(2000 + (h % 7000)).padStart(4, '0')}`] : [phone];

    clients.push({
      clientId: c.id,
      clientName: c.fullName,
      total,
      botReply,
      delivery,
      other,
      failed,
      numbers: alt,
    });
  }

  clients.sort((a, b) => b.total - a.total);

  const totalMessages = clients.reduce((s, r) => s + r.total, 0);
  const totalFailed = clients.reduce((s, r) => s + r.failed, 0);

  return {
    clients,
    totalMessages,
    totalFailed,
    from: fromD,
    to: toD,
  };
}
