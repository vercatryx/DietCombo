import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Clock, ExternalLink, User } from 'lucide-react';
import type { Metadata } from 'next';
import { verifySession } from '@/lib/session';
import { getPendingScreeningSubmissions } from '@/lib/form-actions';
import { formatDateTimeInAppTz } from '@/lib/timezone';

export const metadata: Metadata = {
    title: 'Pending screenings',
};

const ALLOWED_ROLES = new Set(['admin', 'super-admin', 'brooklyn_admin']);

export default async function PendingScreeningsPage() {
    const session = await verifySession();
    if (!ALLOWED_ROLES.has(session.role)) {
        redirect('/clients');
    }

    const result = await getPendingScreeningSubmissions();
    const rows = result.success ? result.data ?? [] : [];

    return (
        <div style={{ maxWidth: '960px' }}>
            <header style={{ marginBottom: '1.5rem' }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>
                    Pending nutritionist screenings
                </h1>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                    Screening forms that were submitted and are waiting for approval via the same review link emailed to nutritionists.
                </p>
            </header>

            {!result.success && (
                <div
                    role="alert"
                    style={{
                        padding: '12px 16px',
                        borderRadius: '8px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        color: '#b91c1c',
                        marginBottom: '1rem',
                    }}
                >
                    {result.error ?? 'Could not load pending submissions.'}
                </div>
            )}

            {result.success && rows.length === 0 && (
                <div
                    style={{
                        padding: '40px',
                        textAlign: 'center',
                        background: 'var(--bg-secondary)',
                        borderRadius: '8px',
                        color: 'var(--text-secondary)',
                    }}
                >
                    No submissions are pending approval right now.
                </div>
            )}

            {rows.length > 0 && (
                <div
                    style={{
                        border: '1px solid var(--border-color, #e2e8f0)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        background: 'var(--bg-secondary)',
                    }}
                >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-primary)', textAlign: 'left' }}>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Client</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Submitted</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)', width: '1%' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} style={{ borderTop: '1px solid var(--border-color, #e2e8f0)' }}>
                                    <td style={{ padding: '14px 16px', verticalAlign: 'middle' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <User size={18} color="var(--text-secondary)" aria-hidden />
                                            {row.client_id ? (
                                                <Link
                                                    href={`/clients/${row.client_id}`}
                                                    style={{ color: 'var(--color-primary, #2563eb)', fontWeight: 500, textDecoration: 'none' }}
                                                >
                                                    {row.client_name?.trim() || 'Client'}
                                                </Link>
                                            ) : (
                                                <span style={{ color: 'var(--text-primary)' }}>
                                                    {row.client_name?.trim() || 'No linked client'}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ padding: '14px 16px', verticalAlign: 'middle', color: 'var(--text-primary)' }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                            <Clock size={16} color="#f59e0b" aria-hidden />
                                            {formatDateTimeInAppTz(row.created_at)}
                                        </span>
                                    </td>
                                    <td style={{ padding: '14px 16px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                                        <a
                                            href={`/verify-order/${row.token}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn btn-secondary"
                                            style={{ fontSize: '14px', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                                        >
                                            <ExternalLink size={14} />
                                            Review
                                        </a>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
