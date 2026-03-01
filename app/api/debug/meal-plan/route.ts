/**
 * Debug: trace meal plan data flow and find quantity discrepancies (e.g. admin shows 0, client view shows 2).
 * GET /api/debug/meal-plan?date=2026-03-09
 * GET /api/debug/meal-plan?date=2026-03-09&item=tuna
 * With item=: returns per-item trace for first matching name (recurring qty, day-specific qty, combined qty + source).
 */

import { NextRequest } from 'next/server';
import {
    getDefaultOrderTemplate,
    getRecurringItemsFromFoodTemplate,
    getMealPlannerCustomItems,
    getCombinedMenuItemsForDate,
    getAvailableMealPlanTemplateWithAllDatesIncludingRecurring,
    getVendors,
    getMenuItems
} from '@/lib/actions';

function nameMatches(itemName: string | null | undefined, search: string): boolean {
    const n = (itemName ?? '').trim().toLowerCase();
    const s = search.trim().toLowerCase();
    return s.length > 0 && n.includes(s);
}

export async function GET(request: NextRequest) {
    const dateParam = request.nextUrl.searchParams.get('date') ?? '2026-03-09';
    const itemSearch = request.nextUrl.searchParams.get('item') ?? '';
    const dateOnly = dateParam.slice(0, 10);

    const out: Record<string, unknown> = { date: dateOnly };

    try {
        // Step 0: Default Food template
        const template = await getDefaultOrderTemplate('Food');
        out.templateExists = !!template;
        out.templateKeys = template && typeof template === 'object' ? Object.keys(template) : [];
        const ddo = template?.deliveryDayOrders ?? template?.delivery_day_orders;
        const vsTop = template?.vendorSelections ?? template?.vendor_selections;
        let templateItemCount = 0;
        if (ddo && typeof ddo === 'object') {
            for (const day of Object.keys(ddo)) {
                const arr = Array.isArray((ddo[day] as any)?.vendorSelections) ? (ddo[day] as any).vendorSelections : (ddo[day] as any)?.vendor_selections ?? [];
                for (const vs of arr) templateItemCount += Object.keys(vs?.items || {}).length;
            }
        }
        if (Array.isArray(vsTop)) for (const vs of vsTop) templateItemCount += Object.keys(vs?.items || {}).length;
        out.templateItemCount = templateItemCount;

        // Step 1: Recurring from template
        const recurringFromTemplate = await getRecurringItemsFromFoodTemplate();
        out.recurringFromTemplateCount = recurringFromTemplate.length;
        out.recurringFromTemplateSampleIds = recurringFromTemplate.slice(0, 3).map((i) => i.id);
        out.recurringFromTemplateSampleNames = recurringFromTemplate.slice(0, 3).map((i) => i.name);

        // Vendors + menu items (to explain fallback)
        const [vendors, menuItems] = await Promise.all([getVendors(), getMenuItems()]);
        const foodVendor = vendors.find((v: any) => v.isDefault === true) || vendors.find((v: any) => (v.serviceTypes || []).includes('Food')) || vendors[0];
        out.vendorsCount = vendors.length;
        out.menuItemsCount = menuItems.length;
        out.foodVendorId = foodVendor?.id ?? null;
        out.foodVendorName = foodVendor?.name ?? null;
        const foodMenuCount = foodVendor ? menuItems.filter((m: any) => m.vendorId === foodVendor.id && m.isActive).length : 0;
        out.foodMenuItemsCount = foodMenuCount;

        // Step 2: Day-specific for date (default template, client_id null)
        const { items: dayItems } = await getMealPlannerCustomItems(dateOnly, null);
        out.dayItemsCount = dayItems?.length ?? 0;
        out.dayItemsSampleIds = (dayItems ?? []).slice(0, 3).map((i: any) => i.id);
        out.dayItemsSampleNames = (dayItems ?? []).slice(0, 3).map((i: any) => i.name);

        // Step 3: Combined for date (what getCombinedMenuItemsForDate returns)
        const combined = await getCombinedMenuItemsForDate(dateOnly, null);
        out.combinedCount = combined.length;
        const recurringIdCount = combined.filter((i) => String(i.id || '').startsWith('recurring-')).length;
        out.combinedRecurringIdCount = recurringIdCount;
        out.combinedSampleIds = combined.slice(0, 5).map((i) => i.id);
        out.combinedSampleNames = combined.slice(0, 5).map((i) => i.name);

        // Step 4: Full template list (what client receives)
        const list = await getAvailableMealPlanTemplateWithAllDatesIncludingRecurring();
        out.templateListLength = list.length;
        const firstOrder = list[0];
        out.firstOrderItemCount = firstOrder?.items?.length ?? 0;
        out.firstOrderSampleIds = firstOrder?.items?.slice(0, 5).map((i: any) => i.id) ?? [];
        out.firstOrderRecurringCount = (firstOrder?.items ?? []).filter((i: any) => String(i.id || '').startsWith('recurring-')).length;

        // Per-item trace when ?item= is provided (e.g. item=tuna to find "Tuna Wrap")
        if (itemSearch) {
            out.itemSearch = itemSearch;
            const recurringMatch = recurringFromTemplate.find((i) => nameMatches(i.name, itemSearch));
            const dayMatch = (dayItems ?? []).find((i: any) => nameMatches(i.name, itemSearch));
            const combinedMatch = combined.find((i) => nameMatches(i.name, itemSearch));

            out.recurringItem = recurringMatch
                ? { id: recurringMatch.id, name: recurringMatch.name, quantity: recurringMatch.quantity }
                : null;
            out.dayItem = dayMatch
                ? { id: (dayMatch as any).id, name: (dayMatch as any).name, quantity: (dayMatch as any).quantity }
                : null;
            out.combinedItem = combinedMatch
                ? { id: combinedMatch.id, name: combinedMatch.name, quantity: combinedMatch.quantity }
                : null;

            // Recurring (top) is the single source for repeating items; combined uses recurring quantity. Day-specific only adds items not in recurring.
            let explanation = '';
            if (recurringMatch && combinedMatch) {
                const rQty = recurringMatch.quantity ?? 0;
                const cQty = combinedMatch.quantity ?? 0;
                explanation = `Recurring (admin "top") has quantity ${rQty}; combined uses that for this item (same every day). No per-date override.`;
                if (dayMatch) {
                    explanation += ` A day-specific row exists for ${dateOnly} (qty ${(dayMatch as any).quantity}) but recurring items are not overridden by day.`;
                }
            } else if (dayMatch && combinedMatch) {
                explanation = `Day-only item (not in recurring list): meal_planner_custom_items has quantity ${(dayMatch as any).quantity}; combined shows ${combinedMatch.quantity ?? 0}.`;
            } else {
                explanation = `No matching item found for "${itemSearch}" in recurring or combined. Check name (case-insensitive contains).`;
            }
            out.explanation = explanation;
        }

        return Response.json(out);
    } catch (err) {
        out.error = err instanceof Error ? err.message : String(err);
        return Response.json(out, { status: 500 });
    }
}
