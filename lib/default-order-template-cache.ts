'use client';

/**
 * Client-side in-memory cache for the default order template (and meal plan template).
 * Makes "Loading default order" instant when navigating between clients; cache is cleared
 * on full page refresh so the next load fetches fresh. Admin save invalidates cache so
 * the new template is used on next open.
 */

import { getDefaultOrderTemplate, getDefaultMealPlanTemplateForNewClient } from '@/lib/actions';
import type { MealPlannerOrderResult } from '@/lib/actions';

const orderTemplateCache: Record<string, any> = Object.create(null);
let mealPlanTemplateCache: MealPlannerOrderResult[] | null = null;

/**
 * Returns the cached template for the service type if present (sync). Use this to avoid
 * showing "Loading default order" when we can show cached data immediately.
 */
export function getDefaultOrderTemplateCachedSync(serviceType: string): any | null {
    return orderTemplateCache[serviceType] ?? null;
}

/**
 * Returns the cached meal plan template for new client if present (sync).
 */
export function getDefaultMealPlanTemplateCachedSync(): MealPlannerOrderResult[] | null {
    return mealPlanTemplateCache;
}

/**
 * Returns the default order template for the given service type, from cache if available
 * or by fetching from the server and then caching. Use in client profile/portal for
 * instant display when cache is warm.
 */
export async function getCachedDefaultOrderTemplate(serviceType: string): Promise<any | null> {
    if (orderTemplateCache[serviceType] != null) {
        return orderTemplateCache[serviceType];
    }
    const template = await getDefaultOrderTemplate(serviceType);
    if (template != null) {
        orderTemplateCache[serviceType] = template;
    }
    return template;
}

/**
 * Returns the default meal plan template for new client, from cache if available
 * or by fetching and then caching.
 */
export async function getCachedDefaultMealPlanTemplateForNewClient(): Promise<MealPlannerOrderResult[]> {
    if (mealPlanTemplateCache != null) {
        return mealPlanTemplateCache;
    }
    const list = await getDefaultMealPlanTemplateForNewClient();
    mealPlanTemplateCache = list;
    return list;
}

/**
 * Clears the in-memory cache. Call after admin saves a new default order template
 * so the next client open gets the new template. Also clears on full page refresh.
 */
export function clearDefaultOrderTemplateCache(): void {
    Object.keys(orderTemplateCache).forEach((k) => delete orderTemplateCache[k]);
    mealPlanTemplateCache = null;
}
