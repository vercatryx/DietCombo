'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createManualProduceOrderForAdmin,
    searchClientsForAdminManualProduceOrder,
} from '@/lib/actions';
import {
    firstDeliveryDayDateKeyInRosterWeek,
    getProduceOrderRosterWeekSundayKey,
} from '@/lib/produce-roster-week';
import { CalendarPlus, Loader2, Search, User } from 'lucide-react';
import styles from './SettingsManagement.module.css';

type SearchRow = { id: string; fullName: string; produceVendorName: string | null };

/** Embedded in Admin → Settings → Actions. */
export function ManualProduceOrderManagement() {
    const defaultDeliveryDate = useMemo(
        () => firstDeliveryDayDateKeyInRosterWeek(getProduceOrderRosterWeekSundayKey(new Date()), 'Monday'),
        []
    );

    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<SearchRow[]>([]);
    const [searchError, setSearchError] = useState<string | null>(null);

    const [selected, setSelected] = useState<SearchRow | null>(null);
    const [deliveryDate, setDeliveryDate] = useState(defaultDeliveryDate);
    const [submitting, setSubmitting] = useState(false);
    const [formMessage, setFormMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

    const runSearch = useCallback(async (q: string) => {
        const trimmed = q.trim();
        if (trimmed.length < 2) {
            setResults([]);
            setSearchError(null);
            return;
        }
        setSearching(true);
        setSearchError(null);
        try {
            const res = await searchClientsForAdminManualProduceOrder(trimmed);
            if (res.error) {
                setResults([]);
                setSearchError(res.error);
            } else {
                setResults(res.results);
            }
        } catch (e) {
            setResults([]);
            setSearchError(e instanceof Error ? e.message : 'Search failed');
        } finally {
            setSearching(false);
        }
    }, []);

    useEffect(() => {
        const t = window.setTimeout(() => {
            void runSearch(query);
        }, 320);
        return () => window.clearTimeout(t);
    }, [query, runSearch]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setFormMessage(null);
        if (!selected) {
            setFormMessage({ type: 'err', text: 'Choose a client from the list.' });
            return;
        }
        setSubmitting(true);
        try {
            const res = await createManualProduceOrderForAdmin(selected.id, deliveryDate);
            if (res.success) {
                setFormMessage({
                    type: 'ok',
                    text: `Created Produce order #${res.orderNumber} for ${deliveryDate} (roster week starting ${res.rosterWeekSunday}).`,
                });
            } else {
                setFormMessage({ type: 'err', text: res.error });
            }
        } catch (err) {
            setFormMessage({
                type: 'err',
                text: err instanceof Error ? err.message : 'Request failed',
            });
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="manual-produce-search">
                    <Search size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                    Find client (produce clients only)
                </label>
                <input
                    id="manual-produce-search"
                    className={styles.input}
                    type="search"
                    autoComplete="off"
                    placeholder="Type at least 2 characters…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                />
                {searching && (
                    <p className={styles.helper} style={{ marginTop: 4 }}>
                        <Loader2 size={14} className="animate-spin" style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                        Searching…
                    </p>
                )}
                {searchError && <p className={styles.error} style={{ marginTop: 4 }}>{searchError}</p>}
                {!searching && query.trim().length >= 2 && results.length === 0 && !searchError && (
                    <p className={styles.helper} style={{ marginTop: 4 }}>
                        No matching produce clients.
                    </p>
                )}
                {results.length > 0 && (
                    <ul
                        role="listbox"
                        style={{
                            marginTop: 10,
                            maxHeight: 220,
                            overflowY: 'auto',
                            border: '1px solid #d1d5db',
                            borderRadius: '0.375rem',
                            listStyle: 'none',
                            padding: 0,
                            maxWidth: '24rem',
                        }}
                    >
                        {results.map(row => (
                            <li key={row.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selected?.id === row.id}
                                    onClick={() => {
                                        setSelected(row);
                                        setFormMessage(null);
                                    }}
                                    style={{
                                        width: '100%',
                                        textAlign: 'left',
                                        padding: '0.65rem 0.85rem',
                                        border: 'none',
                                        borderBottom: '1px solid #e5e7eb',
                                        background: selected?.id === row.id ? '#f3f4f6' : 'white',
                                        cursor: 'pointer',
                                        color: '#111827',
                                    }}
                                >
                                    <User size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
                                    <strong>{row.fullName}</strong>
                                    {row.produceVendorName ? (
                                        <span className={styles.helper} style={{ fontWeight: 400 }}>
                                            {' '}
                                            — {row.produceVendorName}
                                        </span>
                                    ) : (
                                        <span style={{ color: '#b45309', fontWeight: 400 }}> — no produce vendor</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {selected && (
                <p className={styles.helper} style={{ marginBottom: 12 }}>
                    Selected: <strong style={{ color: '#111827' }}>{selected.fullName}</strong>
                </p>
            )}

            <div className={styles.inputGroup}>
                <label className={styles.label} htmlFor="manual-produce-date">
                    <CalendarPlus size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                    Scheduled delivery date
                </label>
                <input
                    id="manual-produce-date"
                    className={styles.input}
                    type="date"
                    required
                    value={deliveryDate}
                    onChange={e => setDeliveryDate(e.target.value)}
                />
                <p className={styles.helper}>
                    Default is the Monday of the current produce roster week (same anchor as weekly orders).
                </p>
            </div>

            <button type="submit" className={styles.actionButton} disabled={submitting || !selected}>
                {submitting ? (
                    <>
                        <Loader2 size={16} className="animate-spin" style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                        Creating…
                    </>
                ) : (
                    'Create produce order'
                )}
            </button>

            {formMessage && (
                <div
                    className={formMessage.type === 'ok' ? styles.success : styles.error}
                    style={{ marginTop: '0.75rem' }}
                >
                    {formMessage.text}
                </div>
            )}
        </form>
    );
}
