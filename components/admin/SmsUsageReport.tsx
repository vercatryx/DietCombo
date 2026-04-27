'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toDateStringInAppTz } from '@/lib/timezone';

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

interface TranscriptRow {
  id: string;
  phone_number: string;
  role: string;
  content: string;
  created_at: string;
}

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: toDateStringInAppTz(from),
    to: toDateStringInAppTz(to),
  };
}

export function SmsUsageReport() {
  const defaults = getDefaultDates();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate, setToDate] = useState(defaults.to);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [transcriptFor, setTranscriptFor] = useState<{ id: string; name: string } | null>(null);
  const [transcriptRows, setTranscriptRows] = useState<TranscriptRow[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');

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

  async function openTranscript(clientId: string, clientName: string) {
    setTranscriptFor({ id: clientId, name: clientName });
    setTranscriptRows([]);
    setTranscriptError('');
    setTranscriptLoading(true);
    try {
      const q = new URLSearchParams({ clientId, from: fromDate, to: toDate });
      const res = await fetch(`/api/admin/sms-conversations?${q}`, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setTranscriptRows(json.messages || []);
    } catch (err: any) {
      setTranscriptError(err.message || 'Failed to load transcript');
    } finally {
      setTranscriptLoading(false);
    }
  }

  function closeTranscript() {
    setTranscriptFor(null);
    setTranscriptRows([]);
    setTranscriptError('');
  }

  return (
    <div>
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
                  <th style={thStyle}>Bot thread</th>
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
                    <td style={tdStyle}>
                      {c.clientId ? (
                        <button
                          type="button"
                          onClick={() => openTranscript(c.clientId!, c.clientName)}
                          style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: 6,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-surface-hover)',
                            color: 'var(--color-primary)',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                          }}
                        >
                          View
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.clients.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No messages found for this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {transcriptFor && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
          onClick={e => {
            if (e.target === e.currentTarget) closeTranscript();
          }}
        >
          <div
            style={{
              background: 'var(--bg-surface)',
              borderRadius: 12,
              border: '1px solid var(--border-color)',
              maxWidth: 560,
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>SMS bot thread</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {transcriptFor.name}
                </div>
              </div>
              <button
                type="button"
                onClick={closeTranscript}
                style={{
                  padding: '0.4rem 0.75rem',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-surface-hover)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: '0.75rem 1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              <strong>Usage vs transcript:</strong> totals count every outbound SMS (delivery, bot replies, etc.).{' '}
              <strong>This list is only the SMS bot dialog</strong> (user + assistant rows still in the database). The bot drops rows older than about{' '}
              <strong>two hours</strong> when someone texts again, so you typically see <em>recent</em> turns—not the full week.{' '}
              Date filters use <strong>Eastern</strong> calendar days so “today” includes messages from the last couple of hours when your range covers today.{' '}
              Full carrier history: Telnyx.
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '0 1.25rem 1.25rem' }}>
              {transcriptLoading && (
                <div style={{ color: 'var(--text-secondary)', padding: '1rem 0' }}>Loading…</div>
              )}
              {transcriptError && (
                <div style={{ color: '#ef4444', padding: '0.5rem 0' }}>{transcriptError}</div>
              )}
              {!transcriptLoading && !transcriptError && transcriptRows.length === 0 && (
                <div style={{ color: 'var(--text-secondary)', padding: '1rem 0' }}>
                  No bot messages in this date range (or they were already pruned). Try a range that includes the last few hours, or check Telnyx.
                </div>
              )}
              {!transcriptLoading &&
                transcriptRows.map(row => (
                  <div
                    key={row.id}
                    style={{
                      marginBottom: '0.85rem',
                      padding: '0.65rem 0.75rem',
                      borderRadius: 8,
                      background: row.role === 'user' ? 'var(--bg-surface-hover)' : 'rgba(34, 197, 94, 0.08)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
                      {row.role === 'user' ? 'Client' : row.role === 'assistant' ? 'Bot' : row.role} ·{' '}
                      {new Date(row.created_at).toLocaleString()} · {row.phone_number}
                    </div>
                    <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{row.content}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
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
