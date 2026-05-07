'use client';

import { useState, useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import {
    listClientChangesForAdmin,
    getStatuses,
    getNavigators,
    getClientFullDetails,
    type AdminClientChangeRow,
    type UniteAccountFilter,
} from '@/lib/actions';
import {
    CHANGE_TAG_LABELS,
    CHANGE_TAG_ORDER,
    type ChangeDisplayTag,
} from '@/lib/audit/clientChangeTags';
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

const filterPanelStyle: CSSProperties = {
    position: 'absolute',
    zIndex: 20,
    marginTop: 4,
    padding: '10px 12px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 8,
    maxHeight: 280,
    overflowY: 'auto',
    minWidth: 260,
    boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
};

export function ClientChangesManagement() {
    const router = useRouter();
    const defaults = defaultDateRange();
    const [fromDate, setFromDate] = useState(defaults.from);
    const [toDate, setToDate] = useState(defaults.to);
    const [selectedTags, setSelectedTags] = useState<ChangeDisplayTag[]>([]);
    const [selectedActors, setSelectedActors] = useState<string[]>([]);
    const [actorOptions, setActorOptions] = useState<string[]>([]);
    const [uniteAccount, setUniteAccount] = useState<UniteAccountFilter>('all');
    const [rows, setRows] = useState<AdminClientChangeRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [shelfClient, setShelfClient] = useState<ClientProfile | null>(null);
    const [shelfSubmissions, setShelfSubmissions] = useState<Submission[]>([]);
    const [shelfOpeningId, setShelfOpeningId] = useState<string | null>(null);

    const typesFilterWrapRef = useRef<HTMLDivElement>(null);
    const staffFilterWrapRef = useRef<HTMLDivElement>(null);
    const [typesDropdownOpen, setTypesDropdownOpen] = useState(false);
    const [staffDropdownOpen, setStaffDropdownOpen] = useState(false);

    useEffect(() => {
        if (!typesDropdownOpen && !staffDropdownOpen) return;

        function handlePointerDown(event: PointerEvent) {
            const target = event.target as Node;
            if (typesFilterWrapRef.current && !typesFilterWrapRef.current.contains(target)) {
                setTypesDropdownOpen(false);
            }
            if (staffFilterWrapRef.current && !staffFilterWrapRef.current.contains(target)) {
                setStaffDropdownOpen(false);
            }
        }

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [typesDropdownOpen, staffDropdownOpen]);

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
                uniteAccount,
                tagFilters: selectedTags.length > 0 ? selectedTags : undefined,
                whoFilters: selectedActors.length > 0 ? selectedActors : undefined,
                limit: 500,
            });
            if (res.error) setError(res.error);
            setRows(res.rows || []);
            setActorOptions(res.actorsInRange || []);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to load');
            setRows([]);
            setActorOptions([]);
        } finally {
            setLoading(false);
        }
    }, [fromDate, toDate, uniteAccount, selectedTags, selectedActors]);

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggleTag = useCallback((tag: ChangeDisplayTag) => {
        setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
        );
    }, []);

    const toggleActor = useCallback((name: string) => {
        setSelectedActors((prev) =>
            prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
        );
    }, []);

    const closeShelf = useCallback(() => {
        setShelfClient(null);
        setShelfSubmissions([]);
        setShelfOpeningId(null);
    }, []);

    const openShelf = useCallback(async (clientId: string) => {
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
    }, []);

    const refreshChangeRows = useCallback(() => {
        void load();
    }, [load]);

    const shelfIsDependent = !!(shelfClient?.parentClientId);

    const typesSummary =
        selectedTags.length === 0
            ? 'All types'
            : `${selectedTags.length} type${selectedTags.length === 1 ? '' : 's'}`;

    const staffSummary =
        selectedActors.length === 0
            ? 'All staff'
            : `${selectedActors.length} selected`;

    return (
        <div>
            <div
                style={{
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-end',
                    flexWrap: 'wrap',
                    marginBottom: '1rem',
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
                <div ref={typesFilterWrapRef} style={{ position: 'relative' }}>
                    <label
                        style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 4,
                        }}
                    >
                        Change types
                    </label>
                    <details
                        open={typesDropdownOpen}
                        onToggle={(e) => setTypesDropdownOpen(e.currentTarget.open)}
                        style={{ borderRadius: 8 }}
                    >
                        <summary
                            style={{
                                padding: '0.5rem 0.75rem',
                                borderRadius: 8,
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-surface)',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem',
                                minWidth: 200,
                                cursor: 'pointer',
                                listStyle: 'none',
                            }}
                        >
                            {typesSummary}
                        </summary>
                        <div style={filterPanelStyle}>
                            <label
                                style={{
                                    display: 'flex',
                                    gap: 8,
                                    alignItems: 'center',
                                    marginBottom: 8,
                                    cursor: 'pointer',
                                    fontSize: '0.88rem',
                                    fontWeight: 600,
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedTags.length === 0}
                                    onChange={() => setSelectedTags([])}
                                />
                                All
                            </label>
                            {CHANGE_TAG_ORDER.map((tag) => (
                                <label
                                    key={tag}
                                    style={{
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'center',
                                        marginBottom: 8,
                                        cursor: 'pointer',
                                        fontSize: '0.88rem',
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTags.includes(tag)}
                                        onChange={() => toggleTag(tag)}
                                    />
                                    {CHANGE_TAG_LABELS[tag]}
                                </label>
                            ))}
                        </div>
                    </details>
                </div>
                <div ref={staffFilterWrapRef} style={{ position: 'relative' }}>
                    <label
                        style={{
                            display: 'block',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            marginBottom: 4,
                        }}
                    >
                        Staff
                    </label>
                    <details
                        open={staffDropdownOpen}
                        onToggle={(e) => setStaffDropdownOpen(e.currentTarget.open)}
                        style={{ borderRadius: 8 }}
                    >
                        <summary
                            style={{
                                padding: '0.5rem 0.75rem',
                                borderRadius: 8,
                                border: '1px solid var(--border-color)',
                                background: 'var(--bg-surface)',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem',
                                minWidth: 200,
                                cursor: 'pointer',
                                listStyle: 'none',
                            }}
                        >
                            {staffSummary}
                        </summary>
                        <div style={filterPanelStyle}>
                            <label
                                style={{
                                    display: 'flex',
                                    gap: 8,
                                    alignItems: 'center',
                                    marginBottom: 8,
                                    cursor: 'pointer',
                                    fontSize: '0.88rem',
                                    fontWeight: 600,
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedActors.length === 0}
                                    onChange={() => setSelectedActors([])}
                                />
                                All
                            </label>
                            {actorOptions.length === 0 ? (
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    No staff in this date range (run Apply after loading).
                                </span>
                            ) : (
                                actorOptions.map((name) => (
                                    <label
                                        key={name}
                                        style={{
                                            display: 'flex',
                                            gap: 8,
                                            alignItems: 'center',
                                            marginBottom: 8,
                                            cursor: 'pointer',
                                            fontSize: '0.88rem',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedActors.includes(name)}
                                            onChange={() => toggleActor(name)}
                                        />
                                        {name}
                                    </label>
                                ))
                            )}
                        </div>
                    </details>
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
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Types</th>
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
                                <td style={{ padding: '10px 12px', maxWidth: 220 }}>
                                    {r.tags.length === 0 ? (
                                        <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                    ) : (
                                        <span
                                            style={{
                                                display: 'flex',
                                                flexWrap: 'wrap',
                                                gap: 6,
                                            }}
                                        >
                                            {r.tags.map((t) => (
                                                <span
                                                    key={t}
                                                    style={{
                                                        fontSize: '0.72rem',
                                                        lineHeight: 1.3,
                                                        padding: '3px 8px',
                                                        borderRadius: 999,
                                                        background: 'var(--bg-surface-hover)',
                                                        border: '1px solid var(--border-color)',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {CHANGE_TAG_LABELS[t]}
                                                </span>
                                            ))}
                                        </span>
                                    )}
                                </td>
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
                                        maxWidth: 520,
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
