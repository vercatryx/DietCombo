import type { SupabaseClient } from '@supabase/supabase-js';
import { isProduceServiceType } from './isProduceServiceType';

/**
 * Food / Meal household members for portal scaling and "People on this account" — excludes Produce and other types.
 */
export function isFoodOrMealHouseholdMember(serviceType: string | null | undefined): boolean {
    if (!serviceType) return false;
    if (isProduceServiceType(serviceType)) return false;
    const parts = String(serviceType)
        .split(',')
        .map((s) => s.trim().toLowerCase());
    return parts.includes('food') || parts.includes('meal');
}

/**
 * True when this client row’s household (parent + dependants) includes at least one Food/Meal member
 * (same rule as client-portal householdPeople). Used so Produce household heads can log in with one
 * session when non-Produce household members need the meal plan portal.
 */
export async function householdHasFoodOrMealPortalMember(
    supabase: SupabaseClient,
    clientId: string
): Promise<boolean> {
    const { data: root, error } = await supabase
        .from('clients')
        .select('id, parent_client_id')
        .eq('id', clientId)
        .maybeSingle();
    if (error || !root) return false;
    const pid = (root as { parent_client_id?: string | null; id: string }).parent_client_id;
    const parentId = pid != null && String(pid) !== '' ? String(pid) : String((root as { id: string }).id);
    const { data: members, error: mErr } = await supabase
        .from('clients')
        .select('service_type')
        .or(`id.eq.${parentId},parent_client_id.eq.${parentId}`);
    if (mErr || !members?.length) return false;
    return (members as { service_type?: string | null }[]).some((m) => isFoodOrMealHouseholdMember(m.service_type));
}
