'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
    listClientChangesForAdmin,
    getStatuses,
    getNavigators,
    getClientFullDetails,
    type AdminClientChangeRow,
    type AdminChangeKindFilter,
    type UniteAccountFilter,
} from '@/lib/actions';
import { CLIENT_CHANGE_KIND_LABELS, type ClientChangeKind } from '@/lib/audit/clientChangeKind';
import { formatDateTimeInAppTz } from '@/lib/timezone';
import { ClientInfoShelf } from '@/components/clients/ClientInfoShelf';
import { DependantInfoShelf } from '@/components/clients/DependantInfoShelf';
import type { ClientProfile, ClientStatus, Navigator, Submission } from '@/lib/types';

function defaultDateRange() {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 14);
    return {
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
    };
}

function kindLabel(row: AdminClientChangeRow): string {
    const k = row.changeKind;
    if (k === null || k === undefined) return '—';
    if (k === 'legacy_unknown') return 'Other (legacy)';
    return CLIENT_CHANGE_KIND_LABELS[k as ClientChangeKind] ?? String(k);
}

const KIND_OPTIONS: { value: AdminChangeKindFilter; label: string }[] = [
    { value: 'all', label: 'All types' },
    { value: 'client_created', label: 'Created' },
    { value: 'client_deleted', label: 'Deleted' },
    { value: 'paused_any', label: 'Paused (manual + automated)' },
    { value: 'client_paused', label: 'Paused (manual)' },
    { value: 'system', label: 'Paused (automated)' },
    { value: 'client_unpaused', label: 'Unpaused' },
    { value: 'client_restored', label: 'Restored' },
    { value: 'client_updated', label: 'Profile / info updated' },
    { value: 'legacy_unknown', label: 'Other (legacy log)' },
];

export function ClientChangesManagement() {
    const router = useRouter();
    const defaults = defaultDateRange();
    const [fromDate, setFromDate] = useState(defaults.from);
    const [toDate, setToDate] = useState(defaults.to);
    const [changeKind, setChangeKind] = useState<AdminChangeKindFilter>('all');
    const [uniteAccount, setUniteAccount] = useState<UniteAccountFilter>('all');
    const [whoContains, setWhoContains] = useState('');
    const [rows, setRows] = useState<AdminClientChangeRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [shelfClient, setShelfClient] = useState<ClientProfile | null>(null);
    const [shelfSubmissions, setShelfSubmissions] = useState<Submission[]>([]);
    const [shelfOpeningId, setShelfOpeningId] = useState<string | null>(null);

    useEffect(() => {
        void (async () => {
            try {
                const [s, n] = await Promise.all([getStatuses(), getNavigators()]);
                setStatuses(s || []);
                setNavigators(n || []);
            } catch (e) {
                console.error('[ClientChangesManagement] reference data', e);
            }
        })();
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await listClientChangesForAdmin({
                fromDate,
                toDate,
                changeKind,
                uniteAccount,
                whoContains: whoContains.trim() || undefined,
                limit: 500,
            });
            if (res.error) setError(res.error);
            setRows(res.rows || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load');
            setRows([]);
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate, changeKind, uniteAccount, whoContains]);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const closeShelf = useCallback(() => {
        setShelfClient(null);
        setShelfSubmissions([]);
        setShelfOpeningId(null);
    }, []);

    const openShelf = useCallback(
        async (clientId: string) => {
            setShelfOpeningId(clientId);
            try {
                const details = await getClientFullDetails(clientId);
                if (!details?.client) {
                    alert('Could not load this client.');
                    return;
                }
                setShelfClient(details.client);
                setShelfSubmissions(details.submissions || []);
            } catch (e) {
                console.error('[ClientChangesManagement] openShelf', e);
                alert(e instanceof Error ? e.message : 'Failed to open client.');
            } finally {
                setShelfOpeningId(null);
            }
        },
        []
    );

    const refreshChangeRows = useCallback(() => {
        void load();
    }, [load]);

    const shelfIsDependent = !!(shelfClient?.parentClientId);

    return (
        <div>
            <div
                style={{
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                    marginBottom: '1.25rem',
                }}
            >
                <div>
                    <label
                        style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 4,
                        }}
                    >
                        From
                    </label>
                    <input
                        type="date"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: 8,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                        }}
                    />
                </div>
                <div>
                    <label
                        style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 4,
                        }}
                    >
                        To
                    </label>
                    <input
                        type="date"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: 8,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                        }}
                    />
                </div>
                <div>
                    <label
                        style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 4,
                        }}
                    >
                        Change type
                    </label>
                    <select
                        value={changeKind}
                        onChange={(e) => setChangeKind(e.target.value as AdminChangeKindFilter)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: 8,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                            minWidth: 220,
                        }}
                    >
                        {KIND_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label
                        style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 4,
                        }}
                    >
                        Unite account
                    </label>
                    <select
                        value={uniteAccount}
                        onChange={(e) => setUniteAccount(e.target.value as UniteAccountFilter)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: 8,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                            minWidth: 160,
                        }}
                    >
                        <option value="all">All</option>
                        <option value="brooklyn">Brooklyn</option>
                        <option value="main">Monsey</option>
                    </select>
                </div>
                <div style={{ flex: '1 1 200px', minWidth: 180 }}>
                    <label
                        style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 4,
                        }}
                    >
                        Who (contains)
                    </label>
                    <input
                        type="text"
                        value={whoContains}
                        onChange={(e) => setWhoContains(e.target.value)}
                        placeholder="Staff name…"
                        style={{
                            width: '100%',
                            padding: '0.5rem 0.75rem',
                            borderRadius: 8,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-surface)',
                            color: 'var(--text-primary)',
                            fontSize: '0.9rem',
                        }}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    style={{
                        padding: '0.55rem 1.25rem',
                        borderRadius: 8,
                        border: 'none',
                        background: 'var(--color-primary)',
                        color: '#000',
                        fontWeight: 600,
                        cursor: loading ? 'wait' : 'pointer',
                        opacity: loading ? 0.75 : 1,
                    }}
                >
                    {loading ? 'Loading…' : 'Apply'}
                </button>
            </div>

            {error && (
                <p style={{ color: '#f87171', marginBottom: '1rem' }} role="alert">
                    {error}
                </p>
            )}

            <div
                style={{
                    overflowX: 'auto',
                    borderRadius: 12,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-surface)',
                }}
            >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-surface-hover)', textAlign: 'left' }}>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>When</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Who</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Account</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Type</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Client</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Summary</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && rows.length === 0 && (
                            <tr>
                                <td colSpan={6} style={{ padding: '1.5rem', color: 'var(--text-secondary)' }}>
                                    No results.
                                </td>
                            </tr>
                        )}
                        {rows.map((r) => (
                            <tr
                                key={r.id}
                                style={{ borderTop: '1px solid var(--border-color)', verticalAlign: 'top' }}
                            >
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                    {formatDateTimeInAppTz(r.timestamp)}
                                </td>
                                <td style={{ padding: '10px 12px' }}>{r.who}</td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{r.uniteAccountLabel}</td>
                                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{kindLabel(r)}</td>
                                <td style={{ padding: '10px 12px' }}>
                                    <button
                                        type="button"
                                        onClick={() => void openShelf(r.clientId)}
                                        disabled={!!shelfOpeningId}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            padding: 0,
                                            cursor: shelfOpeningId ? 'wait' : 'pointer',
                                            color: 'var(--color-primary)',
                                            font: 'inherit',
                                            textAlign: 'left',
                                            textDecoration: 'none',
                                        }}
                                    >
                                        {shelfOpeningId === r.clientId
                                            ? 'Opening…'
                                            : r.clientFullName?.trim() || r.clientId.slice(0, 8) + '…'}
                                    </button>
                                </td>
                                <td
                                    style={{
                                        padding: '10px 12px',
                                        wordBreak: 'break-word',
                                        maxWidth: 480,
                                        whiteSpace: 'pre-wrap',
                                        verticalAlign: 'top',
                                    }}
                                >
                                    {r.summary}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {shelfClient && shelfIsDependent && (
                <DependantInfoShelf
                    client={shelfClient}
                    currentUserRole="admin"
                    onClose={closeShelf}
                    onOpenProfile={(clientId) => {
                        closeShelf();
                        router.push(`/clients/${clientId}`);
                    }}
                    onClientUpdated={(updated) => {
                        if (updated && updated.id === shelfClient.id) setShelfClient(updated);
                        refreshChangeRows();
                    }}
                    onClientDeleted={() => {
                        closeShelf();
                        refreshChangeRows();
                    }}
                />
            )}

            {shelfClient && !shelfIsDependent && (
                <ClientInfoShelf
                    client={shelfClient}
                    statuses={statuses}
                    navigators={navigators}
                    submissions={shelfSubmissions}
                    allClients={[]}
                    currentUserRole="admin"
                    onClose={closeShelf}
                    onOpenProfile={(clientId) => {
                        closeShelf();
                        router.push(`/clients/${clientId}`);
                    }}
                    onOpenDependantShelf={(clientId) => void openShelf(clientId)}
                    onClientUpdated={(updated) => {
                        if (updated && updated.id === shelfClient.id) setShelfClient(updated);
                        refreshChangeRows();
                    }}
                    onClientDeleted={() => {
                        closeShelf();
                        refreshChangeRows();
                    }}
                />
            )}
        </div>
    );
}
