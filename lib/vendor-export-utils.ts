/**
 * Vendor export utilities: sort orders by driver for consistent PDF/Excel exports.
 * Used by VendorDetail and VendorDeliveryOrders for Labels, Breakdown, Cooking, Excel.
 */

import type { ClientProfile } from './types';

const DRIVER_COLOR_PALETTE = [
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
    '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#393b79',
    '#ad494a', '#637939', '#ce6dbd', '#8c6d31', '#7f7f7f',
];

function driverRankByName(name: string | null | undefined): number {
    if (!name) return Number.MAX_SAFE_INTEGER;
    const m = /driver\s+(\d+)/i.exec(String(name));
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export interface DriverInfo {
    id: string;
    name: string;
    color: string;
}

export interface SortOrdersByDriverResult {
    sortedOrders: any[];
    driverColors: string[];
    /** Map driver id -> driver number (1, 2, 3...) for label rendering */
    driverIdToNumber: Record<string, number>;
    /** Map driver id -> hex color for label rendering */
    driverIdToColor: Record<string, string>;
}

/**
 * Sort orders by driver then stop number (1.1, 1.2, 2.1, …) for vendor exports.
 * Orders without assigned_driver_id go last. When clientIdToStopNumber is provided,
 * orders within each driver are sorted by stop number (ascending); orders without a stop go after those with.
 */
export function sortOrdersByDriver(
    orders: any[],
    clients: ClientProfile[],
    drivers: DriverInfo[],
    clientIdToStopNumber?: Record<string, number>
): SortOrdersByDriverResult {
    const clientById = new Map<string, ClientProfile>();
    for (const c of clients) {
        clientById.set(c.id, c);
    }

    const driverById = new Map<string, DriverInfo>();
    for (const d of drivers) {
        driverById.set(d.id, d);
    }

    const getStop = (order: any) => clientIdToStopNumber?.[order.client_id] ?? null;

    // Group orders by assignedDriverId
    const groupsByDriverId = new Map<string, any[]>();
    const unassigned: any[] = [];

    for (const order of orders) {
        const client = clientById.get(order.client_id);
        const driverId = client?.assignedDriverId ? String(client.assignedDriverId) : null;
        if (driverId && driverById.has(driverId)) {
            if (!groupsByDriverId.has(driverId)) {
                groupsByDriverId.set(driverId, []);
            }
            groupsByDriverId.get(driverId)!.push(order);
        } else {
            unassigned.push(order);
        }
    }

    // Sort driver ids by rank (Driver 1, Driver 2, …)
    const driverIds = Array.from(groupsByDriverId.keys()).sort((a, b) => {
        const driverA = driverById.get(a);
        const driverB = driverById.get(b);
        return driverRankByName(driverA?.name) - driverRankByName(driverB?.name);
    });

    const sortedOrders: any[] = [];
    const driverColors: string[] = [];
    const driverIdToNumber: Record<string, number> = {};
    const driverIdToColor: Record<string, string> = {};

    for (const driverId of driverIds) {
        const driver = driverById.get(driverId);
        const parsedNum = driverRankByName(driver?.name);
        const displayNum = parsedNum !== Number.MAX_SAFE_INTEGER ? parsedNum : driverColors.length;
        driverIdToNumber[driverId] = displayNum;
        const color = driver?.color && driver.color !== '#666' && driver.color !== 'gray' && driver.color !== 'grey'
            ? driver.color
            : DRIVER_COLOR_PALETTE[driverColors.length % DRIVER_COLOR_PALETTE.length];
        driverColors.push(color);
        driverIdToColor[driverId] = color;

        let group = groupsByDriverId.get(driverId) || [];
        if (clientIdToStopNumber && Object.keys(clientIdToStopNumber).length > 0) {
            group = [...group].sort((a, b) => {
                const stopA = getStop(a);
                const stopB = getStop(b);
                if (stopA != null && stopB != null) return stopA - stopB;
                if (stopA != null) return -1;
                if (stopB != null) return 1;
                return 0;
            });
        }
        sortedOrders.push(...group);
    }

    sortedOrders.push(...unassigned);

    return { sortedOrders, driverColors, driverIdToNumber, driverIdToColor };
}
