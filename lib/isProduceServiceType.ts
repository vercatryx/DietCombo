/**
 * True when the client/order service type is produce (drivers app should not list these).
 * Matches DB usage: clients.service_type 'Produce', orders.service_type 'produce'.
 */
export function isProduceServiceType(serviceType: string | null | undefined): boolean {
    if (serviceType == null || serviceType === "") return false;
    return String(serviceType).trim().toLowerCase() === "produce";
}
