/**
 * True when the client/order service type includes produce (drivers app should not list these).
 * Matches DB usage: clients may store comma-separated values (e.g. "Food,Produce");
 * orders sometimes use service_type 'produce' (lowercase).
 */
export function isProduceServiceType(serviceType: string | null | undefined): boolean {
    if (serviceType == null || serviceType === '') return false;
    return String(serviceType)
        .split(',')
        .some(s => s.trim().toLowerCase() === 'produce');
}
