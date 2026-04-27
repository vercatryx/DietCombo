import Link from 'next/link';

/** No transcript list on this URL — use Admin → SMS Usage → View (modal). */
export default function SmsConversationsHintPage() {
  return (
    <div style={{ padding: '2rem', maxWidth: 560, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>SMS bot threads</h1>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary, #888)' }}>
        Conversations are <strong>not</strong> shown on this address. Go to{' '}
        <Link href="/admin" style={{ color: 'var(--color-primary, #22c55e)' }}>
          Admin
        </Link>
        {' '}→ <strong>SMS Usage</strong> → pick a date range that includes <strong>today</strong> (Eastern) → <strong>Load</strong> →{' '}
        <strong>View</strong> beside the client. That modal loads whatever bot/user lines still exist for the last couple of hours of activity.
      </p>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #888)' }}>
        This page exists only so <code>/sms-conversations</code> does not 404; the real UI is the modal on SMS Usage.
      </p>
    </div>
  );
}
