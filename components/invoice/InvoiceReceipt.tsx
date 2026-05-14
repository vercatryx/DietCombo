'use client';

import { forwardRef } from 'react';
import type { ClientInvoiceApiPayload } from '@/lib/invoice/build-client-invoice-payload';
import { formatInvoiceMoney, getClientInvoiceFixedLine } from '@/lib/invoice/build-client-invoice-payload';
import {
    INVOICE_ORG_ADDRESS_INLINE,
    INVOICE_ORG_SUPPORT,
    invoiceOrgContactOneLine,
} from '@/lib/invoice/invoice-org-footer';
import styles from './invoice-receipt.module.css';

/** Body rows so the sheet reads as a full A4 page before PDF scaling. */
const MIN_TABLE_BODY_ROWS = 34;

function splitAddress(addr: string): string[] {
    const t = (addr || '').trim();
    if (!t) return [];
    const parts = t.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : [t];
}

type Props = {
    invoice: ClientInvoiceApiPayload;
};

export const InvoiceReceipt = forwardRef<HTMLDivElement, Props>(function InvoiceReceipt({ invoice }, ref) {
    const footerLine = process.env.NEXT_PUBLIC_INVOICE_ORG_FOOTER_LINE || 'Thank you for your business.';
    const addrLines = splitAddress(invoice.clientAddress);
    const padCount = Math.max(0, MIN_TABLE_BODY_ROWS - 1);
    const fixedLine =
        invoice.invoiceFixedLine ??
        getClientInvoiceFixedLine(invoice.produceInvoice === true, invoice.householdMemberCount ?? 1);

    return (
        <div className={styles.receiptA4Frame}>
            <div ref={ref} className={styles.printSheet}>
                <article className={styles.receipt}>
                    <header className={styles.receiptHeader}>
                        <div className={styles.headerTop}>
                            <div className={styles.brand}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src="/diet-fantasy-logo.png" alt="" className={styles.logo} />
                            </div>
                            <div className={styles.headerTitles}>
                                <h1 className={styles.docTitle}>Invoice</h1>
                            </div>
                        </div>
                    </header>

                    <div className={styles.metaRow}>
                        <div className={styles.combinedBillingBox}>
                            <div className={styles.billingBlock}>
                                <div className={styles.blockLabel}>Billing period</div>
                                <div className={styles.blockValue}>{invoice.periodLabel}</div>
                            </div>
                            <div className={styles.boxDivider} aria-hidden="true" />
                            <div className={styles.billingBlock}>
                                <div className={styles.blockLabel}>Delivery date</div>
                                <div className={styles.blockValue}>{invoice.deliveryDateFormatted}</div>
                            </div>
                        </div>
                        <aside className={styles.deliverySide}>
                            <div className={styles.deliverySideTitle}>Delivery address</div>
                            <div className={styles.deliveryName}>{invoice.clientName}</div>
                            {addrLines.length > 0 ? (
                                <div className={styles.deliveryAddress}>
                                    {addrLines.map((line, i) => (
                                        <div key={i}>{line}</div>
                                    ))}
                                </div>
                            ) : (
                                <div className={styles.deliveryAddressMuted}>No address on file</div>
                            )}
                            <div className={styles.deliveryPhone}>
                                {invoice.clientPhone?.trim() ? invoice.clientPhone : '—'}
                            </div>
                        </aside>
                    </div>

                    {invoice.warnings.length > 0 ? (
                        <ul className={styles.warnings}>
                            {invoice.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                            ))}
                        </ul>
                    ) : null}

                    <div className={styles.tableWrap}>
                        <table className={styles.lineTable}>
                            <thead>
                                <tr>
                                    <th className={styles.colNum}>#</th>
                                    <th>Item</th>
                                    <th className={styles.colMoney}>Unit price</th>
                                    <th className={styles.colQty}>Qty</th>
                                    <th className={styles.colMoney}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className={styles.colNum}>1</td>
                                    <td>{fixedLine.description}</td>
                                    <td className={styles.colMoney}>{formatInvoiceMoney(fixedLine.unitPriceUsd)}</td>
                                    <td className={styles.colQty}>{fixedLine.quantity}</td>
                                    <td className={styles.colMoney}>{formatInvoiceMoney(fixedLine.lineTotalUsd)}</td>
                                </tr>
                                {Array.from({ length: padCount }).map((_, i) => (
                                    <tr key={`pad-${i}`} className={styles.padRow}>
                                        <td className={styles.colNum} />
                                        <td />
                                        <td className={styles.colMoney} />
                                        <td className={styles.colQty} />
                                        <td className={styles.colMoney} />
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className={styles.totalRow}>
                                    <td colSpan={4} className={styles.totalLabel}>
                                        Invoice total
                                    </td>
                                    <td className={styles.colMoney}>{formatInvoiceMoney(fixedLine.lineTotalUsd)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <footer className={styles.receiptFooter}>
                        <p className={styles.footerBrand}>{footerLine}</p>
                        <p className={styles.footerOrgOneLine} aria-label={invoiceOrgContactOneLine()}>
                            <span className={styles.footerOrgPlain}>{INVOICE_ORG_ADDRESS_INLINE}</span>
                            <span className={styles.footerOrgPipe} aria-hidden="true">
                                |
                            </span>
                            <a className={styles.footerOrgLink} href={`mailto:${INVOICE_ORG_SUPPORT.email}`}>
                                {INVOICE_ORG_SUPPORT.email}
                            </a>
                            <span className={styles.footerOrgPipe} aria-hidden="true">
                                |
                            </span>
                            <a className={styles.footerOrgLink} href={`tel:${INVOICE_ORG_SUPPORT.phoneTel}`}>
                                {INVOICE_ORG_SUPPORT.phoneDisplay}
                            </a>
                        </p>
                    </footer>
                </article>
            </div>
        </div>
    );
});
