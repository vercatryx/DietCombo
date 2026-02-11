/** Normalize date string to YYYY-MM-DD for reliable DB matching. */
export function mealPlannerDateOnly(dateStr: string): string {
    if (typeof dateStr !== 'string' || !dateStr) return dateStr;
    const trimmed = dateStr.trim();
    if (trimmed.length >= 10) return trimmed.slice(0, 10);
    return trimmed;
}

/** Cutoff: dates older than this (7 days ago) are cleared on save. */
export function mealPlannerCutoffDate(): string {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
}

export type MealPlannerOrderResult = {
    id: string;
    scheduledDeliveryDate: string;
    deliveryDay: string | null;
    status: string;
    totalItems: number;
    items: { id: string; name: string; quantity: number; value?: number | null }[];
    expirationDate?: string | null;
    expectedTotalMeals?: number | null;
};

/** Prepare meal planner orders for DB update (filter cutoff, sort). Use when including in updateClient payload. */
export function prepareMealPlannerDataForUpdate(orders: MealPlannerOrderResult[]): { scheduledDeliveryDate: string; items: { id: string; name: string; quantity: number; value?: number | null }[] }[] | null {
    const cutoff = mealPlannerCutoffDate();
    const newData = orders
        .filter((o) => (o.scheduledDeliveryDate ?? '') >= cutoff)
        .map((o) => ({
            scheduledDeliveryDate: mealPlannerDateOnly(o.scheduledDeliveryDate),
            items: (o.items ?? [])
                .filter((i) => (i.name ?? '').trim())
                .map((it, idx) => ({
                    id: it.id ?? `item-${idx}`,
                    name: (it.name ?? 'Item').trim() || 'Item',
                    quantity: Math.max(0, Number(it.quantity) ?? 0),
                    value: it.value != null && !Number.isNaN(Number(it.value)) ? Number(it.value) : null
                }))
        }))
        .filter((o) => o.items.length > 0)
        .sort((a, b) => a.scheduledDeliveryDate.localeCompare(b.scheduledDeliveryDate));
    return newData.length > 0 ? newData : null;
}
