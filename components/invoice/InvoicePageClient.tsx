'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { ClientInvoiceApiPayload } from '@/lib/invoice/build-client-invoice-payload';
import { InvoiceReceipt } from '@/components/invoice/InvoiceReceipt';
import { getTodayInAppTz } from '@/lib/timezone';
import { searchClientsForDashboard } from '@/lib/actions';
import type { ClientProfile } from '@/lib/types';
import { downloadInvoicePdfFromElement } from '@/lib/invoice/download-invoice-pdf';
import styles from './invoice-page.module.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultDateRange(): { from: string; to: string } {
    const today = getTodayInAppTz();
    return { from: today, to: today };
}

/** One row per household (root id + display name). */
function householdsFromSearchResults(clients: ClientProfile[]): { rootId: string; label: string }[] {
    const byRoot = new Map<string, ClientProfile[]>();
    for (const c of clients) {
        const root = c.parentClientId ?? c.id;
        const list = byRoot.get(root) ?? [];
        list.push(c);
        byRoot.set(root, list);
    }
    const out: { rootId: string; label: string }[] = [];
    for (const [rootId, members] of byRoot) {
        const parent = members.find((m) => m.id === rootId) ?? members[0];
        out.push({ rootId, label: parent.fullName });
    }
    out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
    return out;
}

function looksLikeUuid(s: string): boolean {
    return UUID_RE.test(s.trim());
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseYmd(s: string | null): string | null {
    const t = s?.trim();
    if (!t || !YMD_RE.test(t)) return null;
    return t;
}

function parseProduceInvoiceFlag(s: string | null): boolean {
    const p = s?.trim().toLowerCase();
    return p === '1' || p === 'true' || p === 'yes';
}

type Props = {
    brooklynOnly: boolean;
};

export function InvoicePageClient({ brooklynOnly }: Props) {
    const searchParams = useSearchParams();
    const urlHydrated = useRef(false);

    const initial = defaultDateRange();
    const [clientQuery, setClientQuery] = useState('');
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [produceInvoice, setProduceInvoice] = useState(false);
    const [invoice, setInvoice] = useState<ClientInvoiceApiPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pickHouseholds, setPickHouseholds] = useState<{ rootId: string; label: string }[] | null>(null);
    const [pdfBusy, setPdfBusy] = useState(false);
    const receiptRef = useRef<HTMLDivElement>(null);

    const canSubmit = useMemo(() => clientQuery.trim() && from && to, [clientQuery, from, to]);

    /** `deliveryDate` in the URL is the first day of billing: we map it to `from` when `from` is omitted. */
    useEffect(() => {
        if (urlHydrated.current) return;
        const fromQ = parseYmd(searchParams.get('from'));
        const toQ = parseYmd(searchParams.get('to'));
        const deliveryQ = parseYmd(searchParams.get('deliveryDate'));
        const firstDay = fromQ ?? deliveryQ;
        const clientQ = searchParams.get('clientId')?.trim();
        if (!firstDay && !clientQ) return;
        if (firstDay) {
            setFrom(firstDay);
            setTo(toQ ?? firstDay);
        }
        if (clientQ) setClientQuery(clientQ);
        setProduceInvoice(parseProduceInvoiceFlag(searchParams.get('produce')));
        urlHydrated.current = true;
    }, [searchParams]);

    const fetchInvoiceForClientId = useCallback(
        async (clientId: string) => {
            const qs = new URLSearchParams({
                clientId,
                from,
                to,
            });
            if (produceInvoice) qs.set('produce', '1');
            const res = await fetch(`/api/admin/client-invoice?${qs.toString()}`, { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setInvoice(null);
                setError(typeof data.error === 'string' ? data.error : 'Could not load invoice');
                return;
            }
            setInvoice(data as ClientInvoiceApiPayload);
        },
        [from, to, produceInvoice],
    );

    const loadInvoice = useCallback(async () => {
        if (!canSubmit) return;
        setLoading(true);
        setError(null);
        setPickHouseholds(null);
        const raw = clientQuery.trim();
        try {
            if (looksLikeUuid(raw)) {
                await fetchInvoiceForClientId(raw);
                return;
            }

            const { clients } = await searchClientsForDashboard(raw, { brooklynOnly });
            if (!clients.length) {
                setInvoice(null);
                setError('No clients matched that name or search text.');
                return;
            }

            const households = householdsFromSearchResults(clients);
            if (households.length === 1) {
                await fetchInvoiceForClientId(households[0].rootId);
                return;
            }

            setInvoice(null);
            setPickHouseholds(households);
        } catch {
            setInvoice(null);
            setError('Network error');
        } finally {
            setLoading(false);
        }
    }, [brooklynOnly, canSubmit, clientQuery, fetchInvoiceForClientId]);

    const onPickHousehold = useCallback(
        async (rootId: string) => {
            setPickHouseholds(null);
            setLoading(true);
            setError(null);
            try {
                await fetchInvoiceForClientId(rootId);
            } catch {
                setInvoice(null);
                setError('Network error');
            } finally {
                setLoading(false);
            }
        },
        [fetchInvoiceForClientId],
    );

    const onQueryChange = (value: string) => {
        setClientQuery(value);
        setPickHouseholds(null);
    };

    const handleDownloadPdf = useCallback(async () => {
        const el = receiptRef.current;
        if (!el || !invoice) return;
        setPdfBusy(true);
        setError(null);
        try {
            const base = `invoice-${invoice.clientName}-${invoice.periodFrom}-to-${invoice.periodTo}`;
            await downloadInvoicePdfFromElement(el, base);
        } catch (e) {
            console.error('[invoice PDF]', e);
            setError('Could not generate PDF. Try again or use Print to PDF.');
        } finally {
            setPdfBusy(false);
        }
    }, [invoice]);

    return (
        <div className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>Invoice</h1>
                <p className={styles.subtitle}>
                    Enter a client UUID or search by name (same search as the client dashboard), set the billing window
                    (From / To), then load the invoice. The delivery date on the invoice is always the first day of the
                    billing period (the From date). Optional URL query:{' '}
                    <code className={styles.inlineCode}>
                        ?clientId=…&amp;from=YYYY-MM-DD&amp;to=YYYY-MM-DD
                    </code>{' '}
                    — or use <code className={styles.inlineCode}>deliveryDate=YYYY-MM-DD</code> instead of{' '}
                    <code className={styles.inlineCode}>from</code> when they are the same. Public PDF (no login),
                    same params:{' '}
                    <code className={styles.inlineCode}>/api/client-invoice-pdf?clientId=…&amp;from=…&amp;to=…</code>
                    . Append <code className={styles.inlineCode}>&amp;produce=1</code> for the produce voucher line (1 × $146).
                </p>
            </header>

            <section className={styles.controls}>
                <label className={styles.field}>
                    <span>Client</span>
                    <input
                        className={styles.input}
                        value={clientQuery}
                        onChange={(e) => onQueryChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && canSubmit && !loading) {
                                e.preventDefault();
                                void loadInvoice();
                            }
                        }}
                        placeholder="Name, phone, address fragment, or client UUID"
                        autoComplete="off"
                    />
                </label>
                <label className={styles.field}>
                    <span>From (delivery date)</span>
                    <input className={styles.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className={styles.field}>
                    <span>To</span>
                    <input className={styles.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
                <button type="button" className={styles.submit} disabled={!canSubmit || loading} onClick={() => void loadInvoice()}>
                    {loading ? 'Loading…' : 'Load invoice'}
                </button>
            </section>

            {pickHouseholds && pickHouseholds.length > 0 ? (
                <div className={styles.pickSection}>
                    <p className={styles.pickTitle}>Several households matched — pick one:</p>
                    <div className={styles.pickList}>
                        {pickHouseholds.map((h) => (
                            <button
                                key={h.rootId}
                                type="button"
                                className={styles.pickBtn}
                                onClick={() => void onPickHousehold(h.rootId)}
                                disabled={loading}
                            >
                                {h.label}
                                <span className={styles.pickId}> · {h.rootId}</span>
                            </button>
                        ))}
                    </div>
                    <p className={styles.pickHint}>Tip: refine your search text and load again to narrow results.</p>
                </div>
            ) : null}

            {error ? <div className={styles.error}>{error}</div> : null}

            {invoice ? (
                <div className={styles.preview}>
                    <div className={styles.previewToolbar}>
                        <button
                            type="button"
                            className={styles.downloadBtn}
                            disabled={pdfBusy}
                            onClick={() => void handleDownloadPdf()}
                        >
                            {pdfBusy ? 'Preparing PDF…' : 'Download PDF'}
                        </button>
                    </div>
                    <InvoiceReceipt ref={receiptRef} invoice={invoice} />
                </div>
            ) : null}
        </div>
    );
}
