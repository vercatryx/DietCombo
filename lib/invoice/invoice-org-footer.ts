/** Vendor contact on client invoices (web + PDF). */

export const INVOICE_ORG_ADDRESS_INLINE = '44 S Main St New City, NY 10956';

export const INVOICE_ORG_SUPPORT = {
    email: 'Customersupport@thedietfantasy.com',
    /** E.164 for tel: link (855-995-DIET → 855-995-3438) */
    phoneTel: '+18559953438',
    phoneDisplay: '855.995.DIET',
} as const;

const SEP = ' | ';

/** Single line: `address | email | phone` */
export function invoiceOrgContactOneLine(): string {
    return `${INVOICE_ORG_ADDRESS_INLINE}${SEP}${INVOICE_ORG_SUPPORT.email}${SEP}${INVOICE_ORG_SUPPORT.phoneDisplay}`;
}
