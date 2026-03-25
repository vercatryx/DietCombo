'use client';

import { useState } from 'react';
import Link from 'next/link';

interface ClientUsage {
  clientId: string | null;
  clientName: string;
  total: number;
  botReply: number;
  delivery: number;
  other: number;
  failed: number;
  numbers: string[];
}

interface UsageData {
  clients: ClientUsage[];
  totalMessages: number;
  totalFailed: number;
  from: string;
  to: string;
}

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function SmsUsagePage() {
  const defaults = getDefaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/sms-usage?from=${fromDate}&to=${toDate}`);
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'none', fontSize: '0.875rem' }}>
          &larr; Back to Admin
        </Link>
      </div>

      <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
        SMS Usage Report
      </h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Track outbound text messages per client for a given date range.
      </p>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>From</label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.9rem',
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>To</label>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            style={{
              padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.9rem',
            }}
          />
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          style={{
            padding: '0.5rem 1.5rem', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--color-primary)', color: '#000', fontWeight: 600, fontSize: '0.9rem',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </div>

      {error && <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</div>}

      {data && (
        <>
          <div style={{
            display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1.5rem',
          }}>
            <StatCard label="Total messages" value={data.totalMessages} />
            <StatCard label="Unique clients" value={data.clients.length} />
            <StatCard label="Failed" value={data.totalFailed} color="#ef4444" />
            <StatCard
              label="Period"
              value={`${data.from} — ${data.to}`}
              isText
            />
          </div>

          <div style={{
            borderRadius: 12, border: '1px solid var(--border-color)', overflow: 'hidden',
            background: 'var(--bg-surface)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-hover)', textAlign: 'left' }}>
                  <th style={thStyle}>Client</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Bot replies</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Delivery</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Other</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Failed</th>
                  <th style={thStyle}>Numbers</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c, i) => (
                  <tr key={c.clientId || i} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={tdStyle}>
                      {c.clientId ? (
                        <Link href={`/clients/${c.clientId}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                          {c.clientName}
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)' }}>{c.clientName}</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{c.total}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{c.botReply}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{c.delivery}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{c.other}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: c.failed > 0 ? '#ef4444' : 'inherit' }}>
                      {c.failed || '—'}
                    </td>
                    <td style={{ ...tdStyle, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {c.numbers.join(', ')}
                    </td>
                  </tr>
                ))}
                {data.clients.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No messages found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-secondary)',
  fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.03em',
};

const tdStyle: React.CSSProperties = {
  padding: '0.65rem 1rem', color: 'var(--text-primary)',
};

function StatCard({ label, value, color, isText }: { label: string; value: number | string; color?: string; isText?: boolean }) {
  return (
    <div style={{
      padding: '1rem 1.25rem', borderRadius: 10, border: '1px solid var(--border-color)',
      background: 'var(--bg-surface)', minWidth: 120,
    }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>
      <div style={{
        fontSize: isText ? '0.9rem' : '1.5rem', fontWeight: isText ? 500 : 700,
        color: color || 'var(--text-primary)',
      }}>
        {value}
      </div>
    </div>
  );
}
