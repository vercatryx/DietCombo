'use server';

import { getCurrentTime } from './time';
import { getTodayDateInAppTzAsReference, getTodayInAppTz, toDateStringInAppTz } from './timezone';
import { revalidatePath } from 'next/cache';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, Nutritionist, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota, ServiceType, Equipment, MealCategory, MealItem, ClientFoodOrder, ClientMealOrder, ClientBoxOrder } from './types';
import { randomUUID } from 'crypto';
import { getSession } from './session';
import {
    getNextDeliveryDate,
    getNextDeliveryDateForDay,
    getTakeEffectDate as getTakeEffectDateFromUtils,
    getAllDeliveryDatesForOrder as getAllDeliveryDatesFromUtils,
    getNextOccurrence,
    formatDateToYYYYMMDD,
    DAY_NAME_TO_NUMBER
} from './order-dates';
import { supabase, isConnectionError, getConnectionErrorHelp } from './supabase';
import { createClient } from '@supabase/supabase-js';
import { uploadFile, deleteFile } from './storage';
import { getClientSubmissions } from './form-actions';
import { composeUniteUsUrl } from './utils';
import { toStoredUpcomingOrder, fromStoredUpcomingOrder } from './upcoming-order-schema';

// Meal planner orders use meal_planner_orders and meal_planner_order_items (no longer upcoming_orders)
const MEAL_PLANNER_SERVICE_TYPE = 'meal_planner';

// --- HELPERS ---
function handleError(error: any, context?: string) {
    if (error) {
        const contextMsg = context ? `[${context}] ` : '';
        console.error(`Supabase Error ${contextMsg}:`, {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
            fullError: error
        });
        
        // Check for DNS/connection errors first (most critical)
        if (isConnectionError(error)) {
            console.error(getConnectionErrorHelp(error));
            return; // Don't show other error messages if it's a connection issue
        }
        
        // Check for DNS/connection errors first (most critical)
        if (isConnectionError(error)) {
            console.error(getConnectionErrorHelp(error));
            throw new Error(error.message);
        }
        
        // Check for RLS/permission errors
        if (error.code === 'PGRST301' || error.message?.includes('permission denied') || error.message?.includes('RLS') || error.message?.includes('row-level security')) {
            console.error('⚠️  RLS (Row Level Security) may be blocking this query. Consider:');
            console.error('   1. Setting SUPABASE_SERVICE_ROLE_KEY environment variable');
            console.error('   2. Running sql/disable-rls.sql to disable RLS');
            console.error('   3. Running sql/enable-permissive-rls.sql to add permissive policies');
        }
        
        // Check for schema permission errors (42501)
        if (error.code === '42501' || (error.message?.includes('permission denied for schema') && error.message?.includes('public'))) {
            console.error('⚠️  Database schema permission error (42501) detected!');
            console.error('   This means the database roles don\'t have proper permissions on the public schema.');
            console.error('   SOLUTION: Run the SQL script sql/fix-schema-permissions.sql in your Supabase SQL Editor.');
            console.error('   This will grant the necessary permissions to anon, authenticated, and service_role roles.');
            console.error('   See: https://supabase.com/docs/guides/troubleshooting/database-api-42501-errors');
        }
        
        throw new Error(error.message);
    }
}

function logQueryError(error: any, table: string, operation: string = 'select') {
    if (error) {
        console.error(`[${table}] Error in ${operation}:`, {
            message: error.message,
            code: error.code,
            details: error.details
        });
        
        // Check for RLS/permission errors
        if (error.code === 'PGRST301' || error.message?.includes('permission denied') || error.message?.includes('RLS') || error.message?.includes('row-level security')) {
            console.error(`??????  RLS may be blocking ${table} queries. Check RLS configuration.`);
        }
    }
}

/**
 * Generates a unique order_number by checking both orders and upcoming_orders tables.
 * Optimized to fetch the latest order_number once and start from there.
 * Handles race conditions by retrying if a duplicate is found.
 * @param supabaseClient - The Supabase client to use (defaults to the module's supabase instance)
 * @param maxRetries - Maximum number of retries if duplicate is found (default: 3)
 * @returns A unique order_number (minimum 100000)
 */
export async function generateUniqueOrderNumber(
    supabaseClient: any = supabase,
    maxRetries: number = 3
): Promise<number> {
    try {
        // Get max order_number from both tables ONCE (optimization: fetch latest first)
        const [ordersResult, upcomingOrdersResult] = await Promise.all([
            supabaseClient
                .from('orders')
                .select('order_number')
                .order('order_number', { ascending: false })
                .limit(1)
                .maybeSingle(),
            supabaseClient
                .from('upcoming_orders')
                .select('order_number')
                .order('order_number', { ascending: false })
                .limit(1)
                .maybeSingle()
        ]);

        // Check for errors in queries
        if (ordersResult.error) {
            console.error(`[generateUniqueOrderNumber] Error querying orders table:`, ordersResult.error);
        }
        if (upcomingOrdersResult.error) {
            console.error(`[generateUniqueOrderNumber] Error querying upcoming_orders table:`, upcomingOrdersResult.error);
        }

        const maxFromOrders = ordersResult.data?.order_number || 0;
        const maxFromUpcoming = upcomingOrdersResult.data?.order_number || 0;
        const maxOrderNumber = Math.max(maxFromOrders, maxFromUpcoming);
        
        // Start from max + 1, ensure minimum 100000
        const baseOrderNumber = Math.max((maxOrderNumber || 99999) + 1, 100000);
        let nextOrderNumber = baseOrderNumber;

        // Try to find a unique number, incrementing sequentially if duplicates found
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // Double-check for duplicates in both tables (race condition protection)
            const [duplicateCheckOrders, duplicateCheckUpcoming] = await Promise.all([
                supabaseClient
                    .from('orders')
                    .select('id')
                    .eq('order_number', nextOrderNumber)
                    .maybeSingle(),
                supabaseClient
                    .from('upcoming_orders')
                    .select('id')
                    .eq('order_number', nextOrderNumber)
                    .maybeSingle()
            ]);

            // Check for errors in duplicate check queries
            if (duplicateCheckOrders.error) {
                console.error(`[generateUniqueOrderNumber] Error checking duplicates in orders table:`, duplicateCheckOrders.error);
                // If there's an error, we can't verify uniqueness, so increment and try next
                nextOrderNumber += 1;
                continue;
            }
            if (duplicateCheckUpcoming.error) {
                console.error(`[generateUniqueOrderNumber] Error checking duplicates in upcoming_orders table:`, duplicateCheckUpcoming.error);
                // If there's an error, we can't verify uniqueness, so increment and try next
                nextOrderNumber += 1;
                continue;
            }

            // If no duplicate found, return the number
            if (!duplicateCheckOrders.data && !duplicateCheckUpcoming.data) {
                return nextOrderNumber;
            }

            // Duplicate found - increment and try next sequential number
            if (attempt < maxRetries - 1) {
                console.warn(`[generateUniqueOrderNumber] Duplicate order_number ${nextOrderNumber} found, trying next number (attempt ${attempt + 1}/${maxRetries})`);
                nextOrderNumber += 1;
            }
        }

        // If we exhausted retries, try sequential search for gaps
        console.warn(`[generateUniqueOrderNumber] All retries exhausted, searching for gaps starting from ${nextOrderNumber}`);
        
        // Try up to 20 sequential numbers to find a gap (reduced for speed)
        for (let fallbackAttempt = 0; fallbackAttempt < 20; fallbackAttempt++) {
            const [finalCheckOrders, finalCheckUpcoming] = await Promise.all([
                supabaseClient
                    .from('orders')
                    .select('id')
                    .eq('order_number', nextOrderNumber)
                    .maybeSingle(),
                supabaseClient
                    .from('upcoming_orders')
                    .select('id')
                    .eq('order_number', nextOrderNumber)
                    .maybeSingle()
            ]);
            
            if (!finalCheckOrders.data && !finalCheckUpcoming.data) {
                console.log(`[generateUniqueOrderNumber] Successfully generated order_number: ${nextOrderNumber}`);
                return nextOrderNumber;
            }
            
            // Try next sequential number
            nextOrderNumber += 1;
        }
        
        // Last resort: Use timestamp + random component
        const timestampComponent = Date.now() % 100000; // Last 5 digits
        const randomComponent = Math.floor(Math.random() * 99) + 1; // 1-99
        const timestampBasedNumber = 100000 + (timestampComponent * 100) + randomComponent;
        
        const [timestampCheckOrders, timestampCheckUpcoming] = await Promise.all([
            supabaseClient
                .from('orders')
                .select('id')
                .eq('order_number', timestampBasedNumber)
                .maybeSingle(),
            supabaseClient
                .from('upcoming_orders')
                .select('id')
                .eq('order_number', timestampBasedNumber)
                .maybeSingle()
        ]);
        
        if (!timestampCheckOrders.data && !timestampCheckUpcoming.data) {
            console.log(`[generateUniqueOrderNumber] Successfully generated timestamp-based order_number: ${timestampBasedNumber}`);
            return timestampBasedNumber;
        }
        
        console.error(`[generateUniqueOrderNumber] Failed to generate unique order_number after ${maxRetries} attempts and fallback strategies. Last attempted: ${nextOrderNumber}`);
        throw new Error(`Failed to generate unique order_number after ${maxRetries} attempts. Please try again.`);
    } catch (error: any) {
        // If it's our custom error, re-throw it
        if (error.message?.includes('Failed to generate unique order_number')) {
            throw error;
        }
        
        console.error(`[generateUniqueOrderNumber] Unexpected error:`, error);
        throw new Error(`Failed to generate unique order_number: ${error.message || 'Unknown error'}`);
    }
}

/**
 * Generates a batch of sequential unique order numbers.
 * Fetches max order_number once, then returns count sequential numbers.
 * Use for bulk order creation in a single request (no concurrent writers).
 */
export async function generateBatchOrderNumbers(
    supabaseClient: any,
    count: number
): Promise<number[]> {
    const [ordersResult, upcomingOrdersResult] = await Promise.all([
        supabaseClient.from('orders').select('order_number').order('order_number', { ascending: false }).limit(1).maybeSingle(),
        supabaseClient.from('upcoming_orders').select('order_number').order('order_number', { ascending: false }).limit(1).maybeSingle()
    ]);
    const maxFromOrders = ordersResult.data?.order_number || 0;
    const maxFromUpcoming = upcomingOrdersResult.data?.order_number || 0;
    const baseOrderNumber = Math.max(Math.max(maxFromOrders, maxFromUpcoming, 99999) + 1, 100000);
    return Array.from({ length: count }, (_, i) => baseOrderNumber + i);
}

// --- STATUS ACTIONS ---

export async function getStatuses() {
    try {
        const { data, error } = await supabase.from('client_statuses').select('*').order('created_at', { ascending: true });
        if (error) {
            console.error('Error fetching client_statuses:', error);
            return [];
        }
        return (data || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            isSystemDefault: s.is_system_default,
            deliveriesAllowed: s.deliveries_allowed,
            requiresUnitsOnChange: s.requires_units_on_change ?? false
        }));
    } catch (error) {
        console.error('Error fetching statuses:', error);
        return [];
    }
}

export async function addStatus(name: string) {
    const id = randomUUID();
    const { data, error } = await supabase
        .from('client_statuses')
        .insert([{
            id,
            name,
            is_system_default: false,
            deliveries_allowed: true,
            requires_units_on_change: false
        }])
        .select()
        .single();
    handleError(error);
    if (!data) throw new Error('Failed to retrieve created status');
    revalidatePath('/admin');
    return {
        id: data.id,
        name: data.name,
        isSystemDefault: data.is_system_default,
        deliveriesAllowed: data.deliveries_allowed,
        requiresUnitsOnChange: data.requires_units_on_change ?? false
    };
}

export async function deleteStatus(id: string) {
    const { error } = await supabase.from('client_statuses').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function updateStatus(id: string, data: Partial<ClientStatus>) { // Modified signature to take Partial<ClientStatus> instead of just name
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.deliveriesAllowed !== undefined) payload.deliveries_allowed = data.deliveriesAllowed;
    if (data.requiresUnitsOnChange !== undefined) payload.requires_units_on_change = data.requiresUnitsOnChange;
    
    if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('client_statuses').update(payload).eq('id', id);
        handleError(error);
    }
    
    revalidatePath('/admin');
    const { data: res, error: fetchError } = await supabase.from('client_statuses').select('*').eq('id', id).single();
    handleError(fetchError);
    if (!res) throw new Error('Status not found');
    return {
        id: res.id,
        name: res.name,
        isSystemDefault: res.is_system_default,
        deliveriesAllowed: res.deliveries_allowed,
        requiresUnitsOnChange: res.requires_units_on_change ?? false
    };
}

// --- VENDOR ACTIONS ---

// Server-side cache for vendors (module-level, persists for process lifetime)
interface ServerCacheEntry<T> {
    data: T;
    timestamp: number;
}

const VENDORS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let vendorsCache: ServerCacheEntry<Vendor[]> | undefined = undefined;

// Helper to invalidate vendors cache
function invalidateVendorsCache() {
    vendorsCache = undefined;
}

export async function getVendors() {
    try {
        // Check cache first
        if (vendorsCache && (Date.now() - vendorsCache.timestamp) < VENDORS_CACHE_DURATION) {
            return vendorsCache.data;
        }
        
        // Check if we're using service role key (important for RLS)
        const isUsingServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!isUsingServiceKey) {
            console.warn('[getVendors] ??????  Not using service role key - RLS may block queries');
        }
        
        const { data, error } = await supabase.from('vendors').select('*');
        if (error) {
            logQueryError(error, 'vendors');
            console.error('[getVendors] Query error details:', {
                message: error.message,
                code: error.code,
                details: error.details,
                hint: error.hint,
                usingServiceKey: isUsingServiceKey
            });
            
            // If RLS error, provide helpful message
            if (error.code === 'PGRST301' || error.message?.includes('permission denied') || error.message?.includes('RLS')) {
                console.error('[getVendors] ??? RLS is blocking the query. Ensure SUPABASE_SERVICE_ROLE_KEY is set in environment variables.');
            }
            return [];
        }
        
        if (!data) {
            console.warn('[getVendors] No data returned from query (data is null/undefined)');
            return [];
        }
        
        if (data.length === 0) {
            console.warn('[getVendors] Query succeeded but returned 0 vendors. Table may be empty or RLS is filtering all rows.');
        } else {
            console.log(`[getVendors] ??? Fetched ${data.length} vendors from database`);
        }
        
        const mapped = (data || []).map((v: any) => {
            try {
                // Parse delivery_days safely
                let deliveryDays: string[] = [];
                if (v.delivery_days) {
                    if (typeof v.delivery_days === 'string') {
                        try {
                            deliveryDays = JSON.parse(v.delivery_days);
                        } catch (parseError) {
                            console.warn(`[getVendors] Failed to parse delivery_days for vendor ${v.id}:`, parseError);
                            deliveryDays = [];
                        }
                    } else if (Array.isArray(v.delivery_days)) {
                        deliveryDays = v.delivery_days;
                    }
                }
                
                // Parse service_type safely
                const serviceTypes = (v.service_type || '')
                    .split(',')
                    .map((s: string) => s.trim())
                    .filter(Boolean) as ServiceType[];
                
                const vendor: Vendor = {
                    id: v.id,
                    name: v.name,
                    email: v.email || null,
                    serviceTypes,
                    deliveryDays,
                    allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
                    isActive: v.is_active !== undefined ? Boolean(v.is_active) : true,
                    isDefault: v.is_default !== undefined ? Boolean(v.is_default) : false,
                    minimumMeals: v.minimum_meals ?? 0,
                    cutoffHours: v.cutoff_hours ?? 0
                };
                return vendor;
            } catch (mapError) {
                console.error(`[getVendors] Error mapping vendor ${v.id}:`, mapError);
                return null;
            }
        }).filter((v) => v !== null) as Vendor[];
        
        console.log(`[getVendors] Successfully mapped ${mapped.length} vendors`);
        
        // Cache the result
        vendorsCache = { data: mapped, timestamp: Date.now() };
        
        return mapped;
    } catch (error) {
        console.error('[getVendors] Unexpected error:', error);
        return [];
    }
}

/**
 * Get the default vendor ID for the app
 * Returns the vendor with is_default = true, or the first active vendor if none is default
 */
export async function getDefaultVendorId(): Promise<string | null> {
    try {
        const vendors = await getVendors();
        if (vendors.length === 0) return null;
        
        // First, try to find a vendor with isDefault: true
        const defaultVendor = vendors.find(v => v.isDefault === true);
        if (defaultVendor) return defaultVendor.id;
        
        // If no default vendor, use the first active vendor
        const firstActiveVendor = vendors.find(v => v.isActive !== false) || vendors[0];
        return firstActiveVendor?.id || null;
    } catch (error) {
        console.error('[getDefaultVendorId] Error getting default vendor:', error);
        return null;
    }
}

export async function getVendor(id: string) {
    try {
        const { data: v, error } = await supabase.from('vendors').select('*').eq('id', id).single();
        if (error || !v) return null;

        return {
            id: v.id,
            name: v.name,
            email: v.email || null,
            serviceTypes: (v.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ServiceType[],
            deliveryDays: typeof v.delivery_days === 'string' ? JSON.parse(v.delivery_days) : (v.delivery_days || []),
            allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
            isActive: v.is_active,
            isDefault: v.is_default !== undefined ? Boolean(v.is_default) : false,
            minimumMeals: v.minimum_meals ?? 0,
            cutoffHours: v.cutoff_hours ?? 0
        };
    } catch (error) {
        console.error('Error fetching vendor:', error);
        return null;
    }
}

export async function addVendor(data: Omit<Vendor, 'id'> & { password?: string; email?: string }) {
    const id = randomUUID();
    let password = null;
    
    if (data.password && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        password = await hashPassword(data.password.trim());
    }
    
    const email = data.email !== undefined && data.email !== null 
        ? (data.email.trim() === '' ? null : data.email.trim())
        : null;
    
    const payload: any = {
        id,
        name: data.name,
        email,
        password,
        service_type: (data.serviceTypes || []).join(','),
        delivery_days: data.deliveryDays || [],
        delivery_frequency: data.allowsMultipleDeliveries ? 'Multiple' : 'Once',
        is_active: data.isActive,
        minimum_meals: data.minimumMeals ?? 0,
        cutoff_hours: data.cutoffHours ?? 0
    };
    
    const { error } = await supabase.from('vendors').insert([payload]);
    handleError(error);
    invalidateVendorsCache(); // Clear cache when vendor is added
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateVendor(id: string, data: Partial<Vendor & { password?: string }>) {
    const payload: any = {};
    
    if (data.name) payload.name = data.name;
    if (data.serviceTypes) payload.service_type = data.serviceTypes.join(',');
    if (data.deliveryDays) payload.delivery_days = data.deliveryDays;
    if (data.allowsMultipleDeliveries !== undefined) payload.delivery_frequency = data.allowsMultipleDeliveries ? 'Multiple' : 'Once';
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.minimumMeals !== undefined) payload.minimum_meals = data.minimumMeals;
    if (data.cutoffHours !== undefined) payload.cutoff_hours = data.cutoffHours;
    if (data.email !== undefined) {
        const trimmedEmail = data.email?.trim() || '';
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }
    if (data.password !== undefined && data.password !== null && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password.trim());
    }
    
    if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('vendors').update(payload).eq('id', id);
        handleError(error);
        invalidateVendorsCache(); // Clear cache when vendor is updated
    }
    revalidatePath('/admin');
}

export async function deleteVendor(id: string) {
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    handleError(error);
    invalidateVendorsCache(); // Clear cache when vendor is deleted
    revalidatePath('/admin');
}

// --- MENU ACTIONS ---

export async function getMenuItems() {
    try {
        const { data, error } = await supabase.from('menu_items').select('*');
        if (error) return [];
        return (data || []).map((i: any) => ({
            id: i.id,
            vendorId: i.vendor_id,
            name: i.name,
            value: i.value,
            priceEach: i.price_each ?? undefined,
            isActive: i.is_active,
            categoryId: i.category_id,
            quotaValue: i.quota_value,
            minimumOrder: i.minimum_order ?? 0,
            imageUrl: i.image_url || null,
            sortOrder: i.sort_order ?? 0
        }));
    } catch (error) {
        console.error('Error fetching menu items:', error);
        return [];
    }
}

export async function addMenuItem(data: Omit<MenuItem, 'id'>) {
    if (!data.priceEach || data.priceEach <= 0) {
        throw new Error('Price is required and must be greater than 0');
    }
    
    const id = randomUUID();
    const payload: any = {
        id,
        vendor_id: data.vendorId || null,
        name: data.name,
        value: data.value,
        price_each: data.priceEach,
        is_active: data.isActive,
        category_id: data.categoryId || null,
        quota_value: data.quotaValue || null,
        minimum_order: data.minimumOrder ?? 0,
        image_url: (data as any).imageUrl || null,
        sort_order: (data as any).sortOrder ?? 0
    };
    
    const { error } = await supabase.from('menu_items').insert([payload]);
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateMenuItem(id: string, data: Partial<MenuItem>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.value !== undefined) payload.value = data.value;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.categoryId !== undefined) payload.category_id = data.categoryId || null;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.minimumOrder !== undefined) payload.minimum_order = data.minimumOrder;
    if (data.vendorId !== undefined) payload.vendor_id = data.vendorId || null;
    if ((data as any).imageUrl !== undefined) payload.image_url = (data as any).imageUrl || null;
    if ((data as any).sortOrder !== undefined) payload.sort_order = (data as any).sortOrder ?? 0;
    
    if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('menu_items').update(payload).eq('id', id);
        handleError(error);
    }
    revalidatePath('/admin');
}

export async function deleteMenuItem(id: string) {
    try {
        const { error } = await supabase.from('menu_items').delete().eq('id', id);
        if (error) {
            // Check if it's a foreign key constraint error (PostgreSQL code 23503)
            if (error.code === '23503' || error.message?.includes('foreign key')) {
                // Soft delete instead
                const { error: updateError } = await supabase.from('menu_items').update({ is_active: false }).eq('id', id);
                handleError(updateError);
                revalidatePath('/admin');
                return { success: false, message: 'Item is in use by existing orders. It has been deactivated instead of permanently deleted.' };
            }
            throw error;
        }
        revalidatePath('/admin');
        return { success: true };
    } catch (error: any) {
        console.error('Error deleting menu item:', error);
        throw error;
    }
}

export async function updateMenuItemOrder(updates: { id: string; sortOrder: number }[]) {
    // Perform updates in parallel
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('menu_items').update({ sort_order: sortOrder }).eq('id', id)
    );

    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

// --- ITEM CATEGORY ACTIONS ---

export async function getCategories() {
    try {
        const { data, error } = await supabase.from('item_categories').select('*').order('sort_order', { ascending: true }).order('name');
        if (error) return [];
        return (data || []).map((c: any) => ({
            id: c.id,
            name: c.name,
            setValue: c.set_value ?? undefined,
            sortOrder: c.sort_order ?? 0
        }));
    } catch (error) {
        console.error('Error fetching categories:', error);
        return [];
    }
}

export async function addCategory(name: string, setValue?: number | null) {
    const id = randomUUID();
    // Get max sort_order to append new category at the end
    const { data: maxData } = await supabase.from('item_categories').select('sort_order').order('sort_order', { ascending: false }).limit(1).single();
    const maxSortOrder = maxData?.sort_order ?? -1;
    const { data, error } = await supabase
        .from('item_categories')
        .insert([{ id, name, set_value: setValue ?? null, sort_order: maxSortOrder + 1 }])
        .select()
        .single();
    handleError(error);
    if (!data) throw new Error('Failed to retrieve created category');
    revalidatePath('/admin');
    return { id: data.id, name: data.name, setValue: data.set_value ?? undefined, sortOrder: data.sort_order ?? 0 };
}

export async function deleteCategory(id: string) {
    const { error } = await supabase.from('item_categories').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function updateCategory(id: string, name: string, setValue?: number | null) {
    const { error } = await supabase
        .from('item_categories')
        .update({ name, set_value: setValue ?? null })
        .eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function updateCategoryOrder(updates: { id: string; sortOrder: number }[]) {
    // Perform updates in parallel
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('item_categories').update({ sort_order: sortOrder }).eq('id', id)
    );

    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

// --- EQUIPMENT ACTIONS ---

export async function getEquipment() {
    try {
        const { data, error } = await supabase.from('equipment').select('*').order('name');
        if (error) return [];
        return (data || []).map((e: any) => ({
            id: e.id,
            name: e.name,
            price: parseFloat(e.price),
            vendorId: e.vendor_id || null
        }));
    } catch (error) {
        console.error('Error fetching equipment:', error);
        return [];
    }
}

export async function addEquipment(data: Omit<Equipment, 'id'>) {
    const id = randomUUID();
    const payload: any = {
        id,
        name: data.name,
        price: data.price,
        vendor_id: data.vendorId || null
    };
    const { error } = await supabase.from('equipment').insert([payload]);
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateEquipment(id: string, data: Partial<Equipment>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.price !== undefined) payload.price = data.price;
    if (data.vendorId !== undefined) payload.vendor_id = data.vendorId || null;
    
    if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('equipment').update(payload).eq('id', id);
        handleError(error);
    }
    revalidatePath('/admin');
}

export async function deleteEquipment(id: string) {
    const { error } = await supabase.from('equipment').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function saveEquipmentOrder(clientId: string, vendorId: string, equipmentId: string, caseId?: string) {
    // Cache current time at function start to avoid multiple getCurrentTime() calls (triangleorder pattern)
    const currentTime = await getCurrentTime();
    const currentTimeISO = currentTime.toISOString();

    // Get equipment item to calculate price
    const equipmentList = await getEquipment();
    const equipmentItem = equipmentList.find(e => e.id === equipmentId);
    if (!equipmentItem) {
        throw new Error('Equipment item not found');
    }

    // Get current user for updated_by
    const session = await getSession();
    const currentUserName = session?.name || 'Admin';

    // Calculate scheduled delivery date for vendor
    const vendors = await getVendors();
    const vendor = vendors.find(v => v.id === vendorId);
    let scheduledDeliveryDate: Date | null = null;

    if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 0) {
        const today = new Date(currentTime);
        // Reset to start of day for accurate day-of-week adding
        today.setHours(0, 0, 0, 0);
        const dayNameToNumber: { [key: string]: number } = {
            'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
            'Thursday': 4, 'Friday': 5, 'Saturday': 6
        };
        const deliveryDayNumbers = vendor.deliveryDays
            .map((day: string) => dayNameToNumber[day])
            .filter((num: number | undefined): num is number => num !== undefined);

        // Find next occurrence of any delivery day
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            if (deliveryDayNumbers.includes(checkDate.getDay())) {
                scheduledDeliveryDate = checkDate;
                break;
            }
        }
    }

    // Store equipment selection in notes as JSON
    const equipmentSelection = {
        vendorId,
        equipmentId,
        equipmentName: equipmentItem.name,
        price: equipmentItem.price
    };

    // Create actual order in orders table (not upcoming_orders)
    const orderData: any = {
        client_id: clientId,
        service_type: 'Equipment',
        case_id: caseId || null,
        status: 'pending',
        last_updated: currentTimeISO,
        updated_by: currentUserName,
        scheduled_delivery_date: scheduledDeliveryDate ? formatDateToYYYYMMDD(scheduledDeliveryDate) : null,
        total_value: equipmentItem.price,
        total_items: 1,
        notes: JSON.stringify(equipmentSelection)
    };

    const orderId = randomUUID();
    const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert([{
            id: orderId,
            client_id: clientId,
            service_type: orderData.service_type,
            case_id: orderData.case_id,
            status: orderData.status,
            last_updated: orderData.last_updated,
            updated_by: orderData.updated_by,
            scheduled_delivery_date: orderData.scheduled_delivery_date,
            total_value: orderData.total_value,
            total_items: orderData.total_items,
            notes: orderData.notes
        }])
        .select()
        .single();
    handleError(orderError);
    if (!newOrder) {
        throw new Error('Failed to create order');
    }

    // Ensure order_number is at least 6 digits (100000+)
    // The database default should handle this, but we'll verify and fix if needed
    if (newOrder && (!newOrder.order_number || newOrder.order_number < 100000)) {
        // Get the max order_number and ensure next is at least 6 digits
        const { data: maxOrderData } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .single();

        const nextNumber = Math.max((maxOrderData?.order_number || 99999) + 1, 100000);
        const { error: updateError } = await supabase
            .from('orders')
            .update({ order_number: nextNumber })
            .eq('id', newOrder.id);
        handleError(updateError);

        newOrder.order_number = nextNumber;
    }

    // Also create a vendor selection record so it shows up in vendor tab
    // We'll use order_vendor_selections table for Equipment orders too
    if (newOrder) {
        const vsId = randomUUID();
        try {
            const { error: vsError } = await supabase
                .from('order_vendor_selections')
                .insert([{ id: vsId, order_id: newOrder.id, vendor_id: vendorId }]);
            if (vsError) {
                console.error('Error creating vendor selection for equipment order:', vsError);
                // Don't fail the whole operation if this fails
            }
        } catch (vsError) {
            console.error('Error creating vendor selection for equipment order:', vsError);
            // Don't fail the whole operation if this fails
        }
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/vendor`);
    return { success: true, orderId: newOrder.id };
}

// --- BOX QUOTA ACTIONS ---

export async function getBoxQuotas(boxTypeId: string) {
    try {
        const { data, error } = await supabase.from('box_quotas').select('*').eq('box_type_id', boxTypeId);
        if (error) return [];
        return (data || []).map((q: any) => ({
            id: q.id,
            boxTypeId: q.box_type_id,
            categoryId: q.category_id,
            targetValue: q.target_value
        }));
    } catch (error) {
        console.error('Error fetching box quotas:', error);
        return [];
    }
}

export async function addBoxQuota(data: Omit<BoxQuota, 'id'>) {
    const id = randomUUID();
    const { error } = await supabase
        .from('box_quotas')
        .insert([{ id, box_type_id: data.boxTypeId, category_id: data.categoryId, target_value: data.targetValue }]);
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateBoxQuota(id: string, targetValue: number) {
    const { error } = await supabase.from('box_quotas').update({ target_value: targetValue }).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteBoxQuota(id: string) {
    const { error } = await supabase.from('box_quotas').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- BOX TYPE ACTIONS ---

export async function getBoxTypes() {
    try {
        const { data, error } = await supabase.from('box_types').select('*');
        if (error) return [];
        return (data || []).map((b: any) => ({
            id: b.id,
            name: b.name,
            vendorId: b.vendor_id ?? null,
            isActive: b.is_active,
            priceEach: b.price_each ?? undefined
        }));
    } catch (error) {
        console.error('Error fetching box types:', error);
        return [];
    }
}

export async function addBoxType(data: Omit<BoxType, 'id'>) {
    const payload: any = {
        name: data.name,
        is_active: data.isActive,
        price_each: data.priceEach ?? 1,
        vendor_id: data.vendorId || null
    };

    if (data.priceEach !== undefined && data.priceEach <= 0) {
        throw new Error('Price must be greater than 0');
    }
    if (data.priceEach !== undefined) {
        payload.price_each = data.priceEach;
    }
    const id = randomUUID();
    const { error } = await supabase.from('box_types').insert([{ ...payload, id }]);
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateBoxType(id: string, data: Partial<BoxType>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
    if (data.vendorId !== undefined) payload.vendor_id = data.vendorId;
    
    if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('box_types').update(payload).eq('id', id);
        handleError(error);
    }
    revalidatePath('/admin');
}

export async function deleteBoxType(id: string) {
    const { error } = await supabase.from('box_types').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- SETTINGS ACTIONS ---

export async function getSettings() {
    try {
        const { data, error } = await supabase.from('app_settings').select('*').eq('id', '1').single();
        if (error || !data) return { weeklyCutoffDay: 'Friday', weeklyCutoffTime: '17:00', reportEmail: '', enablePasswordlessLogin: false };

        return {
            weeklyCutoffDay: data.weekly_cutoff_day,
            weeklyCutoffTime: data.weekly_cutoff_time,
            reportEmail: data.report_email || '',
            enablePasswordlessLogin: data.enable_passwordless_login || false
        };
    } catch (error) {
        console.error('Error fetching settings:', error);
        return { weeklyCutoffDay: 'Friday', weeklyCutoffTime: '17:00', reportEmail: '', enablePasswordlessLogin: false };
    }
}

export async function updateSettings(settings: AppSettings) {
    try {
        const { error } = await supabase
            .from('app_settings')
            .update({
                weekly_cutoff_day: settings.weeklyCutoffDay,
                weekly_cutoff_time: settings.weeklyCutoffTime,
                report_email: settings.reportEmail || null,
                enable_passwordless_login: settings.enablePasswordlessLogin || false
            })
            .eq('id', '1');
        handleError(error);
    } catch (error) {
        console.error('Error updating settings:', error);
    }
    revalidatePath('/admin');
}

// --- DEFAULT ORDER TEMPLATE ACTIONS ---
// Default food menu lives in settings (key: default_order_template). Every client gets this unless they have overrides in clients.upcoming_order.

export async function getDefaultOrderTemplate(serviceType?: string): Promise<any | null> {
    try {
        const { data, error } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'default_order_template')
            .single();

        if (error || !data) {
            return null;
        }

        const allTemplates = JSON.parse(data.value);

        // If no serviceType specified, return all templates (for backward compatibility)
        if (!serviceType) {
            if (allTemplates && allTemplates.serviceType) {
                return allTemplates;
            }
            return allTemplates;
        }

        // If serviceType specified, return template for that serviceType
        if (allTemplates && allTemplates.serviceType) {
            return allTemplates.serviceType === serviceType ? allTemplates : null;
        }
        return allTemplates && allTemplates[serviceType] ? allTemplates[serviceType] : null;
    } catch (error) {
        console.error('Error fetching default order template:', error);
        return null;
    }
}

/**
 * Calculate the default approved meals per week based on the total value
 * in the default order template for Food serviceType.
 * Returns 0 if no template exists or if calculation fails.
 */
/**
 * Compute default approved meals per week from a Food template and menu items (no fetch).
 * Use this when you already have the template to avoid a second getDefaultOrderTemplate call.
 */
export async function computeDefaultApprovedMealsFromTemplate(template: any, menuItems: MenuItem[]): Promise<number> {
    if (!template || template.serviceType !== 'Food' || !menuItems?.length) return 0;
    let totalValue = 0;
    const vendorSelections = template.vendorSelections || [];
    for (const selection of vendorSelections) {
        const items = selection.items || {};
        for (const [itemId, quantity] of Object.entries(items)) {
            const item = menuItems.find(mi => mi.id === itemId);
            if (item && item.value) totalValue += item.value * (quantity as number);
        }
    }
    return totalValue;
}

export async function getDefaultApprovedMealsPerWeek(): Promise<number> {
    try {
        const template = await getDefaultOrderTemplate('Food');
        const menuItems = await getMenuItems();
        return await computeDefaultApprovedMealsFromTemplate(template, menuItems);
    } catch (error) {
        console.error('Error calculating default approved meals per week:', error);
        return 0;
    }
}

export async function saveDefaultOrderTemplate(template: any, serviceType?: string): Promise<void> {
    try {
        // If serviceType is provided, save template for that specific serviceType
        // Otherwise, use the template's serviceType property (backward compatibility)
        const targetServiceType = serviceType || template.serviceType;
        
        if (!targetServiceType) {
            throw new Error('ServiceType is required to save default order template');
        }
        
        // Get existing templates
        const { data: existing } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'default_order_template')
            .single();
        
        let allTemplates: Record<string, any> = {};
        
        if (existing && existing.value) {
            try {
                const parsed = JSON.parse(existing.value);
                // Check if it's old format (single template with serviceType property)
                if (parsed && parsed.serviceType) {
                    // Migrate old format to new format
                    allTemplates[parsed.serviceType] = parsed;
                } else {
                    // Already in new format
                    allTemplates = parsed || {};
                }
            } catch (e) {
                // If parsing fails, start fresh
                allTemplates = {};
            }
        }
        
        // Update or add template for the specific serviceType
        allTemplates[targetServiceType] = template;
        
        const templateJson = JSON.stringify(allTemplates);
        
        if (existing) {
            // Update existing
            const { error } = await supabase
                .from('settings')
                .update({ value: templateJson })
                .eq('key', 'default_order_template');
            handleError(error);
        } else {
            // Insert new
            const id = randomUUID();
            const { error } = await supabase
                .from('settings')
                .insert([{ id, key: 'default_order_template', value: templateJson }]);
            handleError(error);
        }

        revalidatePath('/admin');

        // When saving the Food default template, propagate to Food clients in the background so save returns immediately
        if (targetServiceType === 'Food' && template?.vendorSelections?.length) {
            propagateDefaultTemplateToFoodClients(template).catch((propagateError) => {
                console.error('Error propagating default template to Food clients:', propagateError);
            });
        }
    } catch (error) {
        console.error('Error saving default order template:', error);
        throw error;
    }
}

/**
 * Get all client IDs that have serviceType = Food or Meal (including comma-separated service_type).
 * Used when syncing admin meal planner calendar default template to meal_planner_orders.
 * Uses service role so RLS does not block listing clients when syncing from meal planner.
 */
async function getMealPlannerClientIds(): Promise<string[]> {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: rows, error } = await supabaseAdmin
        .from('clients')
        .select('id, service_type')
        .not('service_type', 'is', null);
    if (error) {
        logQueryError(error, 'clients', 'select');
        return [];
    }
    if (!rows?.length) return [];
    const ids = rows
        .filter((r: { service_type: string | null }) => {
            const st = (r.service_type || '').trim();
            if (!st) return false;
            const list = st.split(',').map((s: string) => s.trim()).filter(Boolean);
            return list.some((s) => s.toLowerCase() === 'food' || s.toLowerCase() === 'meal');
        })
        .map((r: { id: string }) => r.id);
    return ids;
}

/**
 * Get all client IDs that have serviceType = Food (including comma-separated service_type like "Food,Produce").
 */
async function getFoodClientIds(): Promise<string[]> {
    const { data: rows, error } = await supabase
        .from('clients')
        .select('id, service_type')
        .not('service_type', 'is', null);
    if (error) {
        logQueryError(error, 'clients', 'select');
        return [];
    }
    if (!rows?.length) return [];
    const ids = rows
        .filter((r: { service_type: string | null }) => {
            const st = (r.service_type || '').trim();
            if (!st) return false;
            const list = st.split(',').map((s: string) => s.trim()).filter(Boolean);
            return list.some((s) => s.toLowerCase() === 'food');
        })
        .map((r: { id: string }) => r.id);
    return ids;
}

/**
 * Get all client IDs that have serviceType = Food (using admin client for server-side sync).
 */
async function getFoodClientIdsAdmin(): Promise<string[]> {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: rows, error } = await supabaseAdmin
        .from('clients')
        .select('id, service_type')
        .not('service_type', 'is', null);
    if (error) {
        logQueryError(error, 'clients', 'select');
        return [];
    }
    if (!rows?.length) return [];
    const ids = rows
        .filter((r: { service_type: string | null }) => {
            const st = (r.service_type || '').trim();
            if (!st) return false;
            const list = st.split(',').map((s: string) => s.trim()).filter(Boolean);
            return list.some((s) => s.toLowerCase() === 'food');
        })
        .map((r: { id: string }) => r.id);
    return ids;
}

/**
 * Get case_id from the client's upcoming_orders record where service_type = 'Food'.
 * Used to link meal_planner_orders to the same case as the viewed client's Food upcoming order.
 */
async function getUpcomingOrderCaseIdForFoodClient(supabaseAdmin: any, clientId: string): Promise<string | null> {
    const { data: row } = (await supabaseAdmin
        .from('upcoming_orders')
        .select('case_id')
        .eq('client_id', clientId)
        .eq('service_type', 'Food')
        .order('last_updated', { ascending: false })
        .limit(1)
        .maybeSingle()) as { data: { case_id?: string | null } | null };
    const caseId = row?.case_id;
    return caseId != null && String(caseId).trim() !== '' ? String(caseId).trim() : null;
}

/** Batch-fetch case_id per client for Food upcoming_orders (latest per client). Returns Map<clientId, caseId>. */
async function getUpcomingOrderCaseIdsForFoodClients(supabaseAdmin: any, clientIds: string[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (clientIds.length === 0) return map;
    const { data: rows } = (await supabaseAdmin
        .from('upcoming_orders')
        .select('client_id, case_id, last_updated')
        .in('client_id', clientIds)
        .eq('service_type', 'Food')
        .order('last_updated', { ascending: false })) as { data: Array<{ client_id: string; case_id: string | null; last_updated?: string }> | null };
    if (!rows?.length) return map;
    for (const row of rows) {
        if (!map.has(row.client_id)) {
            const caseId = row.case_id != null && String(row.case_id).trim() !== '' ? String(row.case_id).trim() : null;
            map.set(row.client_id, caseId);
        }
    }
    return map;
}

/**
 * When a new default order template is saved for Food, create meal_planner_orders and meal_planner_order_items
 * for every client with serviceType = Food, based on the template's vendorSelections (one order per delivery date).
 */
export async function propagateDefaultTemplateToFoodClients(template: any): Promise<{ clientIds: string[]; ordersCreated: number; itemsCreated: number }> {
    if (!template || template.serviceType !== 'Food' || !template.vendorSelections?.length) {
        return { clientIds: [], ordersCreated: 0, itemsCreated: 0 };
    }

    const clientIds = await getFoodClientIds();
    if (clientIds.length === 0) return { clientIds: [], ordersCreated: 0, itemsCreated: 0 };

    const vendors = await getVendors();
    const mainVendor = vendors.find((v) => v.isDefault === true) || vendors[0];
    const deliveryDays = mainVendor
        ? ('deliveryDays' in mainVendor ? mainVendor.deliveryDays : (mainVendor as any).delivery_days) || []
        : [];
    if (deliveryDays.length === 0) {
        console.warn('[propagateDefaultTemplateToFoodClients] No delivery days on main vendor; skipping.');
        return { clientIds: [], ordersCreated: 0, itemsCreated: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayNumbers = deliveryDays
        .map((d: string) => DAY_NAME_TO_NUMBER[d])
        .filter((n: number | undefined): n is number => n !== undefined);
    if (dayNumbers.length === 0) return { clientIds: [], ordersCreated: 0, itemsCreated: 0 };

    const deliveryDates: string[] = [];
    for (let i = 0; i < 56; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        if (dayNumbers.includes(d.getDay())) {
            deliveryDates.push(formatDateToYYYYMMDD(d));
        }
    }

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const todayStr = formatDateToYYYYMMDD(today);

    const dayNameFromDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T12:00:00');
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return names[d.getDay()];
    };

    // Flatten template items: menuItemId -> quantity (sum across vendor selections)
    const templateItems: { menuItemId: string; quantity: number }[] = [];
    const itemQuantities = new Map<string, number>();
    for (const vs of template.vendorSelections) {
        const items = vs?.items && typeof vs.items === 'object' ? vs.items : {};
        for (const [menuItemId, qty] of Object.entries(items)) {
            const quantity = Number(qty) || 0;
            if (quantity <= 0 || !menuItemId) continue;
            itemQuantities.set(menuItemId, (itemQuantities.get(menuItemId) || 0) + quantity);
        }
    }
    itemQuantities.forEach((quantity, menuItemId) => templateItems.push({ menuItemId, quantity }));
    const totalItemsCount = templateItems.reduce((sum, i) => sum + i.quantity, 0);
    const itemsJson =
        template.vendorSelections?.length && templateItems.length > 0
            ? { default: { items: Object.fromEntries(templateItems.map((i) => [i.menuItemId, i.quantity])) } }
            : null;

    // Batch-fetch case_id for all clients in one query
    const caseIdByClient = await getUpcomingOrderCaseIdsForFoodClients(supabaseAdmin, clientIds);

    // Bulk delete existing draft/scheduled meal_planner_orders (chunk to avoid URL limits)
    const deleteChunkSize = 100;
    for (let i = 0; i < clientIds.length; i += deleteChunkSize) {
        const chunk = clientIds.slice(i, i + deleteChunkSize);
        const { data: existing } = await supabaseAdmin
            .from('meal_planner_orders')
            .select('id')
            .in('client_id', chunk)
            .in('status', ['draft', 'scheduled'])
            .gte('scheduled_delivery_date', todayStr);
        if (existing?.length) {
            const ids = existing.map((r: { id: string }) => r.id);
            for (let j = 0; j < ids.length; j += deleteChunkSize) {
                await supabaseAdmin.from('meal_planner_orders').delete().in('id', ids.slice(j, j + deleteChunkSize));
            }
        }
    }

    if (totalItemsCount === 0) return { clientIds, ordersCreated: 0, itemsCreated: 0 };

    const BATCH_ORDERS = 80;
    const BATCH_ITEMS = 400;
    type OrderRow = {
        id: string; client_id: string; case_id: string | null; status: string; scheduled_delivery_date: string;
        delivery_day: string; total_items: number; total_value: null; items: object | null; notes: null;
        processed_order_id: null; processed_at: null; user_modified: boolean;
    };
    type ItemRow = {
        id: string; meal_planner_order_id: string; meal_type: string; menu_item_id: string; meal_item_id: null;
        quantity: number; notes: null; custom_name: null; custom_price: null; sort_order: number;
    };
    const orderRows: OrderRow[] = [];
    const itemRows: ItemRow[] = [];

    for (const clientId of clientIds) {
        const caseId = caseIdByClient.get(clientId) ?? null;
        for (const dateStr of deliveryDates) {
            const orderId = randomUUID();
            orderRows.push({
                id: orderId,
                client_id: clientId,
                case_id: caseId,
                status: 'scheduled',
                scheduled_delivery_date: dateStr,
                delivery_day: dayNameFromDate(dateStr),
                total_items: totalItemsCount,
                total_value: null,
                items: itemsJson,
                notes: null,
                processed_order_id: null,
                processed_at: null,
                user_modified: false
            });
            let sortOrder = 0;
            for (const { menuItemId, quantity } of templateItems) {
                itemRows.push({
                    id: randomUUID(),
                    meal_planner_order_id: orderId,
                    meal_type: 'default',
                    menu_item_id: menuItemId,
                    meal_item_id: null,
                    quantity,
                    notes: null,
                    custom_name: null,
                    custom_price: null,
                    sort_order: sortOrder++
                });
            }
        }
    }

    let ordersCreated = 0;
    let itemsCreated = 0;
    for (let i = 0; i < orderRows.length; i += BATCH_ORDERS) {
        const { error } = await supabaseAdmin.from('meal_planner_orders').insert(orderRows.slice(i, i + BATCH_ORDERS));
        if (error) logQueryError(error, 'meal_planner_orders', 'insert');
        else ordersCreated += Math.min(BATCH_ORDERS, orderRows.length - i);
    }
    for (let i = 0; i < itemRows.length; i += BATCH_ITEMS) {
        const { error } = await supabaseAdmin.from('meal_planner_order_items').insert(itemRows.slice(i, i + BATCH_ITEMS));
        if (error) logQueryError(error, 'meal_planner_order_items', 'insert');
        else itemsCreated += Math.min(BATCH_ITEMS, itemRows.length - i);
    }

    return { clientIds, ordersCreated, itemsCreated };
}

// --- MEAL PLANNER CUSTOM ITEMS ACTIONS ---

/** Normalize date string to YYYY-MM-DD for reliable DB matching. */
function mealPlannerDateOnly(dateStr: string): string {
    if (typeof dateStr !== 'string' || !dateStr) return dateStr;
    const trimmed = dateStr.trim();
    if (trimmed.length >= 10) return trimmed.slice(0, 10);
    return trimmed;
}

/** Normalize DB date value (string or Date) to YYYY-MM-DD in EST for display and filtering. */
function mealPlannerNormalizeDate(value: string | Date | null | undefined): string {
    if (value == null) return '';
    if (typeof value === 'string') {
        const s = value.trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? '' : toDateStringInAppTz(d);
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '' : toDateStringInAppTz(value);
    }
    return '';
}

export type MealPlannerCustomItemInput = {
    id?: string;
    name: string;
    quantity: number;
    price?: number | null;
    value?: number | null;
    sortOrder?: number | null;
    expirationDate?: string | null;
};

export type MealPlannerCustomItemResult = {
    id: string;
    name: string;
    quantity: number;
    price: number | null;
    value: number | null;
    sortOrder: number;
};

export type GetMealPlannerCustomItemsResult = {
    items: MealPlannerCustomItemResult[];
    expirationDate: string | null;
};

/**
 * Fetch meal planner custom items for a given calendar date.
 * Default meal planner menu (single source of truth) is stored where client_id IS NULL.
 * Client overrides are stored in the same table with client_id = client.id (merged with default by name when building orders).
 * @param calendarDate - ISO date string (YYYY-MM-DD)
 * @param clientId - Optional client ID; null/undefined = default template (admin)
 */
export async function getMealPlannerCustomItems(
    calendarDate: string,
    clientId?: string | null
): Promise<GetMealPlannerCustomItemsResult> {
    try {
        const dateOnly = mealPlannerDateOnly(calendarDate);
        let query = supabase
            .from('meal_planner_custom_items')
            .select('id, name, quantity, price, value, sort_order, expiration_date')
            .eq('calendar_date', dateOnly)
            .order('sort_order', { ascending: true });

        if (clientId != null && clientId !== '') {
            query = query.eq('client_id', clientId);
        } else {
            query = query.is('client_id', null);
        }

        const { data, error } = await query;
        if (error) {
            logQueryError(error, 'meal_planner_custom_items', 'select');
            return { items: [], expirationDate: null };
        }
        const rows = data || [];
        const expirationDate =
            rows.length > 0 && rows[0].expiration_date != null
                ? (typeof rows[0].expiration_date === 'string'
                      ? rows[0].expiration_date.slice(0, 10)
                      : String(rows[0].expiration_date).slice(0, 10))
                : null;
        const items = rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            quantity: row.quantity ?? 1,
            price: row.price != null ? Number(row.price) : null,
            value: row.value != null && !Number.isNaN(Number(row.value)) ? Number(row.value) : null,
            sortOrder: row.sort_order ?? 0
        }));
        return { items, expirationDate };
    } catch (error) {
        console.error('Error fetching meal planner custom items:', error);
        return { items: [], expirationDate: null };
    }
}

/**
 * Get item counts per date for a date range (for calendar indicators).
 * @param startDate - ISO date string (YYYY-MM-DD)
 * @param endDate - ISO date string (YYYY-MM-DD)
 * @param clientId - Optional; null = default template
 */
export async function getMealPlannerItemCountsByDate(
    startDate: string,
    endDate: string,
    clientId?: string | null
): Promise<Record<string, number>> {
    try {
        const start = mealPlannerDateOnly(startDate);
        const end = mealPlannerDateOnly(endDate);
        let query = supabase
            .from('meal_planner_custom_items')
            .select('calendar_date')
            .gte('calendar_date', start)
            .lte('calendar_date', end);

        if (clientId != null && clientId !== '') {
            query = query.eq('client_id', clientId);
        } else {
            query = query.is('client_id', null);
        }

        const { data, error } = await query;
        if (error) {
            logQueryError(error, 'meal_planner_custom_items', 'select');
            return {};
        }
        const counts: Record<string, number> = {};
        for (const row of data || []) {
            const d = row.calendar_date;
            if (d != null) {
                const key = typeof d === 'string' ? mealPlannerDateOnly(d) : String(d).slice(0, 10);
                counts[key] = (counts[key] ?? 0) + 1;
            }
        }
        return counts;
    } catch (error) {
        console.error('Error fetching meal planner item counts:', error);
        return {};
    }
}

/**
 * Fetch saved meal plan dates from meal_planner_custom_items: select records for client (optionally
 * in date range), group by calendar_date, and return which dates have orders (with their items).
 * Includes both client-specific rows (client_id = clientId) and default template rows (client_id is null)
 * so dates with a saved plan from the admin default template (e.g. Feb 1, Feb 3) are always shown.
 * Used by SavedMealPlanMonth in the client profile dialog.
 * When startDate/endDate are omitted, fetches all dates so every date with a saved plan is shown.
 */
export async function getSavedMealPlanDatesWithItems(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<MealPlannerOrderResult[]> {
    try {
        // Include client-specific items and default template (client_id is null) so dates like Feb 1, Feb 3 show
        let query = supabase
            .from('meal_planner_custom_items')
            .select('id, calendar_date, name, quantity, client_id')
            .or(`client_id.eq.${clientId},client_id.is.null`)
            .order('calendar_date', { ascending: true })
            .order('sort_order', { ascending: true });

        if (startDate != null && startDate !== '') {
            query = query.gte('calendar_date', mealPlannerDateOnly(startDate));
        }
        if (endDate != null && endDate !== '') {
            query = query.lte('calendar_date', mealPlannerDateOnly(endDate));
        }

        const { data: rows, error } = await query;

        if (error) {
            logQueryError(error, 'meal_planner_custom_items', 'select');
            return [];
        }
        if (!rows || rows.length === 0) return [];

        // Group by date; within each date merge by name (prefer client row over default template)
        const byDateByName = new Map<string, Map<string, MealPlannerOrderDisplayItem>>();
        for (const row of rows) {
            const dateStr = mealPlannerNormalizeDate(
                row.calendar_date as string | Date | null | undefined
            );
            if (!dateStr) continue;
            const byName = byDateByName.get(dateStr) ?? new Map<string, MealPlannerOrderDisplayItem>();
            const name = (row.name ?? 'Item').trim() || 'Item';
            const item: MealPlannerOrderDisplayItem = {
                id: row.id,
                name,
                quantity: Number(row.quantity) ?? 1,
                clientId: row.client_id as string | null
            };
            const existing = byName.get(name);
            const isClientRow = row.client_id === clientId;
            const existingIsClient = existing?.clientId === clientId;
            if (!existing || (isClientRow && !existingIsClient)) {
                byName.set(name, item);
            }
            byDateByName.set(dateStr, byName);
        }
        // Convert Map<name, item> to array per date
        const byDateArrays = new Map<string, MealPlannerOrderDisplayItem[]>();
        for (const [dateStr, byName] of byDateByName) {
            byDateArrays.set(dateStr, Array.from(byName.values()));
        }

        return Array.from(byDateArrays.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([scheduledDeliveryDate, items]) => ({
                id: scheduledDeliveryDate,
                scheduledDeliveryDate,
                deliveryDay: null as string | null,
                status: 'saved',
                totalItems: items.length,
                items
            }));
    } catch (error) {
        console.error('Error fetching saved meal plan dates from custom items:', error);
        return [];
    }
}

/**
 * Fetch saved meal plan dates and items from meal_planner_orders and meal_planner_order_items
 * for the selected client. Used by SavedMealPlanMonth in the client profile dialog so the
 * calendar shows contents by date. Uses service role so server-side read is not blocked by RLS.
 */
export async function getSavedMealPlanDatesWithItemsFromOrders(
    clientId: string,
    startDate?: string,
    endDate?: string
): Promise<MealPlannerOrderResult[]> {
    try {
        const supabaseClient = process.env.SUPABASE_SERVICE_ROLE_KEY
            ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
            : supabase;

        let query = supabaseClient
            .from('meal_planner_orders')
            .select('id, scheduled_delivery_date, delivery_day, status, total_items')
            .eq('client_id', clientId)
            .in('status', ['draft', 'scheduled', 'saved'])
            .order('scheduled_delivery_date', { ascending: true });

        if (startDate != null && startDate !== '') {
            query = query.gte('scheduled_delivery_date', mealPlannerDateOnly(startDate));
        }
        if (endDate != null && endDate !== '') {
            query = query.lte('scheduled_delivery_date', mealPlannerDateOnly(endDate));
        }

        const { data: orders, error: ordersError } = await query;

        if (ordersError) {
            logQueryError(ordersError, 'meal_planner_orders', 'select');
            return [];
        }
        if (!orders || orders.length === 0) return [];

        // Lazy-create: default template is no longer synced to all clients on save. Ensure this client
        // has orders for any default-template date in range that they don't have yet.
        const defaultDatesInRange = await getDefaultTemplateMealPlanDatesInRange(startDate, endDate);
        const existingDates = new Set(
            (orders as { scheduled_delivery_date: string | Date | null }[]).map((o) =>
                mealPlannerNormalizeDate(o.scheduled_delivery_date)
            ).filter(Boolean) as string[]
        );
        const missingDates = defaultDatesInRange.filter((d) => !existingDates.has(d));
        for (const dateOnly of missingDates) {
            await syncMealPlannerCustomItemsToOrders(dateOnly, clientId);
        }
        let ordersToUse = orders as { id: string; scheduled_delivery_date: string | Date | null; delivery_day: string | null; status: string; total_items: number }[];
        if (missingDates.length > 0) {
            let refetchQuery = supabaseClient
                .from('meal_planner_orders')
                .select('id, scheduled_delivery_date, delivery_day, status, total_items')
                .eq('client_id', clientId)
                .in('status', ['draft', 'scheduled', 'saved'])
                .order('scheduled_delivery_date', { ascending: true });
            if (startDate != null && startDate !== '') {
                refetchQuery = refetchQuery.gte('scheduled_delivery_date', mealPlannerDateOnly(startDate));
            }
            if (endDate != null && endDate !== '') {
                refetchQuery = refetchQuery.lte('scheduled_delivery_date', mealPlannerDateOnly(endDate));
            }
            const { data: refetched } = await refetchQuery;
            if (refetched?.length) ordersToUse = refetched as typeof ordersToUse;
        }

        const orderIds = ordersToUse.map((o: { id: string }) => o.id);
        const { data: orderItems, error: itemsError } = await supabaseClient
            .from('meal_planner_order_items')
            .select('id, meal_planner_order_id, menu_item_id, meal_item_id, quantity, custom_name, sort_order')
            .in('meal_planner_order_id', orderIds)
            .order('sort_order', { ascending: true });

        if (itemsError) {
            logQueryError(itemsError, 'meal_planner_order_items', 'select');
            return [];
        }

        const menuItems = await getMenuItems();
        const menuById = new Map(menuItems.map((m) => [m.id, m.name]));
        const mealItems = await getMealItems();
        const mealById = new Map(mealItems.map((m) => [m.id, m.name]));

        const itemsByOrderId = new Map<string, { id: string; name: string; quantity: number }[]>();
        for (const row of orderItems || []) {
            const orderId = row.meal_planner_order_id as string;
            const name =
                (row.custom_name && String(row.custom_name).trim()) ||
                (row.menu_item_id ? menuById.get(row.menu_item_id) : null) ||
                (row.meal_item_id ? mealById.get(row.meal_item_id) : null) ||
                'Item';
            const quantity = Math.max(1, Number(row.quantity) || 1);
            const list = itemsByOrderId.get(orderId) ?? [];
            list.push({ id: row.id, name, quantity });
            itemsByOrderId.set(orderId, list);
        }

        const list: MealPlannerOrderResult[] = [];
        for (const row of ordersToUse) {
            const dateStr = mealPlannerNormalizeDate(
                row.scheduled_delivery_date as string | Date | null | undefined
            );
            if (!dateStr) continue;
            const items = itemsByOrderId.get(row.id) ?? [];
            list.push({
                id: row.id,
                scheduledDeliveryDate: dateStr,
                deliveryDay: (row.delivery_day as string) ?? null,
                status: (row.status as string) ?? 'draft',
                totalItems: row.total_items ?? items.length,
                items: items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity }))
            });
        }
        return list;
    } catch (error) {
        console.error('Error fetching saved meal plan dates from meal_planner_orders:', error);
        return [];
    }
}

/**
 * Get distinct calendar dates from meal_planner_custom_items for the default template (client_id is null)
 * that are today or in the future. Used to seed meal_planner_orders for a client when they have none.
 */
export async function getDefaultTemplateMealPlanDatesForFuture(): Promise<string[]> {
    try {
        const today = getTodayInAppTz();
        const supabaseClient = process.env.SUPABASE_SERVICE_ROLE_KEY
            ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
            : supabase;
        const { data: rows, error } = await supabaseClient
            .from('meal_planner_custom_items')
            .select('calendar_date')
            .is('client_id', null)
            .gte('calendar_date', today)
            .order('calendar_date', { ascending: true });

        if (error) {
            logQueryError(error, 'meal_planner_custom_items', 'select');
            return [];
        }
        if (!rows || rows.length === 0) return [];
        const seen = new Set<string>();
        const dates: string[] = [];
        for (const row of rows) {
            const d = mealPlannerNormalizeDate(row.calendar_date as string | Date | null | undefined);
            if (d && !seen.has(d)) {
                seen.add(d);
                dates.push(d);
            }
        }
        return dates.sort((a, b) => a.localeCompare(b));
    } catch (err) {
        console.error('Error fetching default template meal plan dates:', err);
        return [];
    }
}

/**
 * Get default template calendar dates in an optional date range. Used to lazy-create
 * meal_planner_orders for a client when they view their meal plan and the template has dates they don't have yet.
 */
async function getDefaultTemplateMealPlanDatesInRange(
    startDate?: string | null,
    endDate?: string | null
): Promise<string[]> {
    try {
        const supabaseClient = process.env.SUPABASE_SERVICE_ROLE_KEY
            ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
            : supabase;
        let q = supabaseClient
            .from('meal_planner_custom_items')
            .select('calendar_date')
            .is('client_id', null)
            .order('calendar_date', { ascending: true });
        if (startDate != null && startDate !== '') {
            q = q.gte('calendar_date', mealPlannerDateOnly(startDate));
        }
        if (endDate != null && endDate !== '') {
            q = q.lte('calendar_date', mealPlannerDateOnly(endDate));
        }
        const { data: rows, error } = await q;
        if (error) {
            logQueryError(error, 'meal_planner_custom_items', 'select');
            return [];
        }
        if (!rows || rows.length === 0) return [];
        const seen = new Set<string>();
        const dates: string[] = [];
        for (const row of rows) {
            const d = mealPlannerNormalizeDate(row.calendar_date as string | Date | null | undefined);
            if (d && !seen.has(d)) {
                seen.add(d);
                dates.push(d);
            }
        }
        return dates.sort((a, b) => a.localeCompare(b));
    } catch (err) {
        console.error('Error fetching default template meal plan dates in range:', err);
        return [];
    }
}

/**
 * Fetch the default meal plan template (admin default, client_id is null) as a list of dates with
 * items and quantities. Used by SavedMealPlanMonth when clientId is 'new' so the user can see
 * dates and default template and edit quantities before saving the client. Returns same shape as
 * getSavedMealPlanDatesWithItemsFromOrders but with synthetic ids (e.g. new-YYYY-MM-DD-0).
 */
export async function getDefaultMealPlanTemplateForNewClient(): Promise<MealPlannerOrderResult[]> {
    try {
        const dates = await getDefaultTemplateMealPlanDatesForFuture();
        if (dates.length === 0) return [];
        const today = getTodayInAppTz();
        const list: MealPlannerOrderResult[] = [];
        for (const dateOnly of dates) {
            if (dateOnly < today) continue;
            const { items } = await getMealPlannerCustomItems(dateOnly, null);
            if (items.length === 0) continue;
            const displayItems: MealPlannerOrderDisplayItem[] = items.map((it, idx) => ({
                id: `new-${dateOnly}-${idx}`,
                name: it.name ?? 'Item',
                quantity: Math.max(1, Number(it.quantity) ?? 1)
            }));
            list.push({
                id: `new-${dateOnly}`,
                scheduledDeliveryDate: dateOnly,
                deliveryDay: null,
                status: 'draft',
                totalItems: displayItems.length,
                items: displayItems
            });
        }
        return list;
    } catch (err) {
        console.error('Error fetching default meal plan template for new client:', err);
        return [];
    }
}

/**
 * When a client has no meal_planner_orders (e.g. on first opening the profile), load the default
 * template from meal_planner_custom_items for today and future dates and create meal_planner_orders
 * and meal_planner_order_items for this client. Called from ClientProfile/SavedMealPlanMonth when
 * the meal planner component returns no dates or items.
 */
export async function ensureMealPlannerOrdersFromDefaultTemplate(
    clientId: string
): Promise<{ ok: boolean; error?: string }> {
    try {
        const dates = await getDefaultTemplateMealPlanDatesForFuture();
        if (dates.length === 0) return { ok: true };
        for (const dateOnly of dates) {
            await syncMealPlannerCustomItemsToOrders(mealPlannerDateOnly(dateOnly), clientId);
        }
        return { ok: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Error ensuring meal planner orders from default template:', err);
        return { ok: false, error: message };
    }
}

/**
 * Create meal_planner_orders and meal_planner_order_items for a new client from the in-memory
 * template (e.g. default template with user-edited quantities). Called when saving a new client
 * who had the Saved Meal Plan component open with default template data. Writes to
 * meal_planner_custom_items for the client then syncs to meal_planner_orders.
 */
export async function createMealPlannerOrdersFromTemplate(
    clientId: string,
    orders: MealPlannerOrderResult[]
): Promise<{ ok: boolean; error?: string }> {
    try {
        if (!clientId || orders.length === 0) return { ok: true };
        for (const order of orders) {
            const dateOnly = mealPlannerDateOnly(order.scheduledDeliveryDate);
            const validItems = (order.items ?? []).filter((i) => (i.name ?? '').trim() && (Number(i.quantity) || 0) > 0);
            if (validItems.length === 0) continue;
            const customItems: MealPlannerCustomItemInput[] = validItems.map((item, idx) => ({
                name: (item.name ?? '').trim() || 'Item',
                quantity: Math.max(1, Number(item.quantity) || 1),
                sortOrder: idx
            }));
            await saveMealPlannerCustomItems(dateOnly, customItems, clientId);
            await syncMealPlannerCustomItemsToOrders(dateOnly, clientId);
        }
        return { ok: true };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Error creating meal planner orders from template:', err);
        return { ok: false, error: message };
    }
}

export type MealPlannerOrderDisplayItem = { id: string; name: string; quantity: number; clientId?: string | null };

/**
 * Effective meal plan item (name + quantity + price) for a client on a date.
 * Used when syncing meal_planner_custom_items → meal_planner_orders.
 * quantity and price come from the default meal planner dialog (admin default order template calendar).
 */
export type EffectiveMealPlanItem = { name: string; quantity: number; sortOrder: number; price: number | null };

type MealPlannerCustomItemRow = {
    client_id: string | null;
    name: string | null;
    quantity: number;
    sort_order: number | null;
    price: number | string | null;
};

/**
 * Get the effective list of meal plan items for a client on a calendar date.
 * Reads meal_planner_custom_items for that date (default + client-specific) and merges by name:
 * client-specific row overrides default, so client quantity preference is preserved.
 * Used when creating/updating meal_planner_orders so admin updates don't overwrite client overrides.
 */
async function getEffectiveMealPlanItemsForDate(
    supabaseClient: any,
    clientId: string,
    calendarDate: string
): Promise<EffectiveMealPlanItem[]> {
    const dateOnly = mealPlannerDateOnly(calendarDate);
    const { data: rows, error } = await supabaseClient
        .from('meal_planner_custom_items')
        .select('id, calendar_date, name, quantity, client_id, sort_order, price')
        .eq('calendar_date', dateOnly)
        .or(`client_id.eq.${clientId},client_id.is.null`)
        .order('sort_order', { ascending: true });

    if (error) {
        logQueryError(error, 'meal_planner_custom_items', 'select');
        return [];
    }
    const typedRows = (rows ?? []) as MealPlannerCustomItemRow[];
    if (typedRows.length === 0) return [];

    // Merge by name: client row overrides default (client preference takes precedence for quantity and price)
    const byName = new Map<string, EffectiveMealPlanItem>();
    const defaultRows = typedRows.filter((r) => r.client_id == null);
    const clientRows = typedRows.filter((r) => r.client_id === clientId);
    for (const row of [...defaultRows, ...clientRows]) {
        const name = (row.name ?? 'Item').trim() || 'Item';
        const quantity = Math.max(1, Number(row.quantity) ?? 1);
        const sortOrder = Number(row.sort_order) ?? 0;
        const price = row.price != null ? (typeof row.price === 'number' ? row.price : parseFloat(String(row.price))) : null;
        const priceNum = price != null && !Number.isNaN(price) ? price : null;
        byName.set(name, { name, quantity, sortOrder, price: priceNum });
    }
    return Array.from(byName.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Batch-fetch effective meal plan items for multiple clients on one date.
 * Uses two simple queries (default items + client-specific items) and merges per client.
 * Same merge logic as getEffectiveMealPlanItemsForDate: client overrides default by name.
 */
async function getEffectiveMealPlanItemsForDateBatch(
    supabaseClient: any,
    clientIds: string[],
    dateOnly: string
): Promise<Map<string, EffectiveMealPlanItem[]>> {
    const result = new Map<string, EffectiveMealPlanItem[]>();
    if (clientIds.length === 0) return result;
    const uniq = [...new Set(clientIds)];

    const { data: defaultRows, error: err1 } = await supabaseClient
        .from('meal_planner_custom_items')
        .select('name, quantity, client_id, sort_order, price')
        .eq('calendar_date', dateOnly)
        .is('client_id', null)
        .order('sort_order', { ascending: true });

    if (err1) {
        logQueryError(err1, 'meal_planner_custom_items', 'select');
        return result;
    }

    const { data: clientRows, error: err2 } = await supabaseClient
        .from('meal_planner_custom_items')
        .select('name, quantity, client_id, sort_order, price')
        .eq('calendar_date', dateOnly)
        .in('client_id', uniq)
        .order('sort_order', { ascending: true });

    if (err2) {
        logQueryError(err2, 'meal_planner_custom_items', 'select');
        return result;
    }

    const defaultTyped = (defaultRows ?? []) as MealPlannerCustomItemRow[];
    const clientTyped = (clientRows ?? []) as MealPlannerCustomItemRow[];

    const toItem = (row: MealPlannerCustomItemRow): EffectiveMealPlanItem => {
        const name = (row.name ?? 'Item').trim() || 'Item';
        const quantity = Math.max(1, Number(row.quantity) ?? 1);
        const sortOrder = Number(row.sort_order) ?? 0;
        const price = row.price != null ? (typeof row.price === 'number' ? row.price : parseFloat(String(row.price))) : null;
        const priceNum = price != null && !Number.isNaN(price) ? price : null;
        return { name, quantity, sortOrder, price: priceNum };
    };

    for (const cid of uniq) {
        const clientOnly = clientTyped.filter((r) => r.client_id === cid);
        const byName = new Map<string, EffectiveMealPlanItem>();
        for (const row of [...defaultTyped, ...clientOnly]) {
            const item = toItem(row);
            byName.set(item.name, item);
        }
        result.set(cid, Array.from(byName.values()).sort((a, b) => a.sortOrder - b.sortOrder));
    }
    return result;
}

/**
 * Sync meal_planner_custom_items for a calendar date to meal_planner_orders and meal_planner_order_items.
 * When admin saves or updates meals for a day in the calendar, this creates/updates meal_planner_orders
 * for the affected client(s). Effective items are computed with client overrides merged (client quantity
 * preference takes precedence over admin default). Respects user_modified so client overrides are not overwritten.
 * @param calendarDate - ISO date (YYYY-MM-DD)
 * @param clientId - If null, sync for all Meal/Food clients (default template); else sync only for this client.
 * @param defaultTemplateItems - When saving default template, pass the just-saved items so sync does not rely on read-after-write.
 */
async function syncMealPlannerCustomItemsToOrders(
    calendarDate: string,
    clientId?: string | null,
    defaultTemplateItems?: EffectiveMealPlanItem[]
): Promise<void> {
    const dateOnly = mealPlannerDateOnly(calendarDate);
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const clientIds =
        clientId && clientId !== ''
            ? [clientId]
            : await getMealPlannerClientIds();
    if (clientIds.length === 0) return;

    const dayNameFromDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T12:00:00');
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return names[d.getDay()];
    };

    type ItemRow = { id: string; meal_planner_order_id: string; meal_type: string; menu_item_id: null; meal_item_id: null; quantity: number; notes: null; custom_name: string | null; custom_price: number | null; sort_order: number };
    const itemRowsToInsert: ItemRow[] = [];
    const BATCH = 300;

    const useDefaultTemplateOverride = defaultTemplateItems != null && (!clientId || clientId === '');
    const useBatch = clientIds.length > 1 && !useDefaultTemplateOverride;
    const caseIdByClient = (useBatch || useDefaultTemplateOverride) ? await getUpcomingOrderCaseIdsForFoodClients(supabaseAdmin, clientIds) : new Map<string, string | null>();
    const effectiveByClient = useBatch ? await getEffectiveMealPlanItemsForDateBatch(supabaseAdmin, clientIds, dateOnly) : new Map<string, EffectiveMealPlanItem[]>();

    // Batch-fetch existing orders for all clients (avoids N round-trips when syncing default template)
    const existingOrderByClient = new Map<string, { id: string; user_modified: boolean }>();
    if (clientIds.length === 1) {
        const { data: single } = await supabaseAdmin
            .from('meal_planner_orders')
            .select('id, user_modified')
            .eq('client_id', clientIds[0])
            .eq('scheduled_delivery_date', dateOnly)
            .in('status', ['draft', 'scheduled'])
            .maybeSingle();
        if (single?.id) existingOrderByClient.set(clientIds[0], { id: single.id, user_modified: !!single.user_modified });
    } else {
        const CHUNK = 200;
        for (let i = 0; i < clientIds.length; i += CHUNK) {
            const chunk = clientIds.slice(i, i + CHUNK);
            const { data: rows } = await supabaseAdmin
                .from('meal_planner_orders')
                .select('id, client_id, user_modified')
                .in('client_id', chunk)
                .eq('scheduled_delivery_date', dateOnly)
                .in('status', ['draft', 'scheduled']);
            for (const r of rows ?? []) {
                const cid = (r as { client_id: string }).client_id;
                existingOrderByClient.set(cid, { id: (r as { id: string }).id, user_modified: !!(r as { user_modified?: boolean }).user_modified });
            }
        }
    }

    // Batch-fetch existing items for user_modified orders only (one or few queries instead of N)
    const userModifiedOrderIds = Array.from(existingOrderByClient.entries())
        .filter(([, o]) => o.user_modified)
        .map(([, o]) => o.id);
    const existingItemsByOrderId = new Map<string, Array<{ id: string; custom_name: string | null; quantity: number; sort_order: number | null }>>();
    if (userModifiedOrderIds.length > 0) {
        const ID_CHUNK = 200;
        for (let i = 0; i < userModifiedOrderIds.length; i += ID_CHUNK) {
            const ids = userModifiedOrderIds.slice(i, i + ID_CHUNK);
            const { data: itemsRows } = await supabaseAdmin
                .from('meal_planner_order_items')
                .select('id, meal_planner_order_id, custom_name, quantity, sort_order')
                .in('meal_planner_order_id', ids)
                .order('sort_order', { ascending: true });
            for (const row of itemsRows ?? []) {
                const oid = (row as { meal_planner_order_id: string }).meal_planner_order_id;
                const list = existingItemsByOrderId.get(oid) ?? [];
                list.push({
                    id: (row as { id: string }).id,
                    custom_name: (row as { custom_name: string | null }).custom_name,
                    quantity: (row as { quantity: number }).quantity,
                    sort_order: (row as { sort_order: number | null }).sort_order
                });
                existingItemsByOrderId.set(oid, list);
            }
        }
    }

    const norm = (s: string | null) => ((s ?? '').trim() || 'Item').toLowerCase();
    const itemIdsToDelete: string[] = [];
    const orderIdsToClearItems: string[] = []; // orders where we replace all items (delete by order_id)
    const orderUpdates: Array<{ id: string; total_items: number }> = [];
    const newOrderRows: Array<{ id: string; client_id: string; case_id: string | null; total_items: number }> = [];

    for (const cid of clientIds) {
        const caseId = (useBatch || useDefaultTemplateOverride) ? (caseIdByClient.get(cid) ?? null) : await getUpcomingOrderCaseIdForFoodClient(supabaseAdmin, cid);
        const effectiveItems = useDefaultTemplateOverride
            ? defaultTemplateItems!
            : (useBatch ? (effectiveByClient.get(cid) ?? []) : await getEffectiveMealPlanItemsForDate(supabaseAdmin, cid, dateOnly));
        const totalItemsCount = effectiveItems.reduce((sum, i) => sum + i.quantity, 0);
        const existingOrder = existingOrderByClient.get(cid);

        if (existingOrder?.id && existingOrder?.user_modified) {
            const orderId = existingOrder.id;
            const existingItems = existingItemsByOrderId.get(orderId) ?? [];
            const templateNames = new Set(effectiveItems.map((t) => norm(t.name)));
            const orderByName = new Map<string, { id: string; custom_name: string; quantity: number; sort_order: number }>();
            existingItems.forEach((row) => {
                const name = (row.custom_name ?? '').trim() || 'Item';
                orderByName.set(norm(name), {
                    id: row.id,
                    custom_name: name,
                    quantity: Math.max(1, Number(row.quantity) || 1),
                    sort_order: row.sort_order ?? 0
                });
            });

            const toDelete = existingItems.filter((row) => !templateNames.has(norm(row.custom_name)));
            const toAdd = effectiveItems.filter((t) => !orderByName.has(norm(t.name)));
            toDelete.forEach((row) => itemIdsToDelete.push(row.id));

            const maxSortOrder = existingItems.reduce((m, r) => Math.max(m, r.sort_order ?? 0), -1);
            let nextSortOrder = maxSortOrder + 1;
            for (const t of toAdd) {
                itemRowsToInsert.push({
                    id: randomUUID(),
                    meal_planner_order_id: orderId,
                    meal_type: 'Lunch',
                    menu_item_id: null,
                    meal_item_id: null,
                    quantity: t.quantity,
                    notes: null,
                    custom_name: t.name,
                    custom_price: t.price,
                    sort_order: nextSortOrder++
                });
            }

            const newTotalItems = effectiveItems.reduce((sum, i) => {
                const existing = orderByName.get(norm(i.name));
                return sum + (existing ? existing.quantity : i.quantity);
            }, 0);
            orderUpdates.push({ id: orderId, total_items: newTotalItems });
            continue;
        }
        if (existingOrder?.id) {
            const orderId = existingOrder.id;
            orderIdsToClearItems.push(orderId);

            orderUpdates.push({ id: orderId, total_items: totalItemsCount });
            let sortOrder = 0;
            for (const item of effectiveItems) {
                itemRowsToInsert.push({
                    id: randomUUID(),
                    meal_planner_order_id: orderId,
                    meal_type: 'Lunch',
                    menu_item_id: null,
                    meal_item_id: null,
                    quantity: item.quantity,
                    notes: null,
                    custom_name: item.name,
                    custom_price: item.price,
                    sort_order: sortOrder++
                });
            }
        } else {
            if (effectiveItems.length === 0) continue;
            const orderId = randomUUID();
            newOrderRows.push({
                id: orderId,
                client_id: cid,
                case_id: caseId ?? null,
                total_items: totalItemsCount
            });
            let sortOrder = 0;
            for (const item of effectiveItems) {
                itemRowsToInsert.push({
                    id: randomUUID(),
                    meal_planner_order_id: orderId,
                    meal_type: 'Lunch',
                    menu_item_id: null,
                    meal_item_id: null,
                    quantity: item.quantity,
                    notes: null,
                    custom_name: item.name,
                    custom_price: item.price,
                    sort_order: sortOrder++
                });
            }
        }
    }

    // Execute batched deletes (items by id)
    for (let k = 0; k < itemIdsToDelete.length; k += 100) {
        const { error: delErr } = await supabaseAdmin.from('meal_planner_order_items').delete().in('id', itemIdsToDelete.slice(k, k + 100));
        if (delErr) logQueryError(delErr, 'meal_planner_order_items', 'delete');
    }
    // Delete all items for orders we're replacing (by order id), in parallel
    const CLEAR_CHUNK = 25;
    for (let c = 0; c < orderIdsToClearItems.length; c += CLEAR_CHUNK) {
        const ids = orderIdsToClearItems.slice(c, c + CLEAR_CHUNK);
        await Promise.all(
            ids.map((orderId) => supabaseAdmin.from('meal_planner_order_items').delete().eq('meal_planner_order_id', orderId))
        );
    }
    // Execute order updates in parallel chunks (much faster than sequential)
    const UPDATE_CHUNK = 25;
    const now = new Date().toISOString();
    for (let u = 0; u < orderUpdates.length; u += UPDATE_CHUNK) {
        const chunk = orderUpdates.slice(u, u + UPDATE_CHUNK);
        await Promise.all(
            chunk.map(({ id, total_items }) =>
                supabaseAdmin.from('meal_planner_orders').update({ total_items, updated_at: now }).eq('id', id)
            )
        );
    }
    // Insert new orders
    if (newOrderRows.length > 0) {
        const INSERT_ORDER_CHUNK = 80;
        for (let o = 0; o < newOrderRows.length; o += INSERT_ORDER_CHUNK) {
            const rows = newOrderRows.slice(o, o + INSERT_ORDER_CHUNK).map((r) => ({
                id: r.id,
                client_id: r.client_id,
                case_id: r.case_id,
                status: 'scheduled',
                scheduled_delivery_date: dateOnly,
                delivery_day: dayNameFromDate(dateOnly),
                total_items: r.total_items,
                total_value: null,
                items: null,
                notes: null,
                processed_order_id: null,
                processed_at: null,
                user_modified: false
            }));
            const { error: orderErr } = await supabaseAdmin.from('meal_planner_orders').insert(rows);
            if (orderErr) {
                logQueryError(orderErr, 'meal_planner_orders', 'insert');
                throw new Error(`Failed to create meal planner order: ${orderErr.message}`);
            }
        }
    }

    for (let i = 0; i < itemRowsToInsert.length; i += BATCH) {
        const { error } = await supabaseAdmin.from('meal_planner_order_items').insert(itemRowsToInsert.slice(i, i + BATCH));
        if (error) {
            logQueryError(error, 'meal_planner_order_items', 'insert');
            throw new Error(`Failed to create meal planner order items: ${error.message}`);
        }
    }
}

/**
 * Sync meal_planner_custom_items for a calendar date to meal_planner_orders and meal_planner_order_items.
 * When admin saves meal plan items for a day in the meal planner calendar, this creates/updates
 * meal_planner_orders and meal_planner_order_items for every client with serviceType = food.
 * Effective items are computed with client overrides merged (client quantity preference takes precedence).
 * @param calendarDate - ISO date (YYYY-MM-DD)
 * @param clientId - If null, sync for all Food clients (default template); else sync only for this client.
 */
async function syncMealPlannerCustomItemsToMealPlannerOrders(
    calendarDate: string,
    clientId?: string | null
): Promise<void> {
    const dateOnly = mealPlannerDateOnly(calendarDate);
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const clientIds =
        clientId && clientId !== ''
            ? [clientId]
            : await getFoodClientIdsAdmin();
    if (clientIds.length === 0) return;

    const dayNameFromDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T12:00:00');
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return names[d.getDay()];
    };

    type ItemRow = { id: string; meal_planner_order_id: string; meal_type: string; menu_item_id: null; meal_item_id: null; quantity: number; notes: null; custom_name: string | null; custom_price: number | null; sort_order: number };
    const itemRowsToInsert: ItemRow[] = [];
    const BATCH = 300;

    const useBatch = clientIds.length > 1;
    const caseIdByClient = useBatch ? await getUpcomingOrderCaseIdsForFoodClients(supabaseAdmin, clientIds) : new Map<string, string | null>();
    const effectiveByClient = useBatch ? await getEffectiveMealPlanItemsForDateBatch(supabaseAdmin, clientIds, dateOnly) : new Map<string, EffectiveMealPlanItem[]>();

    for (const cid of clientIds) {
        const caseId = useBatch ? (caseIdByClient.get(cid) ?? null) : await getUpcomingOrderCaseIdForFoodClient(supabaseAdmin, cid);
        const effectiveItems = useBatch ? (effectiveByClient.get(cid) ?? []) : await getEffectiveMealPlanItemsForDate(supabaseAdmin, cid, dateOnly);
        const totalItemsCount = effectiveItems.reduce((sum, i) => sum + i.quantity, 0);

        const { data: existingOrders } = await supabaseAdmin
            .from('meal_planner_orders')
            .select('id')
            .eq('client_id', cid)
            .eq('scheduled_delivery_date', dateOnly)
            .in('status', ['draft', 'scheduled']);

        const existingIds = (existingOrders ?? []).map((r: { id: string }) => r.id);
        if (existingIds.length > 0) {
            for (let j = 0; j < existingIds.length; j += 100) {
                const { error: delErr } = await supabaseAdmin.from('meal_planner_orders').delete().in('id', existingIds.slice(j, j + 100));
                if (delErr) logQueryError(delErr, 'meal_planner_orders', 'delete');
            }
        }

        if (effectiveItems.length === 0) continue;

        const orderId = randomUUID();
        const { error: orderErr } = await supabaseAdmin.from('meal_planner_orders').insert({
            id: orderId,
            client_id: cid,
            case_id: caseId ?? null,
            status: 'scheduled',
            scheduled_delivery_date: dateOnly,
            delivery_day: dayNameFromDate(dateOnly),
            total_items: totalItemsCount,
            total_value: null,
            items: null,
            notes: null,
            processed_order_id: null,
            processed_at: null,
            user_modified: false
        });
        if (orderErr) {
            logQueryError(orderErr, 'meal_planner_orders', 'insert');
            continue;
        }

        let sortOrder = 0;
        for (const item of effectiveItems) {
            itemRowsToInsert.push({
                id: randomUUID(),
                meal_planner_order_id: orderId,
                meal_type: 'Lunch',
                menu_item_id: null,
                meal_item_id: null,
                quantity: item.quantity,
                notes: null,
                custom_name: item.name,
                custom_price: item.price,
                sort_order: sortOrder++
            });
        }
    }

    for (let i = 0; i < itemRowsToInsert.length; i += BATCH) {
        const { error } = await supabaseAdmin.from('meal_planner_order_items').insert(itemRowsToInsert.slice(i, i + BATCH));
        if (error) logQueryError(error, 'meal_planner_order_items', 'insert');
    }
}

/**
 * Sync meal planner order for a single client and date (e.g. after client changes quantity in SavedMealPlanMonth).
 * Keeps meal_planner_orders in sync with client preference without waiting for the next admin save.
 */
export async function syncMealPlanDateToOrderForClient(
    clientId: string,
    calendarDate: string
): Promise<void> {
    await syncMealPlannerCustomItemsToOrders(mealPlannerDateOnly(calendarDate), clientId);
}

export type MealPlannerOrderResult = {
    id: string;
    scheduledDeliveryDate: string;
    deliveryDay: string | null;
    status: string;
    totalItems: number | null;
    items: MealPlannerOrderDisplayItem[];
};

/**
 * Fetch meal planner orders (saved from client meal selections) for a client in a date range.
 * Reads from meal_planner_orders and meal_planner_order_items.
 */
export async function getMealPlannerOrders(
    clientId: string,
    startDate: string,
    endDate: string
): Promise<MealPlannerOrderResult[]> {
    try {
        const supabaseClient = process.env.SUPABASE_SERVICE_ROLE_KEY
            ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
            : supabase;
        const start = mealPlannerDateOnly(startDate);
        const end = mealPlannerDateOnly(endDate);
        const { data: orders, error: ordersError } = await supabaseClient
            .from('meal_planner_orders')
            .select('id, scheduled_delivery_date, delivery_day, status, total_items')
            .eq('client_id', clientId)
            .gte('scheduled_delivery_date', start)
            .lte('scheduled_delivery_date', end)
            .order('scheduled_delivery_date', { ascending: true });

        if (ordersError) {
            logQueryError(ordersError, 'meal_planner_orders', 'select');
            return [];
        }
        if (!orders || orders.length === 0) return [];

        const orderIds = orders.map((o: { id: string }) => o.id);
        const { data: orderItems, error: itemsError } = await supabaseClient
            .from('meal_planner_order_items')
            .select('id, meal_planner_order_id, menu_item_id, meal_item_id, quantity, custom_name, sort_order')
            .in('meal_planner_order_id', orderIds)
            .order('sort_order', { ascending: true });

        if (itemsError) {
            logQueryError(itemsError, 'meal_planner_order_items', 'select');
            return [];
        }

        const menuItems = await getMenuItems();
        const menuById = new Map(menuItems.map((m) => [m.id, m.name]));
        const mealItems = await getMealItems();
        const mealById = new Map(mealItems.map((m) => [m.id, m.name]));

        const itemsByOrderId = new Map<string, { id: string; name: string; quantity: number }[]>();
        for (const row of orderItems || []) {
            const orderId = row.meal_planner_order_id as string;
            const name =
                (row.custom_name && String(row.custom_name).trim()) ||
                (row.menu_item_id ? menuById.get(row.menu_item_id) : null) ||
                (row.meal_item_id ? mealById.get(row.meal_item_id) : null) ||
                'Item';
            const quantity = Math.max(1, Number(row.quantity) || 1);
            const list = itemsByOrderId.get(orderId) ?? [];
            list.push({ id: row.id, name, quantity });
            itemsByOrderId.set(orderId, list);
        }

        const list: MealPlannerOrderResult[] = [];
        for (const row of orders) {
            const dateStr = mealPlannerNormalizeDate(
                row.scheduled_delivery_date as string | Date | null | undefined
            );
            if (!dateStr) continue;
            const items = itemsByOrderId.get(row.id) ?? [];
            list.push({
                id: row.id,
                scheduledDeliveryDate: dateStr,
                deliveryDay: (row.delivery_day as string) ?? null,
                status: (row.status as string) ?? 'draft',
                totalItems: row.total_items ?? items.length,
                items: items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity }))
            });
        }
        return list;
    } catch (error) {
        console.error('Error fetching meal planner orders from meal_planner_orders:', error);
        return [];
    }
}

/**
 * Save meal planner custom items for a given date.
 * Replaces all existing items for that date with the provided list.
 * Uses service role so admin default template and client overrides always save and sync to meal_planner_orders.
 * @param calendarDate - ISO date string (YYYY-MM-DD)
 * @param items - Array of items to save
 * @param clientId - Optional; null = default template (admin)
 */
export async function saveMealPlannerCustomItems(
    calendarDate: string,
    items: MealPlannerCustomItemInput[],
    clientId?: string | null,
    expirationDate?: string | null
): Promise<void> {
    try {
        const validItems = items.filter(
            (i) => (i.name ?? '').trim().length > 0 && (i.quantity ?? 0) > 0
        );
        const clientIdVal = clientId && clientId !== '' ? clientId : null;
        const dateOnly = mealPlannerDateOnly(calendarDate);
        const expirationDateVal =
            expirationDate != null && expirationDate !== ''
                ? mealPlannerDateOnly(expirationDate)
                : null;

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // Delete existing items for this date (service role so RLS does not block)
        let deleteQuery = supabaseAdmin
            .from('meal_planner_custom_items')
            .delete()
            .eq('calendar_date', dateOnly);
        if (clientIdVal) {
            deleteQuery = deleteQuery.eq('client_id', clientIdVal);
        } else {
            deleteQuery = deleteQuery.is('client_id', null);
        }
        const { error: deleteError } = await deleteQuery;
        if (deleteError) {
            logQueryError(deleteError, 'meal_planner_custom_items', 'delete');
            throw new Error(deleteError.message);
        }

        if (validItems.length === 0) {
            revalidatePath('/admin');
            // Only sync to meal_planner_orders when saving a specific client; default template does not push to all clients
            if (clientIdVal != null) {
                await syncMealPlannerCustomItemsToOrders(dateOnly, clientIdVal).catch((syncErr) => {
                    console.error('Error syncing meal planner custom items to meal_planner_orders:', syncErr);
                    throw syncErr;
                });
            }
            return;
        }

        const rows = validItems.map((item, idx) => ({
            id: item.id && item.id.startsWith('custom-') ? randomUUID() : (item.id ?? randomUUID()),
            client_id: clientIdVal,
            calendar_date: dateOnly,
            name: (item.name ?? '').trim(),
            quantity: Math.max(1, item.quantity ?? 1),
            price: item.price != null && !Number.isNaN(Number(item.price)) ? Number(item.price) : null,
            value: item.value != null && !Number.isNaN(Number(item.value)) ? Number(item.value) : null,
            sort_order: item.sortOrder ?? idx,
            expiration_date: expirationDateVal
        }));

        const { error: insertError } = await supabaseAdmin
            .from('meal_planner_custom_items')
            .insert(rows);
        if (insertError) {
            logQueryError(insertError, 'meal_planner_custom_items', 'insert');
            throw new Error(insertError.message);
        }
        revalidatePath('/admin');
        // Sync to meal_planner_orders only when saving a specific client's plan. Default template save does NOT
        // push to all clients (avoids slow mass-write). Orders are created on-demand when a client views their
        // meal plan or when process-orders / create-expired runs.
        if (clientIdVal != null) {
            const defaultItemsForSync: EffectiveMealPlanItem[] = validItems.map((item, idx) => ({
                name: (item.name ?? '').trim() || 'Item',
                quantity: Math.max(1, item.quantity ?? 1),
                sortOrder: item.sortOrder ?? idx,
                price: item.price != null && !Number.isNaN(Number(item.price)) ? Number(item.price) : null
            }));
            await syncMealPlannerCustomItemsToOrders(dateOnly, clientIdVal, defaultItemsForSync).catch((syncErr) => {
                console.error('Error syncing meal planner custom items to meal_planner_orders:', syncErr);
                throw syncErr;
            });
        }
    } catch (error) {
        console.error('Error saving meal planner custom items:', error);
        throw error;
    }
}

/**
 * Ensure meal_planner_orders exist for the given date for all Food/Meal clients, using the default template.
 * Used by process-orders and create-expired-meal-planner-orders so they see orders even though we no longer
 * sync to all clients when the default template is saved.
 */
export async function ensureMealPlannerOrdersForDateFromDefaultTemplate(dateOnly: string): Promise<void> {
    const normalized = mealPlannerDateOnly(dateOnly);
    const { items } = await getMealPlannerCustomItems(normalized, null);
    if (!items?.length) return;
    const defaultItems: EffectiveMealPlanItem[] = items.map((item, idx) => ({
        name: (item.name ?? '').trim() || 'Item',
        quantity: Math.max(1, item.quantity ?? 1),
        sortOrder: item.sortOrder ?? idx,
        price: item.price != null && !Number.isNaN(Number(item.price)) ? Number(item.price) : null
    }));
    await syncMealPlannerCustomItemsToOrders(normalized, null, defaultItems);
}

/**
 * Insert a single meal planner custom item for a client (e.g. when editing quantity of a default template item).
 * Uses service role so client overrides always save; caller should then sync to meal_planner_orders via syncMealPlanDateToOrderForClient.
 */
export async function insertMealPlannerCustomItemForClient(
    clientId: string,
    calendarDate: string,
    name: string,
    quantity: number
): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
        const dateOnly = mealPlannerDateOnly(calendarDate);
        const qty = Math.max(1, Math.floor(Number(quantity)) || 1);
        const trimName = (name ?? '').trim() || 'Item';
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { data, error } = await supabaseAdmin
            .from('meal_planner_custom_items')
            .insert({
                client_id: clientId,
                calendar_date: dateOnly,
                name: trimName,
                quantity: qty,
                sort_order: 0
            })
            .select('id')
            .single();

        if (error) {
            logQueryError(error, 'meal_planner_custom_items', 'insert');
            return { ok: false, error: error.message };
        }
        return { ok: true, id: data?.id };
    } catch (error) {
        console.error('Error inserting meal planner custom item for client:', error);
        return { ok: false, error: String(error) };
    }
}

/**
 * Update a single meal planner custom item's quantity. Only updates if the row belongs to the client.
 * Used by SavedMealPlanMonth in the client profile dialog for +/- quantity controls.
 * Uses service role so client overrides always save; caller should then sync to meal_planner_orders via syncMealPlanDateToOrderForClient.
 */
export async function updateMealPlannerCustomItemQuantity(
    clientId: string,
    itemId: string,
    quantity: number
): Promise<{ ok: boolean; error?: string }> {
    try {
        const qty = Math.max(1, Math.floor(Number(quantity)) || 1);
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { error } = await supabaseAdmin
            .from('meal_planner_custom_items')
            .update({ quantity: qty })
            .eq('id', itemId)
            .eq('client_id', clientId);

        if (error) {
            logQueryError(error, 'meal_planner_custom_items', 'update');
            return { ok: false, error: error.message };
        }
        return { ok: true };
    } catch (error) {
        console.error('Error updating meal planner custom item quantity:', error);
        return { ok: false, error: String(error) };
    }
}

/**
 * Update a single meal_planner_order_item's quantity. Used by SavedMealPlanMonth when the
 * client profile meal planner is loaded from meal_planner_orders / meal_planner_order_items.
 * Sets user_modified = true on the parent meal_planner_order so admin template updates
 * won't overwrite client overrides.
 */
export async function updateMealPlannerOrderItemQuantity(
    itemId: string,
    quantity: number
): Promise<{ ok: boolean; error?: string }> {
    try {
        const qty = Math.max(1, Math.floor(Number(quantity)) || 1);
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const { data: item, error: fetchErr } = await supabaseAdmin
            .from('meal_planner_order_items')
            .select('meal_planner_order_id')
            .eq('id', itemId)
            .single();

        if (fetchErr || !item?.meal_planner_order_id) {
            logQueryError(fetchErr ?? { message: 'Item not found' }, 'meal_planner_order_items', 'select');
            return { ok: false, error: fetchErr?.message ?? 'Item not found' };
        }

        const { error } = await supabaseAdmin
            .from('meal_planner_order_items')
            .update({ quantity: qty })
            .eq('id', itemId);

        if (error) {
            logQueryError(error, 'meal_planner_order_items', 'update');
            return { ok: false, error: error.message };
        }

        const { error: orderErr } = await supabaseAdmin
            .from('meal_planner_orders')
            .update({ user_modified: true })
            .eq('id', item.meal_planner_order_id);
        if (orderErr) logQueryError(orderErr, 'meal_planner_orders', 'update');

        return { ok: true };
    } catch (error) {
        console.error('Error updating meal planner order item quantity:', error);
        return { ok: false, error: String(error) };
    }
}

/**
 * Persist meal planner order quantities from the client profile dialog.
 * Called when saving the client profile so that any quantity changes made in the
 * Saved Meal Plan section (date buttons / quantity controls) are written to
 * meal_planner_orders and meal_planner_order_items. Only updates existing orders
 * that belong to the client; sets user_modified on orders so admin template
 * updates do not overwrite client overrides.
 */
export async function saveClientMealPlannerOrderQuantities(
    clientId: string,
    orders: MealPlannerOrderResult[]
): Promise<{ ok: boolean; error?: string }> {
    if (!clientId || !orders?.length) return { ok: true };
    try {
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        const orderIds = orders.map((o) => o.id).filter(Boolean);
        if (orderIds.length === 0) return { ok: true };

        const { data: allowedOrders, error: fetchErr } = await supabaseAdmin
            .from('meal_planner_orders')
            .select('id')
            .eq('client_id', clientId)
            .in('id', orderIds);

        if (fetchErr) {
            logQueryError(fetchErr, 'meal_planner_orders', 'select');
            return { ok: false, error: fetchErr.message };
        }
        const allowedOrderIds = new Set((allowedOrders ?? []).map((r: { id: string }) => r.id));
        const now = new Date().toISOString();

        // Build order updates and item updates, then run in parallel (batched for items)
        const orderUpdates: Promise<unknown>[] = [];
        const itemUpdates: Array<() => Promise<unknown>> = [];
        for (const order of orders) {
            if (!allowedOrderIds.has(order.id)) continue;
            const totalItems = (order.items ?? []).reduce((sum, i) => sum + Math.max(1, Number(i.quantity) || 1), 0);
            const orderId = order.id;
            orderUpdates.push(
                (async () => {
                    const r = await supabaseAdmin
                        .from('meal_planner_orders')
                        .update({ total_items: totalItems, user_modified: true, updated_at: now })
                        .eq('id', orderId)
                        .eq('client_id', clientId);
                    if (r.error) logQueryError(r.error, 'meal_planner_orders', 'update');
                    return r;
                })()
            );
            for (const item of order.items ?? []) {
                const qty = Math.max(1, Math.floor(Number(item.quantity)) || 1);
                const itemId = item.id;
                itemUpdates.push(async () => {
                    const r = await supabaseAdmin
                        .from('meal_planner_order_items')
                        .update({ quantity: qty, updated_at: now })
                        .eq('id', itemId);
                    if (r.error) logQueryError(r.error, 'meal_planner_order_items', 'update');
                    return r;
                });
            }
        }
        // Run all order updates in parallel
        await Promise.all(orderUpdates);
        // Run item updates in parallel in chunks to avoid overwhelming the DB (e.g. 40 at a time)
        const ITEM_BATCH = 40;
        for (let i = 0; i < itemUpdates.length; i += ITEM_BATCH) {
            const batch = itemUpdates.slice(i, i + ITEM_BATCH).map((fn) => fn());
            await Promise.all(batch);
        }
        return { ok: true };
    } catch (error) {
        console.error('Error saving client meal planner order quantities:', error);
        return { ok: false, error: String(error) };
    }
}

// --- NAVIGATOR ACTIONS ---

export async function getNavigators() {
    try {
        const { data, error } = await supabase.from('navigators').select('*');
        if (error) return [];
        return (data || []).map((n: any) => ({
            id: n.id,
            name: n.name,
            email: n.email || null,
            isActive: n.is_active
        }));
    } catch (error) {
        console.error('Error fetching navigators:', error);
        return [];
    }
}

export async function addNavigator(data: Omit<Navigator, 'id'>) {
    const payload: any = {
        name: data.name,
        is_active: data.isActive
    };

    if (data.email !== undefined && data.email !== null) {
        const trimmedEmail = data.email.trim();
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }

    if (data.password && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password.trim());
    }

    const id = randomUUID();
    const { error } = await supabase.from('navigators').insert([{ ...payload, id }]);
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateNavigator(id: string, data: Partial<Navigator>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.email !== undefined) {
        const trimmedEmail = data.email?.trim() || '';
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }
    if (data.password !== undefined && data.password !== null && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password.trim());
    }
    
    if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('navigators').update(payload).eq('id', id);
        handleError(error);
    }
    revalidatePath('/admin');
}

export async function deleteNavigator(id: string) {
    const { error } = await supabase.from('navigators').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- NUTRITIONIST ACTIONS ---

export async function getNutritionists() {
    try {
        const { data, error } = await supabase.from('nutritionists').select('*').order('created_at', { ascending: true });
        if (error) return [];
        return (data || []).map((n: any) => ({
            id: n.id,
            name: n.name,
            email: n.email || null
        }));
    } catch (error) {
        console.error('Error fetching nutritionists:', error);
        return [];
    }
}

export async function addNutritionist(data: Omit<Nutritionist, 'id'>) {
    const payload: any = {
        name: data.name
    };

    if (data.email !== undefined && data.email !== null) {
        const trimmedEmail = data.email.trim();
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }

    const id = randomUUID();
    const { error } = await supabase.from('nutritionists').insert([{ ...payload, id }]);
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateNutritionist(id: string, data: Partial<Nutritionist>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;

    if (data.email !== undefined) {
        const trimmedEmail = data.email?.trim() || '';
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }
    
    if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('nutritionists').update(payload).eq('id', id);
        handleError(error);
    }
    
    const { data: updated, error: fetchError } = await supabase.from('nutritionists').select('*').eq('id', id).single();
    handleError(fetchError);
    if (!updated) throw new Error('Nutritionist not found');
    revalidatePath('/admin');
    return {
        id: updated.id,
        name: updated.name,
        email: updated.email || null
    };
}

export async function deleteNutritionist(id: string) {
    const { error } = await supabase.from('nutritionists').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- CLIENT ACTIONS ---

function mapClientFromDB(c: any): ClientProfile {
    // Supabase automatically handles JSON fields, so we can use them directly
    const rawActiveOrder = c.upcoming_order || {};
    const serviceType = (c.service_type || 'Food') as ServiceType;
    // Hydrate stored payload to UI OrderConfiguration shape (handles legacy and schema-only payloads)
    const activeOrder = fromStoredUpcomingOrder(rawActiveOrder, serviceType) ?? (Object.keys(rawActiveOrder).length > 0 ? rawActiveOrder : undefined);
    const billings = c.billings || null;
    const visits = c.visits || null;

    return {
        id: c.id,
        fullName: c.full_name,
        email: c.email || '',
        address: c.address || '',
        phoneNumber: c.phone_number || '',
        secondaryPhoneNumber: c.secondary_phone_number || null,
        navigatorId: c.navigator_id || '',
        endDate: c.end_date || '',
        screeningTookPlace: c.screening_took_place,
        screeningSigned: c.screening_signed,
        screeningStatus: c.screening_status || 'not_started',
        notes: c.notes || '',
        statusId: c.status_id || '',
        serviceType: c.service_type as any,
        approvedMealsPerWeek: c.approved_meals_per_week,
        parentClientId: c.parent_client_id || null,
        dob: c.dob || null,
        cin: c.cin ?? null,
        authorizedAmount: c.authorized_amount ?? null,
        expirationDate: c.expiration_date || null,
        activeOrder: activeOrder ?? undefined,
        // New fields from dietfantasy
        firstName: c.first_name || null,
        lastName: c.last_name || null,
        apt: c.apt || null,
        city: c.city || null,
        state: c.state || null,
        zip: c.zip || null,
        county: c.county || null,
        // Single Unite Us link: store full URL in case_id_external; normalize when reading (legacy had separate case + client ids)
        clientIdExternal: null,
        caseIdExternal: (c.case_id_external && String(c.case_id_external).startsWith('http'))
            ? c.case_id_external
            : composeUniteUsUrl(c.case_id_external || null, c.client_id_external || null) || c.case_id_external || null,
        medicaid: c.medicaid ?? false,
        paused: c.paused ?? false,
        complex: c.complex ?? false,
        bill: c.bill ?? true,
        delivery: c.delivery ?? true,
        dislikes: c.dislikes || null,
        latitude: c.latitude ?? null,
        longitude: c.longitude ?? null,
        lat: c.lat ?? null,
        lng: c.lng ?? null,
        geocodedAt: c.geocoded_at || null,
        billings: billings,
        visits: visits,
        signToken: c.sign_token || null,
        assignedDriverId: c.assigned_driver_id || null,
        createdAt: c.created_at,
        updatedAt: c.updated_at
    };
}

/** Fetch id->fullName map for given client IDs. Use for parent/dependent lookups instead of loading all clients. */
export async function getClientNamesByIds(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return {};
    try {
        const { data, error } = await supabase
            .from('clients')
            .select('id, full_name')
            .in('id', unique);
        if (error) {
            logQueryError(error, 'clients (getClientNamesByIds)');
            return {};
        }
        const map: Record<string, string> = {};
        for (const row of data || []) {
            map[row.id] = row.full_name ?? '';
        }
        return map;
    } catch (err) {
        console.error('getClientNamesByIds error:', err);
        return {};
    }
}

export async function getClients() {
    try {
        const { data, error } = await supabase.from('clients').select('*');
        if (error) {
            logQueryError(error, 'clients');
            return [];
        }
        // Map clients with error handling for individual clients
        const mapped = (data || []).map((c: any) => {
            try {
                return mapClientFromDB(c);
            } catch (error) {
                console.error(`[getClients] Error mapping client ${c?.id}:`, error);
                return null;
            }
        }).filter((c: any) => c !== null);
        return mapped;
    } catch (error) {
        console.error('[getClients] Error fetching clients:', error);
        if (error instanceof Error) {
            console.error('[getClients] Error details:', { message: error.message, stack: error.stack });
        }
        return [];
    }
}

export async function getClient(id: string) {
    try {
        const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
        if (error || !data) return undefined;
        const client = mapClientFromDB(data);
        
        // Load box orders from client_box_orders table if service type is Boxes
        if (client.serviceType === 'Boxes') {
            try {
                const boxOrdersFromDb = await getClientBoxOrder(id);
                if (boxOrdersFromDb && boxOrdersFromDb.length > 0) {
                    // Convert ClientBoxOrder[] to boxOrders format
                    const boxOrders = boxOrdersFromDb.map(bo => ({
                        boxTypeId: bo.boxTypeId,
                        vendorId: bo.vendorId,
                        quantity: bo.quantity || 1,
                        items: bo.items || {},
                        itemNotes: bo.itemNotes || {},
                        caseId: bo.caseId
                    }));
                    
                    // Merge into client.activeOrder.boxOrders
                    if (!client.activeOrder) {
                        client.activeOrder = { serviceType: 'Boxes' } as any;
                    }
                    const activeOrderAny = client.activeOrder as any;
                    if (!activeOrderAny.boxOrders || activeOrderAny.boxOrders.length === 0) {
                        activeOrderAny.boxOrders = boxOrders;
                    } else {
                        // Merge: use DB as source of truth, but preserve any additional fields from activeOrder
                        activeOrderAny.boxOrders = boxOrders;
                    }
                    
                    console.log('[getClient] Loaded box orders from client_box_orders:', {
                        clientId: id,
                        boxOrdersCount: boxOrders.length
                    });
                }
            } catch (boxOrderError) {
                console.error('[getClient] Error loading box orders:', boxOrderError);
                // Don't fail the whole request if box orders fail to load
            }
        }
        
        return client;
    } catch (error) {
        console.error('Error fetching client:', error);
        return undefined;
    }
}

export async function getPublicClient(id: string) {
    if (!id) return undefined;

    try {
        const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
        if (error || !data) return undefined;
        return mapClientFromDB(data);
    } catch (error) {
        console.error('Error fetching public client:', error);
        return undefined;
    }
}

export async function addClient(data: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'>) {
    // Validate that client name is not empty
    if (!data.fullName || !data.fullName.trim()) {
        throw new Error('Client name is required and cannot be empty');
    }

    const payload: any = {
        full_name: data.fullName.trim(),
        email: data.email,
        address: data.address,
        phone_number: data.phoneNumber,
        secondary_phone_number: data.secondaryPhoneNumber || null,
        navigator_id: data.navigatorId || null,
        end_date: data.endDate || null,
        screening_took_place: data.screeningTookPlace,
        screening_signed: data.screeningSigned,
        notes: data.notes,
        status_id: data.statusId || null,
        service_type: data.serviceType,
        approved_meals_per_week: data.approvedMealsPerWeek || 0,
        authorized_amount: data.authorizedAmount ?? null,
        expiration_date: data.expirationDate || null,
        // New fields from dietfantasy
        first_name: data.firstName || null,
        last_name: data.lastName || null,
        apt: data.apt || null,
        city: data.city || null,
        state: data.state || null,
        zip: data.zip || null,
        county: data.county || null,
        client_id_external: data.clientIdExternal || null,
        case_id_external: data.caseIdExternal || null,
        medicaid: data.medicaid ?? false,
        paused: data.paused ?? false,
        complex: data.complex ?? false,
        bill: data.bill ?? true,
        delivery: data.delivery ?? true,
        dislikes: data.dislikes || null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        geocoded_at: data.geocodedAt || null,
        billings: data.billings ? JSON.stringify(data.billings) : null,
        visits: data.visits ? JSON.stringify(data.visits) : null,
        sign_token: data.signToken || null
    };

    // Save upcoming_order if provided; sanitize to schema-only shape (UPCOMING_ORDER_SCHEMA)
    const serviceTypeForOrder = data.serviceType ?? 'Food';
    if (data.activeOrder !== undefined && data.activeOrder !== null) {
        payload.upcoming_order = toStoredUpcomingOrder(data.activeOrder, serviceTypeForOrder as ServiceType) ?? data.activeOrder;
    } else {
        // Try to load default order template for new clients based on their serviceType
        try {
            const defaultTemplate = await getDefaultOrderTemplate(data.serviceType);
            if (defaultTemplate) {
                payload.upcoming_order = toStoredUpcomingOrder(defaultTemplate, serviceTypeForOrder as ServiceType) ?? defaultTemplate;
            } else {
                payload.upcoming_order = {};
            }
        } catch (error) {
            console.error('Error loading default order template:', error);
            payload.upcoming_order = {};
        }
    }

    const id = randomUUID();
    const insertPayload: any = {
        id,
        full_name: payload.full_name,
        email: payload.email,
        address: payload.address,
        phone_number: payload.phone_number,
        secondary_phone_number: (payload as any).secondary_phone_number || null,
        navigator_id: payload.navigator_id,
        end_date: payload.end_date,
        screening_took_place: payload.screening_took_place,
        screening_signed: payload.screening_signed,
        notes: payload.notes,
        status_id: payload.status_id,
        service_type: payload.service_type,
        approved_meals_per_week: payload.approved_meals_per_week,
        authorized_amount: payload.authorized_amount,
        expiration_date: payload.expiration_date,
        upcoming_order: payload.upcoming_order || {},
        first_name: payload.first_name,
        last_name: payload.last_name,
        apt: payload.apt,
        city: payload.city,
        state: payload.state,
        zip: payload.zip,
        county: payload.county,
        client_id_external: payload.client_id_external,
        case_id_external: payload.case_id_external,
        medicaid: payload.medicaid,
        paused: payload.paused,
        complex: payload.complex,
        bill: payload.bill,
        delivery: payload.delivery,
        dislikes: payload.dislikes,
        latitude: payload.latitude,
        longitude: payload.longitude,
        lat: payload.lat,
        lng: payload.lng,
        geocoded_at: payload.geocoded_at,
        billings: payload.billings,
        visits: payload.visits,
        sign_token: payload.sign_token
    };
    
    const { data: res, error: insertError } = await supabase
        .from('clients')
        .insert([insertPayload])
        .select()
        .single();
    
    if (insertError || !res) {
        throw new Error('Failed to create client: ' + (insertError?.message || 'no data returned'));
    }

    const newClient = mapClientFromDB(res);

    // For Produce serviceType, do NOT create upcoming_orders records - only save to active_orders.
    // For other service types, sync to upcoming_orders if there's an activeOrder with a caseId.
    if (newClient.activeOrder && newClient.activeOrder.caseId && newClient.serviceType !== 'Produce') {
        await syncCurrentOrderToUpcoming(newClient.id, newClient, true);
    }

    revalidatePath('/clients');

    // Trigger local DB sync in background after mutation
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();

    return newClient;
}

export async function addDependent(name: string, parentClientId: string, dob?: string | null, cin?: number | null) {
    if (!name.trim() || !parentClientId) {
        throw new Error('Dependent name and parent client are required');
    }

    // Verify parent client exists and is not itself a dependent
    const parentClient = await getClient(parentClientId);
    if (!parentClient) {
        throw new Error('Parent client not found');
    }
    if (parentClient.parentClientId) {
        throw new Error('Cannot attach dependent to another dependent');
    }

    // Get default approved meals per week from template for Food serviceType
    const defaultApprovedMeals = await getDefaultApprovedMealsPerWeek();

    const payload: any = {
        full_name: name.trim(),
        email: null,
        address: '',
        phone_number: '',
        secondary_phone_number: null,
        navigator_id: null,
        end_date: null,
        screening_took_place: false,
        screening_signed: false,
        notes: '',
        status_id: null,
        service_type: 'Food' as ServiceType, // Default service type
        approved_meals_per_week: defaultApprovedMeals,
        authorized_amount: null,
        expiration_date: null,
        upcoming_order: {},
        parent_client_id: parentClientId,
        dob: dob || null,
        cin: cin ?? null
    };

    const id = randomUUID();
    const insertPayload: any = {
        id,
        full_name: payload.full_name,
        email: payload.email,
        address: payload.address,
        phone_number: payload.phone_number,
        secondary_phone_number: (payload as any).secondary_phone_number || null,
        navigator_id: payload.navigator_id,
        end_date: payload.end_date,
        screening_took_place: payload.screening_took_place,
        screening_signed: payload.screening_signed,
        notes: payload.notes,
        status_id: payload.status_id,
        service_type: payload.service_type,
        approved_meals_per_week: payload.approved_meals_per_week,
        authorized_amount: payload.authorized_amount,
        expiration_date: payload.expiration_date,
        upcoming_order: payload.upcoming_order || {},
        parent_client_id: payload.parent_client_id,
        dob: payload.dob,
        cin: payload.cin
    };
    const { data: res, error: insertError } = await supabase
        .from('clients')
        .insert([insertPayload])
        .select()
        .single();
    
    if (insertError || !res) {
        throw new Error('Failed to create dependent: ' + (insertError?.message || 'no data returned'));
    }

    const newDependent = mapClientFromDB(res);

    revalidatePath('/clients');

    // Trigger local DB sync in background after mutation
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();

    return newDependent;
}

export async function getRegularClients() {
    try {
        // Get all clients that are not dependents (parent_client_id is NULL)
        // If the column doesn't exist yet (migration not run), return all clients
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .is('parent_client_id', null)
            .order('full_name');
        
        if (error) return [];

        return data.map(mapClientFromDB);
    } catch (error: any) {
        // If error (e.g., column doesn't exist), fall back to getting all clients
        // This handles the case where the migration hasn't been run yet
        try {
            const { data: allData } = await supabase
                .from('clients')
                .select('*')
                .order('full_name');
            return (allData || []).map(mapClientFromDB);
        } catch (allError) {
            console.error('Error fetching clients:', allError);
            return [];
        }
    }
}

export async function getDependentsByParentId(parentClientId: string) {
    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('parent_client_id', parentClientId)
            .order('full_name');
        
        if (error) return [];
        if (!data) return [];
        return data.map(mapClientFromDB);
    } catch (e: any) {
        // If the column doesn't exist, return empty array
        if (e.code === 'ER_BAD_FIELD_ERROR' || e.code === '42703') {
            return [];
        }
        console.error("Error in getDependentsByParentId:", e);
        return [];
    }
}

export async function updateClient(id: string, data: Partial<ClientProfile>) {
    const payload: any = {};
    if (data.fullName) payload.full_name = data.fullName;
    if (data.email !== undefined) payload.email = data.email;
    if (data.address !== undefined) payload.address = data.address;
    if (data.phoneNumber !== undefined) payload.phone_number = data.phoneNumber;
    if (data.secondaryPhoneNumber !== undefined) payload.secondary_phone_number = data.secondaryPhoneNumber || null;
    if (data.navigatorId !== undefined) payload.navigator_id = data.navigatorId || null;
    if (data.endDate !== undefined) payload.end_date = data.endDate || null;
    if (data.screeningTookPlace !== undefined) payload.screening_took_place = data.screeningTookPlace;
    if (data.screeningSigned !== undefined) payload.screening_signed = data.screeningSigned;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.statusId !== undefined) payload.status_id = data.statusId || null;
    if (data.serviceType) payload.service_type = data.serviceType;
    if (data.approvedMealsPerWeek !== undefined) payload.approved_meals_per_week = data.approvedMealsPerWeek;
    if (data.parentClientId !== undefined) payload.parent_client_id = data.parentClientId || null;
    if (data.dob !== undefined) payload.dob = data.dob || null;
    if (data.cin !== undefined) payload.cin = data.cin ?? null;
    if (data.authorizedAmount !== undefined) payload.authorized_amount = data.authorizedAmount ?? null;
    if (data.expirationDate !== undefined) payload.expiration_date = data.expirationDate || null;
    // Sanitize upcoming_order to schema-only fields before persisting (UPCOMING_ORDER_SCHEMA)
    if (data.activeOrder !== undefined) {
        const serviceTypeForOrder = data.serviceType ?? (await getClient(id))?.serviceType ?? 'Food';
        payload.upcoming_order = data.activeOrder == null
            ? null
            : (toStoredUpcomingOrder(data.activeOrder, serviceTypeForOrder as ServiceType) ?? null);
    }
    // New fields from dietfantasy
    if (data.firstName !== undefined) payload.first_name = data.firstName || null;
    if (data.lastName !== undefined) payload.last_name = data.lastName || null;
    if (data.apt !== undefined) payload.apt = data.apt || null;
    if (data.city !== undefined) payload.city = data.city || null;
    if (data.state !== undefined) payload.state = data.state || null;
    if (data.zip !== undefined) payload.zip = data.zip || null;
    if (data.county !== undefined) payload.county = data.county || null;
    if (data.clientIdExternal !== undefined) payload.client_id_external = data.clientIdExternal || null;
    if (data.caseIdExternal !== undefined) payload.case_id_external = data.caseIdExternal || null;
    if (data.medicaid !== undefined) payload.medicaid = data.medicaid;
    if (data.paused !== undefined) payload.paused = data.paused;
    if (data.complex !== undefined) payload.complex = data.complex;
    if (data.bill !== undefined) payload.bill = data.bill;
    if (data.delivery !== undefined) payload.delivery = data.delivery;
    if (data.dislikes !== undefined) payload.dislikes = data.dislikes || null;
    if (data.latitude !== undefined) payload.latitude = data.latitude ?? null;
    if (data.longitude !== undefined) payload.longitude = data.longitude ?? null;
    if (data.lat !== undefined) payload.lat = data.lat ?? null;
    if (data.lng !== undefined) payload.lng = data.lng ?? null;
    if (data.geocodedAt !== undefined) payload.geocoded_at = data.geocodedAt || null;
    if (data.billings !== undefined) payload.billings = data.billings ? JSON.stringify(data.billings) : null;
    if (data.visits !== undefined) payload.visits = data.visits ? JSON.stringify(data.visits) : null;
    if (data.signToken !== undefined) payload.sign_token = data.signToken || null;

    payload.updated_at = new Date().toISOString();

    // Convert camelCase to snake_case for database
    const dbPayload: any = {};
    for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined) {
            // Convert camelCase to snake_case
            const dbKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            // JSON fields are already handled by Supabase automatically
            dbPayload[dbKey] = value;
        }
    }
    
    if (Object.keys(dbPayload).length > 0) {
        const { error } = await supabase
            .from('clients')
            .update(dbPayload)
            .eq('id', id);
        handleError(error, 'updateClient');
    }

    // IMPORTANT: For existing clients with Food service, updates must be shown in active_orders
    // The active_order field (active_orders) is already updated above (line 1702) when data.activeOrder is provided
    // If activeOrder was updated, also sync to upcoming_orders for backward compatibility.
    // CRITICAL: Do NOT sync Produce to upcoming_orders (Produce uses active_orders only).
    if (data.activeOrder) {
        console.log('[updateClient] activeOrder provided, syncing to upcoming_orders:', {
            clientId: id,
            serviceType: data.activeOrder.serviceType,
            hasVendorSelections: !!(data.activeOrder as any).vendorSelections,
            vendorSelectionsCount: (data.activeOrder as any).vendorSelections?.length || 0,
            hasDeliveryDayOrders: !!(data.activeOrder as any).deliveryDayOrders,
            deliveryDayOrdersKeys: (data.activeOrder as any).deliveryDayOrders ? Object.keys((data.activeOrder as any).deliveryDayOrders) : []
        });
        const updatedClient = await getClient(id);
        if (updatedClient) {
            updatedClient.activeOrder = data.activeOrder;
            const serviceType = updatedClient.serviceType ?? data.serviceType;
            if (serviceType !== 'Produce') {
                await syncCurrentOrderToUpcoming(id, updatedClient, true);
                console.log('[updateClient] Successfully synced order to upcoming_orders');
            } else {
                console.log('[updateClient] Skipping upcoming_orders sync for Produce (active_orders only)');
            }
        } else {
            console.error('[updateClient] Failed to fetch updated client after update');
        }
    } else {
        // Trigger local DB sync in background even if activeOrder wasn't updated
        // (other changes might affect orders indirectly)
        const { triggerSyncInBackground } = await import('./local-db');
        triggerSyncInBackground();
    }

    revalidatePath('/clients');
    revalidatePath(`/clients/${id}`);
}

export async function deleteClient(id: string) {
    // First, get all dependents of this client (if it's a parent client)
    const { data: dependents } = await supabase
        .from('clients')
        .select('id')
        .eq('parent_client_id', id);

    // Delete all dependents first (cascade delete)
    // Dependents cannot have their own dependents (enforced in addDependent),
    // so we can safely delete them directly
    if (dependents && dependents.length > 0) {
        const dependentIds = dependents.map(d => d.id);

        // Delete upcoming orders for all dependents
        const { error: depUpcomingErr } = await supabase
            .from('upcoming_orders')
            .delete()
            .in('client_id', dependentIds);
        handleError(depUpcomingErr, 'deleteClient dependents upcoming_orders');

        // Delete meal planner data for dependents
        const { data: depMpo } = await supabase.from('meal_planner_orders').select('id').in('client_id', dependentIds);
        const depMpoIds = (depMpo ?? []).map((r: { id: string }) => r.id);
        if (depMpoIds.length > 0) {
            const { error: em } = await supabase.from('meal_planner_order_items').delete().in('meal_planner_order_id', depMpoIds);
            handleError(em, 'deleteClient dependents meal_planner_order_items');
            const { error: em2 } = await supabase.from('meal_planner_orders').delete().in('client_id', dependentIds);
            handleError(em2, 'deleteClient dependents meal_planner_orders');
        }

        // Fetch all order IDs for dependents and delete child rows then orders
        const { data: depOrders } = await supabase
            .from('orders')
            .select('id')
            .in('client_id', dependentIds);
        const depOrderIds = (depOrders ?? []).map((o: { id: string }) => o.id);
        if (depOrderIds.length > 0) {
            const { data: depSelections } = await supabase
                .from('order_vendor_selections')
                .select('id')
                .in('order_id', depOrderIds);
            const depSelectionIds = (depSelections ?? []).map((s: { id: string }) => s.id);
            if (depSelectionIds.length > 0) {
                const { error: e } = await supabase.from('order_items').delete().in('vendor_selection_id', depSelectionIds);
                handleError(e, 'deleteClient dependents order_items');
            }
            const { error: e2 } = await supabase.from('order_box_selections').delete().in('order_id', depOrderIds);
            handleError(e2, 'deleteClient dependents order_box_selections');
            const { error: e3 } = await supabase.from('order_vendor_selections').delete().in('order_id', depOrderIds);
            handleError(e3, 'deleteClient dependents order_vendor_selections');
        }
        const { error: depBillingErr } = await supabase.from('billing_records').delete().in('client_id', dependentIds);
        handleError(depBillingErr, 'deleteClient dependents billing_records');
        const { error: depOrdersErr } = await supabase.from('orders').delete().in('client_id', dependentIds);
        handleError(depOrdersErr, 'deleteClient dependents orders');

        // Delete other client-referencing data for dependents
        const { error: e4 } = await supabase.from('delivery_history').delete().in('client_id', dependentIds);
        handleError(e4, 'deleteClient dependents delivery_history');
        const { error: e5 } = await supabase.from('order_history').delete().in('client_id', dependentIds);
        handleError(e5, 'deleteClient dependents order_history');
        const { error: e6 } = await supabase.from('navigator_logs').delete().in('client_id', dependentIds);
        handleError(e6, 'deleteClient dependents navigator_logs');
        const { error: e7 } = await supabase.from('signatures').delete().in('client_id', dependentIds);
        handleError(e7, 'deleteClient dependents signatures');
        const { error: e8 } = await supabase.from('schedules').delete().in('client_id', dependentIds);
        handleError(e8, 'deleteClient dependents schedules');
        const { error: e9 } = await supabase.from('stops').delete().in('client_id', dependentIds);
        handleError(e9, 'deleteClient dependents stops');

        const { error: e10 } = await supabase.from('client_box_orders').delete().in('client_id', dependentIds);
        handleError(e10, 'deleteClient dependents client_box_orders');

        // Delete form submissions for all dependents
        const { error: depFormsErr } = await supabase
            .from('form_submissions')
            .delete()
            .in('client_id', dependentIds);
        handleError(depFormsErr, 'deleteClient dependents form_submissions');

        // Delete all dependents
        const { error: depClientsErr } = await supabase
            .from('clients')
            .delete()
            .in('id', dependentIds);
        handleError(depClientsErr, 'deleteClient dependents');
    }

    // Delete all upcoming orders for this client
    const { error: upcomingErr } = await supabase
        .from('upcoming_orders')
        .delete()
        .eq('client_id', id);
    handleError(upcomingErr, 'deleteClient upcoming_orders');

    // Delete meal planner data for this client (items first, then orders)
    const { data: mpoRows } = await supabase.from('meal_planner_orders').select('id').eq('client_id', id);
    const mpoIds = (mpoRows ?? []).map((r: { id: string }) => r.id);
    if (mpoIds.length > 0) {
        const { error: mpoItemsErr } = await supabase.from('meal_planner_order_items').delete().in('meal_planner_order_id', mpoIds);
        handleError(mpoItemsErr, 'deleteClient meal_planner_order_items');
        const { error: mpoErr } = await supabase.from('meal_planner_orders').delete().eq('client_id', id);
        handleError(mpoErr, 'deleteClient meal_planner_orders');
    }

    // Fetch all order IDs for this client (all statuses) so we can delete child rows and avoid FK blocks
    const { data: clientOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('client_id', id);
    const orderIds = (clientOrders ?? []).map((o: { id: string }) => o.id);

    if (orderIds.length > 0) {
        // Get order_vendor_selections for these orders (order_items reference these)
        const { data: selections } = await supabase
            .from('order_vendor_selections')
            .select('id')
            .in('order_id', orderIds);
        const selectionIds = (selections ?? []).map((s: { id: string }) => s.id);
        if (selectionIds.length > 0) {
            const { error: orderItemsErr } = await supabase
                .from('order_items')
                .delete()
                .in('vendor_selection_id', selectionIds);
            handleError(orderItemsErr, 'deleteClient order_items');
        }
        const { error: boxSelErr } = await supabase
            .from('order_box_selections')
            .delete()
            .in('order_id', orderIds);
        handleError(boxSelErr, 'deleteClient order_box_selections');
        const { error: vendorSelErr } = await supabase
            .from('order_vendor_selections')
            .delete()
            .in('order_id', orderIds);
        handleError(vendorSelErr, 'deleteClient order_vendor_selections');
    }

    // Delete billing_records that reference this client (or their orders)
    const { error: billingErr } = await supabase
        .from('billing_records')
        .delete()
        .eq('client_id', id);
    handleError(billingErr, 'deleteClient billing_records');

    // Delete all orders for this client (all statuses) so client row can be removed
    const { error: ordersErr } = await supabase
        .from('orders')
        .delete()
        .eq('client_id', id);
    handleError(ordersErr, 'deleteClient orders');

    // Delete other client-referencing tables so FK does not block client delete
    const { error: deliveryHistErr } = await supabase
        .from('delivery_history')
        .delete()
        .eq('client_id', id);
    handleError(deliveryHistErr, 'deleteClient delivery_history');

    const { error: orderHistErr } = await supabase
        .from('order_history')
        .delete()
        .eq('client_id', id);
    handleError(orderHistErr, 'deleteClient order_history');

    const { error: navLogsErr } = await supabase
        .from('navigator_logs')
        .delete()
        .eq('client_id', id);
    handleError(navLogsErr, 'deleteClient navigator_logs');

    const { error: sigErr } = await supabase
        .from('signatures')
        .delete()
        .eq('client_id', id);
    handleError(sigErr, 'deleteClient signatures');

    const { error: schedErr } = await supabase
        .from('schedules')
        .delete()
        .eq('client_id', id);
    handleError(schedErr, 'deleteClient schedules');

    const { error: stopsErr } = await supabase
        .from('stops')
        .delete()
        .eq('client_id', id);
    handleError(stopsErr, 'deleteClient stops');

    const { error: boxOrdersErr } = await supabase
        .from('client_box_orders')
        .delete()
        .eq('client_id', id);
    handleError(boxOrdersErr, 'deleteClient client_box_orders');

    // Delete form submissions for this client
    const { error: formsErr } = await supabase
        .from('form_submissions')
        .delete()
        .eq('client_id', id);
    handleError(formsErr, 'deleteClient form_submissions');

    // Delete the client
    // Note: Client IDs are generated identifiers (e.g. CLIENT-XXX) which CAN be reused after deletion.
    // We must ensure the local cache is synced to remove any stale data associated with this ID.
    const { error: clientErr } = await supabase
        .from('clients')
        .delete()
        .eq('id', id);
    handleError(clientErr, 'deleteClient clients');
    revalidatePath('/clients');

    // Trigger local DB sync in background to remove deleted client data from cache
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();
}

// --- DELIVERY ACTIONS ---

export async function generateDeliveriesForDate(dateStr: string) {
    // Fetch required data
    const { data: clients } = await supabase.from('clients').select('*');
    const { data: vendors } = await supabase.from('vendors').select('*');
    const { data: boxTypes } = await supabase.from('box_types').select('*');
    const { data: existingHistory } = await supabase
        .from('delivery_history')
        .select('*')
        .eq('delivery_date', dateStr);

    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    let count = 0;

    if (!clients || !vendors) return 0;

    for (const c of clients) {
        const activeOrder = typeof c.upcoming_order === 'string' 
            ? JSON.parse(c.upcoming_order) 
            : (c.upcoming_order || {});
        
        if (!activeOrder || !activeOrder.vendorId) continue;

        const vendor = vendors.find((v: any) => v.id === activeOrder.vendorId);
        if (!vendor) continue;

        // Check day
        const deliveryDays = typeof vendor.delivery_days === 'string'
            ? JSON.parse(vendor.delivery_days)
            : (vendor.delivery_days || []);
        if (deliveryDays.includes(dayName)) {
            let summary = '';
            if (c.service_type === 'Food') {
                summary = `Food Order: ${Object.keys(activeOrder.menuSelections || {}).length} items`;
            } else if (c.service_type === 'Boxes') {
                const box = boxTypes?.find((b: any) => b.id === activeOrder.boxTypeId);
                summary = `${box?.name || 'Box'} x${activeOrder.boxQuantity}`;
            }

            const historyId = randomUUID();
            try {
                await supabase
                    .from('delivery_history')
                    .insert([{
                        id: historyId,
                        client_id: c.id,
                        vendor_id: vendor.id,
                        service_type: c.service_type,
                        delivery_date: dateStr,
                        items_summary: summary,
                        proof_of_delivery_image: ''
                    }]);
                count++;
            } catch (error) {
                console.error('Error inserting delivery history:', error);
            }
        }
    }

    revalidatePath('/clients');
    return count;
}

export async function getClientHistory(clientId: string) {
    try {
        const { data, error } = await supabase
            .from('delivery_history')
            .select('*')
            .eq('client_id', clientId)
            .order('delivery_date', { ascending: false });
        
        if (error) return [];

        return (data || []).map((d: any) => ({
            id: d.id,
            clientId: d.client_id,
            vendorId: d.vendor_id,
            serviceType: d.service_type,
            deliveryDate: d.delivery_date,
            itemsSummary: d.items_summary,
            proofOfDeliveryImage: d.proof_of_delivery_image,
            createdAt: d.created_at
        }));
    } catch (error) {
        console.error('Error fetching client history:', error);
        return [];
    }
}

export async function updateDeliveryProof(id: string, proofUrl: string) {
    try {
        await supabase
            .from('delivery_history')
            .update({ proof_of_delivery_image: proofUrl })
            .eq('id', id);
        revalidatePath('/clients');
    } catch (error) {
        console.error('Error updating delivery proof:', error);
        throw error;
    }
}

export async function recordClientChange(clientId: string, summary: string, who?: string) {
    // Get current user from session if who is not provided
    let userName = who;
    if (!userName || userName === 'Admin') {
        const session = await getSession();
        userName = session?.name || 'Admin';
    }

    try {
        const historyId = randomUUID();
        await supabase
            .from('order_history')
            .insert([{
                id: historyId,
                client_id: clientId,
                who: userName,
                summary,
                timestamp: new Date().toISOString()
            }]);
    } catch (error) {
        console.error('Error recording audit log:', error);
    }
}

export async function getOrderHistory(clientId: string, caseId?: string | null) {
    if (!clientId) return [];

    try {
        // Fetch all orders for this client (not just those with delivery proof)
        // If caseId is provided, filter by both client_id and case_id (for Boxes service type)
        let query = supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId);
        
        if (caseId) {
            query = query.eq('case_id', caseId);
        }
        
        const { data } = await query
            .order('created_at', { ascending: false })
            .limit(50); // Limit to most recent 50 orders

        if (!data || data.length === 0) return [];

        // Fetch reference data once
        const [menuItems, vendors, boxTypes] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes()
        ]);

        const orders = await Promise.all(
            data.map(async (orderData: any) => {
                let orderDetails: any = undefined;

                if (orderData.service_type === 'Food') {
                    const { data: vendorSelections } = await supabase
                        .from('order_vendor_selections')
                        .select('*')
                        .eq('order_id', orderData.id);

                    if (vendorSelections && vendorSelections.length > 0) {
                        const vendorSelectionsWithItems = await Promise.all(
                            vendorSelections.map(async (vs: any) => {
                                const { data: items } = await supabase
                                    .from('order_items')
                                    .select('*')
                                    .eq('vendor_selection_id', vs.id);

                                const vendor = vendors.find(v => v.id === vs.vendor_id);
                                const itemsWithDetails = (items || []).map((item: any) => {
                                    // Skip total items (menu_item_id is null)
                                    if (item.menu_item_id === null) {
                                        return null;
                                    }
                                    const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                    const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value || '0');
                                    const quantity = item.quantity;
                                    const itemTotal = itemPrice * quantity;

                                    return {
                                        id: item.id,
                                        menuItemId: item.menu_item_id,
                                        menuItemName: menuItem?.name || 'Unknown Item',
                                        quantity: quantity,
                                        unitValue: itemPrice,
                                        totalValue: itemTotal
                                    };
                                }).filter(item => item !== null);

                                return {
                                    vendorId: vs.vendor_id,
                                    vendorName: vendor?.name || 'Unknown Vendor',
                                    items: itemsWithDetails
                                };
                            })
                        );

                        // Calculate total by summing all items from all vendor selections
                        let calculatedTotal = 0;
                        for (const vs of vendorSelectionsWithItems) {
                            for (const item of vs.items) {
                                calculatedTotal += item.totalValue;
                            }
                        }

                        orderDetails = {
                            serviceType: orderData.service_type,
                            vendorSelections: vendorSelectionsWithItems,
                            totalItems: orderData.total_items,
                            totalValue: calculatedTotal
                        };
                    } else {
                        // No vendor selections, create empty structure
                        orderDetails = {
                            serviceType: orderData.service_type,
                            vendorSelections: [],
                            totalItems: orderData.total_items || 0,
                            totalValue: parseFloat(orderData.total_value || 0)
                        };
                    }
                } else if (orderData.service_type === 'Boxes') {
                    const { data: boxSelectionData } = await supabase
                        .from('order_box_selections')
                        .select('*')
                        .eq('order_id', orderData.id)
                        .maybeSingle();
                    const boxSelection = boxSelectionData || null;

                    if (boxSelection) {
                        const vendor = vendors.find(v => v.id === boxSelection.vendor_id);
                        const boxType = boxTypes.find(bt => bt.id === boxSelection.box_type_id);
                        const boxTotalValue = boxSelection.total_value
                            ? parseFloat(boxSelection.total_value)
                            : parseFloat(orderData.total_value || 0);

                        // Parse items from JSON if available
                        let items: any = {};
                        try {
                            if (boxSelection.items && typeof boxSelection.items === 'string') {
                                items = JSON.parse(boxSelection.items);
                            } else if (boxSelection.items && typeof boxSelection.items === 'object') {
                                items = boxSelection.items;
                            }
                        } catch (e) {
                            console.error('Error parsing box items:', e);
                        }

                        orderDetails = {
                            serviceType: orderData.service_type,
                            vendorId: boxSelection.vendor_id,
                            vendorName: vendor?.name || 'Unknown Vendor',
                            boxTypeId: boxSelection.box_type_id,
                            boxTypeName: boxType?.name || 'Unknown Box Type',
                            boxQuantity: boxSelection.quantity,
                            items: items,
                            totalValue: boxTotalValue
                        };
                    } else {
                        orderDetails = {
                            serviceType: orderData.service_type,
                            totalValue: parseFloat(orderData.total_value || 0)
                        };
                    }
                } else {
                    orderDetails = {
                        serviceType: orderData.service_type,
                        totalValue: parseFloat(orderData.total_value || 0),
                        notes: orderData.notes
                    };
                }

                return {
                    id: orderData.id,
                    clientId: orderData.client_id,
                    serviceType: orderData.service_type,
                    caseId: orderData.case_id,
                    status: orderData.status,
                    scheduledDeliveryDate: orderData.scheduled_delivery_date,
                    actualDeliveryDate: orderData.actual_delivery_date,
                    deliveryProofUrl: orderData.proof_of_delivery_url || orderData.proof_of_delivery_image || '',
                    totalValue: parseFloat(orderData.total_value || 0),
                    totalItems: orderData.total_items,
                    notes: orderData.notes,
                    createdAt: orderData.created_at,
                    lastUpdated: orderData.updated_at || orderData.last_updated,
                    updatedBy: orderData.updated_by,
                    orderNumber: orderData.order_number,
                    orderDetails: orderDetails,
                    // Include vendorSelections and items at top level for easier access
                    vendorSelections: orderDetails.vendorSelections,
                    vendorId: orderDetails.vendorId,
                    boxTypeId: orderDetails.boxTypeId,
                    boxQuantity: orderDetails.boxQuantity,
                    items: orderDetails.items
                };
            })
        );

        return orders;
    } catch (error) {
        console.error('Error fetching order history:', error);
        return [];
    }
}

export async function getCompletedOrdersWithDeliveryProof(clientId: string) {
    if (!clientId) return [];

    try {
        const { data } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .not('proof_of_delivery_url', 'is', null)
            .order('created_at', { ascending: false });

        if (!data || data.length === 0) return [];

        // Fetch reference data once
        const [menuItems, vendors, boxTypes] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes()
        ]);

        const orders = await Promise.all(
            data.map(async (orderData: any) => {
                let orderDetails: any = undefined;

                if (orderData.service_type === 'Food') {
                    console.log(`[getCompletedOrdersWithDeliveryProof] Processing Food order ${orderData.id}`);
                    const { data: vendorSelections } = await supabase
                        .from('order_vendor_selections')
                        .select('*')
                        .eq('order_id', orderData.id);

                    console.log(`[getCompletedOrdersWithDeliveryProof] Found ${vendorSelections?.length || 0} vendor selections for order ${orderData.id}`);

                    if (vendorSelections && vendorSelections.length > 0) {
                        const vendorSelectionsWithItems = await Promise.all(
                            vendorSelections.map(async (vs: any) => {
                                console.log(`[getCompletedOrdersWithDeliveryProof] Processing vendor selection ${vs.id} for vendor ${vs.vendor_id}`);
                                const { data: items } = await supabase
                                    .from('order_items')
                                    .select('*')
                                    .eq('vendor_selection_id', vs.id);

                                console.log(`[getCompletedOrdersWithDeliveryProof] Found ${items?.length || 0} items for vendor selection ${vs.id}`, items);

                            const vendor = vendors.find(v => v.id === vs.vendor_id);
                            const itemsWithDetails = (items || []).map((item: any) => {
                                // Skip total items (menu_item_id is null)
                                if (item.menu_item_id === null) {
                                    console.log(`[getCompletedOrdersWithDeliveryProof] Skipping total item with null menu_item_id:`, item);
                                    return null;
                                }
                                const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                console.log(`[getCompletedOrdersWithDeliveryProof] Processing item:`, {
                                    itemId: item.id,
                                    menuItemId: item.menu_item_id,
                                    menuItemName: menuItem?.name,
                                    storedUnitValue: item.unit_value,
                                    storedTotalValue: item.total_value,
                                    quantity: item.quantity,
                                    menuItemPriceEach: menuItem?.priceEach,
                                    menuItemValue: menuItem?.value
                                });

                                const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value || '0');
                                const quantity = item.quantity;
                                // Always recalculate from price and quantity, don't trust stored total_value
                                const itemTotal = itemPrice * quantity;

                                console.log(`[getCompletedOrdersWithDeliveryProof] Calculated item total: ${itemPrice} * ${quantity} = ${itemTotal}`);

                                return {
                                    id: item.id,
                                    menuItemId: item.menu_item_id,
                                    menuItemName: menuItem?.name || 'Unknown Item',
                                    quantity: quantity,
                                    unitValue: itemPrice,
                                    totalValue: itemTotal
                                };
                            }).filter(item => item !== null);

                            console.log(`[getCompletedOrdersWithDeliveryProof] Vendor ${vs.vendor_id} has ${itemsWithDetails.length} valid items`);

                            return {
                                vendorId: vs.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                items: itemsWithDetails
                            };
                        })
                    );

                    // Calculate total by summing all items from all vendor selections
                    let calculatedTotal = 0;
                    console.log(`[getCompletedOrdersWithDeliveryProof] Starting total calculation across ${vendorSelectionsWithItems.length} vendor selections`);
                    for (const vs of vendorSelectionsWithItems) {
                        console.log(`[getCompletedOrdersWithDeliveryProof] Processing vendor ${vs.vendorName} with ${vs.items.length} items`);
                        for (const item of vs.items) {
                            console.log(`[getCompletedOrdersWithDeliveryProof] Adding item ${item.menuItemName}: ${item.totalValue} to total (current total: ${calculatedTotal})`);
                            calculatedTotal += item.totalValue;
                            console.log(`[getCompletedOrdersWithDeliveryProof] New total: ${calculatedTotal}`);
                        }
                    }

                    console.log(`[getCompletedOrdersWithDeliveryProof] Final calculated total: ${calculatedTotal}`);
                    console.log(`[getCompletedOrdersWithDeliveryProof] Stored order total_value from DB: ${orderData.total_value}`);

                    // Always use calculated total (sum of all items)
                    const finalTotal = calculatedTotal;
                    console.log(`[getCompletedOrdersWithDeliveryProof] Using finalTotal: ${finalTotal}`);

                    orderDetails = {
                        serviceType: orderData.service_type,
                        vendorSelections: vendorSelectionsWithItems,
                        totalItems: orderData.total_items,
                        totalValue: finalTotal
                    };
                    console.log(`[getCompletedOrdersWithDeliveryProof] Set orderDetails.totalValue to: ${finalTotal}`);
                }
            } else if (orderData.service_type === 'Boxes') {
                const { data: boxSelectionData } = await supabase
                    .from('order_box_selections')
                    .select('*')
                    .eq('order_id', orderData.id)
                    .maybeSingle();
                const boxSelection = boxSelectionData || null;

                if (boxSelection) {
                    const vendor = vendors.find(v => v.id === boxSelection.vendor_id);
                    const boxType = boxTypes.find(bt => bt.id === boxSelection.box_type_id);
                    const boxTotalValue = boxSelection.total_value
                        ? parseFloat(boxSelection.total_value)
                        : parseFloat(orderData.total_value || 0);

                    orderDetails = {
                        serviceType: orderData.service_type,
                        vendorId: boxSelection.vendor_id,
                        vendorName: vendor?.name || 'Unknown Vendor',
                        boxTypeId: boxSelection.box_type_id,
                        boxTypeName: boxType?.name || 'Unknown Box Type',
                        boxQuantity: boxSelection.quantity,
                        totalValue: boxTotalValue
                    };
                }
            } else {
                orderDetails = {
                    serviceType: orderData.service_type,
                    totalValue: parseFloat(orderData.total_value || 0),
                    notes: orderData.notes
                };
            }

            const returnValue = {
                id: orderData.id,
                clientId: orderData.client_id,
                serviceType: orderData.service_type,
                caseId: orderData.case_id,
                status: orderData.status,
                scheduledDeliveryDate: orderData.scheduled_delivery_date,
                actualDeliveryDate: orderData.actual_delivery_date,
                deliveryProofUrl: orderData.proof_of_delivery_image || '',
                totalValue: parseFloat(orderData.total_value || 0),
                totalItems: orderData.total_items,
                notes: orderData.notes,
                createdAt: orderData.created_at,
                lastUpdated: orderData.updated_at,
                updatedBy: orderData.updated_by,
                orderNumber: orderData.order_number,
                orderDetails: orderDetails
            };

            console.log(`[getCompletedOrdersWithDeliveryProof] Returning order ${orderData.id}:`, {
                totalValue: returnValue.totalValue,
                orderDetailsTotalValue: returnValue.orderDetails?.totalValue,
                orderDetails: returnValue.orderDetails
            });

            return returnValue;
        })
    );

    return orders;
    } catch (error) {
        console.error('Error fetching completed orders with delivery proof:', error);
        return [];
    }
}

/** Orders that are marked complete (status completed/billing_pending) or have proof_of_delivery_url. For /clients completed-deliveries tab. */
export type CompletedOrProofOrderRow = {
    id: string;
    clientId: string;
    clientName: string;
    serviceType: string;
    status: string;
    scheduledDeliveryDate: string | null;
    actualDeliveryDate: string | null;
    proofOfDeliveryUrl: string | null;
    orderNumber: number | null;
    totalValue: number | null;
    createdAt: string;
};

export async function getAllCompletedOrWithProofOrders(): Promise<CompletedOrProofOrderRow[]> {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select('id, client_id, service_type, status, scheduled_delivery_date, actual_delivery_date, proof_of_delivery_url, order_number, total_value, created_at')
            .or('status.eq.completed,status.eq.billing_pending,proof_of_delivery_url.not.is.null')
            .order('created_at', { ascending: false });

        if (error) {
            logQueryError(error, 'orders (getAllCompletedOrWithProofOrders)');
            return [];
        }
        if (!data?.length) return [];

        const clientIds = [...new Set((data as any[]).map((r: any) => r.client_id).filter(Boolean))];
        const namesMap = await getClientNamesByIds(clientIds);

        return (data as any[]).map((row: any) => ({
            id: row.id,
            clientId: row.client_id,
            clientName: namesMap[row.client_id] ?? 'Unknown',
            serviceType: row.service_type ?? '',
            status: row.status ?? '',
            scheduledDeliveryDate: row.scheduled_delivery_date ?? null,
            actualDeliveryDate: row.actual_delivery_date ?? null,
            proofOfDeliveryUrl: row.proof_of_delivery_url ?? null,
            orderNumber: row.order_number ?? null,
            totalValue: row.total_value != null ? parseFloat(row.total_value) : null,
            createdAt: row.created_at ?? '',
        }));
    } catch (err) {
        console.error('getAllCompletedOrWithProofOrders error:', err);
        return [];
    }
}

export async function getBillingHistory(clientId: string) {
    if (!clientId) return [];

    try {
        const { data: billingRecords } = await supabase
            .from('billing_records')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        // Fetch reference data once for all orders
        const [menuItems, vendors, boxTypes] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes()
        ]);

        // Fetch client name
        const { data: clientData } = await supabase
            .from('clients')
            .select('id, full_name')
            .eq('id', clientId)
            .single();

        // Fetch order details separately if order_id exists
        const recordsWithOrderData = await Promise.all(
            (billingRecords || []).map(async (d: any) => {
                let deliveryDate: string | undefined = undefined;
                let orderDetails: any = undefined;

                if (d.order_id) {
                    const { data: orderData } = await supabase
                        .from('orders')
                        .select('*')
                        .eq('id', d.order_id)
                        .single();

                    if (orderData) {
                        // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                        deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;

                        // Build order details based on service type
                        if (orderData.service_type === 'Food') {
                            console.log(`[getBillingHistory] Processing Food order ${orderData.id}`);
                            // Fetch vendor selections and items
                            const { data: vendorSelections } = await supabase
                                .from('order_vendor_selections')
                                .select('*')
                                .eq('order_id', d.order_id);

                            console.log(`[getBillingHistory] Found ${vendorSelections?.length || 0} vendor selections for order ${orderData.id}`);

                            if (vendorSelections && vendorSelections.length > 0) {
                                const vendorSelectionsWithItems = await Promise.all(
                                    vendorSelections.map(async (vs: any) => {
                                        console.log(`[getBillingHistory] Processing vendor selection ${vs.id} for vendor ${vs.vendor_id}`);
                                        const { data: items } = await supabase
                                            .from('order_items')
                                            .select('*')
                                            .eq('vendor_selection_id', vs.id);

                                    console.log(`[getBillingHistory] Found ${items?.length || 0} items for vendor selection ${vs.id}`, items);

                                    const vendor = vendors.find(v => v.id === vs.vendor_id);
                                    const itemsWithDetails = (items || []).map((item: any) => {
                                        // Skip total items (menu_item_id is null)
                                        if (item.menu_item_id === null) {
                                            console.log(`[getBillingHistory] Skipping total item with null menu_item_id:`, item);
                                            return null;
                                        }
                                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                        console.log(`[getBillingHistory] Processing item:`, {
                                            itemId: item.id,
                                            menuItemId: item.menu_item_id,
                                            menuItemName: menuItem?.name,
                                            storedUnitValue: item.unit_value,
                                            storedTotalValue: item.total_value,
                                            quantity: item.quantity,
                                            menuItemPriceEach: menuItem?.priceEach,
                                            menuItemValue: menuItem?.value
                                        });

                                        // Use priceEach if available, otherwise fall back to stored unit_value
                                        const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value || '0');
                                        const quantity = item.quantity;
                                        // Always recalculate from price and quantity, don't trust stored total_value
                                        const itemTotal = itemPrice * quantity;

                                        console.log(`[getBillingHistory] Calculated item total: ${itemPrice} * ${quantity} = ${itemTotal}`);

                                        return {
                                            id: item.id,
                                            menuItemId: item.menu_item_id,
                                            menuItemName: menuItem?.name || 'Unknown Item',
                                            quantity: quantity,
                                            unitValue: itemPrice,
                                            totalValue: itemTotal
                                        };
                                    }).filter(item => item !== null);

                                    console.log(`[getBillingHistory] Vendor ${vs.vendor_id} has ${itemsWithDetails.length} valid items`);

                                    return {
                                        vendorId: vs.vendor_id,
                                        vendorName: vendor?.name || 'Unknown Vendor',
                                        items: itemsWithDetails
                                    };
                                })
                            );

                            // Calculate total by summing all items from all vendor selections
                            let calculatedTotal = 0;
                            console.log(`[getBillingHistory] Starting total calculation across ${vendorSelectionsWithItems.length} vendor selections`);
                            for (const vs of vendorSelectionsWithItems) {
                                console.log(`[getBillingHistory] Processing vendor ${vs.vendorName} with ${vs.items.length} items`);
                                for (const item of vs.items) {
                                    console.log(`[getBillingHistory] Adding item ${item.menuItemName}: ${item.totalValue} to total (current total: ${calculatedTotal})`);
                                    calculatedTotal += item.totalValue;
                                    console.log(`[getBillingHistory] New total: ${calculatedTotal}`);
                                }
                            }

                            console.log(`[getBillingHistory] Final calculated total: ${calculatedTotal}`);
                            console.log(`[getBillingHistory] Stored order total_value from DB: ${orderData.total_value}`);

                            // Always use calculated total (sum of all items)
                            const finalTotal = calculatedTotal;
                            console.log(`[getBillingHistory] Using finalTotal: ${finalTotal}`);

                            orderDetails = {
                                serviceType: orderData.service_type,
                                vendorSelections: vendorSelectionsWithItems,
                                totalItems: orderData.total_items,
                                totalValue: finalTotal
                            };
                            console.log(`[getBillingHistory] Set orderDetails.totalValue to: ${finalTotal}`);
                        }
                    } else if (orderData.service_type === 'Boxes') {
                        // Fetch box selection
                        const { data: boxSelectionData } = await supabase
                            .from('order_box_selections')
                            .select('*')
                            .eq('order_id', d.order_id)
                            .maybeSingle();
                        const boxSelection = boxSelectionData || null;

                        if (boxSelection) {
                            const vendor = vendors.find(v => v.id === boxSelection.vendor_id);
                            const boxType = boxTypes.find(bt => bt.id === boxSelection.box_type_id);
                            // Prefer stored total_value from box selection, fallback to order total_value
                            const boxTotalValue = boxSelection.total_value
                                ? parseFloat(boxSelection.total_value)
                                : parseFloat(orderData.total_value || 0);

                            orderDetails = {
                                serviceType: orderData.service_type,
                                vendorId: boxSelection.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                boxTypeId: boxSelection.box_type_id,
                                boxTypeName: boxType?.name || 'Unknown Box Type',
                                boxQuantity: boxSelection.quantity,
                                totalValue: boxTotalValue
                            };
                        }
                    } else {
                        // For other service types, just include basic info
                        orderDetails = {
                            serviceType: orderData.service_type,
                            totalValue: parseFloat(orderData.total_value || 0),
                            notes: orderData.notes
                        };
                    }
                }
            }

            // Calculate amount from order items if order details exist
            let calculatedAmount = d.amount; // Default to stored amount

            if (orderDetails) {
                if (orderDetails.serviceType === 'Food' && orderDetails.vendorSelections) {
                    // Sum all item totalValues from all vendor selections
                    calculatedAmount = orderDetails.vendorSelections.reduce((sum: number, vs: any) => {
                        return sum + (vs.items || []).reduce((itemSum: number, item: any) => {
                            return itemSum + (item.totalValue || 0);
                        }, 0);
                    }, 0);
                } else if (orderDetails.totalValue !== undefined) {
                    // For Boxes and other service types, use the totalValue
                    calculatedAmount = orderDetails.totalValue;
                }
            }

            return {
                id: d.id,
                clientId: d.client_id,
                clientName: clientData?.full_name || 'Unknown Client',
                status: d.status,
                remarks: d.remarks,
                navigator: d.navigator,
                amount: calculatedAmount,
                createdAt: d.created_at,
                date: d.date || new Date(d.created_at).toLocaleDateString(),
                method: d.method || 'N/A',
                orderId: d.order_id || undefined,
                deliveryDate: deliveryDate,
                orderDetails: orderDetails
            };
        })
    );

        return recordsWithOrderData || [];
    } catch (error) {
        console.error('Error fetching billing history:', error);
        return [];
    }
}

export async function getBillingOrders() {
    try {
        // Get orders with billing_pending status (without join to avoid PostgREST relationship issues)
        const { data: pendingOrdersByStatus, error: statusError } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'billing_pending')
            .order('created_at', { ascending: false });

        if (statusError) {
            console.error('[getBillingOrders] Error fetching pending orders by status:', statusError);
        }
        
        console.log('[getBillingOrders] Found orders with billing_pending status:', pendingOrdersByStatus?.length || 0);

        // Get orders that have proof_of_delivery_url (processed/delivered orders)
        // This ensures all delivered orders show up on the billing page, even if status wasn't updated correctly
        // Use a filter that checks for non-null and non-empty proof_of_delivery_url
        const { data: processedOrders, error: processedError } = await supabase
            .from('orders')
            .select('*')
            .not('proof_of_delivery_url', 'is', null)
            .neq('proof_of_delivery_url', '')
            .order('created_at', { ascending: false });

        if (processedError) {
            console.error('[getBillingOrders] Error fetching processed orders:', processedError);
        }
        
        console.log('[getBillingOrders] Found processed orders:', processedOrders?.length || 0);

        // Combine both sets and remove duplicates (prioritize orders with billing_pending status)
        const pendingOrderIds = new Set((pendingOrdersByStatus || []).map((o: any) => o.id));
        const allPendingOrders = [
            ...(pendingOrdersByStatus || []),
            ...((processedOrders || []).filter((o: any) => !pendingOrderIds.has(o.id)))
        ];

        // Get billing records with status "success" and their associated orders
        const { data: billingRecords, error: billingError } = await supabase
            .from('billing_records')
            .select('order_id, status')
            .eq('status', 'success');

        if (billingError) {
            console.error('[getBillingOrders] Error fetching billing records:', billingError);
        }

        const successfulOrderIds = new Set((billingRecords || []).map((br: any) => br.order_id).filter(Boolean));

        // Get orders that have successful billing records
        let successfulOrders: any[] = [];
        if (successfulOrderIds.size > 0) {
            const { data: successfulOrdersData, error: successfulError } = await supabase
                .from('orders')
                .select('*')
                .in('id', Array.from(successfulOrderIds))
                .order('created_at', { ascending: false });
            
            if (successfulError) {
                console.error('[getBillingOrders] Error fetching successful orders:', successfulError);
            }
            successfulOrders = successfulOrdersData || [];
        }

        // Collect all unique client IDs from all orders
        const allOrderData = [...(allPendingOrders || []), ...(successfulOrders || [])];
        const clientIds = [...new Set(allOrderData.map((o: any) => o.client_id).filter(Boolean))];

        // Fetch all clients in one query
        let clientsMap = new Map<string, { id: string; full_name: string }>();
        if (clientIds.length > 0) {
            const { data: clients, error: clientsError } = await supabase
                .from('clients')
                .select('id, full_name')
                .in('id', clientIds);

            if (clientsError) {
                console.error('[getBillingOrders] Error fetching clients:', clientsError);
            } else if (clients) {
                clientsMap = new Map(clients.map((c: any) => [c.id, c]));
            }
        }

        // Combine and map orders with client data
        const allOrders = [
            ...(allPendingOrders.map((o: any) => {
                const client = clientsMap.get(o.client_id);
                return {
                    ...o,
                    clientName: client?.full_name || 'Unknown',
                    amount: o.total_value || 0,
                    billingStatus: 'billing_pending' as const
                };
            })),
            ...(successfulOrders.map((o: any) => {
                const client = clientsMap.get(o.client_id);
                return {
                    ...o,
                    clientName: client?.full_name || 'Unknown',
                    amount: o.total_value || 0,
                    billingStatus: 'billing_successful' as const
                };
            }))
        ];

        // Remove duplicates (in case an order is both pending and has a successful record - prioritize successful)
        const orderMap = new Map();
        for (const order of allOrders) {
            if (!orderMap.has(order.id) || order.billingStatus === 'billing_successful') {
                orderMap.set(order.id, order);
            }
        }

        const finalOrders = Array.from(orderMap.values()).sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
        });
        
        console.log('[getBillingOrders] Total orders to return:', finalOrders.length);
        return finalOrders;
    } catch (error) {
        console.error('Error fetching billing orders:', error);
        return [];
    }
}

export async function getAllBillingRecords() {
    try {
        // First, ensure all orders with billing_pending status have billing records
        const { data: billingPendingOrders } = await supabase
            .from('orders')
            .select('*')
            .eq('status', 'billing_pending');

        if (billingPendingOrders && billingPendingOrders.length > 0) {
            // For each billing_pending order, check if billing record exists
            for (const order of billingPendingOrders) {
                const { data: existingBilling } = await supabase
                    .from('billing_records')
                    .select('id')
                    .eq('order_id', order.id)
                    .maybeSingle();

                if (!existingBilling) {
                    // Fetch client to get navigator and name
                    const { data: client } = await supabase
                        .from('clients')
                        .select('navigator_id, full_name')
                        .eq('id', order.client_id)
                        .single();

                    if (client) {
                        // Create billing record for this order
                        const billingId = randomUUID();
                        await supabase
                            .from('billing_records')
                            .insert([{
                                id: billingId,
                                client_id: order.client_id,
                                order_id: order.id,
                                status: 'pending',
                                amount: order.total_value || 0,
                                navigator: client.navigator_id || 'Unknown',
                                remarks: 'Auto-generated for billing_pending order'
                            }]);
                    }
                }
            }
        }

        // Now fetch all billing records
        const { data: billingRecords } = await supabase
            .from('billing_records')
            .select('*')
            .order('created_at', { ascending: false });

        // Fetch reference data once for all orders
        const [menuItems, vendors, boxTypes] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes()
        ]);

        // Fetch all unique client IDs and get their names
        const uniqueClientIds = [...new Set((billingRecords || []).map((br: any) => br.client_id).filter(Boolean))];
        const { data: clientsData } = await supabase
            .from('clients')
            .select('id, full_name')
            .in('id', uniqueClientIds);
        
        const clientsMap = new Map((clientsData || []).map((c: any) => [c.id, c.full_name]));

        // Fetch order details separately if order_id exists
        const recordsWithOrderData = await Promise.all(
            (billingRecords || []).map(async (d: any) => {
                let deliveryDate: string | undefined = undefined;
                let calculatedAmount = d.amount; // Default to stored amount

                if (d.order_id) {
                    const { data: orderData } = await supabase
                        .from('orders')
                        .select('*')
                        .eq('id', d.order_id)
                        .single();

                    if (orderData) {
                        // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                        deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;

                        // Calculate amount from order items
                        if (orderData.service_type === 'Food') {
                            // Fetch vendor selections and items
                            const { data: vendorSelections } = await supabase
                                .from('order_vendor_selections')
                                .select('*')
                                .eq('order_id', d.order_id);

                            if (vendorSelections && vendorSelections.length > 0) {
                                const vendorAmounts = await Promise.all(
                                    vendorSelections.map(async (vs: any) => {
                                        const { data: items } = await supabase
                                            .from('order_items')
                                            .select('*')
                                            .eq('vendor_selection_id', vs.id);

                                        return (items || []).reduce((sum: number, item: any) => {
                                            const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                            const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value || '0');
                                            return sum + (itemPrice * item.quantity);
                                        }, 0);
                                    })
                                );
                                calculatedAmount = vendorAmounts.reduce((sum: number, val: number) => sum + val, 0);
                            }
                        } else if (orderData.service_type === 'Boxes') {
                            // Fetch box selection and use stored total_value if available
                            const { data: boxSelection } = await supabase
                                .from('order_box_selections')
                                .select('*')
                                .eq('order_id', d.order_id)
                                .maybeSingle();

                            if (boxSelection && boxSelection.total_value) {
                                calculatedAmount = parseFloat(boxSelection.total_value);
                            } else {
                                calculatedAmount = parseFloat(orderData.total_value || 0);
                            }
                        } else {
                            // For other service types, use the order's total_value
                            calculatedAmount = parseFloat(orderData.total_value || 0);
                        }
                    }
                }

            return {
                id: d.id,
                clientId: d.client_id,
                clientName: clientsMap.get(d.client_id) || 'Unknown Client',
                status: d.status,
                remarks: d.remarks,
                navigator: d.navigator,
                amount: calculatedAmount,
                createdAt: d.created_at,
                orderId: d.order_id || undefined,
                deliveryDate: deliveryDate
            };
        })
    );

    return recordsWithOrderData;
    } catch (error) {
        console.error('Error fetching all billing records:', error);
        return [];
    }
}

// --- UPCOMING ORDERS ACTIONS ---

// Re-export for backward compatibility (deprecated, use order-dates.ts directly)
/** @deprecated Use getTakeEffectDateLegacy from order-dates.ts */
function calculateTakeEffectDate(vendorId: string, vendors: Vendor[]): Date | null {
    const { getTakeEffectDateLegacy } = require('./order-dates');
    return getTakeEffectDateLegacy(vendorId, vendors);
}

/** @deprecated Use getEarliestDeliveryDate from order-dates.ts */
function calculateEarliestTakeEffectDate(vendorIds: string[], vendors: Vendor[]): Date | null {
    const { getTakeEffectDateLegacy, getEarliestDeliveryDate } = require('./order-dates');
    const dates: Date[] = [];
    for (const vendorId of vendorIds) {
        const date = getTakeEffectDateLegacy(vendorId, vendors);
        if (date) dates.push(date);
    }
    if (dates.length === 0) return null;
    return dates.reduce((earliest, current) => current < earliest ? current : earliest);
}

/** @deprecated Use getNextDeliveryDateForDay from order-dates.ts */
function calculateScheduledDeliveryDateForDay(deliveryDay: string, vendors: Vendor[], vendorId?: string): Date | null {
    return getNextDeliveryDateForDay(deliveryDay, vendors, vendorId);
}

/** @deprecated Use getTakeEffectDateForDayLegacy from order-dates.ts */
function calculateTakeEffectDateForDay(deliveryDay: string, vendors: Vendor[], vendorId?: string): Date | null {
    const { getTakeEffectDateForDayLegacy } = require('./order-dates');
    return getTakeEffectDateForDayLegacy(deliveryDay, vendors, vendorId);
}

/**
 * Normalize delivery day key to day name for vendor checks and date calculation.
 * deliveryDayOrders keys are composite (e.g. "Thursday_Food", "Friday_Boxes"); vendors store day names only ("Thursday").
 */
function normalizeDeliveryDayForVendor(deliveryDay: string): string {
    if (!deliveryDay || typeof deliveryDay !== 'string') return deliveryDay;
    const suffix = /_(Food|Boxes|Custom)$/;
    const match = deliveryDay.match(suffix);
    return match ? deliveryDay.slice(0, -match[0].length) : deliveryDay;
}

/**
 * Helper function to sync a single order configuration for a specific delivery day
 */
async function syncSingleOrderForDeliveryDay(
    clientId: string,
    orderConfig: any,
    deliveryDay: string | null,
    vendors: Vendor[],
    menuItems: any[],
    boxTypes: any[]
): Promise<void> {
    // Cache current time at function start to avoid multiple getCurrentTime() calls (triangleorder pattern)
    const currentTime = await getCurrentTime();

    console.log('[syncSingleOrderForDeliveryDay] Start', {
        clientId,
        serviceType: orderConfig.serviceType,
        deliveryDay,
        itemsCount: orderConfig.items ? Object.keys(orderConfig.items).length : 0,
        boxQuantity: orderConfig.boxQuantity,
        hasVendorSelections: !!orderConfig.vendorSelections,
        vendorSelectionsCount: orderConfig.vendorSelections?.length || 0,
        vendorSelections: orderConfig.vendorSelections?.map((vs: any) => ({
            vendorId: vs.vendorId,
            hasItems: !!vs.items,
            itemCount: vs.items ? Object.keys(vs.items).length : 0
        })) || []
    });

    // Calculate dates for this specific delivery day
    // IMPORTANT: take_effect_date must always be a Sunday and respect weekly locking
    let takeEffectDate: Date | null = null;
    let scheduledDeliveryDate: Date | null = null;

    // Get settings for weekly locking logic
    const settings = await getSettings();

    // ... logic ...
    // Note: I am rewriting the top of the function to include supabaseClientObj.
    // I need to search and replace 'supabase.' with 'supabaseClient.' in the REST of the function.
    // However, ReplaceFileContent works on chunks. I can't easily replace all internal usages without listing them or rewriting the whole function.
    // The function is long (1234 to 1500+).
    // I will try to use sed or multiple chunks if possible, or rewrite critical parts.
    // Let's check usages of `supabase.` in this function.
    // It uses `supabase.from` for upcoming_orders queries, inserts, deletes.
    // I will rewrite the query sections.

    if (orderConfig.serviceType === 'Food') {
        // Check if vendorSelections exist and have valid vendors
        if (!orderConfig.vendorSelections || orderConfig.vendorSelections.length === 0) {
            const errorMsg = `Cannot save Food order: No vendor selections found. Please select at least one vendor with items.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                hasVendorSelections: !!orderConfig.vendorSelections,
                vendorSelectionsCount: orderConfig.vendorSelections?.length || 0
            });
            throw new Error(errorMsg);
        }
        const vendorIds = orderConfig.vendorSelections
            .map((s: any) => s.vendorId)
            .filter((id: string) => id);

        if (vendorIds.length === 0) {
            // No valid vendor IDs in selections
            const errorMsg = `Cannot save Food order: No valid vendors selected. Please select at least one vendor with items.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                vendorSelectionsCount: orderConfig.vendorSelections.length,
                vendorSelections: orderConfig.vendorSelections
            });
            throw new Error(errorMsg);
        }

        // Check if vendors have delivery days configured
        const vendorsWithoutDeliveryDays: string[] = [];
        for (const vendorId of vendorIds) {
            const vendor = vendors.find(v => v.id === vendorId);
            if (!vendor) {
                vendorsWithoutDeliveryDays.push(vendorId);
            } else {
                const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                if (!deliveryDays || deliveryDays.length === 0) {
                    vendorsWithoutDeliveryDays.push(vendor.name || vendorId);
                }
            }
        }

        if (vendorsWithoutDeliveryDays.length > 0) {
            const vendorNames = vendorsWithoutDeliveryDays.join(', ');
            const errorMsg = `Cannot save Food order: Vendor(s) ${vendorNames} do not have delivery days configured. Please configure delivery days for all selected vendors.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                vendorsWithoutDeliveryDays
            });
            throw new Error(errorMsg);
        }

        if (deliveryDay) {
            // Normalize composite key (e.g. "Thursday_Food") to day name for vendor check and date calc (1-vendor policy)
            const normalizedDay = normalizeDeliveryDayForVendor(deliveryDay);
            // For client-selected delivery day, get the nearest occurrence of that day
            // First validate that vendor can deliver on that day
            const vendor = vendors.find(v => v.id === vendorIds[0]);
            if (vendor) {
                const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                if (!deliveryDays || !deliveryDays.includes(normalizedDay)) {
                    const vendorName = vendor?.name || vendorIds[0];
                    const errorMsg = `Cannot save Food order: Vendor "${vendorName}" does not deliver on ${normalizedDay}. Please select a different delivery day or vendor.`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                        serviceType: orderConfig.serviceType,
                        deliveryDay: normalizedDay,
                        vendorId: vendorIds[0],
                        vendorName
                    });
                    throw new Error(errorMsg);
                }
            }
            
            // Get the nearest occurrence of the client-selected delivery day (use day name for getNextOccurrence)
            scheduledDeliveryDate = getNextOccurrence(normalizedDay, getTodayDateInAppTzAsReference(currentTime));
            
            if (!scheduledDeliveryDate) {
                const errorMsg = `Cannot save Food order: Could not calculate delivery date for ${normalizedDay}.`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                    serviceType: orderConfig.serviceType,
                    deliveryDay: normalizedDay
                });
                throw new Error(errorMsg);
            }
        } else {
            // Use main vendor's delivery day as default
            // Find main vendor (isDefault: true, or first vendor if none is default)
            const mainVendor = vendors.find(v => v.isDefault === true) || vendors[0];
            
            if (mainVendor) {
                const deliveryDays = 'deliveryDays' in mainVendor ? mainVendor.deliveryDays : (mainVendor as any).delivery_days;
                if (deliveryDays && deliveryDays.length > 0) {
                    // Use the first delivery day from main vendor (only one is allowed per vendor)
                    const mainVendorDeliveryDay = deliveryDays[0];
                    
                    // Get the nearest occurrence of the main vendor's delivery day
                    scheduledDeliveryDate = getNextOccurrence(mainVendorDeliveryDay, getTodayDateInAppTzAsReference(currentTime));
                    
                    if (!scheduledDeliveryDate) {
                        const errorMsg = `Cannot save Food order: Could not calculate delivery date for main vendor's delivery day (${mainVendorDeliveryDay}).`;
                        console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                            serviceType: orderConfig.serviceType,
                            mainVendorDeliveryDay,
                            mainVendorName: mainVendor.name
                        });
                        throw new Error(errorMsg);
                    }
                }
            }
            
            // If still no scheduled delivery date, try using getNextDeliveryDate with first vendor
            if (!scheduledDeliveryDate) {
                scheduledDeliveryDate = getNextDeliveryDate(vendorIds[0], vendors, getTodayDateInAppTzAsReference(currentTime));
                
                if (!scheduledDeliveryDate) {
                    const vendor = vendors.find(v => v.id === vendorIds[0]);
                    const vendorName = vendor?.name || vendorIds[0];
                    const errorMsg = `Cannot save Food order: Could not calculate delivery date for vendor "${vendorName}". Please ensure the vendor has valid delivery days configured and check cutoff times.`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                        serviceType: orderConfig.serviceType,
                        vendorId: vendorIds[0],
                        vendorName
                    });
                    throw new Error(errorMsg);
                }
            }
        }

        // IMPORTANT: take_effect_date must always be a Sunday using weekly locking logic
        takeEffectDate = getTakeEffectDateFromUtils(settings);
        
        if (!takeEffectDate) {
            const errorMsg = `Cannot save Food order: Could not calculate take effect date. Please check system settings.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                settings: settings ? 'present' : 'missing'
            });
            throw new Error(errorMsg);
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        // Boxes can exist with or without boxTypeId now
        // Check explicitly for undefined/null/empty string to properly handle vendor assignment
        let boxVendorId = (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') ? orderConfig.vendorId : null;
        if (!boxVendorId && orderConfig.boxTypeId) {
            const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
            boxVendorId = boxType?.vendorId || null;
        }

        if (boxVendorId) {
            if (deliveryDay) {
                // Normalize composite key (e.g. "Thursday_Boxes") to day name for vendor check and date calc (1-vendor policy)
                const normalizedDay = normalizeDeliveryDayForVendor(deliveryDay);
                // For client-selected delivery day, get the nearest occurrence of that day
                // First validate that vendor can deliver on that day
                const vendor = vendors.find(v => v.id === boxVendorId);
                if (vendor) {
                    const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                    if (!deliveryDays || !deliveryDays.includes(normalizedDay)) {
                        const vendorName = vendor?.name || boxVendorId;
                        const errorMsg = `Cannot save Boxes order: Vendor "${vendorName}" does not deliver on ${normalizedDay}. Please select a different delivery day or vendor.`;
                        console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                            serviceType: orderConfig.serviceType,
                            deliveryDay: normalizedDay,
                            vendorId: boxVendorId,
                            vendorName
                        });
                        throw new Error(errorMsg);
                    }
                }
                
                // Get the nearest occurrence of the client-selected delivery day (use day name for getNextOccurrence)
                scheduledDeliveryDate = getNextOccurrence(normalizedDay, getTodayDateInAppTzAsReference(currentTime));
                
                if (!scheduledDeliveryDate) {
                    const errorMsg = `Cannot save Boxes order: Could not calculate delivery date for ${normalizedDay}.`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                        serviceType: orderConfig.serviceType,
                        deliveryDay: normalizedDay
                    });
                    throw new Error(errorMsg);
                }
            } else {
                // Use main vendor's delivery day as default
                // Find main vendor (isDefault: true, or first vendor if none is default)
                const mainVendor = vendors.find(v => v.isDefault === true) || vendors[0];
                
                if (mainVendor) {
                    const deliveryDays = 'deliveryDays' in mainVendor ? mainVendor.deliveryDays : (mainVendor as any).delivery_days;
                    if (deliveryDays && deliveryDays.length > 0) {
                        // Use the first delivery day from main vendor (only one is allowed per vendor)
                        const mainVendorDeliveryDay = deliveryDays[0];
                        
                        // Get the nearest occurrence of the main vendor's delivery day
                        scheduledDeliveryDate = getNextOccurrence(mainVendorDeliveryDay, getTodayDateInAppTzAsReference(currentTime));
                        
                        if (!scheduledDeliveryDate) {
                            const errorMsg = `Cannot save Boxes order: Could not calculate delivery date for main vendor's delivery day (${mainVendorDeliveryDay}).`;
                            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                                serviceType: orderConfig.serviceType,
                                mainVendorDeliveryDay,
                                mainVendorName: mainVendor.name
                            });
                            throw new Error(errorMsg);
                        }
                    }
                }
                
                // Fallback: find the first delivery date from box vendor if main vendor didn't work
                if (!scheduledDeliveryDate) {
                    const vendor = vendors.find(v => v.id === boxVendorId);
                    if (vendor) {
                        const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                        if (deliveryDays && deliveryDays.length > 0) {
                            const today = new Date(currentTime);
                            today.setHours(0, 0, 0, 0);
                            const dayNameToNumber: { [key: string]: number } = {
                                'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                                'Thursday': 4, 'Friday': 5, 'Saturday': 6
                            };
                            const deliveryDayNumbers = deliveryDays
                                .map((day: string) => dayNameToNumber[day])
                                .filter((num: number | undefined): num is number => num !== undefined);

                            for (let i = 0; i <= 14; i++) {
                                const checkDate = new Date(today);
                                checkDate.setDate(today.getDate() + i);
                                if (deliveryDayNumbers.includes(checkDate.getDay())) {
                                    scheduledDeliveryDate = checkDate;
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // IMPORTANT: take_effect_date must always be a Sunday using weekly locking logic
            takeEffectDate = getTakeEffectDateFromUtils(settings);
        } else {
            // If no vendorId, we must still provide a take_effect_date to satisfy the NOT NULL constraint in upcoming_orders table.
            // We'll use a far-future date (2099-12-31) to indicate it's not ready for processing but valid for storage.
            console.log(`[syncSingleOrderForDeliveryDay] No vendorId for Boxes order - setting fallback take_effect_date (2099-12-31)`);

            // Create date for 2099-12-31
            const fallbackDate = new Date('2099-12-31T00:00:00.000Z');
            takeEffectDate = fallbackDate;
            scheduledDeliveryDate = fallbackDate; // Also set this so the check below passes
        }
    } else if (orderConfig.serviceType === 'Custom') {
        // For Custom orders: validate vendorId and customItems
        if (!orderConfig.vendorId || orderConfig.vendorId.trim() === '') {
            const errorMsg = `Cannot save Custom order: No vendor selected. Please select a vendor.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                hasVendorId: !!orderConfig.vendorId
            });
            throw new Error(errorMsg);
        }

        const customItems = (orderConfig as any).customItems || [];
        if (!Array.isArray(customItems) || customItems.length === 0) {
            const errorMsg = `Cannot save Custom order: No custom items found. Please add at least one custom item.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                customItemsCount: customItems.length
            });
            throw new Error(errorMsg);
        }

        // Validate that all custom items have required fields
        const invalidItems = customItems.filter((item: any) => 
            !item.name || !item.name.trim() || 
            !item.price || item.price <= 0 || 
            !item.quantity || item.quantity <= 0
        );
        if (invalidItems.length > 0) {
            const errorMsg = `Cannot save Custom order: ${invalidItems.length} custom item(s) have invalid data. Please ensure all items have a name, valid price > 0, and quantity > 0.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                invalidItemsCount: invalidItems.length
            });
            throw new Error(errorMsg);
        }

        // For Custom orders, try to get delivery day from vendor if available
        const vendor = vendors.find(v => v.id === orderConfig.vendorId);
        if (vendor && deliveryDay) {
            // Normalize composite key (e.g. "Thursday_Custom") to day name for vendor check and date calc (1-vendor policy)
            const normalizedDay = normalizeDeliveryDayForVendor(deliveryDay);
            // Validate that vendor can deliver on that day
            const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
            if (deliveryDays && !deliveryDays.includes(normalizedDay)) {
                const vendorName = vendor?.name || orderConfig.vendorId;
                const errorMsg = `Cannot save Custom order: Vendor "${vendorName}" does not deliver on ${normalizedDay}. Please select a different delivery day or vendor.`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                    serviceType: orderConfig.serviceType,
                    deliveryDay: normalizedDay,
                    vendorId: orderConfig.vendorId,
                    vendorName
                });
                throw new Error(errorMsg);
            }
            
            // Get the nearest occurrence of the client-selected delivery day (use day name for getNextOccurrence)
            scheduledDeliveryDate = getNextOccurrence(normalizedDay, getTodayDateInAppTzAsReference(currentTime));
            
            if (!scheduledDeliveryDate) {
                const errorMsg = `Cannot save Custom order: Could not calculate delivery date for ${normalizedDay}.`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                    serviceType: orderConfig.serviceType,
                    deliveryDay: normalizedDay
                });
                throw new Error(errorMsg);
            }
        } else {
            // Use main vendor's delivery day as default
            // Find main vendor (isDefault: true, or first vendor if none is default)
            const mainVendor = vendors.find(v => v.isDefault === true) || vendors[0];
            
            if (mainVendor) {
                const deliveryDays = 'deliveryDays' in mainVendor ? mainVendor.deliveryDays : (mainVendor as any).delivery_days;
                if (deliveryDays && deliveryDays.length > 0) {
                    // Use the first delivery day from main vendor (only one is allowed per vendor)
                    const mainVendorDeliveryDay = deliveryDays[0];
                    
                    // Get the nearest occurrence of the main vendor's delivery day
                    scheduledDeliveryDate = getNextOccurrence(mainVendorDeliveryDay, getTodayDateInAppTzAsReference(currentTime));
                    
                    if (!scheduledDeliveryDate) {
                        const errorMsg = `Cannot save Custom order: Could not calculate delivery date for main vendor's delivery day (${mainVendorDeliveryDay}).`;
                        console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                            serviceType: orderConfig.serviceType,
                            mainVendorDeliveryDay,
                            mainVendorName: mainVendor.name
                        });
                        throw new Error(errorMsg);
                    }
                }
            }
            
            // Fallback: find the first delivery date from selected vendor if main vendor didn't work
            if (!scheduledDeliveryDate && vendor) {
                const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                if (deliveryDays && deliveryDays.length > 0) {
                    const dayNameToNumber: { [key: string]: number } = {
                        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                        'Thursday': 4, 'Friday': 5, 'Saturday': 6
                    };
                    const deliveryDayNumbers = deliveryDays
                        .map((day: string) => dayNameToNumber[day])
                        .filter((num: number | undefined): num is number => num !== undefined);

                    const today = new Date(currentTime);
                    today.setHours(0, 0, 0, 0);
                    for (let i = 0; i <= 14; i++) {
                        const checkDate = new Date(today);
                        checkDate.setDate(today.getDate() + i);
                        if (deliveryDayNumbers.includes(checkDate.getDay())) {
                            scheduledDeliveryDate = checkDate;
                            break;
                        }
                    }
                }
            }
        }

        // IMPORTANT: take_effect_date must always be a Sunday using weekly locking logic
        takeEffectDate = getTakeEffectDateFromUtils(settings);
        
        if (!takeEffectDate) {
            const errorMsg = `Cannot save Custom order: Could not calculate take effect date. Please check system settings.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                settings: settings ? 'present' : 'missing'
            });
            throw new Error(errorMsg);
        }

        // If still no scheduled delivery date, use a fallback (far future date)
        if (!scheduledDeliveryDate) {
            console.log(`[syncSingleOrderForDeliveryDay] No delivery date calculated for Custom order - using fallback date`);
            const fallbackDate = new Date('2099-12-31T00:00:00.000Z');
            scheduledDeliveryDate = fallbackDate;
        }
    } else if (orderConfig.serviceType === 'Produce') {
        // For Produce orders: validate billAmount
        if (orderConfig.billAmount === undefined || orderConfig.billAmount === null || orderConfig.billAmount < 0) {
            const errorMsg = `Cannot save Produce order: Invalid bill amount. Please enter a valid bill amount (>= 0).`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                billAmount: orderConfig.billAmount
            });
            throw new Error(errorMsg);
        }

        // For Produce orders, ALWAYS use the vendor's delivery day from admin settings
        // The scheduled_delivery_date is the nearest date of the day of the week set by the vendor
        const mainVendor = vendors.find(v => v.isDefault === true) || vendors[0];
        
        if (mainVendor) {
            const deliveryDays = 'deliveryDays' in mainVendor ? mainVendor.deliveryDays : (mainVendor as any).delivery_days;
            if (deliveryDays && deliveryDays.length > 0) {
                // Use the vendor's first delivery day from admin settings
                const vendorDeliveryDay = deliveryDays[0];
                // Calculate the nearest occurrence of this day
                scheduledDeliveryDate = getNextOccurrence(vendorDeliveryDay, getTodayDateInAppTzAsReference(currentTime));
                
                if (!scheduledDeliveryDate) {
                    const errorMsg = `Cannot save Produce order: Could not calculate delivery date for vendor's delivery day (${vendorDeliveryDay}).`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                        serviceType: orderConfig.serviceType,
                        vendorDeliveryDay,
                        vendorName: mainVendor.name
                    });
                    throw new Error(errorMsg);
                }
                
                console.log(`[syncSingleOrderForDeliveryDay] Produce order: Using vendor delivery day ${vendorDeliveryDay} from admin settings, scheduled_delivery_date: ${scheduledDeliveryDate.toISOString()}`);
            } else {
                const errorMsg = `Cannot save Produce order: Vendor "${mainVendor.name}" has no delivery days configured in admin settings. Please configure delivery days for this vendor.`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                    serviceType: orderConfig.serviceType,
                    vendorName: mainVendor.name
                });
                throw new Error(errorMsg);
            }
        } else {
            const errorMsg = `Cannot save Produce order: No vendor found. Please ensure at least one vendor is configured.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType
            });
            throw new Error(errorMsg);
        }

        // IMPORTANT: take_effect_date must always be a Sunday using weekly locking logic
        takeEffectDate = getTakeEffectDateFromUtils(settings);
        
        if (!takeEffectDate) {
            const errorMsg = `Cannot save Produce order: Could not calculate take effect date. Please check system settings.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                settings: settings ? 'present' : 'missing'
            });
            throw new Error(errorMsg);
        }

        // If still no scheduled delivery date, use a fallback (far future date)
        if (!scheduledDeliveryDate) {
            console.log(`[syncSingleOrderForDeliveryDay] No delivery date calculated for Produce order - using fallback date`);
            const fallbackDate = new Date('2099-12-31T00:00:00.000Z');
            scheduledDeliveryDate = fallbackDate;
        }
    }

    // For Boxes orders, dates are optional - they can be set later
    // Only require dates for Food, Custom, and Produce orders
    // This check should rarely be hit now since we validate earlier, but keep as a safety net
    if ((orderConfig.serviceType === 'Food' || orderConfig.serviceType === 'Custom' || orderConfig.serviceType === 'Produce') && (!takeEffectDate || !scheduledDeliveryDate)) {
        const vendorIds = orderConfig.vendorSelections?.map((s: any) => s.vendorId).filter((id: string) => id) || [];
        const vendorNames = vendorIds.map((id: string) => {
            const vendor = vendors.find(v => v.id === id);
            return vendor?.name || id;
        }).join(', ');
        
        let errorMsg = `Cannot save Food order: Missing delivery dates. `;
        if (!takeEffectDate && !scheduledDeliveryDate) {
            errorMsg += `Both take effect date and scheduled delivery date are missing. `;
        } else if (!takeEffectDate) {
            errorMsg += `Take effect date is missing. `;
        } else {
            errorMsg += `Scheduled delivery date is missing. `;
        }
        errorMsg += vendorNames ? `Vendor(s): ${vendorNames}. ` : '';
        errorMsg += `Please ensure all selected vendors have delivery days configured.`;
        
        console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
            serviceType: orderConfig.serviceType,
            hasTakeEffectDate: !!takeEffectDate,
            hasScheduledDeliveryDate: !!scheduledDeliveryDate,
            vendorIds,
            vendorNames
        });
        throw new Error(errorMsg);
    }

    // For Boxes orders without dates, we'll save with null dates (can be set later)
    if (orderConfig.serviceType === 'Boxes' && (!takeEffectDate || !scheduledDeliveryDate)) {
        console.log(`[syncSingleOrderForDeliveryDay] Boxes order without dates - will save with null dates (can be set later)`);
        // Allow null dates for Boxes orders
    }

    // Calculate totals
    let totalValue = 0;
    let totalItems = 0;

    console.log(`[syncSingleOrderForDeliveryDay] Starting total calculation for order`);
    console.log(`[syncSingleOrderForDeliveryDay] Order config:`, {
        serviceType: orderConfig.serviceType,
        hasVendorSelections: !!orderConfig.vendorSelections,
        vendorSelectionsCount: orderConfig.vendorSelections?.length || 0
    });

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections) {
        console.log(`[syncSingleOrderForDeliveryDay] Processing Food order with ${orderConfig.vendorSelections.length} vendor selections`);
        for (const selection of orderConfig.vendorSelections) {
            if (!selection.items) {
                console.log(`[syncSingleOrderForDeliveryDay] Skipping vendor selection - no items`);
                continue;
            }
            console.log(`[syncSingleOrderForDeliveryDay] Processing vendor ${selection.vendorId} with ${Object.keys(selection.items).length} items`);
            for (const [itemId, qty] of Object.entries(selection.items)) {
                const item = menuItems.find(i => i.id === itemId);
                const quantity = qty as number;
                if (item && quantity > 0) {
                    // Use priceEach if available, otherwise fall back to value
                    const itemPrice = item.priceEach ?? item.value;
                    const itemTotal = itemPrice * quantity;
                    console.log(`[syncSingleOrderForDeliveryDay] Item: ${item.name}`, {
                        itemId,
                        quantity,
                        itemPrice,
                        itemValue: item.value,
                        itemPriceEach: item.priceEach,
                        itemTotal,
                        currentTotalValue: totalValue
                    });
                    totalValue += itemTotal;
                    totalItems += quantity;
                    console.log(`[syncSingleOrderForDeliveryDay] Updated totalValue: ${totalValue}, totalItems: ${totalItems}`);
                } else {
                    console.log(`[syncSingleOrderForDeliveryDay] Skipping item ${itemId} - item not found or quantity is 0`, {
                        itemFound: !!item,
                        quantity
                    });
                }
            }
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        totalItems = orderConfig.boxQuantity || 0;
        const items = (orderConfig as any).items || {};
        const itemPrices = (orderConfig as any).itemPrices || {};
        let boxItemsTotal = 0;
        for (const [itemId, qty] of Object.entries(items)) {
            const quantity = typeof qty === 'number' ? qty : 0;
            const price = itemPrices[itemId];
            if (price !== undefined && price !== null && quantity > 0) {
                boxItemsTotal += price * quantity;
            }
        }
        if (boxItemsTotal > 0) {
            totalValue = boxItemsTotal;
        } else if (orderConfig.boxTypeId) {
            // Fall back to boxType pricing only if boxTypeId is present
            const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
            if (boxType && boxType.priceEach) {
                totalValue = boxType.priceEach * totalItems;
            }
        }
    } else if (orderConfig.serviceType === 'Custom') {
        // Calculate totals from customItems array
        const customItems = (orderConfig as any).customItems || [];
        console.log(`[syncSingleOrderForDeliveryDay] Processing Custom order with ${customItems.length} custom items`);
        for (const item of customItems) {
            if (item.name && item.name.trim() && item.price > 0 && item.quantity > 0) {
                const itemTotal = parseFloat(item.price) * parseInt(item.quantity);
                totalValue += itemTotal;
                totalItems += parseInt(item.quantity);
                console.log(`[syncSingleOrderForDeliveryDay] Custom item: ${item.name}`, {
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                    itemTotal,
                    currentTotalValue: totalValue
                });
            }
        }
        console.log(`[syncSingleOrderForDeliveryDay] Custom order totals: totalValue=${totalValue}, totalItems=${totalItems}`);
    } else if (orderConfig.serviceType === 'Produce') {
        // For Produce orders, totalValue is the billAmount
        totalValue = parseFloat(orderConfig.billAmount) || 0;
        totalItems = 1; // Produce orders are counted as 1 item
        console.log(`[syncSingleOrderForDeliveryDay] Processing Produce order`, {
            billAmount: orderConfig.billAmount,
            totalValue,
            totalItems
        });
    }

    // Get current user from session for updated_by
    const session = await getSession();
    const currentUserName = session?.name || 'Admin';
    const updatedBy = (orderConfig.updatedBy && orderConfig.updatedBy !== 'Admin') ? orderConfig.updatedBy : currentUserName;

    console.log(`[syncSingleOrderForDeliveryDay] Final calculated totals:`, {
        totalValue,
        totalItems
    });

    // Upsert upcoming order for this delivery day
    // currentTime already cached at function start
    
    // Validate and normalize service_type to match database constraint
    // Allowed values: 'Food', 'Meal', 'Boxes', 'Equipment', 'Custom', 'Produce'
    const validServiceTypes = ['Food', 'Meal', 'Boxes', 'Equipment', 'Custom', 'Produce'] as const;
    let serviceType = orderConfig.serviceType;
    
    if (!serviceType || typeof serviceType !== 'string') {
        console.error('[syncSingleOrderForDeliveryDay] Invalid serviceType:', serviceType, 'Defaulting to Food');
        serviceType = 'Food';
    } else {
        // Normalize common variations
        const normalized = serviceType.trim();
        if (normalized === 'Meals') {
            serviceType = 'Meal';
        } else if (!validServiceTypes.includes(normalized as any)) {
            console.error('[syncSingleOrderForDeliveryDay] Invalid serviceType:', serviceType, 'Defaulting to Food');
            serviceType = 'Food';
        } else {
            serviceType = normalized;
        }
    }
    
    // Extract vendor_id based on service type
    let vendorId: string | null = null;
    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) {
        // For Food orders, use the first vendor selection's vendorId
        const firstVendorSelection = orderConfig.vendorSelections.find((vs: any) => vs.vendorId && vs.items && Object.keys(vs.items).length > 0);
        if (firstVendorSelection) {
            vendorId = firstVendorSelection.vendorId;
            console.log(`[syncSingleOrderForDeliveryDay] Extracted vendor_id for Food order: ${vendorId}`);
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        // CRITICAL FIX: Check boxOrders array first to get vendor ID from selected vendor
        const boxOrders = (orderConfig as any)?.boxOrders;
        if (boxOrders && Array.isArray(boxOrders) && boxOrders.length > 0) {
            // Get vendor ID from the first box (or find first box with a vendor ID)
            const firstBoxWithVendor = boxOrders.find((box: any) => box.vendorId && box.vendorId.trim() !== '');
            if (firstBoxWithVendor) {
                vendorId = firstBoxWithVendor.vendorId;
                console.log(`[syncSingleOrderForDeliveryDay] Extracted vendor_id from boxOrders array: ${vendorId}`);
            }
        }
        
        // Fallback to top-level vendorId if not found in boxOrders
        if (!vendorId && orderConfig.vendorId && orderConfig.vendorId.trim() !== '') {
            vendorId = orderConfig.vendorId;
        }
        
        // Fallback to boxType vendorId if still not found
        if (!vendorId && orderConfig.boxTypeId) {
            const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
            vendorId = boxType?.vendorId || null;
        }
        
        // Fallback to first item's vendorId if still not found
        if (!vendorId) {
            const items = (orderConfig as any).items || {};
            if (Object.keys(items).length > 0) {
                const firstItemId = Object.keys(items)[0];
                const firstItem = menuItems.find(i => i.id === firstItemId);
                if (firstItem?.vendorId) {
                    vendorId = firstItem.vendorId;
                }
            }
        }
        if (vendorId) {
            console.log(`[syncSingleOrderForDeliveryDay] Extracted vendor_id for Boxes order: ${vendorId}`);
        }
    } else if (orderConfig.serviceType === 'Custom') {
        // For Custom orders, use the vendorId from orderConfig
        if (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') {
            vendorId = orderConfig.vendorId;
            console.log(`[syncSingleOrderForDeliveryDay] Extracted vendor_id for Custom order: ${vendorId}`);
        } else {
            const errorMsg = `Cannot save Custom order: No vendor selected. Please select a vendor.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                hasVendorId: !!orderConfig.vendorId
            });
            throw new Error(errorMsg);
        }
    } else if (orderConfig.serviceType === 'Produce') {
        // For Produce orders, use main vendor (isDefault: true, or first vendor if none is default)
        const mainVendor = vendors.find(v => v.isDefault === true) || vendors[0];
        if (mainVendor) {
            vendorId = mainVendor.id;
            console.log(`[syncSingleOrderForDeliveryDay] Extracted vendor_id for Produce order: ${vendorId} (main vendor: ${mainVendor.name})`);
        } else {
            console.warn(`[syncSingleOrderForDeliveryDay] No vendor found for Produce order - vendor_id will be null`);
        }
    }
    
    // Map serviceType to DB service_type for upcoming_orders.
    // CRITICAL: Use 'Food', 'Boxes', 'Custom', 'Produce' (schema/process-weekly-orders expect these).
    // Never use lowercase ('food', etc.) or inserts/queries will not match.
    let serviceTypeForUpcomingOrders: string;
    if (serviceType === 'Food') {
        serviceTypeForUpcomingOrders = 'Food';
    } else if (serviceType === 'Boxes') {
        serviceTypeForUpcomingOrders = 'Boxes';
    } else if (serviceType === 'Custom') {
        serviceTypeForUpcomingOrders = 'Custom';
    } else if (serviceType === 'Produce') {
        serviceTypeForUpcomingOrders = 'Produce';
    } else if (serviceType === 'Meal' || serviceType === 'Equipment') {
        serviceTypeForUpcomingOrders = serviceType;
    } else {
        serviceTypeForUpcomingOrders = serviceType || 'Food';
    }
    
    const upcomingOrderData: any = {
        client_id: clientId,
        service_type: serviceTypeForUpcomingOrders,
        case_id: orderConfig.caseId,
        status: 'scheduled',
        last_updated: orderConfig.lastUpdated || currentTime.toISOString(),
        updated_by: updatedBy,
        // For Boxes orders, dates are optional (can be null)
        scheduled_delivery_date: scheduledDeliveryDate ? formatDateToYYYYMMDD(scheduledDeliveryDate) : null,
        take_effect_date: takeEffectDate ? formatDateToYYYYMMDD(takeEffectDate) : null,
        total_value: totalValue,
        total_items: totalItems,
        bill_amount: orderConfig.serviceType === 'Produce' ? (orderConfig.billAmount || null) : null,
        notes: null,
        vendor_id: vendorId
    };

    // Delivery day on upcoming_orders: use vendor's delivery day when we have a vendor (so record matches vendors table)
    let deliveryDayForRecord: string | null = deliveryDay;
    if (vendorId) {
        const vendor = vendors.find(v => v.id === vendorId);
        if (vendor) {
            const vDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
            const arr = Array.isArray(vDays) ? vDays : (typeof vDays === 'string' ? (() => { try { return JSON.parse(vDays); } catch { return []; } })() : []);
            if (arr.length > 0) {
                const vendorDays = arr.map((d: unknown) => (typeof d === 'string' ? d : '')).filter(Boolean);
                // Prefer passed deliveryDay if it's one of the vendor's days; else use vendor's first day
                const normalizedPassed = deliveryDay ? normalizeDeliveryDayForVendor(deliveryDay) : null;
                if (normalizedPassed && vendorDays.includes(normalizedPassed)) {
                    deliveryDayForRecord = normalizedPassed;
                } else {
                    deliveryDayForRecord = vendorDays[0];
                }
            }
        }
    }
    if (deliveryDayForRecord) {
        upcomingOrderData.delivery_day = deliveryDayForRecord;
    }

    // Check if upcoming order exists for this delivery day
    // IMPORTANT: Must filter by service_type to avoid conflicts between Food and Boxes orders
    let existing;
    if (deliveryDayForRecord) {
        const { data: existingData } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('client_id', clientId)
            .eq('service_type', serviceTypeForUpcomingOrders)
            .eq('delivery_day', deliveryDayForRecord)
            .maybeSingle();
        existing = existingData;
    } else {
        // For backward compatibility, check for orders without delivery_day
        const { data: existingData } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('client_id', clientId)
            .eq('service_type', serviceTypeForUpcomingOrders)
            .is('delivery_day', null)
            .maybeSingle();
        existing = existingData;
    }

    console.log('[syncSingleOrderForDeliveryDay] Checking existing', {
        deliveryDay: deliveryDayForRecord,
        foundExisting: !!existing,
        existingId: existing?.id,
        willCreateNew: !existing
    });

    let upcomingOrderId: string;

    if (existing) {
        // Update existing
        // First, check if existing order has order_number
        const { data: existingOrder } = await supabase
            .from('upcoming_orders')
            .select('order_number')
            .eq('id', existing.id)
            .single();
        
        // If existing order doesn't have order_number, generate one
        if (existingOrder && (!existingOrder.order_number || existingOrder.order_number < 100000)) {
            // Generate unique order_number using helper function
            const nextOrderNumber = await generateUniqueOrderNumber();
            
            // Add order_number to update payload
            upcomingOrderData.order_number = nextOrderNumber;
        }
        
        const updatePayload: any = {};
        for (const [key, value] of Object.entries(upcomingOrderData)) {
            if (value !== undefined) {
                if (key === 'delivery_distribution' && typeof value !== 'string') {
                    updatePayload[key] = value; // Supabase handles JSON automatically
                } else {
                    updatePayload[key] = value;
                }
            }
        }
        
        const { error: updateError } = await supabase
            .from('upcoming_orders')
            .update(updatePayload)
            .eq('id', existing.id);
        
        if (updateError) {
            // Check for RLS/permission errors
            const isRLSError = updateError?.code === 'PGRST301' || 
                              updateError?.message?.includes('permission denied') || 
                              updateError?.message?.includes('RLS') ||
                              updateError?.message?.includes('row-level security');
            
            console.error('[syncSingleOrderForDeliveryDay] Error updating upcoming order:', {
                error: updateError,
                errorCode: updateError?.code,
                errorMessage: updateError?.message,
                isRLSError,
                upcomingOrderId: existing.id
            });
            
            if (isRLSError) {
                throw new Error(`Database permission error: Row-level security (RLS) is blocking this operation. Please ensure SUPABASE_SERVICE_ROLE_KEY is configured correctly.`);
            }
            
            throw new Error(`Failed to update upcoming order: ${updateError.message || 'Unknown error'}`);
        }
        
        upcomingOrderId = existing.id;
    } else {
        // Insert new - Generate unique order_number before inserting
        const nextOrderNumber = await generateUniqueOrderNumber();
        
        const upcomingOrderId_new = randomUUID();
        const insertPayload = { 
            ...upcomingOrderData, 
            id: upcomingOrderId_new,
            order_number: nextOrderNumber
        };
        
        const { data: insertedData, error: insertError } = await supabase
            .from('upcoming_orders')
            .insert([insertPayload])
            .select()
            .single();
        
        if (insertError || !insertedData) {
            // Check for RLS/permission errors
            const isRLSError = insertError?.code === 'PGRST301' || 
                              insertError?.message?.includes('permission denied') || 
                              insertError?.message?.includes('RLS') ||
                              insertError?.message?.includes('row-level security');
            
            const errorDetails = {
                error: insertError,
                errorCode: insertError?.code,
                errorMessage: insertError?.message,
                insertPayload: {
                    ...insertPayload,
                    // Don't log sensitive data, but show structure
                    client_id: insertPayload.client_id,
                    service_type: insertPayload.service_type,
                    case_id: insertPayload.case_id ? '***' : null,
                    status: insertPayload.status
                },
                originalServiceType: orderConfig.serviceType,
                normalizedServiceType: serviceType,
                isRLSError
            };
            
            console.error('[syncSingleOrderForDeliveryDay] Error creating upcoming order:', errorDetails);
            
            if (isRLSError) {
                throw new Error(`Database permission error: Row-level security (RLS) is blocking this operation. Please ensure SUPABASE_SERVICE_ROLE_KEY is configured correctly.`);
            }
            
            // Provide more specific error messages based on error type
            let userFriendlyMessage = `Failed to create upcoming order`;
            if (insertError?.message) {
                if (insertError.message.includes('foreign key')) {
                    userFriendlyMessage = `Invalid reference: ${insertError.message}`;
                } else if (insertError.message.includes('NOT NULL')) {
                    userFriendlyMessage = `Missing required field: ${insertError.message}`;
                } else if (insertError.message.includes('unique constraint') || insertError.message.includes('duplicate')) {
                    userFriendlyMessage = `Order already exists. Please refresh the page.`;
                } else {
                    userFriendlyMessage = insertError.message;
                }
            }
            
            throw new Error(`${userFriendlyMessage}. Service type: ${serviceType} (original: ${orderConfig.serviceType})`);
        }
        
        upcomingOrderId = upcomingOrderId_new;
    }

    // Now sync related data (vendor selections, items, box selections)
    // Delete existing related records to avoid duplicates
    // Delete all items for this upcoming order first (by upcoming_order_id for safety)
    const { error: deleteItemsError } = await supabase
        .from('upcoming_order_items')
        .delete()
        .eq('upcoming_order_id', upcomingOrderId);
    
    if (deleteItemsError) {
        console.warn(`[syncSingleOrderForDeliveryDay] Error deleting existing items: ${deleteItemsError.message}`);
        // Don't throw - we'll try to insert anyway and let the insert fail if there's a conflict
    }
    
    // Delete vendor selections (cascade should handle items, but we already deleted them above)
    const { error: deleteVSError } = await supabase
        .from('upcoming_order_vendor_selections')
        .delete()
        .eq('upcoming_order_id', upcomingOrderId);
    
    if (deleteVSError) {
        console.warn(`[syncSingleOrderForDeliveryDay] Error deleting existing vendor selections: ${deleteVSError.message}`);
    }
    
    // Delete box selections
    const { error: deleteBoxError } = await supabase
        .from('upcoming_order_box_selections')
        .delete()
        .eq('upcoming_order_id', upcomingOrderId);
    
    if (deleteBoxError) {
        console.warn(`[syncSingleOrderForDeliveryDay] Error deleting existing box selections: ${deleteBoxError.message}`);
    }
    
    console.log(`[syncSingleOrderForDeliveryDay] Cleaned up existing related records for upcoming_order_id: ${upcomingOrderId}`);

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections) {
        // Insert vendor selections and items
        let calculatedTotalFromItems = 0;
        const allVendorSelections: any[] = [];

        console.log(`[syncSingleOrderForDeliveryDay] Starting to insert items for upcoming_order_id: ${upcomingOrderId}`, {
            vendorSelectionsCount: orderConfig.vendorSelections.length,
            vendorSelections: orderConfig.vendorSelections.map((vs: any) => ({
                vendorId: vs.vendorId,
                hasItems: !!vs.items,
                itemCount: vs.items ? Object.keys(vs.items).length : 0,
                items: vs.items
            }))
        });

        for (const selection of orderConfig.vendorSelections) {
            if (!selection.vendorId || !selection.items) {
                console.log(`[syncSingleOrderForDeliveryDay] Skipping vendor selection - missing vendorId or items`, {
                    vendorId: selection.vendorId,
                    hasItems: !!selection.items,
                    items: selection.items
                });
                continue;
            }

            // Validate required fields before creating vendor selection
            if (!upcomingOrderId) {
                throw new Error(`Cannot create vendor selection: upcomingOrderId is missing`);
            }
            if (!selection.vendorId) {
                console.warn(`[syncSingleOrderForDeliveryDay] Skipping vendor selection - vendorId is missing`);
                continue;
            }

            console.log(`[syncSingleOrderForDeliveryDay] Creating vendor selection for vendor ${selection.vendorId}`);
            const vsId = randomUUID();
            const vsInsertPayload = { 
                id: vsId, 
                upcoming_order_id: upcomingOrderId, 
                vendor_id: selection.vendorId 
            };
            
            console.log(`[syncSingleOrderForDeliveryDay] Vendor selection insert payload:`, vsInsertPayload);
            
            const { data: vsData, error: vsError } = await supabase
                .from('upcoming_order_vendor_selections')
                .insert([vsInsertPayload])
                .select()
                .single();
            
            if (vsError) {
                const errorMsg = `Failed to create vendor selection for vendor ${selection.vendorId}: ${vsError.message}`;
                console.error(`[syncSingleOrderForDeliveryDay] Error creating vendor selection:`, {
                    error: vsError,
                    payload: vsInsertPayload,
                    errorDetails: vsError
                });
                throw new Error(errorMsg);
            }
            
            if (!vsData) {
                const errorMsg = `Vendor selection insert returned no data for vendor ${selection.vendorId}`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            const vendorSelection = { id: vsData.id, upcoming_order_id: upcomingOrderId, vendor_id: selection.vendorId };
            allVendorSelections.push(vendorSelection);
            console.log(`[syncSingleOrderForDeliveryDay] Created vendor selection ${vendorSelection.id} for vendor ${selection.vendorId}`);

            // Insert items
            // For upcoming orders, use upcoming_vendor_selection_id (from upcoming_order_vendor_selections)
            // vendor_selection_id should be NULL for upcoming orders (it's nullable in the schema)
            const itemInsertErrors: string[] = [];
            for (const [itemId, qty] of Object.entries(selection.items)) {
                // Skip invalid item keys (null/undefined/empty from UI or stale data)
                if (itemId == null || itemId === '' || String(itemId) === 'null') {
                    console.warn(`[syncSingleOrderForDeliveryDay] Skipping invalid item key: ${itemId}`);
                    continue;
                }
                const item = menuItems.find(i => i.id === itemId);
                const quantity = typeof qty === 'number' ? qty : Number(qty) || 0;
                
                // Validate item exists and quantity is valid
                if (!item) {
                    console.error(`[syncSingleOrderForDeliveryDay] Item not found: ${itemId}`);
                    itemInsertErrors.push(`Item ${itemId} not found in menu items`);
                    continue;
                }
                
                if (!quantity || quantity <= 0) {
                    console.log(`[syncSingleOrderForDeliveryDay] Skipping item ${itemId} - quantity is 0 or invalid`);
                    continue;
                }

                // Validate required IDs
                if (!upcomingOrderId) {
                    throw new Error(`Cannot insert items: upcomingOrderId is missing`);
                }
                if (!vendorSelection.id) {
                    throw new Error(`Cannot insert items: vendorSelection.id is missing for vendor ${selection.vendorId}`);
                }
                if (!itemId) {
                    throw new Error(`Cannot insert items: itemId is missing`);
                }

                // Use priceEach if available, otherwise fall back to value
                const itemPrice = item.priceEach ?? item.value;
                const itemTotal = itemPrice * quantity;
                console.log(`[syncSingleOrderForDeliveryDay] Inserting item:`, {
                    itemId,
                    itemName: item.name,
                    quantity,
                    itemPrice,
                    itemValue: item.value,
                    itemPriceEach: item.priceEach,
                    itemTotal,
                    calculatedTotalBefore: calculatedTotalFromItems,
                    upcomingOrderId,
                    upcomingVendorSelectionId: vendorSelection.id
                });
                calculatedTotalFromItems += itemTotal;
                console.log(`[syncSingleOrderForDeliveryDay] Updated calculatedTotalFromItems: ${calculatedTotalFromItems}`);

                const itemId_uuid = randomUUID();
                const insertPayload = {
                    id: itemId_uuid,
                    upcoming_order_id: upcomingOrderId,
                    vendor_selection_id: null, // NULL for upcoming orders
                    upcoming_vendor_selection_id: vendorSelection.id, // Use the ID from upcoming_order_vendor_selections
                    menu_item_id: itemId,
                    quantity: quantity
                };

                console.log(`[syncSingleOrderForDeliveryDay] Insert payload:`, insertPayload);

                const { data: insertedItem, error: itemError } = await supabase
                    .from('upcoming_order_items')
                    .insert([insertPayload])
                    .select()
                    .single();
                
                if (itemError) {
                    const errorMsg = `Failed to insert item ${itemId} (${item.name}): ${itemError.message}`;
                    console.error(`[syncSingleOrderForDeliveryDay] Error inserting item:`, {
                        error: itemError,
                        payload: insertPayload,
                        errorDetails: itemError
                    });
                    itemInsertErrors.push(errorMsg);
                } else if (!insertedItem) {
                    const errorMsg = `Item ${itemId} insert returned no data`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
                    itemInsertErrors.push(errorMsg);
                } else {
                    console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted item ${itemId} (${item.name}) with id ${insertedItem.id}`);
                }
            }

            // If any items failed to insert, throw an error
            if (itemInsertErrors.length > 0) {
                throw new Error(`Failed to insert ${itemInsertErrors.length} item(s) for vendor ${selection.vendorId}: ${itemInsertErrors.join('; ')}`);
            }
        }

        console.log(`[syncSingleOrderForDeliveryDay] Final calculatedTotalFromItems: ${calculatedTotalFromItems}`);
        console.log(`[syncSingleOrderForDeliveryDay] Original totalValue: ${totalValue}`);

        // Update total_value to match calculated total from items
        if (calculatedTotalFromItems !== totalValue) {
            console.log(`[syncSingleOrderForDeliveryDay] Mismatch detected! Updating total_value from ${totalValue} to ${calculatedTotalFromItems}`);
            totalValue = calculatedTotalFromItems;
            try {
                await supabase
                    .from('upcoming_orders')
                    .update({ total_value: totalValue })
                    .eq('id', upcomingOrderId);
                console.log(`[syncSingleOrderForDeliveryDay] Successfully updated total_value to ${totalValue}`);
            } catch (error) {
                console.error(`[syncSingleOrderForDeliveryDay] Error updating total_value:`, error);
            }
        } else {
            console.log(`[syncSingleOrderForDeliveryDay] Total values match, no update needed`);
        }

        // Add total as a separate item in the upcoming_order_items table
        // Use the first vendor selection to attach the total item
        // Note: menu_item_id can be null for total items, but this might cause issues with NOT NULL constraint
        // Let's skip inserting total items for now since they're not strictly necessary
        // The total_value is already stored in the upcoming_orders table
        if (allVendorSelections.length > 0 && calculatedTotalFromItems > 0) {
            console.log(`[syncSingleOrderForDeliveryDay] Skipping total item insertion - total_value (${calculatedTotalFromItems}) is stored in upcoming_orders table`);
            // Note: We don't insert a total item because menu_item_id is NOT NULL in the schema
            // The total is already calculated and stored in upcoming_orders.total_value
        }
    } else if (orderConfig.serviceType === 'Custom') {
        // Handle Custom orders - create vendor selection and custom items
        console.log('[syncSingleOrderForDeliveryDay] Processing Custom order for upcoming_order_id:', upcomingOrderId);
        const customItems = (orderConfig as any).customItems || [];
        console.log('[syncSingleOrderForDeliveryDay] Custom orderConfig:', {
            vendorId: orderConfig.vendorId,
            customItemsCount: customItems.length,
            customItems: customItems.map((item: any) => ({
                name: item.name,
                price: item.price,
                quantity: item.quantity
            }))
        });

        if (!orderConfig.vendorId || orderConfig.vendorId.trim() === '') {
            const errorMsg = `Cannot save Custom order: No vendor selected. Please select a vendor.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                hasVendorId: !!orderConfig.vendorId
            });
            throw new Error(errorMsg);
        }

        if (!Array.isArray(customItems) || customItems.length === 0) {
            const errorMsg = `Cannot save Custom order: No custom items found. Please add at least one custom item.`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                serviceType: orderConfig.serviceType,
                customItemsCount: customItems.length
            });
            throw new Error(errorMsg);
        }

        // Create vendor selection for Custom order
        console.log(`[syncSingleOrderForDeliveryDay] Creating vendor selection for Custom order vendor ${orderConfig.vendorId}`);
        const vsId = randomUUID();
        const vsInsertPayload = { 
            id: vsId, 
            upcoming_order_id: upcomingOrderId, 
            vendor_id: orderConfig.vendorId 
        };
        
        console.log(`[syncSingleOrderForDeliveryDay] Vendor selection insert payload:`, vsInsertPayload);
        
        const { data: vsData, error: vsError } = await supabase
            .from('upcoming_order_vendor_selections')
            .insert([vsInsertPayload])
            .select()
            .single();
        
        if (vsError) {
            const errorMsg = `Failed to create vendor selection for Custom order vendor ${orderConfig.vendorId}: ${vsError.message}`;
            console.error(`[syncSingleOrderForDeliveryDay] Error creating vendor selection:`, {
                error: vsError,
                payload: vsInsertPayload,
                errorDetails: vsError
            });
            throw new Error(errorMsg);
        }
        
        if (!vsData) {
            const errorMsg = `Vendor selection insert returned no data for Custom order vendor ${orderConfig.vendorId}`;
            console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
            throw new Error(errorMsg);
        }
        
        const vendorSelection = { id: vsData.id, upcoming_order_id: upcomingOrderId, vendor_id: orderConfig.vendorId };
        console.log(`[syncSingleOrderForDeliveryDay] Created vendor selection ${vendorSelection.id} for Custom order vendor ${orderConfig.vendorId}`);

        // Insert custom items
        const itemInsertErrors: string[] = [];
        let calculatedTotalFromItems = 0;
        
        for (const item of customItems) {
            if (!item.name || !item.name.trim() || !item.price || item.price <= 0 || !item.quantity || item.quantity <= 0) {
                console.warn(`[syncSingleOrderForDeliveryDay] Skipping invalid custom item:`, item);
                continue;
            }

            const itemPrice = parseFloat(item.price);
            const quantity = parseInt(item.quantity);
            const itemTotal = itemPrice * quantity;
            calculatedTotalFromItems += itemTotal;

            console.log(`[syncSingleOrderForDeliveryDay] Inserting custom item:`, {
                name: item.name,
                price: itemPrice,
                quantity: quantity,
                itemTotal,
                calculatedTotalBefore: calculatedTotalFromItems - itemTotal,
                upcomingOrderId,
                upcomingVendorSelectionId: vendorSelection.id
            });

            const itemId_uuid = randomUUID();
            const insertPayload = {
                id: itemId_uuid,
                upcoming_order_id: upcomingOrderId,
                vendor_selection_id: null, // NULL for upcoming orders
                upcoming_vendor_selection_id: vendorSelection.id, // Use the ID from upcoming_order_vendor_selections
                menu_item_id: null, // NULL for custom items
                quantity: quantity,
                custom_name: item.name.trim(),
                custom_price: itemPrice
            };

            console.log(`[syncSingleOrderForDeliveryDay] Custom item insert payload:`, insertPayload);

            const { data: insertedItem, error: itemError } = await supabase
                .from('upcoming_order_items')
                .insert([insertPayload])
                .select()
                .single();
            
            if (itemError) {
                const errorMsg = `Failed to insert custom item "${item.name}": ${itemError.message}`;
                console.error(`[syncSingleOrderForDeliveryDay] Error inserting custom item:`, {
                    error: itemError,
                    payload: insertPayload,
                    errorDetails: itemError
                });
                itemInsertErrors.push(errorMsg);
            } else if (!insertedItem) {
                const errorMsg = `Custom item "${item.name}" insert returned no data`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
                itemInsertErrors.push(errorMsg);
            } else {
                console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted custom item "${item.name}" with id ${insertedItem.id}`);
            }
        }

        // If any items failed to insert, throw an error
        if (itemInsertErrors.length > 0) {
            throw new Error(`Failed to insert ${itemInsertErrors.length} custom item(s): ${itemInsertErrors.join('; ')}`);
        }

        console.log(`[syncSingleOrderForDeliveryDay] Final calculatedTotalFromItems for Custom order: ${calculatedTotalFromItems}`);
        console.log(`[syncSingleOrderForDeliveryDay] Original totalValue: ${totalValue}`);

        // Update total_value to match calculated total from items
        if (calculatedTotalFromItems !== totalValue) {
            console.log(`[syncSingleOrderForDeliveryDay] Mismatch detected! Updating total_value from ${totalValue} to ${calculatedTotalFromItems}`);
            totalValue = calculatedTotalFromItems;
            try {
                await supabase
                    .from('upcoming_orders')
                    .update({ total_value: totalValue })
                    .eq('id', upcomingOrderId);
                console.log(`[syncSingleOrderForDeliveryDay] Successfully updated total_value to ${totalValue}`);
            } catch (error) {
                console.error(`[syncSingleOrderForDeliveryDay] Error updating total_value:`, error);
            }
        } else {
            console.log(`[syncSingleOrderForDeliveryDay] Total values match, no update needed`);
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        console.log('[syncSingleOrderForDeliveryDay] Processing Boxes order for upcoming_order_id:', upcomingOrderId);
        console.log('[syncSingleOrderForDeliveryDay] Box orderConfig:', {
            vendorId: orderConfig.vendorId,
            boxTypeId: orderConfig.boxTypeId,
            boxQuantity: orderConfig.boxQuantity,
            hasBoxOrders: !!(orderConfig as any)?.boxOrders && Array.isArray((orderConfig as any).boxOrders),
            boxOrdersCount: (orderConfig as any)?.boxOrders?.length || 0,
            hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0
        });

        // CRITICAL FIX: Check for boxOrders array first (new structure)
        const boxOrders = (orderConfig as any)?.boxOrders;
        const hasBoxOrdersArray = boxOrders && Array.isArray(boxOrders) && boxOrders.length > 0;

        if (hasBoxOrdersArray) {
            // NEW STRUCTURE: Process each box in the boxOrders array
            console.log(`[syncSingleOrderForDeliveryDay] Processing ${boxOrders.length} box(es) from boxOrders array`);
            
            const allBoxInsertErrors: string[] = [];
            
            for (let boxIndex = 0; boxIndex < boxOrders.length; boxIndex++) {
                const box = boxOrders[boxIndex];
                console.log(`[syncSingleOrderForDeliveryDay] Processing box ${boxIndex + 1}/${boxOrders.length}:`, {
                    boxNumber: box.boxNumber || (boxIndex + 1),
                    vendorId: box.vendorId,
                    boxTypeId: box.boxTypeId,
                    quantity: box.quantity || 1,
                    itemsCount: box.items ? Object.keys(box.items).length : 0
                });

                // Get vendor ID from this box, with fallbacks
                let boxVendorId = (box.vendorId && box.vendorId.trim() !== '') ? box.vendorId : null;
                
                // Fallback to boxType vendorId
                if (!boxVendorId && box.boxTypeId) {
                    const boxType = boxTypes.find(bt => bt.id === box.boxTypeId);
                    boxVendorId = boxType?.vendorId || null;
                    console.log(`[syncSingleOrderForDeliveryDay] Box ${boxIndex + 1}: Vendor ID from boxType:`, { boxTypeId: box.boxTypeId, vendorId: boxVendorId });
                }
                
                // Fallback to top-level vendorId for backward compatibility
                if (!boxVendorId && orderConfig.vendorId && orderConfig.vendorId.trim() !== '') {
                    boxVendorId = orderConfig.vendorId;
                    console.log(`[syncSingleOrderForDeliveryDay] Box ${boxIndex + 1}: Using top-level vendorId:`, boxVendorId);
                }

                // Fallback to first menu item's vendorId
                const boxItemsRaw = box.items || {};
                if (!boxVendorId && Object.keys(boxItemsRaw).length > 0) {
                    const firstItemId = Object.keys(boxItemsRaw)[0];
                    const firstItem = menuItems.find(i => i.id === firstItemId);
                    if (firstItem?.vendorId) {
                        boxVendorId = firstItem.vendorId;
                        console.log(`[syncSingleOrderForDeliveryDay] Box ${boxIndex + 1}: Vendor ID from first menu item:`, { itemId: firstItemId, vendorId: boxVendorId });
                    }
                }

                // Validate that vendor ID is not null before proceeding
                if (!boxVendorId) {
                    const errorMsg = `Cannot insert box selection ${boxIndex + 1}: vendor_id is required but could not be determined. Please ensure the box has a vendor ID set in box.vendorId, boxType.vendorId, or menu items have vendorId.`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                        boxVendorId: box.vendorId,
                        boxTypeId: box.boxTypeId,
                        boxTypeVendorId: box.boxTypeId ? boxTypes.find(bt => bt.id === box.boxTypeId)?.vendorId : null,
                        boxItemsCount: Object.keys(boxItemsRaw).length,
                        firstItemVendorId: Object.keys(boxItemsRaw).length > 0 ? menuItems.find(i => i.id === Object.keys(boxItemsRaw)[0])?.vendorId : null
                    });
                    allBoxInsertErrors.push(errorMsg);
                    continue; // Skip this box but continue with others
                }

                // Extract items and prices from this box
                const boxItemPrices = box.itemPrices || {};
                const boxItems: any = {};
                for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                    const price = boxItemPrices[itemId];
                    if (price !== undefined && price !== null) {
                        boxItems[itemId] = { quantity: qty, price: price };
                    } else {
                        boxItems[itemId] = qty;
                    }
                }

                // Calculate total from item prices for this box
                let calculatedTotal = 0;
                for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                    const quantity = typeof qty === 'number' ? qty : 0;
                    const price = boxItemPrices[itemId];
                    if (price !== undefined && price !== null && quantity > 0) {
                        calculatedTotal += price * quantity;
                    }
                }

                const boxQuantity = box.quantity || 1;
                const boxSelectionId = randomUUID();
                const boxSelectionPayload = {
                    id: boxSelectionId,
                    upcoming_order_id: upcomingOrderId,
                    vendor_id: boxVendorId,
                    box_type_id: box.boxTypeId || null,
                    quantity: boxQuantity,
                    items: boxItems
                };

                console.log(`[syncSingleOrderForDeliveryDay] Box ${boxIndex + 1} selection insert payload:`, {
                    ...boxSelectionPayload,
                    items: boxItems // Log items separately for readability
                });

                try {
                    const { data: insertedBoxSelection, error: boxSelectionError } = await supabase
                        .from('upcoming_order_box_selections')
                        .insert([boxSelectionPayload])
                        .select()
                        .single();
                    
                    if (boxSelectionError) {
                        const errorMsg = `Failed to insert box selection ${boxIndex + 1}: ${boxSelectionError.message}`;
                        console.error(`[syncSingleOrderForDeliveryDay] Error inserting box selection:`, {
                            error: boxSelectionError,
                            payload: boxSelectionPayload,
                            errorDetails: boxSelectionError
                        });
                        allBoxInsertErrors.push(errorMsg);
                        continue;
                    }

                    if (!insertedBoxSelection) {
                        const errorMsg = `Box selection ${boxIndex + 1} insert returned no data`;
                        console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
                        allBoxInsertErrors.push(errorMsg);
                        continue;
                    }
                    
                    console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted box selection ${insertedBoxSelection.id} for box ${boxIndex + 1}, vendor_id=${boxVendorId}, items_count=${Object.keys(boxItems).length}`);

                    // Now save box items as individual records in upcoming_order_items table
                    if (boxItemsRaw && Object.keys(boxItemsRaw).length > 0) {
                        const itemInsertErrors: string[] = [];
                        for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                            if (itemId == null || itemId === '' || String(itemId) === 'null') {
                                console.warn(`[syncSingleOrderForDeliveryDay] Skipping invalid box ${boxIndex + 1} item key: ${itemId}`);
                                continue;
                            }
                            const item = menuItems.find(i => i.id === itemId);
                            const quantity = typeof qty === 'number' ? qty : Number(qty) || 0;
                            
                            if (!item) {
                                console.error(`[syncSingleOrderForDeliveryDay] Box ${boxIndex + 1} item not found: ${itemId}`);
                                itemInsertErrors.push(`Item ${itemId} not found in menu items`);
                                continue;
                            }
                            
                            if (!quantity || quantity <= 0) {
                                console.log(`[syncSingleOrderForDeliveryDay] Skipping box ${boxIndex + 1} item ${itemId} - quantity is 0 or invalid`);
                                continue;
                            }

                            // Get price from itemPrices or fall back to item's priceEach/value
                            const itemPrice = boxItemPrices[itemId] ?? item.priceEach ?? item.value;

                            const itemId_uuid = randomUUID();
                            const insertPayload = {
                                id: itemId_uuid,
                                upcoming_order_id: upcomingOrderId,
                                vendor_selection_id: null,
                                upcoming_vendor_selection_id: null,
                                menu_item_id: itemId,
                                quantity: quantity
                            };

                            const { data: insertedItem, error: itemError } = await supabase
                                .from('upcoming_order_items')
                                .insert([insertPayload])
                                .select()
                                .single();
                            
                            if (itemError) {
                                const errorMsg = `Failed to insert box ${boxIndex + 1} item ${itemId} (${item.name}): ${itemError.message}`;
                                console.error(`[syncSingleOrderForDeliveryDay] Error inserting box item:`, {
                                    error: itemError,
                                    payload: insertPayload
                                });
                                itemInsertErrors.push(errorMsg);
                            } else if (!insertedItem) {
                                const errorMsg = `Box ${boxIndex + 1} item ${itemId} insert returned no data`;
                                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
                                itemInsertErrors.push(errorMsg);
                            } else {
                                console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted box ${boxIndex + 1} item ${itemId} (${item.name})`);
                            }
                        }

                        if (itemInsertErrors.length > 0) {
                            allBoxInsertErrors.push(...itemInsertErrors);
                        }
                    }
                } catch (error: any) {
                    const errorMsg = `Exception inserting box selection ${boxIndex + 1}: ${error.message}`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, error);
                    allBoxInsertErrors.push(errorMsg);
                }
            }

            // If any boxes failed to insert, throw an error
            if (allBoxInsertErrors.length > 0) {
                throw new Error(`Failed to process ${allBoxInsertErrors.length} box-related operation(s): ${allBoxInsertErrors.join('; ')}`);
            }
        } else {
            // LEGACY STRUCTURE: Fallback to old single-box structure
            console.log('[syncSingleOrderForDeliveryDay] Using legacy single-box structure (no boxOrders array)');
            
            // Insert box selection with prices
            const quantity = orderConfig.boxQuantity || 1;

            // Get vendor ID from orderConfig, or from boxType if boxTypeId is present
            let boxVendorId = (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') ? orderConfig.vendorId : null;
            if (!boxVendorId && orderConfig.boxTypeId) {
                const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
                boxVendorId = boxType?.vendorId || null;
                console.log('[syncSingleOrderForDeliveryDay] Vendor ID from boxType:', { boxTypeId: orderConfig.boxTypeId, vendorId: boxVendorId });
            }

            const boxItemsRaw = (orderConfig as any).items || {};
            const boxItemPrices = (orderConfig as any).itemPrices || {};
            const boxItems: any = {};
            for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                const price = boxItemPrices[itemId];
                if (price !== undefined && price !== null) {
                    boxItems[itemId] = { quantity: qty, price: price };
                } else {
                    boxItems[itemId] = qty;
                }
            }

            // If vendor ID is still null, try to get it from the first menu item in the box
            if (!boxVendorId && Object.keys(boxItemsRaw).length > 0) {
                const firstItemId = Object.keys(boxItemsRaw)[0];
                const firstItem = menuItems.find(i => i.id === firstItemId);
                if (firstItem?.vendorId) {
                    boxVendorId = firstItem.vendorId;
                    console.log('[syncSingleOrderForDeliveryDay] Vendor ID from first menu item:', { itemId: firstItemId, vendorId: boxVendorId });
                }
            }

            // Validate that vendor ID is not null before proceeding
            if (!boxVendorId) {
                const errorMsg = `Cannot insert box selection: vendor_id is required but could not be determined. Please ensure the box has a vendor ID set in orderConfig.vendorId, boxType.vendorId, or menu items have vendorId.`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                    orderConfigVendorId: orderConfig.vendorId,
                    boxTypeId: orderConfig.boxTypeId,
                    boxTypeVendorId: orderConfig.boxTypeId ? boxTypes.find(bt => bt.id === orderConfig.boxTypeId)?.vendorId : null,
                    boxItemsCount: Object.keys(boxItemsRaw).length,
                    firstItemVendorId: Object.keys(boxItemsRaw).length > 0 ? menuItems.find(i => i.id === Object.keys(boxItemsRaw)[0])?.vendorId : null
                });
                throw new Error(errorMsg);
            }

            // Calculate total from item prices
            let calculatedTotal = 0;
            for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                const qtyNum = typeof qty === 'number' ? qty : 0;
                const price = boxItemPrices[itemId];
                if (price !== undefined && price !== null && qtyNum > 0) {
                    calculatedTotal += price * qtyNum;
                }
            }

            const boxSelectionId = randomUUID();
            const boxSelectionPayload = {
                id: boxSelectionId,
                upcoming_order_id: upcomingOrderId,
                vendor_id: boxVendorId,
                box_type_id: orderConfig.boxTypeId || null,
                quantity,
                items: boxItems
            };

            console.log(`[syncSingleOrderForDeliveryDay] Box selection insert payload (legacy):`, {
                ...boxSelectionPayload,
                items: boxItems
            });

            const { data: insertedBoxSelection, error: boxSelectionError } = await supabase
                .from('upcoming_order_box_selections')
                .insert([boxSelectionPayload])
                .select()
                .single();
            
            if (boxSelectionError) {
                const errorMsg = `Failed to insert box selection: ${boxSelectionError.message}`;
                console.error(`[syncSingleOrderForDeliveryDay] Error inserting box selection:`, {
                    error: boxSelectionError,
                    payload: boxSelectionPayload,
                    errorDetails: boxSelectionError
                });
                throw new Error(errorMsg);
            }

            if (!insertedBoxSelection) {
                const errorMsg = `Box selection insert returned no data`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
                throw new Error(errorMsg);
            }
            
            console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted box selection ${insertedBoxSelection.id} for upcoming_order_id=${upcomingOrderId}, vendor_id=${boxVendorId}, items_count=${Object.keys(boxItems).length}`);

            // Now save box items as individual records
            if (boxItemsRaw && Object.keys(boxItemsRaw).length > 0) {
                const itemInsertErrors: string[] = [];
                for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                    if (itemId == null || itemId === '' || String(itemId) === 'null') {
                        console.warn(`[syncSingleOrderForDeliveryDay] Skipping invalid box item key: ${itemId}`);
                        continue;
                    }
                    const item = menuItems.find(i => i.id === itemId);
                    const quantity = typeof qty === 'number' ? qty : Number(qty) || 0;
                    
                    if (!item) {
                        console.error(`[syncSingleOrderForDeliveryDay] Box item not found: ${itemId}`);
                        itemInsertErrors.push(`Item ${itemId} not found in menu items`);
                        continue;
                    }
                    
                    if (!quantity || quantity <= 0) {
                        console.log(`[syncSingleOrderForDeliveryDay] Skipping box item ${itemId} - quantity is 0 or invalid`);
                        continue;
                    }

                    // Get price from itemPrices or fall back to item's priceEach/value
                    const itemPrice = boxItemPrices[itemId] ?? item.priceEach ?? item.value;

                    const itemId_uuid = randomUUID();
                    const insertPayload = {
                        id: itemId_uuid,
                        upcoming_order_id: upcomingOrderId,
                        vendor_selection_id: null,
                        upcoming_vendor_selection_id: null,
                        menu_item_id: itemId,
                        quantity: quantity
                    };

                    const { data: insertedItem, error: itemError } = await supabase
                        .from('upcoming_order_items')
                        .insert([insertPayload])
                        .select()
                        .single();
                    
                    if (itemError) {
                        const errorMsg = `Failed to insert box item ${itemId} (${item.name}): ${itemError.message}`;
                        console.error(`[syncSingleOrderForDeliveryDay] Error inserting box item:`, {
                            error: itemError,
                            payload: insertPayload
                        });
                        itemInsertErrors.push(errorMsg);
                    } else if (!insertedItem) {
                        const errorMsg = `Box item ${itemId} insert returned no data`;
                        console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`);
                        itemInsertErrors.push(errorMsg);
                    } else {
                        console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted box item ${itemId} (${item.name}) with id ${insertedItem.id}`);
                    }
                }

                if (itemInsertErrors.length > 0) {
                    throw new Error(`Failed to insert ${itemInsertErrors.length} box item(s): ${itemInsertErrors.join('; ')}`);
                }
            }
        }
    }

    // CRITICAL: Always update client's active_order with vendor IDs from the upcoming order
    await updateClientActiveOrderFromUpcomingOrder(clientId, upcomingOrderId, deliveryDay, orderConfig.serviceType);
}

/**
 * Update client's active_order column with vendor IDs from the upcoming order
 * This ensures vendor information is always persisted in the clients table
 * CRITICAL: This function MUST be called after every upcoming order creation/update
 */
async function updateClientActiveOrderFromUpcomingOrder(
    clientId: string,
    upcomingOrderId: string,
    deliveryDay: string | null,
    serviceType: string
): Promise<void> {
    try {
        // Get current client's upcoming_order
        const { data: clientData } = await supabase
            .from('clients')
            .select('upcoming_order')
            .eq('id', clientId)
            .single();

        if (!clientData) {
            console.warn(`[updateClientActiveOrderFromUpcomingOrder] Client ${clientId} not found`);
            return;
        }

        const currentActiveOrder: any = clientData.upcoming_order || { serviceType };

        if (serviceType === 'Food') {
            // Get vendor IDs from upcoming_order_vendor_selections
            const { data: vendorSelections } = await supabase
                .from('upcoming_order_vendor_selections')
                .select('vendor_id')
                .eq('upcoming_order_id', upcomingOrderId);

            if (vendorSelections && vendorSelections.length > 0) {
                const vendorIds = vendorSelections.map((vs: any) => vs.vendor_id).filter(Boolean);
                
                if (vendorIds.length > 0) {
                    // Update active_order with vendor IDs organized by delivery day
                    if (deliveryDay) {
                        // If deliveryDayOrders format exists, update that day's vendor selections
                        if (!currentActiveOrder.deliveryDayOrders) {
                            currentActiveOrder.deliveryDayOrders = {};
                        }
                        if (!currentActiveOrder.deliveryDayOrders[deliveryDay]) {
                            currentActiveOrder.deliveryDayOrders[deliveryDay] = { vendorSelections: [] };
                        }
                        
                        // Preserve existing items if they exist, otherwise create new vendor selections
                        const existingDayOrder = currentActiveOrder.deliveryDayOrders[deliveryDay];
                        const existingVendorSelections = existingDayOrder.vendorSelections || [];
                        
                        // Update vendor selections for this day, preserving items where vendor IDs match
                        currentActiveOrder.deliveryDayOrders[deliveryDay].vendorSelections = vendorIds.map((vendorId: string) => {
                            // Try to find existing vendor selection with items
                            const existing = existingVendorSelections.find((vs: any) => vs.vendorId === vendorId);
                            return {
                                vendorId,
                                items: existing?.items || {}
                            };
                        });
                    } else {
                        // Update top-level vendorSelections, preserving existing items
                        const existingVendorSelections = currentActiveOrder.vendorSelections || [];
                        currentActiveOrder.vendorSelections = vendorIds.map((vendorId: string) => {
                            // Try to find existing vendor selection with items
                            const existing = existingVendorSelections.find((vs: any) => vs.vendorId === vendorId);
                            return {
                                vendorId,
                                items: existing?.items || {}
                            };
                        });
                    }
                    currentActiveOrder.serviceType = 'Food';
                }
            }
        } else if (serviceType === 'Boxes') {
            // Get all box selections from upcoming_order_box_selections with full data
            const { data: boxSelections } = await supabase
                .from('upcoming_order_box_selections')
                .select('vendor_id, box_type_id, quantity, items')
                .eq('upcoming_order_id', upcomingOrderId);

            if (boxSelections && boxSelections.length > 0) {
                // Convert box selections to boxOrders format (similar to how Food orders save vendorSelections)
                const boxOrders = boxSelections.map((box: any, index: number) => {
                    // Parse items from JSON if it's a string
                    let items: any = {};
                    if (box.items) {
                        if (typeof box.items === 'string') {
                            try {
                                items = JSON.parse(box.items);
                            } catch (e) {
                                console.error(`[updateClientActiveOrderFromUpcomingOrder] Error parsing box items JSON:`, e);
                                items = {};
                            }
                        } else if (typeof box.items === 'object') {
                            items = box.items;
                        }
                        
                        // Handle different JSON formats
                        // Format 1: { itemId: quantity }
                        // Format 2: { itemId: { quantity: number, price: number } }
                        if (items && typeof items === 'object' && !Array.isArray(items)) {
                            const normalizedItems: any = {};
                            for (const [itemId, val] of Object.entries(items)) {
                                if (val && typeof val === 'object' && 'quantity' in val) {
                                    normalizedItems[itemId] = (val as any).quantity;
                                } else if (typeof val === 'number') {
                                    normalizedItems[itemId] = val;
                                } else {
                                    normalizedItems[itemId] = val;
                                }
                            }
                            items = normalizedItems;
                        }
                    }
                    
                    return {
                        boxNumber: index + 1,
                        boxTypeId: box.box_type_id || null,
                        vendorId: box.vendor_id || null,
                        quantity: box.quantity || 1,
                        items: items
                    };
                });
                
                // Update active_order with boxOrders array, preserving other fields
                currentActiveOrder.boxOrders = boxOrders;
                currentActiveOrder.serviceType = 'Boxes';
                
                // Also set vendorId from first box for backward compatibility
                if (boxOrders.length > 0 && boxOrders[0].vendorId) {
                    currentActiveOrder.vendorId = boxOrders[0].vendorId;
                }
                
                console.log(`[updateClientActiveOrderFromUpcomingOrder] Updated active_order with ${boxOrders.length} box order(s) for Boxes service type`);
            }
        } else if (serviceType === 'Produce') {
            // For Produce orders, get billAmount from total_value in upcoming_orders
            const { data: upcomingOrder } = await supabase
                .from('upcoming_orders')
                .select('total_value')
                .eq('id', upcomingOrderId)
                .single();

            if (upcomingOrder) {
                // Update active_order with billAmount from total_value
                currentActiveOrder.billAmount = parseFloat(upcomingOrder.total_value) || 0;
                currentActiveOrder.serviceType = 'Produce';
                console.log(`[updateClientActiveOrderFromUpcomingOrder] Updated active_order with billAmount ${currentActiveOrder.billAmount} for Produce service type`);
            }
        }

        // Always update the clients table to ensure vendor IDs are persisted
        const currentTime = await getCurrentTime();
        const { error: updateError } = await supabase
            .from('clients')
            .update({
                upcoming_order: currentActiveOrder,
                updated_at: currentTime.toISOString()
            })
            .eq('id', clientId);

        if (updateError) {
            console.error(`[updateClientActiveOrderFromUpcomingOrder] Error updating client ${clientId} upcoming_order:`, updateError);
        } else {
            console.log(`[updateClientActiveOrderFromUpcomingOrder] Successfully updated client ${clientId} upcoming_order with vendor info from upcoming order ${upcomingOrderId} (deliveryDay: ${deliveryDay || 'none'})`);
        }
    } catch (error) {
        console.error(`[updateClientActiveOrderFromUpcomingOrder] Error updating client upcoming_order:`, error);
        // Don't throw - this is a non-critical update, but log it for debugging
    }
}

/**
 * Sync Current Order Request (activeOrder) to upcoming_orders table
 * This ensures upcoming_orders always reflects the latest order configuration
 * Now supports multiple orders per client (one per delivery day)
 */
export async function syncCurrentOrderToUpcoming(clientId: string, client: ClientProfile, skipClientUpdate: boolean = false) {
    console.log('[syncCurrentOrderToUpcoming] START', { 
        clientId, 
        serviceType: client.activeOrder?.serviceType,
        hasActiveOrder: !!client.activeOrder,
        activeOrderKeys: client.activeOrder ? Object.keys(client.activeOrder) : []
    });

    // CRITICAL: Never sync Produce to upcoming_orders. Produce uses active_orders only.
    const clientServiceType = client.serviceType ?? (client.activeOrder as any)?.serviceType;
    if (clientServiceType === 'Produce') {
        console.log('[syncCurrentOrderToUpcoming] Skipping Produce (active_orders only)');
        return;
    }

    // orderConfig is used for sync; may be updated to hydrated shape after draft persistence
    let orderConfig = client.activeOrder;

    console.log('[syncCurrentOrderToUpcoming] orderConfig received:', {
        serviceType: orderConfig?.serviceType,
        vendorId: orderConfig?.vendorId,
        boxTypeId: orderConfig?.boxTypeId,
        boxQuantity: orderConfig?.boxQuantity,
        caseId: orderConfig?.caseId ? '***' : null,
        hasVendorSelections: !!(orderConfig as any)?.vendorSelections,
        vendorSelectionsCount: (orderConfig as any)?.vendorSelections?.length || 0,
        hasDeliveryDayOrders: !!(orderConfig as any)?.deliveryDayOrders,
        deliveryDayOrdersKeys: (orderConfig as any)?.deliveryDayOrders ? Object.keys((orderConfig as any).deliveryDayOrders) : [],
        hasBoxOrders: !!(orderConfig as any)?.boxOrders && Array.isArray((orderConfig as any).boxOrders),
        boxOrdersCount: (orderConfig as any)?.boxOrders?.length || 0,
        hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0,
        itemsCount: (orderConfig as any)?.items ? Object.keys((orderConfig as any).items || {}).length : 0,
        hasCustomItems: !!(orderConfig as any)?.customItems && Array.isArray((orderConfig as any).customItems),
        customItemsCount: (orderConfig as any)?.customItems?.length || 0
    });
    // console.log('[syncCurrentOrderToUpcoming] orderConfig received:', {
    //     serviceType: orderConfig?.serviceType,
    //     vendorId: orderConfig?.vendorId,
    //     boxTypeId: orderConfig?.boxTypeId,
    //     boxQuantity: orderConfig?.boxQuantity,
    //     hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0
    // });

    const vendors = await getVendors();
    const menuItems = await getMenuItems();
    const boxTypes = await getBoxTypes();

    // 1. DRAFT PERSISTENCE: Save schema-only payload to clients.upcoming_order (UPCOMING_ORDER_SCHEMA).
    // Sanitize so only allowed fields per serviceType are stored; then use hydrated config for sync below.
    if (!skipClientUpdate && client.activeOrder) {
        const storedPayload = toStoredUpcomingOrder(client.activeOrder, clientServiceType as ServiceType);
        if (storedPayload !== null) {
            const currentTime = await getCurrentTime();
            const currentTimeISO = currentTime.toISOString();
            const { error: updateError } = await supabase
                .from('clients')
                .update({
                    upcoming_order: storedPayload,
                    updated_at: currentTimeISO
                })
                .eq('id', clientId);

            if (updateError) {
                const isRLSError = updateError?.code === 'PGRST301' ||
                    updateError?.message?.includes('permission denied') ||
                    updateError?.message?.includes('RLS') ||
                    updateError?.message?.includes('row-level security');

                console.error('[syncCurrentOrderToUpcoming] Error updating clients.upcoming_order:', {
                    error: updateError,
                    errorCode: updateError?.code,
                    errorMessage: updateError?.message,
                    isRLSError,
                    clientId
                });

                if (isRLSError) {
                    throw new Error(`Database permission error: Row-level security (RLS) is blocking this operation. Please ensure SUPABASE_SERVICE_ROLE_KEY is configured correctly.`);
                }

                throw new Error(`Failed to save order: ${updateError.message || 'Unknown error'}`);
            }

            // Use hydrated config for rest of sync so upcoming_orders table gets consistent shape
            orderConfig = fromStoredUpcomingOrder(storedPayload, clientServiceType as ServiceType) ?? orderConfig;
            revalidatePath('/clients');
        }
    }

    if (!orderConfig) {
        console.log('[syncCurrentOrderToUpcoming] No orderConfig - removing existing upcoming orders');
        // If no active order, remove any existing upcoming orders
        const { error: deleteError } = await supabase
            .from('upcoming_orders')
            .delete()
            .eq('client_id', clientId);
        
        if (deleteError) {
            console.error('[syncCurrentOrderToUpcoming] Error deleting upcoming orders:', deleteError);
        } else {
            console.log('[syncCurrentOrderToUpcoming] Successfully removed existing upcoming orders');
        }
        return;
    }

    // Check if orderConfig uses the new deliveryDayOrders format
    // Boxes orders should NOT use deliveryDayOrders format - they use the old format
    // CRITICAL: Also check that deliveryDayOrders has at least one key, otherwise
    // an empty object {} would be treated as new format but have no days to process
    const deliveryDayOrdersObj = (orderConfig as any)?.deliveryDayOrders;
    const hasDeliveryDayOrders = orderConfig &&
        orderConfig.serviceType !== 'Boxes' &&
        deliveryDayOrdersObj &&
        typeof deliveryDayOrdersObj === 'object' &&
        Object.keys(deliveryDayOrdersObj).length > 0;

    // Placeholder upcoming order for new Food clients with no vendor selections yet (caseId optional).
    // Without this, syncSingleOrderForDeliveryDay would throw "No vendor selections found" and
    // no row would be created in upcoming_orders or related tables.
    // CRITICAL FIX: Check both vendorSelections (old format) and deliveryDayOrders (new format) for items
    const hasRealVendorSelections = (orderConfig as any)?.vendorSelections?.some((s: any) => {
        if (!s.vendorId || String(s.vendorId).trim() === '') return false;
        const items = s.items || {};
        return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
    });
    // Also check deliveryDayOrders format for items
    // CRITICAL FIX: Check for items in deliveryDayOrders independently of hasDeliveryDayOrders
    // This ensures we detect items even if deliveryDayOrders exists but hasDeliveryDayOrders is false
    // (e.g., if deliveryDayOrders has items but the structure check failed)
    const hasItemsInDeliveryDayOrders = deliveryDayOrdersObj &&
        typeof deliveryDayOrdersObj === 'object' &&
        Object.keys(deliveryDayOrdersObj).length > 0 &&
        Object.values(deliveryDayOrdersObj).some((dayOrder: any) => {
            if (!dayOrder?.vendorSelections || !Array.isArray(dayOrder.vendorSelections)) return false;
            return dayOrder.vendorSelections.some((s: any) => {
                if (!s.vendorId || String(s.vendorId).trim() === '') return false;
                const items = s.items || {};
                return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
            });
        });
    if (
        orderConfig.serviceType === 'Food' &&
        !hasDeliveryDayOrders &&
        !hasRealVendorSelections &&
        !hasItemsInDeliveryDayOrders
    ) {
        console.log('[syncCurrentOrderToUpcoming] Creating placeholder upcoming order for new Food client (no vendors yet)');
        const { error: deleteErr } = await supabase
            .from('upcoming_orders')
            .delete()
            .eq('client_id', clientId)
            .eq('service_type', 'Food');
        if (deleteErr) {
            console.warn('[syncCurrentOrderToUpcoming] Error deleting existing Food upcoming orders before placeholder:', deleteErr);
        }
        // Generate unique order_number using helper function
        const nextOrderNumber = await generateUniqueOrderNumber();
        const currentTime = await getCurrentTime();
        const placeholderId = randomUUID();
        const session = await getSession();
        const updatedBy = session?.name || 'Admin';
        const { error: insertErr } = await supabase
            .from('upcoming_orders')
            .insert([{
                id: placeholderId,
                client_id: clientId,
                service_type: 'Food',
                case_id: orderConfig.caseId && String(orderConfig.caseId).trim() !== '' ? orderConfig.caseId : null,
                status: 'scheduled',
                scheduled_delivery_date: null,
                take_effect_date: null,
                delivery_day: null,
                total_value: 0,
                total_items: 0,
                bill_amount: null,
                notes: null,
                order_number: nextOrderNumber,
                last_updated: currentTime.toISOString(),
                updated_by: updatedBy,
            }]);
        if (insertErr) {
            console.error('[syncCurrentOrderToUpcoming] Error creating placeholder upcoming order:', insertErr);
            throw new Error(`Failed to create upcoming order for new Food client: ${insertErr.message || 'Unknown error'}`);
        }
        console.log('[syncCurrentOrderToUpcoming] Placeholder upcoming order created', { id: placeholderId, order_number: nextOrderNumber });
        const { syncLocalDBFromSupabase } = await import('./local-db');
        try {
            await syncLocalDBFromSupabase();
        } catch (syncError) {
            console.warn('[syncCurrentOrderToUpcoming] Local DB sync failed (non-critical):', syncError);
        }
        revalidatePath('/clients');
        revalidatePath(`/client-portal/${clientId}`);
        console.log('[syncCurrentOrderToUpcoming] COMPLETE - Placeholder upcoming order saved successfully');
        return;
    }

    // CRITICAL FIX: If we have items in deliveryDayOrders but hasDeliveryDayOrders is false,
    // we should still process them. This can happen if deliveryDayOrders exists but the structure check failed.
    // Check if we should process deliveryDayOrders format even if hasDeliveryDayOrders is false
    const shouldProcessDeliveryDayOrders = hasDeliveryDayOrders || 
        (hasItemsInDeliveryDayOrders && deliveryDayOrdersObj && Object.keys(deliveryDayOrdersObj).length > 0);
    
    if (shouldProcessDeliveryDayOrders) {
        // New format: create/update orders for each delivery day
        const deliveryDayOrders = (orderConfig as any).deliveryDayOrders;
        // Only sync days that are in deliveryDayOrders (user's selected days)
        // Filter to only include days that have at least one vendor with items
        const deliveryDays = Object.keys(deliveryDayOrders).filter(day => {
            const dayOrder = deliveryDayOrders[day];
            if (!dayOrder || !dayOrder.vendorSelections || dayOrder.vendorSelections.length === 0) {
                return false;
            }
            // Check if at least one vendor has items
            return dayOrder.vendorSelections.some((sel: any) => {
                if (!sel.vendorId) return false;
                const items = sel.items || {};
                return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
            });
        });

        // console.log('[syncCurrentOrderToUpcoming] Processing deliveryDayOrders format:', {
        //     allDays: Object.keys(deliveryDayOrders),
        //     filteredDays: deliveryDays,
        //     dayDetails: deliveryDays.map(day => ({
        //         day,
        //         vendorCount: deliveryDayOrders[day]?.vendorSelections?.length || 0,
        //         vendors: deliveryDayOrders[day]?.vendorSelections?.map((s: any) => ({
        //             vendorId: s.vendorId,
        //             itemCount: Object.keys(s.items || {}).length
        //         }))
        //     }))
        // });

        // Delete orders for delivery days that are no longer in the config
        // Filter by service_type to only delete orders of the same type
        // CRITICAL: Use 'Food', 'Boxes', etc. (not lowercase). Must match schema and process-weekly-orders.
        const serviceTypeForQuery = orderConfig.serviceType === 'Food' ? 'Food' :
                                   orderConfig.serviceType === 'Boxes' ? 'Boxes' :
                                   orderConfig.serviceType === 'Custom' ? 'Custom' :
                                   orderConfig.serviceType === 'Produce' ? 'Produce' :
                                   orderConfig.serviceType || 'Food';
        const { data: existingOrders } = await supabase
            .from('upcoming_orders')
            .select('id, delivery_day')
            .eq('client_id', clientId)
            .eq('service_type', serviceTypeForQuery);

        if (existingOrders && existingOrders.length > 0) {
            const existingDeliveryDays = new Set((existingOrders || []).map(o => o.delivery_day).filter(Boolean));
            const currentDeliveryDays = new Set(deliveryDays);

            // Delete orders for days that are no longer in the config
            for (const day of existingDeliveryDays) {
                if (!currentDeliveryDays.has(day)) {
                    const orderToDelete = (existingOrders || []).find(o => o.delivery_day === day);
                    if (orderToDelete) {
                        await supabase
                            .from('upcoming_orders')
                            .delete()
                            .eq('id', orderToDelete.id);
                    }
                }
            }
        }

        // Sync each delivery day order
        for (const deliveryDay of deliveryDays) {
            const dayOrder = deliveryDayOrders[deliveryDay];
            if (dayOrder && dayOrder.vendorSelections) {
                // Create a full order config for this day
                // CRITICAL FIX: Ensure items are preserved when filtering
                const filteredVendorSelections = dayOrder.vendorSelections
                    .filter((s: any) => {
                        // Only include vendors with items
                        if (!s.vendorId) return false;
                        const items = s.items || {};
                        const hasItems = Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                        return hasItems;
                    })
                    .map((s: any) => ({
                        // Explicitly preserve vendorId and items to ensure they're not lost
                        vendorId: s.vendorId,
                        items: s.items || {}
                    }));
                
                const dayOrderConfig = {
                    serviceType: orderConfig.serviceType,
                    caseId: orderConfig.caseId,
                    vendorSelections: filteredVendorSelections,
                    lastUpdated: orderConfig.lastUpdated,
                    updatedBy: orderConfig.updatedBy
                };

                console.log(`[syncCurrentOrderToUpcoming] Syncing order for ${deliveryDay} with ${dayOrderConfig.vendorSelections.length} vendor(s)`, {
                    deliveryDay,
                    vendorCount: dayOrderConfig.vendorSelections.length,
                    vendors: dayOrderConfig.vendorSelections.map((vs: any) => ({
                        vendorId: vs.vendorId,
                        itemCount: Object.keys(vs.items || {}).length,
                        items: vs.items
                    }))
                });

                // Only sync if there are vendors with items
                if (dayOrderConfig.vendorSelections.length > 0) {
                    await syncSingleOrderForDeliveryDay(
                        clientId,
                        dayOrderConfig,
                        deliveryDay,
                        vendors,
                        menuItems,
                        boxTypes
                    );
                } else {
                    console.log(`[syncCurrentOrderToUpcoming] Skipping ${deliveryDay} - no vendors with items`);
                }
            }
        }
    } else {
        // Old format: single order config
        // Check if any selected vendors have multiple delivery days
        let deliveryDays: string[] = [];

        if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) {
            // Get all unique delivery days from selected vendors
            const allDeliveryDays = new Set<string>();
            // CRITICAL FIX: Also check if there are items with empty vendorId (template items)
            // In this case, try to use default vendor or first available vendor
            let hasItemsWithoutVendor = false;
            for (const selection of orderConfig.vendorSelections) {
                const items = selection.items || {};
                const hasItems = Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                if (hasItems && (!selection.vendorId || String(selection.vendorId).trim() === '')) {
                    hasItemsWithoutVendor = true;
                }
                if (selection.vendorId) {
                    const vendor = vendors.find(v => v.id === selection.vendorId);
                    if (vendor) {
                        const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                        if (deliveryDays) {
                            deliveryDays.forEach((day: string) => allDeliveryDays.add(day));
                        }
                    }
                }
            }
            // If we have items but no vendorId, try to use default vendor for Food
            if (hasItemsWithoutVendor && allDeliveryDays.size === 0) {
                const defaultVendor = vendors.find(v => 
                    v.isActive && 
                    v.serviceTypes && 
                    Array.isArray(v.serviceTypes) && 
                    v.serviceTypes.includes('Food')
                );
                if (defaultVendor) {
                    const deliveryDaysList = 'deliveryDays' in defaultVendor ? defaultVendor.deliveryDays : (defaultVendor as any).delivery_days;
                    if (deliveryDaysList && deliveryDaysList.length > 0) {
                        deliveryDaysList.forEach((day: string) => allDeliveryDays.add(day));
                        // Also update the vendorSelections to include the default vendorId
                        for (const selection of orderConfig.vendorSelections) {
                            const items = selection.items || {};
                            const hasItems = Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                            if (hasItems && (!selection.vendorId || String(selection.vendorId).trim() === '')) {
                                selection.vendorId = defaultVendor.id;
                            }
                        }
                    }
                }
            }
            deliveryDays = Array.from(allDeliveryDays);
        } else if (orderConfig.serviceType === 'Boxes') {
            // Boxes can exist with or without boxTypeId now
            console.log('[syncCurrentOrderToUpcoming] Processing Boxes order (old format):', {
                vendorId: orderConfig.vendorId,
                boxTypeId: orderConfig.boxTypeId,
                boxQuantity: orderConfig.boxQuantity,
                hasBoxOrders: !!(orderConfig as any)?.boxOrders && Array.isArray((orderConfig as any).boxOrders),
                boxOrdersCount: (orderConfig as any)?.boxOrders?.length || 0,
                hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0
            });

            // CRITICAL FIX: Check boxOrders array first to get vendor ID from selected vendor
            let boxVendorId: string | null = null;
            const boxOrders = (orderConfig as any)?.boxOrders;
            if (boxOrders && Array.isArray(boxOrders) && boxOrders.length > 0) {
                // Get vendor ID from the first box (or find first box with a vendor ID)
                const firstBoxWithVendor = boxOrders.find((box: any) => box.vendorId && box.vendorId.trim() !== '');
                if (firstBoxWithVendor) {
                    boxVendorId = firstBoxWithVendor.vendorId;
                    console.log('[syncCurrentOrderToUpcoming] Found vendor ID from boxOrders array:', boxVendorId);
                }
            }
            
            // Fallback to top-level vendorId if not found in boxOrders
            if (!boxVendorId && orderConfig.vendorId && orderConfig.vendorId.trim() !== '') {
                boxVendorId = orderConfig.vendorId;
            }
            
            // Fallback to boxType vendorId if still not found
            const boxType = orderConfig.boxTypeId ? boxTypes.find(bt => bt.id === orderConfig.boxTypeId) : null;
            if (!boxVendorId && boxType) {
                boxVendorId = boxType.vendorId || null;
            }

            console.log('[syncCurrentOrderToUpcoming] Box vendor resolution:', {
                orderConfigVendorId: orderConfig.vendorId,
                boxTypeVendorId: boxType?.vendorId,
                resolvedVendorId: boxVendorId
            });

            if (boxVendorId) {
                const vendor = vendors.find(v => v.id === boxVendorId);
                if (vendor) {
                    const deliveryDaysList = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                    if (deliveryDaysList && deliveryDaysList.length > 0) {
                        // FIX: For Boxes, we strictly want ONE recurring order per week, not one per delivery day.
                        // Since the UI doesn't currently allow selecting a specific day for Boxes,
                        // we default to the first available delivery day of the vendor.
                        deliveryDays = [deliveryDaysList[0]];
                    } else {
                        // If vendor has no delivery days, still try to sync (will use default logic)
                        console.warn(`[syncCurrentOrderToUpcoming] Vendor ${boxVendorId} has no delivery days configured, will attempt sync anyway`);
                    }
                }
            } else {
                // No vendorId for boxes - will use default delivery day from settings in syncSingleOrderForDeliveryDay
                console.log(`[syncCurrentOrderToUpcoming] No vendorId found for Boxes order${orderConfig.boxTypeId ? ` with boxTypeId ${orderConfig.boxTypeId}` : ''}, will calculate dates based on settings`);
                deliveryDays = []; // Empty array - syncSingleOrderForDeliveryDay will handle it with settings
            }
        } else if (orderConfig.serviceType === 'Custom') {
            // For Custom orders, get delivery days from vendor if available
            console.log('[syncCurrentOrderToUpcoming] Processing Custom order (old format):', {
                vendorId: orderConfig.vendorId,
                customItemsCount: (orderConfig as any).customItems?.length || 0,
                hasCustomItems: !!(orderConfig as any).customItems && Array.isArray((orderConfig as any).customItems) && (orderConfig as any).customItems.length > 0
            });

            if (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') {
                const vendor = vendors.find(v => v.id === orderConfig.vendorId);
                if (vendor) {
                    const deliveryDaysList = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                    if (deliveryDaysList && deliveryDaysList.length > 0) {
                        // For Custom orders, use the first available delivery day
                        // (similar to Boxes - one recurring order per week)
                        deliveryDays = [deliveryDaysList[0]];
                    } else {
                        // If vendor has no delivery days, still try to sync (will use default logic)
                        console.warn(`[syncCurrentOrderToUpcoming] Vendor ${orderConfig.vendorId} has no delivery days configured, will attempt sync anyway`);
                        deliveryDays = [];
                    }
                } else {
                    console.warn(`[syncCurrentOrderToUpcoming] Vendor ${orderConfig.vendorId} not found, will attempt sync anyway`);
                    deliveryDays = [];
                }
            } else {
                console.warn(`[syncCurrentOrderToUpcoming] No vendorId found for Custom order, will calculate dates based on settings`);
                deliveryDays = []; // Empty array - syncSingleOrderForDeliveryDay will handle it with settings
            }
        }

        // If vendor(s) have multiple delivery days, create orders for each
        if (deliveryDays.length > 1) {
            // Delete old orders without delivery_day
            await supabase
                .from('upcoming_orders')
                .delete()
                .eq('client_id', clientId)
                .is('delivery_day', null);

            // Create order for each delivery day
            for (const deliveryDay of deliveryDays) {
                await syncSingleOrderForDeliveryDay(
                    clientId,
                    orderConfig,
                    deliveryDay,
                    vendors,
                    menuItems,
                    boxTypes
                );
            }
        } else {
            // Single delivery day or no delivery days - use old logic

            // CLEANUP: Ensure no duplicate Box orders exist from previous bugs
            // Only keep the order for the target delivery day (or null), delete others
            if (orderConfig.serviceType === 'Boxes') {
                const targetDay = deliveryDays.length === 1 ? deliveryDays[0] : null;
                const { data: existing } = await supabase
                    .from('upcoming_orders')
                    .select('id, delivery_day')
                    .eq('client_id', clientId)
                    .eq('service_type', 'Boxes'); // Must match schema; do not use 'boxes'

                if (existing && existing.length > 0) {
                    const idsToDelete = existing
                        .filter((o: any) => o.delivery_day !== targetDay)
                        .map((o: any) => o.id);

                    if (idsToDelete.length > 0) {
                        await supabase
                            .from('upcoming_orders')
                            .delete()
                            .in('id', idsToDelete);
                    }
                }
            }

            await syncSingleOrderForDeliveryDay(
                clientId,
                orderConfig,
                deliveryDays.length === 1 ? deliveryDays[0] : null,
                vendors,
                menuItems,
                boxTypes
            );
        }
    }

    // Force synchronous local DB sync to ensure data is fresh for immediate re-fetch
    const { syncLocalDBFromSupabase } = await import('./local-db');
    try {
        await syncLocalDBFromSupabase();
        console.log('[syncCurrentOrderToUpcoming] Local DB sync completed');
    } catch (syncError) {
        console.warn('[syncCurrentOrderToUpcoming] Local DB sync failed (non-critical):', syncError);
        // Don't throw - local DB is just a cache
    }

    revalidatePath('/clients');
    revalidatePath(`/client-portal/${clientId}`);
    
    console.log('[syncCurrentOrderToUpcoming] COMPLETE - Order saved successfully');
}

/**
 * Process upcoming orders that have reached their take effect date
 * Moves them from upcoming_orders to orders table
 */
export async function processUpcomingOrders() {
    const currentTime = await getCurrentTime();
    const todayStr = getTodayInAppTz(currentTime);

    // Find all upcoming orders where take_effect_date <= today (Eastern) and status is 'scheduled'
    let upcomingOrders;
    try {
        const { data: upcomingOrdersData, error: fetchError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('status', 'scheduled')
            .lte('take_effect_date', todayStr);
        
        if (fetchError) {
            console.error('Error fetching upcoming orders:', fetchError);
            return { processed: 0, errors: [] };
        }
        upcomingOrders = upcomingOrdersData || [];
    } catch (fetchError) {
        console.error('Error fetching upcoming orders:', fetchError);
        return { processed: 0, errors: [] };
    }

    if (!upcomingOrders || upcomingOrders.length === 0) {
        return { processed: 0, errors: [] };
    }

    const menuItems = await getMenuItems();
    const errors: string[] = [];
    let processedCount = 0;

    for (const upcomingOrder of upcomingOrders) {
        try {
            // Calculate scheduled_delivery_date from delivery_day if available
            let scheduledDeliveryDate: string | null = null;
            if (upcomingOrder.delivery_day) {
                const currentTime = await getCurrentTime();
                const calculatedDate = getNextDeliveryDateForDay(
                    upcomingOrder.delivery_day,
                    await getVendors(),
                    undefined,
                    getTodayDateInAppTzAsReference(currentTime),
                    currentTime
                );
                if (calculatedDate) {
                    scheduledDeliveryDate = formatDateToYYYYMMDD(calculatedDate);
                }
            }

            // Create order in orders table
            const currentTime = await getCurrentTime();
            const orderData: any = {
                client_id: upcomingOrder.client_id,
                service_type: upcomingOrder.service_type,
                case_id: upcomingOrder.case_id,
                status: 'pending',
                last_updated: currentTime.toISOString(),
                updated_by: upcomingOrder.updated_by,
                scheduled_delivery_date: scheduledDeliveryDate,
                delivery_distribution: null, // Can be set later if needed
                total_value: upcomingOrder.total_value,
                total_items: upcomingOrder.total_items,
                bill_amount: upcomingOrder.bill_amount || null,
                notes: upcomingOrder.notes,
                order_number: upcomingOrder.order_number, // Preserve the assigned 6-digit number
                vendor_id: upcomingOrder.vendor_id ?? null // So vendor page (getOrdersByVendor) can find this order
            };

            const orderId = randomUUID();
            let newOrder: any;
            try {
                const insertPayload = {
                    id: orderId,
                    ...orderData,
                    delivery_distribution: orderData.delivery_distribution || null
                };
                
                const { data: insertedOrder, error: insertError } = await supabase
                    .from('orders')
                    .insert([insertPayload])
                    .select()
                    .single();
                
                if (insertError || !insertedOrder) {
                    errors.push(`Failed to create order for client ${upcomingOrder.client_id}: ${insertError?.message || 'Order not found after insert'}`);
                    continue;
                }
                newOrder = insertedOrder;
            } catch (orderError: any) {
                errors.push(`Failed to create order for client ${upcomingOrder.client_id}: ${orderError?.message}`);
                continue;
            }
            
            if (!newOrder) {
                errors.push(`Failed to retrieve order for client ${upcomingOrder.client_id}`);
                continue;
            }

            // Copy vendor selections and items (for Food orders)
            const { data: vendorSelections } = await supabase
                .from('upcoming_order_vendor_selections')
                .select('*')
                .eq('upcoming_order_id', upcomingOrder.id);

            if (vendorSelections && vendorSelections.length > 0) {
                for (const vs of vendorSelections) {
                    const newVsId = randomUUID();
                    try {
                        await supabase
                            .from('order_vendor_selections')
                            .insert([{ id: newVsId, order_id: newOrder.id, vendor_id: vs.vendor_id }]);
                        const newVs = { id: newVsId, order_id: newOrder.id, vendor_id: vs.vendor_id };

                        // Copy items
                        const { data: items } = await supabase
                            .from('upcoming_order_items')
                            .select('*')
                            .eq('vendor_selection_id', vs.id);

                        if (items && items.length > 0) {
                            const itemsToInsert = items.map(item => ({
                                id: randomUUID(),
                                vendor_selection_id: newVs.id,
                                menu_item_id: item.menu_item_id,
                                quantity: item.quantity
                            }));
                            await supabase
                                .from('order_items')
                                .insert(itemsToInsert);
                        }
                    } catch (vsError) {
                        console.error('Error creating vendor selection:', vsError);
                        continue;
                    }
                }
            }

            // Copy box selections (for Box orders)
            const { data: boxSelections } = await supabase
                .from('upcoming_order_box_selections')
                .select('*')
                .eq('upcoming_order_id', upcomingOrder.id);

            console.log('[processUpcomingOrders] Box selections found:', {
                upcoming_order_id: upcomingOrder.id,
                order_id: newOrder.id,
                boxSelectionsCount: boxSelections?.length || 0,
                boxSelections: boxSelections?.map(bs => ({
                    vendor_id: bs.vendor_id,
                    box_type_id: bs.box_type_id,
                    quantity: bs.quantity
                }))
            });

            if (boxSelections) {
                for (const bs of boxSelections) {
                    const insertData = {
                        order_id: newOrder.id,
                        box_type_id: bs.box_type_id,
                        vendor_id: bs.vendor_id,
                        quantity: bs.quantity,
                        unit_value: bs.unit_value || 0,
                        total_value: bs.total_value || 0,
                        items: bs.items || {}
                    };

                    console.log('[processUpcomingOrders] Inserting box selection:', insertData);

                    const boxSelectionId = randomUUID();
                    try {
                        await supabase
                            .from('order_box_selections')
                            .insert([{
                                id: boxSelectionId,
                                order_id: newOrder.id,
                                vendor_id: bs.vendor_id,
                                box_type_id: bs.box_type_id,
                                quantity: bs.quantity,
                                items: bs.items || {}
                            }]);
                        console.log('[processUpcomingOrders] Successfully inserted box selection for order_id:', newOrder.id);
                    } catch (error) {
                        console.error('[processUpcomingOrders] Error inserting box selection:', error);
                    }
                }
            }

            // Update upcoming order status
            await supabase
                .from('upcoming_orders')
                .update({
                    status: 'processed',
                    processed_order_id: newOrder.id,
                    processed_at: (await getCurrentTime()).toISOString()
                })
                .eq('id', upcomingOrder.id);

            processedCount++;
        } catch (error: any) {
            errors.push(`Error processing upcoming order ${upcomingOrder.id}: ${error.message}`);
        }
    }

    revalidatePath('/clients');

    // Trigger local DB sync in background after mutation
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();

    return { processed: processedCount, errors };
}

/**
 * Get active order from orders table for a client
 * This is used for "Recent Orders" display
 * Returns orders with scheduled_delivery_date in the current week, or orders created/updated this week
 * Now uses local database for fast access
 */
export async function getActiveOrderForClient(clientId: string) {
    if (!clientId) return null;

    try {
        // Calculate current week range (Sunday to Saturday)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const day = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - day);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        const startOfWeekStr = formatDateToYYYYMMDD(startOfWeek);
        const endOfWeekStr = formatDateToYYYYMMDD(endOfWeek);
        const startOfWeekISO = startOfWeek.toISOString();
        const endOfWeekISO = endOfWeek.toISOString();

        // Try to get all orders with scheduled_delivery_date in current week
        // Now supports multiple orders per client (one per delivery day)
        let { data: ordersData, error } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .in('status', ['pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending'])
            .gte('scheduled_delivery_date', startOfWeekStr)
            .lte('scheduled_delivery_date', endOfWeekStr)
            .order('created_at', { ascending: false });

        // If no orders found with scheduled_delivery_date in current week,
        // try to get orders created or updated this week (fallback)
        if (!ordersData || ordersData.length === 0) {
            // Log error if it's not just "no rows returned"
            if (error && error.code !== 'PGRST116') {
                console.error('Error fetching orders by scheduled_delivery_date:', error);
            }

            // Try fetching by created_at in current week
            const { data: dataByCreated, error: errorByCreated } = await supabase
                .from('orders')
                .select('*')
                .eq('client_id', clientId)
                .in('status', ['pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending'])
                .gte('created_at', startOfWeekISO)
                .lte('created_at', endOfWeekISO)
                .order('created_at', { ascending: false });

            if (errorByCreated && errorByCreated.code !== 'PGRST116') {
                console.error('Error fetching orders by created_at:', errorByCreated);
            }

            // If still no data, try by last_updated
            if (!dataByCreated || dataByCreated.length === 0) {
                const { data: dataByUpdated, error: errorByUpdated } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('client_id', clientId)
                    .in('status', ['pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending'])
                    .gte('last_updated', startOfWeekISO)
                    .lte('last_updated', endOfWeekISO)
                    .order('created_at', { ascending: false });

                if (errorByUpdated && errorByUpdated.code !== 'PGRST116') {
                    console.error('Error fetching orders by last_updated:', errorByUpdated);
                }

                ordersData = dataByUpdated || [];
            } else {
                ordersData = dataByCreated;
            }
        }

        // If no orders found in orders table, check upcoming_orders as fallback
        // This handles cases where orders haven't been processed yet
        // Removed upcoming_orders fallback based on user requirement: 
        // "Things should only start showing under recent orders once they are an actual order"

        if (!ordersData || ordersData.length === 0) {
            // No active orders found
            return null;
        }

        // If only one order, return it in the old format for backward compatibility
        // If multiple orders, return them grouped by delivery day or as an array
        const isMultipleOrders = ordersData.length > 1;

        // Fetch related data
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // Process all orders
        const processOrder = async (orderData: any) => {
            // Build order configuration object
            const orderConfig: any = {
                id: orderData.id,
                serviceType: orderData.service_type,
                caseId: orderData.case_id,
                status: orderData.status,
                lastUpdated: orderData.last_updated,
                updatedBy: orderData.updated_by,
                scheduledDeliveryDate: orderData.scheduled_delivery_date,
                createdAt: orderData.created_at,
                deliveryDistribution: orderData.delivery_distribution,
                totalValue: orderData.total_value,
                totalItems: orderData.total_items,
                notes: orderData.notes,
                deliveryDay: orderData.delivery_day, // Include delivery_day if present
                isUpcoming: orderData.is_upcoming || false, // Flag for upcoming orders
                orderNumber: orderData.order_number, // Numeric Order ID
                proofOfDelivery: orderData.proof_of_delivery_url || orderData.proof_of_delivery_image // URL to proof of delivery image (check both fields for compatibility)
            };

            // Determine which table to query based on whether this is an upcoming order
            const vendorSelectionsTable = orderData.is_upcoming
                ? 'upcoming_order_vendor_selections'
                : 'order_vendor_selections';
            const itemsTable = orderData.is_upcoming
                ? 'upcoming_order_items'
                : 'order_items';
            const orderIdField = orderData.is_upcoming
                ? 'upcoming_order_id'
                : 'order_id';

            if (orderData.service_type === 'Food') {
                // Fetch vendor selections and items
                const { data: vendorSelections, error: vendorSelectionsError } = await supabase
                    .from(vendorSelectionsTable)
                    .select('*')
                    .eq(orderIdField, orderData.id);

                if (vendorSelectionsError) {
                    console.error('Error fetching vendor selections:', vendorSelectionsError);
                }

                if (vendorSelections && vendorSelections.length > 0) {
                    orderConfig.vendorSelections = [];
                    for (const vs of vendorSelections) {
                        // For upcoming orders, use upcoming_vendor_selection_id; for regular orders, use vendor_selection_id
                        const selectionIdField = orderData.is_upcoming ? 'upcoming_vendor_selection_id' : 'vendor_selection_id';
                        const { data: items, error: itemsError } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .eq(selectionIdField, vs.id);

                        if (itemsError) {
                            console.error('Error fetching order items:', itemsError);
                        }

                        const itemsMap: any = {};
                        if (items && items.length > 0) {
                            for (const item of items) {
                                itemsMap[item.menu_item_id] = item.quantity;
                            }
                        }

                        orderConfig.vendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                } else {
                    // Initialize empty vendor selections if none found
                    orderConfig.vendorSelections = [];
                }
            } else if (orderData.service_type === 'Boxes') {
                // Fetch box selection
                const boxSelectionsTable = orderData.is_upcoming
                    ? 'upcoming_order_box_selections'
                    : 'order_box_selections';

                const { data: boxSelection, error: boxSelectionError } = await supabase
                    .from(boxSelectionsTable)
                    .select('*')
                    .eq(orderIdField, orderData.id)
                    .maybeSingle();

                if (boxSelectionError && boxSelectionError.code !== 'PGRST116') {
                    console.error('Error fetching box selection:', boxSelectionError);
                }

                if (boxSelection) {
                    // console.log('[getActiveOrderForClient] Box selection found:', {
                    //     order_id: orderData.id,
                    //     vendor_id: boxSelection.vendor_id,
                    //     box_type_id: boxSelection.box_type_id,
                    //     quantity: boxSelection.quantity
                    // });

                    orderConfig.vendorId = boxSelection.vendor_id;
                    orderConfig.boxTypeId = boxSelection.box_type_id;
                    orderConfig.boxQuantity = boxSelection.quantity;

                    // PRIORITY 1: Load items from upcoming_order_items/order_items table (same as food orders)
                    // This is the primary source for box items now
                    const { data: boxItems, error: boxItemsError } = await supabase
                        .from(itemsTable)
                        .select('*')
                        .eq(orderIdField, orderData.id)
                        .is(orderData.is_upcoming ? 'upcoming_vendor_selection_id' : 'vendor_selection_id', null); // Box items don't have vendor selections

                    if (boxItemsError) {
                        console.error('Error fetching box items from items table:', boxItemsError);
                    }

                    let itemsMap: any = {};
                    const itemPricesMap: any = {};
                    
                    if (boxItems && boxItems.length > 0) {
                        for (const item of boxItems) {
                            if (item.menu_item_id) {
                                itemsMap[item.menu_item_id] = item.quantity;
                                // Store price if available (from custom_price or calculated)
                                if (item.custom_price) {
                                    itemPricesMap[item.menu_item_id] = parseFloat(item.custom_price.toString());
                                }
                            }
                        }
                    }

                    // PRIORITY 2: Fallback to boxSelection.items (JSONB) if no items found in items table
                    // This handles legacy data or cases where items weren't saved to the items table
                    if (Object.keys(itemsMap).length === 0 && boxSelection.items) {
                        console.log('[getActiveOrderForClient] Loading box items from JSON field (fallback)');
                        
                        let jsonItems: any = boxSelection.items;
                        // Handle string JSON
                        if (typeof jsonItems === 'string') {
                            try {
                                jsonItems = JSON.parse(jsonItems);
                            } catch (e) {
                                console.error('[getActiveOrderForClient] Error parsing JSON string:', e);
                                jsonItems = {};
                            }
                        }
                        
                        // Handle different JSON formats
                        if (jsonItems && typeof jsonItems === 'object' && !Array.isArray(jsonItems)) {
                            for (const [itemId, val] of Object.entries(jsonItems)) {
                                if (val && typeof val === 'object' && 'quantity' in val) {
                                    itemsMap[itemId] = (val as any).quantity;
                                    if ('price' in val && (val as any).price !== undefined && (val as any).price !== null) {
                                        itemPricesMap[itemId] = (val as any).price;
                                    }
                                } else if (typeof val === 'number') {
                                    itemsMap[itemId] = val;
                                } else {
                                    itemsMap[itemId] = val;
                                }
                            }
                        }
                        
                        console.log('[getActiveOrderForClient] Loaded', Object.keys(itemsMap).length, 'items from JSON field');
                    }

                    // Set items and prices
                    orderConfig.items = itemsMap;
                    if (Object.keys(itemPricesMap).length > 0) {
                        orderConfig.itemPrices = itemPricesMap;
                    }

                    // Also set boxOrders array for consistency with display code
                    orderConfig.boxOrders = [{
                        boxTypeId: boxSelection.box_type_id,
                        vendorId: boxSelection.vendor_id,
                        quantity: boxSelection.quantity,
                        items: itemsMap,
                        itemNotes: boxSelection.item_notes || {}
                    }];
                }
            } else if (orderData.service_type === 'Equipment') {
                // Parse equipment details from notes
                try {
                    const notes = orderData.notes ? JSON.parse(orderData.notes) : null;
                    if (notes) {
                        orderConfig.equipmentSelection = {
                            vendorId: notes.vendorId,
                            equipmentId: notes.equipmentId,
                            equipmentName: notes.equipmentName,
                            price: notes.price
                        };
                        orderConfig.vendorId = notes.vendorId; // For consistency
                    }
                } catch (e) {
                    console.error('Error parsing equipment order notes:', e);
                }
            }

            return orderConfig;
        };

        // Process all orders
        const processedOrders = await Promise.all(ordersData.map(processOrder));

        // If only one order, return it in the old format for backward compatibility
        if (processedOrders.length === 1) {
            return processedOrders[0];
        }

        // If multiple orders, return them as an array
        // The UI will need to handle displaying multiple orders
        return {
            multiple: true,
            orders: processedOrders
        };
    } catch (err) {
        console.error('Error in getActiveOrderForClient:', err);
        return null;
    }
}

/**
 * Get recent orders from orders table for a client
 * Returns the most recent orders (limited by limit parameter, default 3)
 * Used for "Recent Orders" display in ClientProfile
 */
export async function getRecentOrdersForClient(clientId: string, limit: number = 3) {
    if (!clientId) return null;

    try {
        // Query orders table by client_id, ordered by created_at DESC, limited by limit
        let { data: ordersData, error } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching recent orders:', error);
            return null;
        }

        if (!ordersData || ordersData.length === 0) {
            return null;
        }

        // Fetch related data
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // Process all orders
        const processOrder = async (orderData: any) => {
            // Build order configuration object
            const orderConfig: any = {
                id: orderData.id,
                serviceType: orderData.service_type,
                caseId: orderData.case_id,
                status: orderData.status,
                lastUpdated: orderData.last_updated,
                updatedBy: orderData.updated_by,
                scheduledDeliveryDate: orderData.scheduled_delivery_date,
                createdAt: orderData.created_at,
                deliveryDistribution: orderData.delivery_distribution,
                totalValue: orderData.total_value,
                totalItems: orderData.total_items,
                notes: orderData.notes,
                deliveryDay: orderData.delivery_day,
                isUpcoming: false,
                orderNumber: orderData.order_number,
                proofOfDelivery: orderData.proof_of_delivery_image || orderData.delivery_proof_url
            };

            const vendorSelectionsTable = 'order_vendor_selections';
            const itemsTable = 'order_items';
            const boxSelectionsTable = 'order_box_selections';

            // Get Vendor Selections (for Food service)
            const { data: vendorSelections } = await supabase
                .from(vendorSelectionsTable)
                .select('*')
                .eq('order_id', orderData.id);

            if (vendorSelections) {
                const vendorSelectionsWithItems = await Promise.all(vendorSelections.map(async (selection: any) => {
                    const { data: items } = await supabase
                        .from(itemsTable)
                        .select('*')
                        .eq('vendor_selection_id', selection.id);

                    const itemsMap: any = {};
                    const itemNotesMap: any = {};

                    if (items) {
                        items.forEach((item: any) => {
                            if (item.menu_item_id) {
                                itemsMap[item.menu_item_id] = item.quantity;
                                if (item.notes) {
                                    itemNotesMap[item.menu_item_id] = item.notes;
                                }
                            }
                        });
                    }

                    return {
                        id: selection.id, // Keep ID for reference
                        vendorId: selection.vendor_id,
                        selectedDeliveryDays: selection.selected_days || [],
                        items: itemsMap,
                        itemNotes: itemNotesMap,
                        itemsByDay: selection.items_by_day || {}, // For new format
                        itemNotesByDay: selection.item_notes_by_day || {} // For new format
                    };
                }));

                orderConfig.vendorSelections = vendorSelectionsWithItems;
            }

            // Get Box Selections (for Boxes service)
            const { data: boxSelections } = await supabase
                .from(boxSelectionsTable)
                .select('*')
                .eq('order_id', orderData.id);

            if (boxSelections && boxSelections.length > 0) {
                // PRIORITY 1: Load items from order_items table (same as getActiveOrderForClient)
                // This is the primary source for box items now
                let boxItems: any[] = [];
                let boxItemsError: any = null;

                // Strategy 1: Try querying by order_id with null vendor_selection_id (if order_id field exists)
                // Note: order_items may not have order_id field, and vendor_selection_id is NOT NULL in schema
                // So this query might not work, but we try it first
                try {
                    const { data: itemsByOrderId, error: errorByOrderId } = await supabase
                        .from(itemsTable)
                        .select('*')
                        .eq('order_id', orderData.id)
                        .is('vendor_selection_id', null);
                    
                    if (!errorByOrderId && itemsByOrderId && itemsByOrderId.length > 0) {
                        boxItems = itemsByOrderId;
                        console.log('[getRecentOrdersForClient] Found', boxItems.length, 'box items using order_id query');
                    } else if (errorByOrderId) {
                        // Log but don't fail - this is expected if order_id doesn't exist
                        if (errorByOrderId.code !== 'PGRST116') {
                            console.log('[getRecentOrdersForClient] order_id query returned error (may be expected):', errorByOrderId.message);
                        }
                    }
                } catch (e) {
                    console.log('[getRecentOrdersForClient] order_id query failed (field may not exist):', e);
                }

                // Strategy 2: If Strategy 1 didn't work, try finding items through vendor selections
                // For Boxes orders, items might be linked through vendor selections created for the box order
                if (boxItems.length === 0) {
                    const { data: vendorSelections } = await supabase
                        .from('order_vendor_selections')
                        .select('id')
                        .eq('order_id', orderData.id);
                    
                    const vendorSelectionIds = vendorSelections?.map(vs => vs.id) || [];
                    
                    if (vendorSelectionIds.length > 0) {
                        // For Boxes orders, items linked to vendor selections ARE the box items
                        // (unlike Food orders where vendor selections have food items)
                        // Get all items linked to vendor selections for this order
                        const { data: itemsThroughVS } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .in('vendor_selection_id', vendorSelectionIds);
                        
                        if (itemsThroughVS && itemsThroughVS.length > 0) {
                            console.log('[getRecentOrdersForClient] Found', itemsThroughVS.length, 'items through vendor selections for Boxes order');
                            
                            // For Boxes orders, if we find items through vendor selections, they are box items
                            // We can optionally match them to box JSON, but if JSON is empty/outdated, use all items
                            const boxItemMenuIds = new Set<string>();
                            let hasBoxJson = false;
                            boxSelections.forEach((bs: any) => {
                                try {
                                    const boxItemsJson = typeof bs.items === 'string' ? JSON.parse(bs.items) : (bs.items || {});
                                    if (boxItemsJson && typeof boxItemsJson === 'object' && Object.keys(boxItemsJson).length > 0) {
                                        hasBoxJson = true;
                                        Object.keys(boxItemsJson).forEach(itemId => {
                                            if (boxItemsJson[itemId] && Number(boxItemsJson[itemId]) > 0) {
                                                boxItemMenuIds.add(itemId);
                                            }
                                        });
                                    }
                                } catch (e) {
                                    // Ignore parse errors
                                }
                            });
                            
                            // If box JSON exists and has items, try to match
                            // Otherwise, use all items found (they're box items for this Boxes order)
                            if (hasBoxJson && boxItemMenuIds.size > 0) {
                                boxItems = itemsThroughVS.filter((item: any) => 
                                    item.menu_item_id && boxItemMenuIds.has(item.menu_item_id)
                                );
                                
                                if (boxItems.length > 0) {
                                    console.log('[getRecentOrdersForClient] Matched', boxItems.length, 'box items to box JSON');
                                } else {
                                    // JSON exists but no matches - use all items anyway (JSON might be outdated)
                                    console.log('[getRecentOrdersForClient] No items matched box JSON, using all', itemsThroughVS.length, 'items as box items');
                                    boxItems = itemsThroughVS;
                                }
                            } else {
                                // No box JSON or empty JSON - use all items (they're box items for this Boxes order)
                                boxItems = itemsThroughVS;
                                console.log('[getRecentOrdersForClient] Using all', boxItems.length, 'items as box items (no box JSON to match against)');
                            }
                        }
                    } else {
                        // No vendor selections found - try to find items that might be linked directly
                        // Some box items might be stored with a special vendor_selection_id or in a different way
                        console.log('[getRecentOrdersForClient] No vendor selections found, cannot query order_items through vendor selections');
                    }
                }

                if (boxItemsError && boxItemsError.code !== 'PGRST116') {
                    console.error('[getRecentOrdersForClient] Error fetching box items from items table:', boxItemsError);
                }
                
                // Final check: If we still have no items but box selections have items in JSON, log it
                if (boxItems.length === 0 && boxSelections.length > 0) {
                    const hasJsonItems = boxSelections.some((bs: any) => {
                        try {
                            const json = typeof bs.items === 'string' ? JSON.parse(bs.items) : (bs.items || {});
                            return json && typeof json === 'object' && Object.keys(json).length > 0;
                        } catch (e) {
                            return false;
                        }
                    });
                    if (hasJsonItems) {
                        console.log('[getRecentOrdersForClient] No items found in order_items, but box selections have JSON items - will use JSON fallback');
                    } else {
                        console.warn('[getRecentOrdersForClient] No items found in order_items AND no JSON items in box selections');
                    }
                }

                // Build items map from order_items table
                let itemsFromTable: any = {};
                const itemPricesMap: any = {};
                if (boxItems && boxItems.length > 0) {
                    console.log('[getRecentOrdersForClient] Processing', boxItems.length, 'box items from order_items table');
                    for (const item of boxItems) {
                        if (item.menu_item_id) {
                            // Sum quantities if same item appears multiple times (for multiple boxes)
                            const existingQty = itemsFromTable[item.menu_item_id] || 0;
                            const itemQty = item.quantity || 1;
                            itemsFromTable[item.menu_item_id] = existingQty + itemQty;
                            // Store price if available (from custom_price or calculated)
                            if (item.custom_price && !itemPricesMap[item.menu_item_id]) {
                                itemPricesMap[item.menu_item_id] = parseFloat(item.custom_price.toString());
                            }
                            console.log('[getRecentOrdersForClient] Added item', item.menu_item_id, 'qty:', itemQty, 'total:', itemsFromTable[item.menu_item_id]);
                        } else {
                            console.warn('[getRecentOrdersForClient] Box item missing menu_item_id:', item);
                        }
                    }
                    console.log('[getRecentOrdersForClient] Loaded', Object.keys(itemsFromTable).length, 'unique box items from order_items table:', itemsFromTable);
                } else {
                    console.log('[getRecentOrdersForClient] No box items found in order_items table, will use JSON fallback');
                }

                // Map to boxOrders format
                orderConfig.boxOrders = boxSelections.map((box: any, boxIdx: number) => {
                    // PRIORITY 1: Use items from order_items table if available
                    let items: any = {};
                    const itemsFromTableCount = Object.keys(itemsFromTable).length;
                    if (itemsFromTableCount > 0) {
                        items = { ...itemsFromTable }; // Create a copy to avoid reference issues
                        console.log(`[getRecentOrdersForClient] Box ${boxIdx}: Using ${itemsFromTableCount} items from order_items table:`, items);
                    } else {
                        // PRIORITY 2: Fallback to JSON field if no items found in items table
                        // Parse items from JSON if available (similar to getOrderHistory)
                        try {
                            if (box.items) {
                                if (typeof box.items === 'string') {
                                    items = JSON.parse(box.items);
                                } else if (typeof box.items === 'object') {
                                    items = box.items;
                                }
                                
                                // Handle different JSON formats
                                // Format 1: { itemId: quantity }
                                // Format 2: { itemId: { quantity: number, price: number } }
                                if (items && typeof items === 'object' && !Array.isArray(items)) {
                                    const normalizedItems: any = {};
                                    for (const [itemId, val] of Object.entries(items)) {
                                        if (val && typeof val === 'object' && 'quantity' in val) {
                                            normalizedItems[itemId] = (val as any).quantity;
                                        } else if (typeof val === 'number') {
                                            normalizedItems[itemId] = val;
                                        } else {
                                            normalizedItems[itemId] = val;
                                        }
                                    }
                                    items = normalizedItems;
                                }
                                console.log('[getRecentOrdersForClient] Using items from JSON field:', Object.keys(items).length, 'items');
                            } else {
                                console.log('[getRecentOrdersForClient] No items found in box selection');
                            }
                        } catch (e) {
                            console.error('[getRecentOrdersForClient] Error parsing box items:', e, { boxItems: box.items });
                            items = {};
                        }
                    }

                    const finalItems = items || {};
                    const finalItemsCount = Object.keys(finalItems).length;
                    console.log(`[getRecentOrdersForClient] Box ${boxIdx} (${box.box_type_id}): Final items count: ${finalItemsCount}`, finalItems);
                    
                    return {
                        boxTypeId: box.box_type_id,
                        vendorId: box.vendor_id,
                        quantity: box.quantity,
                        items: finalItems,
                        itemNotes: box.item_notes || {}
                    };
                });
                
                // Debug: Log final boxOrders structure
                console.log('[getRecentOrdersForClient] Final boxOrders:', JSON.stringify(orderConfig.boxOrders.map((b: any) => ({
                    boxTypeId: b.boxTypeId,
                    itemsCount: Object.keys(b.items || {}).length,
                    items: b.items
                })), null, 2));
                // Also set top-level properties for backward compatibility if single box
                if (boxSelections.length === 1) {
                    orderConfig.boxTypeId = boxSelections[0].box_type_id;
                    orderConfig.vendorId = boxSelections[0].vendor_id;
                    orderConfig.boxQuantity = boxSelections[0].quantity;
                    // Use items from table if available, otherwise fallback to JSON
                    let topLevelItems: any = {};
                    if (Object.keys(itemsFromTable).length > 0) {
                        topLevelItems = itemsFromTable;
                    } else {
                        // Parse items for top-level as well
                        try {
                            if (boxSelections[0].items && typeof boxSelections[0].items === 'string') {
                                topLevelItems = JSON.parse(boxSelections[0].items);
                            } else if (boxSelections[0].items && typeof boxSelections[0].items === 'object') {
                                topLevelItems = boxSelections[0].items;
                            }
                        } catch (e) {
                            console.error('Error parsing top-level box items:', e);
                        }
                    }
                    orderConfig.items = topLevelItems;
                    if (Object.keys(itemPricesMap).length > 0) {
                        orderConfig.itemPrices = itemPricesMap;
                    }
                }
            }

            return orderConfig;
        };

        const processedOrders = await Promise.all(ordersData.map(processOrder));

        return {
            orders: processedOrders,
            multiple: true // Flag to tell UI it's a list
        };

    } catch (error) {
        console.error('getRecentOrdersForClient error:', error);
        return null;
    }
}

/**
 * Get upcoming order from upcoming_orders table for a client
 * This is used for "Current Order Request" form
 */
/**
 * Get upcoming order from upcoming_orders table for a client
 * This is used for "Current Order Request" form
 * Now uses local database for fast access
 */
export async function getUpcomingOrderForClient(clientId: string, caseId?: string | null) {
    if (!clientId) return null;

    try {
        const { getUpcomingOrderForClientLocal, syncLocalDBFromSupabase } = await import('./local-db');
        let result = await getUpcomingOrderForClientLocal(clientId, caseId);
        // Reimplemented fix: when local DB is empty or out of sync, sync from Supabase and retry
        // so the client profile dialog can load existing upcoming_orders records
        if (result === null) {
            await syncLocalDBFromSupabase();
            result = await getUpcomingOrderForClientLocal(clientId, caseId);
        }
        return result;
    } catch (err) {
        console.error('Error in getUpcomingOrderForClient:', err);
        return null;
    }
}

/**
 * Get previous orders (history) for a client
 */
export async function getPreviousOrdersForClient(clientId: string) {
    if (!clientId) return [];

    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching previous orders:', error);
            return [];
        }

        return orders || [];
    } catch (err) {
        console.error('Error in getPreviousOrdersForClient:', err);
        return [];
    }
}

/**
 * Log a navigator action (status change)
 */
export async function logNavigatorAction(data: {
    navigatorId: string;
    clientId: string;
    oldStatus: string;
    newStatus: string;
    unitsAdded: number;
}) {
    try {
        const logId = randomUUID();
        await supabase
            .from('navigator_logs')
            .insert([{
                id: logId,
                navigator_id: data.navigatorId,
                client_id: data.clientId,
                action: `Status changed from ${data.oldStatus} to ${data.newStatus}`,
                details: { unitsAdded: data.unitsAdded }
            }]);
    } catch (err) {
        console.error('Error in logNavigatorAction:', err);
        // We don't throw here to avoid blocking the main action if logging fails, 
        // but in a strict audit system we might want to.
    }
}

/**
 * Get logs for a specific navigator
 */
export async function getNavigatorLogs(navigatorId: string) {
    try {
        // Fetch logs with client details
        const { data, error } = await supabase
            .from('navigator_logs')
            .select(`
                *,
                clients (
                    full_name
                )
            `)
            .eq('navigator_id', navigatorId)
            .gt('units_added', 0) // Only get logs where units were added
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching navigator logs:', error);
            return [];
        }

        return data.map((log: any) => ({
            id: log.id,
            clientId: log.client_id,
            clientName: log.clients?.full_name || 'Unknown Client',
            oldStatus: log.old_status,
            newStatus: log.new_status,
            unitsAdded: log.units_added,
            createdAt: log.created_at
        }));
    } catch (err) {
        console.error('Error in getNavigatorLogs:', err);
        return [];
    }
}

// --- OPTIMIZED ACTIONS ---

export async function getClientsPaginated(page: number, pageSize: number, searchQuery: string = '', filter?: 'needs-vendor') {
    try {
        // If filtering for clients needing vendor assignment, get Boxes clients whose vendor is not set
        if (filter === 'needs-vendor') {
            // First, get all clients with service_type = 'Boxes'
            const { data: allBoxesClients } = await supabase
                .from('clients')
                .select('id')
                .eq('service_type', 'Boxes');

            if (!allBoxesClients || allBoxesClients.length === 0) {
                return { clients: [], total: 0 };
            }

            const boxesClientIds = allBoxesClients.map(c => c.id);

            // Get all upcoming box selections for these clients
            // First get upcoming orders for these clients
            const { data: upcomingOrders } = await supabase
                .from('upcoming_orders')
                .select('id, client_id')
                .in('client_id', boxesClientIds)
                .eq('service_type', 'Boxes')
                .eq('status', 'scheduled');
            
            const upcomingOrderIds = (upcomingOrders || []).map(o => o.id);
            
            // Then get box selections for these orders
            const { data: boxSelections } = upcomingOrderIds.length > 0
                ? await supabase
                    .from('upcoming_order_box_selections')
                    .select('vendor_id, box_type_id, upcoming_order_id')
                    .in('upcoming_order_id', upcomingOrderIds)
                : { data: [] };
            
            // Map box selections with client_id from upcoming orders
            const boxSelectionsWithClient = (boxSelections || []).map((bs: any) => {
                const order = (upcomingOrders || []).find((o: any) => o.id === bs.upcoming_order_id);
                return {
                    ...bs,
                    client_id: order?.client_id || null,
                    service_type: 'Boxes',
                    status: 'scheduled'
                };
            });

            // Get all box types to check their vendor_id
            const { data: boxTypes } = await supabase
                .from('box_types')
                .select('id, vendor_id');

            const boxTypeMap = new Map((boxTypes || []).map((bt: any) => [bt.id, bt.vendor_id]));

            // Group box selections by client_id
            const clientBoxSelections = new Map<string, any[]>();
            if (boxSelectionsWithClient) {
                for (const bs of boxSelectionsWithClient) {
                    const clientId = bs.client_id;
                    if (!clientId) continue;

                    if (!clientBoxSelections.has(clientId)) {
                        clientBoxSelections.set(clientId, []);
                    }
                    clientBoxSelections.get(clientId)!.push(bs);
                }
            }

            // Find clients whose vendor is not set
            // Vendor is considered "set" if:
            // 1. box_selection.vendor_id is not null, OR
            // 2. box_type.vendor_id is not null (when box_type_id is set)
            const clientIdsNeedingVendor: string[] = [];

            for (const clientId of boxesClientIds) {
                const selections = clientBoxSelections.get(clientId) || [];

                // If client has no upcoming box selections, they need vendor assignment
                if (selections.length === 0) {
                    clientIdsNeedingVendor.push(clientId);
                    continue;
                }

                // Check if any selection has a vendor set
                let hasVendor = false;
                for (const selection of selections) {
                    // Check direct vendor_id in box selection
                    if (selection.vendor_id) {
                        hasVendor = true;
                        break;
                    }

                    // Check vendor_id from box type
                    if (selection.box_type_id) {
                        const boxTypeVendorId = boxTypeMap.get(selection.box_type_id);
                        if (boxTypeVendorId) {
                            hasVendor = true;
                            break;
                        }
                    }
                }

                if (!hasVendor) {
                    clientIdsNeedingVendor.push(clientId);
                }
            }

            if (clientIdsNeedingVendor.length === 0) {
                return { clients: [], total: 0 };
            }

            // Fetch clients with pagination
            let clientsQuery = supabase
                .from('clients')
                .select('*', { count: 'exact' })
                .in('id', clientIdsNeedingVendor);

            if (searchQuery) {
                clientsQuery = clientsQuery.ilike('full_name', `%${searchQuery}%`);
            }

            const { data, count, error } = await clientsQuery
                .order('full_name')
                .range((page - 1) * pageSize, page * pageSize - 1);

            if (error) {
                console.error('Error fetching clients:', error);
                return { clients: [], total: 0 };
            }

            const total = count || 0;

            // Map clients with error handling for individual clients
            const mappedClients = (data || []).map((c: any) => {
                try {
                    return mapClientFromDB(c);
                } catch (error) {
                    console.error(`Error mapping client ${c.id}:`, error);
                    return null;
                }
            }).filter((c: any) => c !== null);

            return {
                clients: mappedClients,
                total: total
            };
        }

        // Default behavior - get all clients. Fetch in chunks to avoid Supabase/PostgREST row limit (e.g. 690 or 1000).
        const CHUNK_SIZE = 500;
        const startRow = (page - 1) * pageSize;
        const endRow = page * pageSize - 1;

        let baseQuery = supabase.from('clients').select('*', { count: 'exact' });
        if (searchQuery) {
            baseQuery = baseQuery.ilike('full_name', `%${searchQuery}%`);
        }
        baseQuery = baseQuery.order('full_name');

        // Get total count (single small request)
        const { count: totalCount, error: countError } = await baseQuery.range(0, 0);
        if (countError) {
            console.error('Error fetching client count:', countError);
            return { clients: [], total: 0 };
        }
        const total = totalCount ?? 0;

        // Fetch only the rows for this page in chunks so we exceed no per-request limit
        const allData: any[] = [];
        for (let from = startRow; from <= endRow; from += CHUNK_SIZE) {
            const to = Math.min(from + CHUNK_SIZE - 1, endRow);
            const { data: chunk, error } = await baseQuery.range(from, to);
            if (error) {
                console.error('Error fetching clients chunk:', error);
                break;
            }
            allData.push(...(chunk || []));
            if ((chunk?.length ?? 0) < CHUNK_SIZE) break;
        }

        // Map clients with error handling for individual clients (partial data → keep client with defaults)
        const mappedClients = allData.map((c: any) => {
            try {
                return mapClientFromDB(c);
            } catch (error) {
                console.error(`Error mapping client ${c?.id}:`, error, { clientData: c });
                return null;
            }
        }).filter((c: any): c is ClientProfile => c !== null);

        return {
            clients: mappedClients,
            total
        };
    } catch (error) {
        console.error('[getClientsPaginated] Error fetching paginated clients:', error);
        if (error instanceof Error) {
            console.error('[getClientsPaginated] Error details:', { message: error.message, stack: error.stack });
        }
        return { clients: [], total: 0 };
    }
}

export async function getClientFullDetails(clientId: string) {
    if (!clientId) return null;

    try {
        const client = await getClient(clientId);
        if (!client) return null;

        const [
            history,
            orderHistory,
            billingHistory,
            activeOrder,
            upcomingOrder,
            submissionsResult,
            mealPlanData
        ] = await Promise.all([
            getClientHistory(clientId),
            getOrderHistory(clientId),
            getBillingHistory(clientId),
            getActiveOrderForClient(clientId),
            getUpcomingOrderForClient(clientId),
            getClientSubmissions(clientId),
            client.serviceType === 'Food' ? getSavedMealPlanDatesWithItemsFromOrders(clientId) : Promise.resolve([])
        ]);

        // Load box orders from client_box_orders table if service type is Boxes
        // Note: getClient() already loads box orders, but we also merge into activeOrder
        if (client.serviceType === 'Boxes') {
            try {
                const boxOrdersFromDb = await getClientBoxOrder(clientId);
                if (boxOrdersFromDb && boxOrdersFromDb.length > 0) {
                    // Convert ClientBoxOrder[] to boxOrders format
                    const boxOrders = boxOrdersFromDb.map(bo => ({
                        boxTypeId: bo.boxTypeId,
                        vendorId: bo.vendorId,
                        quantity: bo.quantity || 1,
                        items: bo.items || {},
                        itemNotes: bo.itemNotes || {},
                        caseId: bo.caseId
                    }));
                    
                    // Merge into activeOrder.boxOrders if activeOrder exists
                    if (activeOrder) {
                        const activeOrderAny = activeOrder as any;
                        if (!activeOrderAny.boxOrders || activeOrderAny.boxOrders.length === 0) {
                            activeOrderAny.boxOrders = boxOrders;
                        } else {
                            // Merge: use DB as source of truth
                            activeOrderAny.boxOrders = boxOrders;
                        }
                    }
                    
                    console.log('[getClientFullDetails] Loaded box orders from client_box_orders:', {
                        clientId,
                        boxOrdersCount: boxOrders.length
                    });
                }
            } catch (boxOrderError) {
                console.error('[getClientFullDetails] Error loading box orders:', boxOrderError);
                // Don't fail the whole request if box orders fail to load
            }
        }

        return {
            client,
            history,
            orderHistory,
            billingHistory,
            activeOrder,
            upcomingOrder,
            submissions: submissionsResult.success ? (submissionsResult.data || []) : [],
            mealPlanData: mealPlanData ?? []
        };
    } catch (error) {
        console.error('Error fetching full client details:', error);
        return null;
    }
}

/**
 * Single server action that returns all data needed for the client profile page.
 * One client→server round-trip instead of 17+ when cache is cold.
 * Keeps data accurate (same sources and caseId logic as loadData).
 */
export async function getClientProfilePageData(clientId: string) {
    if (!clientId) return null;
    try {
        const client = await getClient(clientId);
        if (!client) return null;

        const caseId = client.serviceType === 'Boxes'
            ? (client.activeOrder?.caseId ?? null)
            : null;

        const [
            statuses,
            navigators,
            vendors,
            menuItems,
            boxTypes,
            settings,
            categories,
            allClientsData,
            regularClientsData,
            activeOrderData,
            historyData,
            billingHistoryData,
            upcomingOrderDataInitial,
            orderHistoryData,
            dependentsData,
            boxOrdersFromDb,
            submissionsResult,
            mealPlanData
        ] = await Promise.all([
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getClients(),
            getRegularClients(),
            getRecentOrdersForClient(clientId),
            getClientHistory(clientId),
            getBillingHistory(clientId),
            getUpcomingOrderForClient(clientId, caseId),
            getOrderHistory(clientId, caseId),
            !client.parentClientId ? getDependentsByParentId(client.id) : Promise.resolve([]),
            client.serviceType === 'Boxes' ? getClientBoxOrder(clientId) : Promise.resolve(null),
            getClientSubmissions(clientId),
            client.serviceType === 'Food' ? getSavedMealPlanDatesWithItemsFromOrders(clientId) : Promise.resolve([])
        ]);

        return {
            c: client,
            s: statuses,
            n: navigators,
            v: vendors ?? [],
            m: menuItems ?? [],
            b: boxTypes ?? [],
            appSettings: settings,
            catData: categories ?? [],
            allClientsData: allClientsData ?? [],
            regularClientsData: regularClientsData ?? [],
            activeOrderData,
            historyData: historyData ?? [],
            billingHistoryData: billingHistoryData ?? [],
            upcomingOrderDataInitial,
            orderHistoryData: orderHistoryData ?? [],
            dependentsData: dependentsData ?? [],
            boxOrdersFromDb,
            submissions: submissionsResult?.success ? (submissionsResult.data ?? []) : [],
            mealPlanData: mealPlanData ?? []
        };
    } catch (error) {
        console.error('[getClientProfilePageData] Error:', error);
        return null;
    }
}

// --- VENDOR ORDER ACTIONS ---

export async function getOrdersByVendor(vendorId: string) {
    if (!vendorId) return [];

    const session = await getSession();
    if (!session || (session.role !== 'admin' && session.userId !== vendorId)) {
        console.error('Unauthorized access to getOrdersByVendor');
        return [];
    }

    try {
        // 1. Primary source: all orders from the database orders table for this vendor
        const { data: directOrders, error: directErr } = await supabase
            .from('orders')
            .select('*')
            .eq('vendor_id', vendorId)
            .order('created_at', { ascending: false });

        if (directErr) {
            console.error('getOrdersByVendor: error fetching orders by vendor_id:', directErr);
        }

        // 2. Also include orders linked via junction tables (in case vendor_id is null on order)
        const { data: foodOrderIds } = await supabase
            .from('order_vendor_selections')
            .select('order_id')
            .eq('vendor_id', vendorId);

        const { data: boxOrderIds } = await supabase
            .from('order_box_selections')
            .select('order_id')
            .eq('vendor_id', vendorId);

        const junctionOrderIds = Array.from(new Set([
            ...(foodOrderIds?.map((o: { order_id: string }) => o.order_id) || []),
            ...(boxOrderIds?.map((o: { order_id: string }) => o.order_id) || [])
        ]));

        // If we got orders directly from orders table, use them and add any from junction not already present
        const directIdSet = new Set((directOrders || []).map((o: { id: string }) => o.id));
        const ordersFromTable = directOrders || [];
        let ordersData = [...ordersFromTable];

        if (junctionOrderIds.length > 0) {
            const missingIds = junctionOrderIds.filter(id => !directIdSet.has(id));
            if (missingIds.length > 0) {
                const { data: extraOrders } = await supabase
                    .from('orders')
                    .select('*')
                    .in('id', missingIds)
                    .order('created_at', { ascending: false });
                if (extraOrders?.length) {
                    ordersData = [...ordersData, ...extraOrders];
                    ordersData.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                }
            }
        }

        // Filter: for Equipment, include if order.vendor_id matches OR notes.vendorId matches
        const filteredOrders = ordersData.filter((order: any) => {
            if (order.vendor_id === vendorId) return true;
            if (order.service_type === 'Equipment') {
                try {
                    const notes = order.notes ? JSON.parse(order.notes) : null;
                    return notes && notes.vendorId === vendorId;
                } catch {
                    return false;
                }
            }
            // Food/Boxes: only include if they're in junction tables (we already have them in ordersData)
            return true;
        });

        const orders = await Promise.all(filteredOrders.map(async (order: any) => {
            const processed = await processVendorOrderDetails(order, vendorId, false);
            return { ...processed, orderType: 'completed' };
        }));

        return orders;

    } catch (err) {
        console.error('Error in getOrdersByVendor:', err);
        return [];
    }
}

/**
 * Get all orders by service type (for admin use)
 * Returns orders filtered by service_type
 */
export async function getOrdersByServiceType(serviceType: string) {
    const session = await getSession();
    if (!session || session.role !== 'admin') {
        console.error('Unauthorized access to getOrdersByServiceType');
        return [];
    }

    try {
        // Fetch all orders with the specified service type
        const { data: ordersData, error } = await supabase
            .from('orders')
            .select('*')
            .eq('service_type', serviceType)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching orders by service type:', error);
            return [];
        }

        if (!ordersData || ordersData.length === 0) {
            return [];
        }

        // Process orders similar to getOrdersByVendor but for all vendors
        // For Produce orders, we need to handle them appropriately
        const processedOrders = await Promise.all(ordersData.map(async (order) => {
            // For Produce orders, we might need to get vendor info from notes or other sources
            // For now, return the order with basic processing
            const result: any = {
                ...order,
                orderNumber: order.order_number,
                items: [],
                boxSelection: null,
                orderType: 'completed'
            };

            // If Produce orders have vendor selections, fetch them
            if (serviceType === 'Produce') {
                // Try to get vendor selections for Produce orders
                const { data: vendorSelections } = await supabase
                    .from('order_vendor_selections')
                    .select('*')
                    .eq('order_id', order.id)
                    .limit(1);

                if (vendorSelections && vendorSelections.length > 0) {
                    const vs = vendorSelections[0];
                    const { data: items } = await supabase
                        .from('order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);

                    result.items = items || [];
                    result.vendorId = vs.vendor_id;
                } else {
                    // Try to parse from notes if available
                    try {
                        const notes = order.notes ? JSON.parse(order.notes) : null;
                        if (notes && notes.vendorId) {
                            result.vendorId = notes.vendorId;
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }

            return result;
        }));

        return processedOrders;

    } catch (err) {
        console.error('Error in getOrdersByServiceType:', err);
        return [];
    }
}

async function processVendorOrderDetails(order: any, vendorId: string, isUpcoming: boolean) {
    const orderIdField = isUpcoming ? 'upcoming_order_id' : 'order_id';
    const vendorSelectionsTable = isUpcoming ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
    const itemsTable = isUpcoming ? 'upcoming_order_items' : 'order_items';
    const boxSelectionsTable = isUpcoming ? 'upcoming_order_box_selections' : 'order_box_selections';

    const result = {
        ...order,
        orderNumber: order.order_number, // Ensure mapped for UI
        delivery_proof_url: order.proof_of_delivery_url ?? order.delivery_proof_url, // UI expects delivery_proof_url
        items: [],
        boxSelection: null
    };

    if (order.service_type === 'Food') {
        const { data: vs } = await supabase
            .from(vendorSelectionsTable)
            .select('id')
            .eq(orderIdField, order.id)
            .eq('vendor_id', vendorId)
            .maybeSingle();

        if (vs) {
            // For upcoming orders, use upcoming_vendor_selection_id; for regular orders, use vendor_selection_id
            const selectionIdField = isUpcoming ? 'upcoming_vendor_selection_id' : 'vendor_selection_id';
            const { data: items } = await supabase
                .from(itemsTable)
                .select('*')
                .eq(selectionIdField, vs.id);

            result.items = items || [];
        }
    } else if (order.service_type === 'Equipment') {
        // Parse equipment details from notes
        // Note: Orders are already filtered by vendor in getOrdersByVendor, so we can trust the vendorId
        try {
            const notes = order.notes ? JSON.parse(order.notes) : null;
            if (notes && notes.equipmentName) {
                result.equipmentSelection = {
                    vendorId: notes.vendorId,
                    equipmentId: notes.equipmentId,
                    equipmentName: notes.equipmentName,
                    price: notes.price
                };
            }
        } catch (e) {
            console.error('Error parsing equipment order notes:', e);
        }
    } else if (order.service_type === 'Boxes') {
        const { data: bs } = await supabase
            .from(boxSelectionsTable)
            .select('*')
            .eq(orderIdField, order.id)
            .eq('vendor_id', vendorId)
            .maybeSingle();

        if (bs) {
            result.boxSelection = bs;

            // If items field is empty, try to fetch from client's upcoming_order (same source as client profile uses)
            if (!bs.items || Object.keys(bs.items).length === 0) {
                // Get the client's upcoming_order from clients table (UPCOMING_ORDER_SCHEMA)
                const { data: clientData } = await supabase
                    .from('clients')
                    .select('upcoming_order')
                    .eq('id', order.client_id)
                    .maybeSingle();

                if (clientData && clientData.upcoming_order) {
                    const activeOrder = clientData.upcoming_order;
                    // Check if this is a box order and has items
                    if (activeOrder.serviceType === 'Boxes' && activeOrder.items && Object.keys(activeOrder.items).length > 0) {
                        // Use items from client's upcoming_order (same as client profile uses)
                        result.boxSelection = {
                            ...bs,
                            items: activeOrder.items
                        };
                    }
                }

                // If still empty, try to fetch items from order_items table as fallback (for migrated data)
                if ((!result.boxSelection.items || Object.keys(result.boxSelection.items).length === 0) && bs.vendor_id) {
                    // Find the vendor_selection for the box vendor in this order
                    const { data: vendorSelection } = await supabase
                        .from(vendorSelectionsTable)
                        .select('id')
                        .eq(orderIdField, order.id)
                        .eq('vendor_id', vendorId)
                        .maybeSingle();

                    if (vendorSelection) {
                        // For upcoming orders, use upcoming_vendor_selection_id; for regular orders, use vendor_selection_id
                        const selectionIdField = isUpcoming ? 'upcoming_vendor_selection_id' : 'vendor_selection_id';
                        const { data: boxItems } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .eq(selectionIdField, vendorSelection.id);

                        if (boxItems && boxItems.length > 0) {
                            // Convert items array to object format: { itemId: quantity }
                            const itemsObj: any = {};
                            for (const item of boxItems) {
                                if (item.menu_item_id && item.quantity) {
                                    itemsObj[item.menu_item_id] = item.quantity;
                                }
                            }
                            // Update the boxSelection with items
                            result.boxSelection = {
                                ...bs,
                                items: itemsObj
                            };
                        }
                    }
                }
            }
        }
    }

    return result;
}

/**
 * Resolve order ID from either order number (numeric) or UUID order ID
 * Returns the UUID order ID
 */
export async function resolveOrderId(orderIdentifier: string): Promise<string | null> {
    if (!orderIdentifier) return null;

    // Check if it's a UUID (contains hyphens and is 36 chars)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdentifier);

    if (isUUID) {
        // Already a UUID, verify it exists
        const { data } = await supabase
            .from('orders')
            .select('id')
            .eq('id', orderIdentifier)
            .maybeSingle();
        return data?.id || null;
    }

    // Try as order number (numeric)
    const orderNumber = parseInt(orderIdentifier, 10);
    if (!isNaN(orderNumber)) {
        const { data } = await supabase
            .from('orders')
            .select('id')
            .eq('order_number', orderNumber)
            .maybeSingle();
        return data?.id || null;
    }

    return null;
}

export async function isOrderUnderVendor(orderId: string, vendorId: string) {
    // Quick check if order is in list
    // Optimization: check DB directly
    const { data: foodOrder } = await supabase
        .from('order_vendor_selections')
        .select('id')
        .eq('order_id', orderId)
        .eq('vendor_id', vendorId)
        .maybeSingle();

    if (foodOrder) return true;

    const { data: boxOrder } = await supabase
        .from('order_box_selections')
        .select('id')
        .eq('order_id', orderId)
        .eq('vendor_id', vendorId)
        .maybeSingle();

    if (boxOrder) return true;

    // Check Equipment orders - vendor ID is stored in notes JSON
    const { data: equipmentOrder } = await supabase
        .from('orders')
        .select('service_type, notes')
        .eq('id', orderId)
        .eq('service_type', 'Equipment')
        .maybeSingle();

    if (equipmentOrder && equipmentOrder.notes) {
        try {
            const notes = JSON.parse(equipmentOrder.notes);
            if (notes && notes.vendorId === vendorId) {
                return true;
            }
        } catch (e) {
            // Invalid JSON, skip
        }
    }

    return false;
}

export async function orderHasDeliveryProof(orderId: string) {
    const { data, error } = await supabase
        .from('orders')
        .select('proof_of_delivery_url')
        .eq('id', orderId)
        .single();

    if (error || !data) return false;
    return !!data.proof_of_delivery_url;
}

export async function updateOrderDeliveryProof(orderId: string, proofUrl: string) {
    // Security check
    const session = await getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    if (session.role === 'vendor') {
        const authorized = await isOrderUnderVendor(orderId, session.userId);
        if (!authorized) {
            return { success: false, error: 'Unauthorized: Order does not belong to this vendor' };
        }
    }
    // 1. Update Order Status
    const { data: order, error } = await supabase
        .from('orders')
        .update({
            proof_of_delivery_url: proofUrl,
            status: 'billing_pending', // Changed from 'completed'
            actual_delivery_date: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();

    if (error) return { success: false, error: 'Failed to update order status: ' + error.message };

    // 2. Create Billing Record (if it doesn't already exist)
    // Fetch client to get navigator info and client name
    const { data: client } = await supabase
        .from('clients')
        .select('navigator_id, full_name, authorized_amount')
        .eq('id', order.client_id)
        .single();

    // Check if billing record already exists for this order
    const { data: existingBilling } = await supabase
        .from('billing_records')
        .select('id')
        .eq('order_id', order.id)
        .maybeSingle();

    if (!existingBilling) {
        const billingId = randomUUID();
        try {
            await supabase
                .from('billing_records')
                .insert([{
                    id: billingId,
                    client_id: order.client_id,
                    order_id: order.id,
                    status: 'pending',
                    amount: order.total_value || 0,
                    navigator: client?.navigator_id || null,
                    remarks: 'Auto-generated upon proof upload'
                }]);
        } catch (billingError) {
            console.error('Failed to create billing record:', billingError);
            return { success: true, warning: 'Order updated but billing record creation failed.' };
        }
    }

    // Reduce client's authorized amount by the order amount (only if billing record didn't already exist)
    if (!existingBilling && client && client.authorized_amount !== null && client.authorized_amount !== undefined) {
        const orderAmount = order.total_value || 0;
        const newAuthorizedAmount = Math.max(0, client.authorized_amount - orderAmount);

        const { error: authAmountError } = await supabase
            .from('clients')
            .update({ authorized_amount: newAuthorizedAmount })
            .eq('id', order.client_id);

        if (authAmountError) {
            console.error('Failed to update authorized amount:', authAmountError);
        }
    }

    revalidatePath('/vendors');
    return { success: true };
}

export async function saveDeliveryProofUrlAndProcessOrder(
    orderId: string,
    orderType: string,
    proofUrl: string
) {
    console.log(`[Process Pending Order] START saveDeliveryProofUrlAndProcessOrder for Order: "${orderId}", Type: "${orderType}"`);
    console.log(`[Process Pending Order] Proof URL: ${proofUrl}`);

    const session = await getSession();
    const currentUserName = session?.name || 'Admin';

    let finalOrderId = orderId;
    let wasProcessed = false;
    const errors: string[] = [];

    // If order is from upcoming_orders, process it first (but check if already processed)
    if (orderType === 'upcoming') {
        // Fetch the upcoming order
        const { data: upcomingOrder, error: fetchError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError || !upcomingOrder) {
            return {
                success: false,
                error: 'Upcoming order not found: ' + (fetchError?.message || 'Unknown error')
            };
        }

        // Check if already processed - look for order with same case_id
        if (upcomingOrder.case_id) {
            const { data: existingOrder, error: checkError } = await supabase
                .from('orders')
                .select('id')
                .eq('case_id', upcomingOrder.case_id)
                .maybeSingle();

            if (checkError) {
                return {
                    success: false,
                    error: 'Error checking for existing order: ' + checkError.message
                };
            }

            if (existingOrder) {
                // Already processed, use the existing order ID
                finalOrderId = existingOrder.id;
                wasProcessed = false; // Not processed now, was already processed before
            } else {
                // Not processed yet, process it now
                try {
                    const currentTime = await getCurrentTime();
                    const proofUploadDateStr = formatDateToYYYYMMDD(currentTime);

                    // For Produce (prompt/realtime delivery), use proof upload date for both scheduled and actual delivery.
                    // Otherwise calculate scheduled_delivery_date from delivery_day if available.
                    let scheduledDeliveryDate: string | null = null;
                    if (upcomingOrder.service_type === 'Produce') {
                        scheduledDeliveryDate = proofUploadDateStr;
                    } else if (upcomingOrder.delivery_day) {
                        const calculatedDate = getNextDeliveryDateForDay(
                            upcomingOrder.delivery_day,
                            await getVendors(),
                            undefined,
                            getTodayDateInAppTzAsReference(currentTime),
                            currentTime
                        );
                        if (calculatedDate) {
                            scheduledDeliveryDate = formatDateToYYYYMMDD(calculatedDate);
                        }
                    }

                    // Create order in orders table
                    console.log(`[Process Pending Order] Creating new Order for Case ${upcomingOrder.case_id} with status 'billing_pending'`);
                    console.log(`[Process Pending Order] Copying order_number from upcoming order: ${upcomingOrder.order_number}`);
                    
                    const orderData: any = {
                        id: randomUUID(),
                        client_id: upcomingOrder.client_id,
                        service_type: upcomingOrder.service_type,
                        case_id: upcomingOrder.case_id,
                        status: 'billing_pending',
                        last_updated: currentTime.toISOString(),
                        updated_by: currentUserName,
                        scheduled_delivery_date: scheduledDeliveryDate,
                        delivery_distribution: null, // Can be set later if needed
                        total_value: upcomingOrder.total_value,
                        total_items: upcomingOrder.total_items,
                        bill_amount: upcomingOrder.bill_amount || null,
                        notes: upcomingOrder.notes,
                        actual_delivery_date: currentTime.toISOString(),
                        order_number: upcomingOrder.order_number, // Copy order_number directly from upcoming_orders record
                        vendor_id: upcomingOrder.vendor_id ?? null // So vendor page (getOrdersByVendor) can find this order
                    };

                    const { data: newOrder, error: orderError } = await supabase
                        .from('orders')
                        .insert(orderData)
                        .select()
                        .single();

                    if (orderError || !newOrder) {
                        return {
                            success: false,
                            error: 'Failed to create order: ' + (orderError?.message || 'Unknown error')
                        };
                    }

                    finalOrderId = newOrder.id;
                    wasProcessed = true;
                    console.log(`[Process Pending Order] Successfully created Order ${newOrder.id}`);

                    // Create billing record for the processed order
                    const { data: client } = await supabase
                        .from('clients')
                        .select('navigator_id, full_name, authorized_amount')
                        .eq('id', upcomingOrder.client_id)
                        .single();

                    // Check if billing record already exists for this order
                    const { data: existingBilling } = await supabase
                        .from('billing_records')
                        .select('id')
                        .eq('order_id', newOrder.id)
                        .maybeSingle();

                    if (!existingBilling) {
                        console.log(`[Process Pending Order] Creating Billing Record for ${newOrder.id}`);
                        // Use bill_amount if available, otherwise fall back to total_value
                        const billingAmount = upcomingOrder.bill_amount ?? upcomingOrder.total_value ?? 0;
                        const { error: billingError } = await supabase
                            .from('billing_records')
                            .insert([{
                                id: randomUUID(),
                                client_id: upcomingOrder.client_id,
                                order_id: newOrder.id,
                                status: 'pending',
                                amount: billingAmount,
                                navigator: client?.navigator_id || null,
                                remarks: 'Auto-generated when order processed for delivery'
                            }]);

                        if (billingError) {
                            errors.push('Failed to create billing record: ' + billingError.message);
                        }
                    }

                    // Reduce client's authorized amount by the order amount (only if billing record didn't already exist)
                    if (!existingBilling && client) {
                        console.log(`[Process Pending Order] Processing deduction for client ${upcomingOrder.client_id}`);
                        console.log(`[Process Pending Order] Client Object:`, client);
                        console.log(`[Process Pending Order] Current authorized_amount: ${client?.authorized_amount}`);
                        console.log(`[Process Pending Order] Order total_value: ${upcomingOrder.total_value}`);

                        // Treat null/undefined as 0 and allow negative result
                        const currentAmount = client.authorized_amount ?? 0;
                        const orderAmount = upcomingOrder.total_value || 0;
                        const newAuthorizedAmount = currentAmount - orderAmount;

                        console.log(`[Process Pending Order] Deducting ${orderAmount} from ${currentAmount}. New amount: ${newAuthorizedAmount}`);

                        const { error: authAmountError } = await supabase
                            .from('clients')
                            .update({ authorized_amount: newAuthorizedAmount })
                            .eq('id', upcomingOrder.client_id);

                        if (authAmountError) {
                            errors.push('Failed to update authorized amount: ' + authAmountError.message);
                            console.error('[Process Pending Order] Failed to update authorized amount:', authAmountError);
                        } else {
                            console.log('[Process Pending Order] Successfully updated authorized_amount');
                        }
                    }

                    // Copy vendor selections and items (for Food orders)
                    if (upcomingOrder.service_type === 'Food') {
                        const { data: vendorSelections } = await supabase
                            .from('upcoming_order_vendor_selections')
                            .select('*')
                            .eq('upcoming_order_id', upcomingOrder.id);

                        if (vendorSelections) {
                            for (const vs of vendorSelections) {
                                const { data: newVs, error: vsError } = await supabase
                                    .from('order_vendor_selections')
                                    .insert({
                                        order_id: newOrder.id,
                                        vendor_id: vs.vendor_id
                                    })
                                    .select()
                                    .single();

                                if (vsError || !newVs) {
                                    errors.push(`Failed to copy vendor selection: ${vsError?.message}`);
                                    continue;
                                }

                                // Copy items - use upcoming_vendor_selection_id to find items from upcoming orders
                                const { data: items } = await supabase
                                    .from('upcoming_order_items')
                                    .select('*')
                                    .eq('upcoming_vendor_selection_id', vs.id);

                                if (items) {
                                    console.log(`[Process Pending Order] Found ${items.length} items for vendor selection ${vs.id}`);
                                    for (const item of items) {
                                        // Skip items with null menu_item_id (these are total items, not actual menu items)
                                        if (!item.menu_item_id && !item.meal_item_id) {
                                            console.log(`[Process Pending Order] Skipping item with null menu_item_id and meal_item_id (likely a total item)`);
                                            continue;
                                        }

                                        // Build item data with all fields that should be copied
                                        const itemData: any = {
                                            id: randomUUID(),
                                            vendor_selection_id: newVs.id,
                                            quantity: item.quantity
                                        };

                                        // Copy menu_item_id if present (can be null for meal items)
                                        if (item.menu_item_id) {
                                            itemData.menu_item_id = item.menu_item_id;
                                        }

                                        // Copy meal_item_id if present
                                        if (item.meal_item_id) {
                                            itemData.meal_item_id = item.meal_item_id;
                                        }

                                        // Copy notes if present
                                        if (item.notes) {
                                            itemData.notes = item.notes;
                                        }

                                        // Copy custom_name if present
                                        if (item.custom_name) {
                                            itemData.custom_name = item.custom_name;
                                        }

                                        // Copy custom_price if present
                                        if (item.custom_price !== null && item.custom_price !== undefined) {
                                            itemData.custom_price = item.custom_price;
                                        }

                                        const { error: itemError } = await supabase
                                            .from('order_items')
                                            .insert(itemData);

                                        if (itemError) {
                                            const errorMsg = `Failed to copy item ${item.menu_item_id || item.meal_item_id || 'unknown'}: ${itemError.message}`;
                                            console.error(`[Process Pending Order] ${errorMsg}`);
                                            errors.push(errorMsg);
                                        } else {
                                            console.log(`[Process Pending Order] Successfully copied item ${item.menu_item_id || item.meal_item_id || 'custom'} (quantity: ${item.quantity})`);
                                        }
                                    }
                                } else {
                                    console.log(`[Process Pending Order] No items found for vendor selection ${vs.id}`);
                                }
                            }
                        }
                    }

                    // Copy box selections (for Box orders)
                    if (upcomingOrder.service_type === 'Boxes') {
                        const { data: boxSelections } = await supabase
                            .from('upcoming_order_box_selections')
                            .select('*')
                            .eq('upcoming_order_id', upcomingOrder.id);

                        if (boxSelections && boxSelections.length > 0) {
                            // First, copy all box selections
                            for (const bs of boxSelections) {
                                const { error: bsError } = await supabase
                                    .from('order_box_selections')
                                    .insert({
                                        order_id: newOrder.id,
                                        box_type_id: bs.box_type_id,
                                        vendor_id: bs.vendor_id,
                                        quantity: bs.quantity,
                                        unit_value: bs.unit_value || 0,
                                        total_value: bs.total_value || 0,
                                        items: bs.items || {}
                                    });

                                if (bsError) {
                                    errors.push(`Failed to copy box selection: ${bsError.message}`);
                                } else {
                                    console.log(`[Process Pending Order] Successfully copied box selection for order ${newOrder.id}`);
                                }
                            }

                            // Then, copy box items from upcoming_order_items (only once, outside the loop)
                            // Box order items have null vendor_selection_id and upcoming_vendor_selection_id
                            const { data: boxItems } = await supabase
                                .from('upcoming_order_items')
                                .select('*')
                                .eq('upcoming_order_id', upcomingOrder.id)
                                .is('upcoming_vendor_selection_id', null)
                                .is('vendor_selection_id', null);

                            if (boxItems && boxItems.length > 0) {
                                console.log(`[Process Pending Order] Found ${boxItems.length} box items to copy for order ${newOrder.id}`);
                                
                                // Get unique vendor IDs from box selections to create vendor selections
                                const uniqueVendorIds = [...new Set(boxSelections.map(bs => bs.vendor_id).filter(Boolean))];
                                
                                // Create vendor selections for each unique vendor (needed for order_items)
                                const vendorSelectionMap = new Map<string, string>();
                                
                                for (const vendorId of uniqueVendorIds) {
                                    // Check if vendor selection already exists
                                    const { data: existingVs } = await supabase
                                        .from('order_vendor_selections')
                                        .select('id')
                                        .eq('order_id', newOrder.id)
                                        .eq('vendor_id', vendorId)
                                        .maybeSingle();

                                    if (existingVs) {
                                        vendorSelectionMap.set(vendorId, existingVs.id);
                                    } else {
                                        // Create vendor selection for Box orders
                                        const { data: newBoxVs, error: vsError } = await supabase
                                            .from('order_vendor_selections')
                                            .insert({
                                                order_id: newOrder.id,
                                                vendor_id: vendorId
                                            })
                                            .select()
                                            .single();

                                        if (vsError || !newBoxVs) {
                                            errors.push(`Failed to create vendor selection for vendor ${vendorId}: ${vsError?.message}`);
                                        } else {
                                            vendorSelectionMap.set(vendorId, newBoxVs.id);
                                            console.log(`[Process Pending Order] Created vendor selection ${newBoxVs.id} for vendor ${vendorId}`);
                                        }
                                    }
                                }

                                // Copy box items to order_items
                                // For box items, we need to determine which vendor selection to use
                                // We'll use the first vendor selection if we can't determine the vendor from the item
                                const firstVendorId = uniqueVendorIds[0];
                                const defaultVsId = firstVendorId ? vendorSelectionMap.get(firstVendorId) : null;

                                if (defaultVsId) {
                                    for (const item of boxItems) {
                                        // Skip items with null menu_item_id and meal_item_id
                                        if (!item.menu_item_id && !item.meal_item_id) {
                                            console.log(`[Process Pending Order] Skipping box item with null menu_item_id and meal_item_id`);
                                            continue;
                                        }

                                        // Try to find the vendor for this item to use the correct vendor selection
                                        // For now, use the default vendor selection (first vendor)
                                        // TODO: If items have vendor_id, use that to find the correct vendor selection
                                        const itemVsId = defaultVsId;

                                        const itemData: any = {
                                            id: randomUUID(),
                                            vendor_selection_id: itemVsId,
                                            quantity: item.quantity
                                        };

                                        if (item.menu_item_id) {
                                            itemData.menu_item_id = item.menu_item_id;
                                        }

                                        if (item.meal_item_id) {
                                            itemData.meal_item_id = item.meal_item_id;
                                        }

                                        if (item.notes) {
                                            itemData.notes = item.notes;
                                        }

                                        if (item.custom_name) {
                                            itemData.custom_name = item.custom_name;
                                        }

                                        if (item.custom_price !== null && item.custom_price !== undefined) {
                                            itemData.custom_price = item.custom_price;
                                        }

                                        const { error: itemError } = await supabase
                                            .from('order_items')
                                            .insert(itemData);

                                        if (itemError) {
                                            const errorMsg = `Failed to copy box item ${item.menu_item_id || item.meal_item_id || 'unknown'}: ${itemError.message}`;
                                            console.error(`[Process Pending Order] ${errorMsg}`);
                                            errors.push(errorMsg);
                                        } else {
                                            console.log(`[Process Pending Order] Successfully copied box item ${item.menu_item_id || item.meal_item_id || 'custom'} (quantity: ${item.quantity})`);
                                        }
                                    }
                                } else {
                                    errors.push(`Failed to create vendor selection for box items: No vendor selections available`);
                                }
                            } else {
                                console.log(`[Process Pending Order] No box items found to copy for order ${newOrder.id}`);
                            }
                        } else {
                            console.log(`[Process Pending Order] No box selections found for upcoming order ${upcomingOrder.id}`);
                        }
                    }

                    // Update upcoming order status to processed
                    await supabase
                        .from('upcoming_orders')
                        .update({
                            status: 'processed',
                            processed_order_id: newOrder.id,
                            processed_at: new Date().toISOString()
                        })
                        .eq('id', upcomingOrder.id);
                } catch (error: any) {
                    return {
                        success: false,
                        error: 'Error processing upcoming order: ' + error.message
                    };
                }
            }
        } else {
            // No case_id, can't check if processed, so just try to process
            // This is similar to above but we'll skip duplicate checking
            // Actually, let's return an error if there's no case_id as it's risky
            return {
                success: false,
                error: 'Upcoming order has no case_id, cannot safely process'
            };
        }
    }

    // Now update the order (from either upcoming or existing orders table) with proof URL
    // If order was just processed, it already has status 'billing_pending' and billing record created
    // Just update the proof URL and other fields
    const updateData: any = {
        proof_of_delivery_url: proofUrl.trim(),
        updated_by: currentUserName,
        last_updated: new Date().toISOString()
    };

    // Only update status and actual_delivery_date if order wasn't just processed
    if (!wasProcessed) {
        updateData.status = 'billing_pending';
        updateData.actual_delivery_date = new Date().toISOString();
    }

    const { data: order, error: updateError } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', finalOrderId)
        .select()
        .single();

    if (updateError || !order) {
        return {
            success: false,
            error: 'Failed to update order with proof URL: ' + (updateError?.message || 'Unknown error')
        };
    }

    // Only create billing record if order wasn't just processed (for existing orders)
    if (!wasProcessed) {
        const { data: client } = await supabase
            .from('clients')
            .select('navigator_id, full_name, authorized_amount')
            .eq('id', order.client_id)
            .single();

        // Check if billing record already exists for this order
        const { data: existingBilling } = await supabase
            .from('billing_records')
            .select('id')
            .eq('order_id', order.id)
            .maybeSingle();

        if (!existingBilling) {
            // Create billing record if it doesn't exist
            // Use bill_amount if available, otherwise fall back to total_value
            const billingAmount = order.bill_amount ?? order.total_value ?? 0;
            const { error: billingError } = await supabase
                .from('billing_records')
                .insert([{
                    id: randomUUID(),
                    client_id: order.client_id,
                    order_id: order.id,
                    status: 'pending',
                    amount: billingAmount,
                    navigator: client?.navigator_id || null,
                    remarks: 'Auto-generated upon proof upload'
                }]);

            if (billingError) {
                errors.push('Failed to create billing record: ' + billingError.message);
            }
        }

        // Reduce client's authorized amount by the order amount (only if billing record didn't already exist)
        if (!existingBilling && client && client.authorized_amount !== null && client.authorized_amount !== undefined) {
            const orderAmount = order.total_value || 0;
            const newAuthorizedAmount = Math.max(0, client.authorized_amount - orderAmount);

            const { error: authAmountError } = await supabase
                .from('clients')
                .update({ authorized_amount: newAuthorizedAmount })
                .eq('id', order.client_id);

            if (authAmountError) {
                errors.push('Failed to update authorized amount: ' + authAmountError.message);
            }
        }
    }

    revalidatePath('/vendors');
    revalidatePath('/clients');

    // Trigger local DB sync in background
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();

    return {
        success: true,
        orderId: finalOrderId,
        wasProcessed,
        errors: errors.length > 0 ? errors : undefined,
        summary: {
            orderId: finalOrderId,
            caseId: order.case_id || 'N/A',
            clientId: order.client_id,
            serviceType: order.service_type,
            status: order.status,
            wasProcessed: wasProcessed,
            hasErrors: errors.length > 0,
            errors: errors.length > 0 ? errors : undefined
        }
    };
}

// --- VENDOR-SPECIFIC ACTIONS (for vendor portal) ---

export async function getVendorSession() {
    const session = await getSession();
    if (!session || session.role !== 'vendor') {
        return null;
    }
    return session;
}

export async function getVendorOrders() {
    const session = await getVendorSession();
    if (!session) return [];
    return await getOrdersByVendor(session.userId);
}

export async function getVendorMenuItems() {
    const session = await getVendorSession();
    if (!session) return [];

    const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('vendor_id', session.userId);

    if (error) return [];
    return data.map((i: any) => ({
        id: i.id,
        vendorId: i.vendor_id,
        name: i.name,
        value: i.value,
        priceEach: i.price_each ?? undefined,
        isActive: i.is_active,
        categoryId: i.category_id,
        quotaValue: i.quota_value,
        minimumOrder: i.minimum_order ?? 0
    }));
}

export async function getVendorDetails() {
    const session = await getVendorSession();
    if (!session) return null;

    const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', session.userId)
        .single();

    if (error || !data) return null;

    return {
        id: data.id,
        name: data.name,
        email: data.email,
        serviceTypes: (data.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ServiceType[],
        deliveryDays: data.delivery_days || [],
        allowsMultipleDeliveries: data.delivery_frequency === 'Multiple',
        isActive: data.is_active,
        minimumMeals: data.minimum_meals ?? 0
    };
}

export async function updateVendorDetails(data: Partial<Vendor & { password?: string }>) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.serviceTypes) payload.service_type = data.serviceTypes.join(',');
    if (data.deliveryDays) payload.delivery_days = data.deliveryDays;
    if (data.allowsMultipleDeliveries !== undefined) {
        payload.delivery_frequency = data.allowsMultipleDeliveries ? 'Multiple' : 'Once';
    }
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.minimumMeals !== undefined) payload.minimum_meals = data.minimumMeals;
    if (data.email !== undefined) payload.email = data.email;
    if (data.password) {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password);
    }

    const { error } = await supabase
        .from('vendors')
        .update(payload)
        .eq('id', session.userId);

    handleError(error);
    invalidateVendorsCache(); // Clear cache when vendor is updated
    revalidatePath('/vendor');
    revalidatePath('/vendor/details');
}

export async function addVendorMenuItem(data: Omit<MenuItem, 'id'>) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    const payload: any = {
        vendor_id: session.userId,
        name: data.name,
        value: data.value,
        is_active: data.isActive,
        category_id: data.categoryId || null,
        quota_value: data.quotaValue,
        minimum_order: data.minimumOrder ?? 0,
        price_each: data.priceEach
    };

    if (!data.priceEach || data.priceEach <= 0) {
        throw new Error('Price is required and must be greater than 0');
    }

    const { data: res, error } = await supabase
        .from('menu_items')
        .insert([payload])
        .select()
        .single();

    handleError(error);
    revalidatePath('/vendor');
    revalidatePath('/vendor/items');
    return { ...data, id: res.id };
}

export async function updateVendorMenuItem(id: string, data: Partial<MenuItem>) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    // Verify the menu item belongs to this vendor
    const { data: item } = await supabase
        .from('menu_items')
        .select('vendor_id')
        .eq('id', id)
        .single();

    if (!item || item.vendor_id !== session.userId) {
        throw new Error('Unauthorized: Menu item does not belong to this vendor');
    }

    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.value !== undefined) payload.value = data.value;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.categoryId !== undefined) payload.category_id = data.categoryId || null;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.minimumOrder !== undefined) payload.minimum_order = data.minimumOrder;

    const { error } = await supabase
        .from('menu_items')
        .update(payload)
        .eq('id', id);

    handleError(error);
    revalidatePath('/vendor');
    revalidatePath('/vendor/items');
}

export async function deleteVendorMenuItem(id: string) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    // Verify the menu item belongs to this vendor
    const { data: item } = await supabase
        .from('menu_items')
        .select('vendor_id')
        .eq('id', id)
        .single();

    if (!item || item.vendor_id !== session.userId) {
        throw new Error('Unauthorized: Menu item does not belong to this vendor');
    }

    const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', id);

    handleError(error);
    revalidatePath('/vendor');
    revalidatePath('/vendor/items');
}

export async function invalidateOrderData(path?: string) {
    if (path) {
        revalidatePath(path);
    } else {
        revalidatePath('/', 'layout');
    }
}

export async function getOrdersPaginated(page: number, pageSize: number, filter?: 'needs-vendor') {
    // For the Orders tab, show orders from both orders and upcoming_orders tables
    // Include all statuses (pending, confirmed, completed, waiting_for_proof, billing_pending, cancelled)
    // Show all orders regardless of scheduled_delivery_date (some may use delivery_day instead)
    
    try {
        // Build base query for orders table
        // Fetch orders first, then get client names separately to avoid nested relation issues
        let ordersQuery = supabase
            .from('orders')
            .select('*');

        // Build base query for upcoming_orders table
        let upcomingOrdersQuery = supabase
            .from('upcoming_orders')
            .select('*');

        let orderIdsFromOrders: string[] = [];
        let orderIdsFromUpcoming: string[] = [];
        let orderIdsNeedingVendor: string[] = [];

    // If filtering for orders needing vendor assignment, only get Boxes orders with null vendor_id in box_selections
    if (filter === 'needs-vendor') {
        // Get all Boxes orders from orders table
        const { data: boxesOrders, error: boxesError } = await supabase
            .from('orders')
            .select('id')
            .eq('service_type', 'Boxes');

        if (boxesError) {
            console.error('Error fetching boxes orders:', boxesError);
            return { orders: [], total: 0 };
        }

        // Get all Boxes upcoming orders
        const { data: boxesUpcomingOrders, error: boxesUpcomingError } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('service_type', 'Boxes')
            .eq('status', 'scheduled');

        if (boxesUpcomingError) {
            console.error('Error fetching boxes upcoming orders:', boxesUpcomingError);
        }

        const boxesOrderIds = (boxesOrders || []).map(o => o.id);
        const boxesUpcomingOrderIds = (boxesUpcomingOrders || []).map(o => o.id);

        const allBoxesOrderIds = [...boxesOrderIds, ...boxesUpcomingOrderIds];

        if (allBoxesOrderIds.length === 0) {
            return { orders: [], total: 0 };
        }

        // Get box selections with null vendor_id from both tables
        const [orderBoxSelectionsResult, upcomingBoxSelectionsResult] = await Promise.all([
            boxesOrderIds.length > 0 ? supabase
                .from('order_box_selections')
                .select('order_id')
                .in('order_id', boxesOrderIds)
                .is('vendor_id', null) : { data: [], error: null },
            boxesUpcomingOrderIds.length > 0 ? supabase
                .from('upcoming_order_box_selections')
                .select('upcoming_order_id')
                .in('upcoming_order_id', boxesUpcomingOrderIds)
                .is('vendor_id', null) : { data: [], error: null }
        ]);

        if (orderBoxSelectionsResult.error) {
            console.error('Error fetching order box selections:', orderBoxSelectionsResult.error);
        }
        if (upcomingBoxSelectionsResult.error) {
            console.error('Error fetching upcoming box selections:', upcomingBoxSelectionsResult.error);
        }

        orderIdsNeedingVendor = [
            ...((orderBoxSelectionsResult.data || []).map((bs: any) => bs.order_id)),
            ...((upcomingBoxSelectionsResult.data || []).map((bs: any) => bs.upcoming_order_id))
        ];

        if (orderIdsNeedingVendor.length === 0) {
            return { orders: [], total: 0 };
        }

        // Filter orders to only those needing vendor
        orderIdsFromOrders = orderIdsNeedingVendor.filter(id => boxesOrderIds.includes(id));
        orderIdsFromUpcoming = orderIdsNeedingVendor.filter(id => boxesUpcomingOrderIds.includes(id));

        // Only query tables that have orders needing vendors
        if (orderIdsFromOrders.length > 0) {
            ordersQuery = ordersQuery.in('id', orderIdsFromOrders);
        } else {
            // No orders from orders table need vendor, so set to return empty
            ordersQuery = ordersQuery.eq('id', '00000000-0000-0000-0000-000000000000'); // Impossible match
        }

        if (orderIdsFromUpcoming.length > 0) {
            upcomingOrdersQuery = upcomingOrdersQuery.in('id', orderIdsFromUpcoming);
        } else {
            // No orders from upcoming_orders table need vendor, so set to return empty
            upcomingOrdersQuery = upcomingOrdersQuery.eq('id', '00000000-0000-0000-0000-000000000000'); // Impossible match
        }
    }

    // Bounded fetch: get total count, then fetch only enough rows to form the requested page.
    let total: number;
    let ordersData: any[];
    let upcomingOrdersData: any[];

    if (filter === 'needs-vendor') {
        // Already constrained to orderIdsFromOrders / orderIdsFromUpcoming; fetch those rows only.
        const oRes = orderIdsFromOrders.length > 0 ? await ordersQuery.order('created_at', { ascending: false }) : { data: [] as any[], error: null };
        const uRes = orderIdsFromUpcoming.length > 0 ? await upcomingOrdersQuery.order('created_at', { ascending: false }) : { data: [] as any[], error: null };
        if (oRes.error) console.error('[getOrdersPaginated] Error fetching orders:', oRes.error);
        if (uRes.error) console.error('[getOrdersPaginated] Error fetching upcoming orders:', uRes.error);
        ordersData = oRes.data || [];
        upcomingOrdersData = uRes.data || [];
        total = orderIdsNeedingVendor.length;
    } else {
        // No filter: get counts from both tables, then bounded fetch (limit page * pageSize from each).
        const ordersCountQuery = supabase.from('orders').select('*', { count: 'exact', head: true });
        const upcomingCountQuery = supabase.from('upcoming_orders').select('*', { count: 'exact', head: true });
        const ordersLimit = page * pageSize;
        const ordersDataQuery = supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(ordersLimit);
        const upcomingDataQuery = supabase
            .from('upcoming_orders')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(ordersLimit);

        const [countOrders, countUpcoming, ordersResult, upcomingOrdersResult] = await Promise.all([
            ordersCountQuery,
            upcomingCountQuery,
            ordersDataQuery,
            upcomingDataQuery
        ]);

        const totalOrders = (countOrders as any).count ?? 0;
        const totalUpcoming = (countUpcoming as any).count ?? 0;
        total = totalOrders + totalUpcoming;

        if (ordersResult.error) {
            console.error('[getOrdersPaginated] Error fetching orders:', ordersResult.error);
        }
        if (upcomingOrdersResult.error) {
            console.error('[getOrdersPaginated] Error fetching upcoming orders:', upcomingOrdersResult.error);
        }
        ordersData = ordersResult.data || [];
        upcomingOrdersData = upcomingOrdersResult.data || [];
    }

    // Combine and sort by created_at descending, then take the requested page
    const allOrders = [
        ...(ordersData.map((o: any) => ({ ...o, is_upcoming: false }))),
        ...(upcomingOrdersData.map((o: any) => ({ ...o, is_upcoming: true })))
    ];
    allOrders.sort((a: any, b: any) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
    });

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedOrders = total === 0 ? [] : allOrders.slice(startIndex, endIndex);

    console.log(`[getOrdersPaginated] Total orders: ${total}, Page: ${page}, Page size: ${pageSize}, Showing: ${paginatedOrders.length}`);

    // Fetch client names for paginated orders only
    const clientIds = [...new Set(
        paginatedOrders.map((o: any) => o.client_id).filter(Boolean)
    )];
    
    let clientsMap: Record<string, string> = {};
    if (clientIds.length > 0) {
        const { data: clientsData, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name')
            .in('id', clientIds);
        
        if (!clientsError && clientsData) {
            clientsMap = clientsData.reduce((acc: Record<string, string>, client: any) => {
                acc[client.id] = client.full_name || 'Unknown';
                return acc;
            }, {});
        } else if (clientsError) {
            console.error('[getOrdersPaginated] Error fetching client names:', clientsError);
        }
    }

    const mappedOrders = paginatedOrders.map((o: any) => {
        // Get client name from the map
        const clientName = o.client_id ? (clientsMap[o.client_id] || 'Unknown') : 'Unknown';
        // For display: prefer actual_delivery_date (e.g. produce proof upload date) over scheduled_delivery_date
        const displayDeliveryDate = o.actual_delivery_date || o.scheduled_delivery_date || null;
        return {
            ...o,
            clientName: clientName,
            // Use the actual status from the order, default to 'pending' if not set
            status: o.status || (o.is_upcoming ? 'scheduled' : 'pending'),
            // Raw scheduled_delivery_date from DB; use displayDeliveryDate for Delivery Date column (prefers actual when set)
            scheduled_delivery_date: o.scheduled_delivery_date || null,
            actual_delivery_date: o.actual_delivery_date || null,
            display_delivery_date: displayDeliveryDate,
            // Ensure total_items is included
            total_items: o.total_items || 0
        };
    });

        return {
            orders: mappedOrders,
            total: total
        };
    } catch (error: any) {
        console.error('[getOrdersPaginated] Unexpected error:', error);
        return { orders: [], total: 0 };
    }
}

export async function getOrderById(orderId: string) {
    try {
        if (!orderId) {
            console.warn('[getOrderById] No orderId provided');
            return null;
        }

        console.log('[getOrderById] Fetching order:', orderId);

        // Fetch the order
        // Use maybeSingle() instead of single() to avoid errors when order doesn't exist
        let orderData: any = null;
        let isUpcomingOrder = false;

        const { data: orderDataFromOrders, error: orderError } = await supabase
            .from('orders')
            .select('*')
            .eq('id', orderId)
            .maybeSingle();

        if (orderError) {
            // Log detailed error information for actual errors (not "not found" cases)
            console.error('[getOrderById] Error fetching order:', {
                code: orderError.code,
                message: orderError.message,
                details: orderError.details,
                hint: orderError.hint,
                orderId: orderId
            });
            return null;
        }

        if (orderDataFromOrders) {
            orderData = orderDataFromOrders;
            isUpcomingOrder = false;
            console.log('[getOrderById] Order found in orders table:', orderData.id, 'Service type:', orderData.service_type);
        } else {
            // Order not found in orders table - check upcoming_orders table
            console.log('[getOrderById] Order not found in orders table, checking upcoming_orders:', orderId);
            
            const { data: upcomingOrderData, error: upcomingOrderError } = await supabase
                .from('upcoming_orders')
                .select('*')
                .eq('id', orderId)
                .maybeSingle();

            if (upcomingOrderError) {
                console.error('[getOrderById] Error fetching upcoming order:', {
                    code: upcomingOrderError.code,
                    message: upcomingOrderError.message,
                    details: upcomingOrderError.details,
                    hint: upcomingOrderError.hint,
                    orderId: orderId
                });
                return null;
            }

            if (!upcomingOrderData) {
                // Order not found in either table
                console.log('[getOrderById] Order not found in orders or upcoming_orders:', orderId);
                return null;
            }

            // Use upcoming order data and set flag to use upcoming order tables
            orderData = upcomingOrderData;
            isUpcomingOrder = true;
            console.log('[getOrderById] Order found in upcoming_orders:', orderData.id, 'Service type:', orderData.service_type);
        }

    // Fetch client information (including sign_token for signature reports)
    const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('id, full_name, address, email, phone_number, sign_token')
        .eq('id', orderData.client_id)
        .maybeSingle();
    
    if (clientError) {
        console.error('[getOrderById] Error fetching client:', clientError);
    }

    // Fetch reference data
    const [menuItems, vendors, boxTypes, equipmentList, categories, mealItems] = await Promise.all([
        getMenuItems(),
        getVendors(),
        getBoxTypes(),
        getEquipment(),
        getCategories(),
        getMealItems()
    ]);

    let orderDetails: any = undefined;

    if (orderData.service_type === 'Food' || orderData.service_type === 'Meal') {
        // Fetch vendor selections and items
        const vendorSelectionsTable = isUpcomingOrder ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
        const orderIdField = isUpcomingOrder ? 'upcoming_order_id' : 'order_id';
        
        const { data: vendorSelections } = await supabase
            .from(vendorSelectionsTable)
            .select('*')
            .eq(orderIdField, orderId);

        console.log(`[getOrderById] Order ${orderId} (${orderData.service_type}): Found ${vendorSelections?.length} vendor selections`);

        if (vendorSelections && vendorSelections.length > 0) {
            const itemsTable = isUpcomingOrder ? 'upcoming_order_items' : 'order_items';
            const vendorSelectionIdField = isUpcomingOrder ? 'upcoming_vendor_selection_id' : 'vendor_selection_id';
            
            const vendorSelectionsWithItems = await Promise.all(
                vendorSelections.map(async (vs: any) => {
                    const { data: items } = await supabase
                        .from(itemsTable)
                        .select('*')
                        .eq(vendorSelectionIdField, vs.id);

                    console.log(`[getOrderById] VS ${vs.id}: Found ${items?.length} items in DB`);
                    if (items && items.length > 0) {
                        console.log(`[getOrderById] First item:`, items[0]);
                    }

                    const vendor = vendors.find(v => v.id === vs.vendor_id);
                    const itemsWithDetails = (items || []).map((item: any) => {
                        let menuItem: any = menuItems.find(mi => mi.id === item.menu_item_id);
                        if (!menuItem) {
                            menuItem = mealItems.find(mi => mi.id === item.menu_item_id);
                        }

                        if (!menuItem) {
                            console.warn(`[getOrderById] Item not found in menu or meal items: ${item.menu_item_id}`);
                        }

                        console.log('[getOrderById] Processing Item:', {
                            id: item.id,
                            menuItemId: item.menu_item_id,
                            customName: item.custom_name,
                            customPrice: item.custom_price,
                            unitValue: item.unit_value
                        });

                        const itemPrice = item.custom_price ? parseFloat(item.custom_price) : (menuItem?.priceEach ?? parseFloat(item.unit_value || '0'));
                        const quantity = item.quantity;
                        const itemTotal = itemPrice * quantity;
                        return {
                            id: item.id,
                            menuItemId: item.menu_item_id,
                            menuItemName: item.custom_name || menuItem?.name || 'Unknown Item',
                            quantity: quantity,
                            unitValue: itemPrice,
                            totalValue: itemTotal,
                            notes: item.notes || null
                        };
                    });

                    return {
                        vendorId: vs.vendor_id,
                        vendorName: vendor?.name || 'Unknown Vendor',
                        items: itemsWithDetails
                    };
                })
            );

            orderDetails = {
                serviceType: orderData.service_type,
                vendorSelections: vendorSelectionsWithItems,
                totalItems: orderData.total_items,
                totalValue: parseFloat(orderData.total_value || 0)
            };
        }
    } else if (orderData.service_type === 'Custom') {
        // Handle Custom orders - fetch vendor selections and items
        const vendorSelectionsTable = isUpcomingOrder ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
        const orderIdField = isUpcomingOrder ? 'upcoming_order_id' : 'order_id';
        
        const { data: vendorSelections } = await supabase
            .from(vendorSelectionsTable)
            .select('*')
            .eq(orderIdField, orderId);

        if (vendorSelections && vendorSelections.length > 0) {
            const itemsTable = isUpcomingOrder ? 'upcoming_order_items' : 'order_items';
            const vendorSelectionIdField = isUpcomingOrder ? 'upcoming_vendor_selection_id' : 'vendor_selection_id';
            
            const vendorSelectionsWithItems = await Promise.all(
                vendorSelections.map(async (vs: any) => {
                    const { data: items } = await supabase
                        .from(itemsTable)
                        .select('*')
                        .eq(vendorSelectionIdField, vs.id);

                    const vendor = vendors.find(v => v.id === vs.vendor_id);

                    const itemsWithDetails = (items || []).map((item: any) => ({
                        id: item.id,
                        menuItemId: null,
                        menuItemName: item.custom_name || 'Custom Item',
                        quantity: item.quantity,
                        unitValue: parseFloat(item.custom_price || 0),
                        totalValue: parseFloat(item.custom_price || 0) * item.quantity
                    }));

                    return {
                        vendorId: vs.vendor_id,
                        vendorName: vendor?.name || 'Unknown Vendor',
                        items: itemsWithDetails
                    };
                })
            );

            orderDetails = {
                serviceType: 'Custom',
                vendorSelections: vendorSelectionsWithItems,
                totalItems: orderData.total_items,
                totalValue: parseFloat(orderData.total_value || 0),
                notes: orderData.notes
            };
        }
    } else if (orderData.service_type === 'Boxes') {
        // Fetch box selection
        const boxSelectionsTable = isUpcomingOrder ? 'upcoming_order_box_selections' : 'order_box_selections';
        const orderIdField = isUpcomingOrder ? 'upcoming_order_id' : 'order_id';
        
        const { data: boxSelection } = await supabase
            .from(boxSelectionsTable)
            .select('*')
            .eq(orderIdField, orderId)
            .maybeSingle();

        if (boxSelection) {
            const vendor = vendors.find(v => v.id === boxSelection.vendor_id);
            const boxType = boxTypes.find(bt => bt.id === boxSelection.box_type_id);
            const boxTotalValue = boxSelection.total_value
                ? parseFloat(boxSelection.total_value)
                : parseFloat(orderData.total_value || 0);

            // Structure box items by category
            const boxItems = boxSelection.items || {};
            const itemsByCategory: { [categoryId: string]: { categoryName: string; items: Array<{ itemId: string; itemName: string; quantity: number; quotaValue: number }> } } = {};

            // Group items by category
            Object.entries(boxItems).forEach(([itemId, qty]: [string, any]) => {
                const menuItem = menuItems.find(mi => mi.id === itemId);

                // Handle both object format {quantity: X} and direct number format
                const quantity = typeof qty === 'object' && qty !== null ? (qty as any).quantity : Number(qty) || 0;

                if (menuItem && menuItem.categoryId) {
                    const category = categories.find(c => c.id === menuItem.categoryId);
                    if (category) {
                        if (!itemsByCategory[category.id]) {
                            itemsByCategory[category.id] = {
                                categoryName: category.name,
                                items: []
                            };
                        }

                        itemsByCategory[category.id].items.push({
                            itemId: itemId,
                            itemName: menuItem.name,
                            quantity: quantity,
                            quotaValue: menuItem.quotaValue || 1
                        });
                    } else {
                        // Category not found but item exists
                        if (!itemsByCategory['uncategorized']) {
                            itemsByCategory['uncategorized'] = {
                                categoryName: 'Uncategorized',
                                items: []
                            };
                        }
                        itemsByCategory['uncategorized'].items.push({
                            itemId: itemId,
                            itemName: menuItem.name,
                            quantity: quantity,
                            quotaValue: menuItem.quotaValue || 1
                        });
                    }
                } else {
                    // Menu item not found - fallback
                    if (!itemsByCategory['uncategorized']) {
                        itemsByCategory['uncategorized'] = {
                            categoryName: 'Uncategorized',
                            items: []
                        };
                    }

                    itemsByCategory['uncategorized'].items.push({
                        itemId: itemId,
                        itemName: menuItem?.name || 'Unknown Item (' + itemId + ')',
                        quantity: quantity,
                        quotaValue: 1
                    });
                }
            });

            orderDetails = {
                serviceType: orderData.service_type,
                vendorId: boxSelection.vendor_id,
                vendorName: vendor?.name || 'Unknown Vendor',
                boxTypeId: boxSelection.box_type_id,
                boxTypeName: boxType?.name || 'Unknown Box Type',
                boxQuantity: boxSelection.quantity,
                items: boxSelection.items || {},
                itemsByCategory: itemsByCategory,
                totalValue: boxTotalValue
            };
        } else {
            // Fallback if box selection is missing
            orderDetails = {
                serviceType: orderData.service_type,
                vendorId: null,
                vendorName: 'Unknown Vendor (Missing Selection Data)',
                boxTypeId: null,
                boxTypeName: 'Unknown Box Type',
                boxQuantity: 1,
                items: {},
                itemsByCategory: {},
                totalValue: parseFloat(orderData.total_value || 0)
            };
        }
    } else if (orderData.service_type === 'Equipment') {
        // Parse equipment details from notes field
        try {
            const notes = orderData.notes ? JSON.parse(orderData.notes) : null;
            if (notes) {
                const vendor = vendors.find(v => v.id === notes.vendorId);
                const equipment = equipmentList.find(e => e.id === notes.equipmentId);

                orderDetails = {
                    serviceType: orderData.service_type,
                    vendorId: notes.vendorId,
                    vendorName: vendor?.name || 'Unknown Vendor',
                    equipmentId: notes.equipmentId,
                    equipmentName: notes.equipmentName || equipment?.name || 'Unknown Equipment',
                    price: notes.price || equipment?.price || 0,
                    totalValue: parseFloat(orderData.total_value || 0)
                };
            }
        } catch (e) {
            console.error('Error parsing equipment order notes:', e);
            // Fallback: try to get vendor from vendor selections
            const vendorSelectionsTable = isUpcomingOrder ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
            const orderIdField = isUpcomingOrder ? 'upcoming_order_id' : 'order_id';
            
            const { data: vendorSelections } = await supabase
                .from(vendorSelectionsTable)
                .select('*')
                .eq(orderIdField, orderId)
                .limit(1)
                .maybeSingle();

            if (vendorSelections) {
                const vendor = vendors.find(v => v.id === vendorSelections.vendor_id);
                orderDetails = {
                    serviceType: orderData.service_type,
                    vendorId: vendorSelections.vendor_id,
                    vendorName: vendor?.name || 'Unknown Vendor',
                    totalValue: parseFloat(orderData.total_value || 0)
                };
            }
        }
    }

    console.log('[getOrderById] Successfully built order object');
    return {
        id: orderData.id,
        orderNumber: orderData.order_number,
        clientId: orderData.client_id,
        clientName: clientData?.full_name || 'Unknown Client',
        clientAddress: clientData?.address || '',
        clientEmail: clientData?.email || '',
        clientPhone: clientData?.phone_number || '',
        clientSignToken: clientData?.sign_token || null,
        serviceType: orderData.service_type,
        caseId: orderData.case_id,
        status: orderData.status,
        scheduledDeliveryDate: orderData.scheduled_delivery_date,
        actualDeliveryDate: orderData.actual_delivery_date,
        deliveryProofUrl: orderData.proof_of_delivery_image || '',
        totalValue: parseFloat(orderData.total_value || 0),
        totalItems: orderData.total_items,
        notes: orderData.notes,
        createdAt: orderData.created_at,
        lastUpdated: orderData.updated_at || orderData.last_updated,
        updatedBy: orderData.updated_by,
        // Include upcoming order specific fields if applicable
        takeEffectDate: isUpcomingOrder ? orderData.take_effect_date : undefined,
        deliveryDay: isUpcomingOrder ? orderData.delivery_day : undefined,
        deliveryDistribution: isUpcomingOrder ? orderData.delivery_distribution : undefined,
        isUpcomingOrder: isUpcomingOrder,
        orderDetails: orderDetails
    };
    } catch (error) {
        console.error('[getOrderById] Unexpected error:', error);
        return null;
    }
};

/**
 * Efficiently fetch full details for a batch of clients
 * Used for prefetching visible clients in the list
 */
export async function getBatchClientDetails(clientIds: string[]) {
    if (!clientIds || clientIds.length === 0) return {};

    try {
        // console.log(`[BatchFetch] Starting batch fetch for ${clientIds.length} clients`);
        // We could optimize this further with a single SQL query or stored proc,
        // but for now, parallelizing the existing optimized getters is a massive step up from serial
        // fetching in a loop.
        // Also, most of the "sub-getters" (like history) are simple selects by ID.

        // Use Promise.all to fetch all clients in parallel
        const results = await Promise.all(
            clientIds.map(async (id) => {
                try {
                    const details = await getClientFullDetails(id);
                    return { id, details };
                } catch (e) {
                    console.error(`Error fetching details for client ${id}:`, e);
                    return { id, details: null };
                }
            })
        );

        // Convert array to map for easy lookup
        const resultMap: Record<string, any> = {};
        results.forEach(r => {
            if (r.details) {
                resultMap[r.id] = r.details;
            }
        });

        // console.log(`[BatchFetch] Completed batch fetch for ${clientIds.length} clients`);
        return resultMap;
    } catch (error) {
        console.error('Error in getBatchClientDetails:', error);
        return {};
    }
}

// --- FILE UPLOAD ACTION ---

export async function uploadMenuItemImage(formData: FormData) {
    const file = formData.get('file') as File;
    if (!file) {
        throw new Error('No file provided');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const extension = file.name.split('.').pop();
    // Use a clean filename
    const key = `menu-item-${timestamp}-${randomUUID()}.${extension}`;

    // Upload to R2
    const result = await uploadFile(key, buffer, file.type);

    if (!result.success) {
        throw new Error('Failed to upload image');
    }

    // Construct public URL
    // Priority: Env Var -> Hardcoded fallback
    const publicUrlBase = process.env.R2_PUBLIC_URL_BASE || 'https://pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev';
    const publicUrl = `${publicUrlBase}/${key}`;

    return { success: true, url: publicUrl };
}

// --- MEAL SELECTION MANAGEMENT ACTIONS ---
// Uses 'breakfast_categories' and 'breakfast_items' tables but is generic via 'meal_type'

export async function getMealCategories() {
    const { data, error } = await supabase.from('breakfast_categories').select('*').order('sort_order', { ascending: true }).order('name');
    if (error) {
        logQueryError(error, 'breakfast_categories', 'select');
        return [];
    }
    return (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        mealType: c.meal_type || 'Breakfast', // Default to Breakfast if missing
        setValue: c.set_value ?? undefined,
        sortOrder: c.sort_order ?? 0
    }));
}

export async function addMealCategory(mealType: string, name: string, setValue?: number | null) {
    const payload: any = {
        name,
        meal_type: mealType
    };
    if (setValue !== undefined) {
        payload.set_value = setValue;
    }
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: res, error } = await supabaseAdmin.from('breakfast_categories').insert([payload]).select().single();
    handleError(error, 'addMealCategory');
    revalidatePath('/admin');
    return {
        id: res.id,
        name: res.name,
        mealType: res.meal_type,
        setValue: res.set_value ?? undefined,
        sortOrder: res.sort_order ?? 0
    };
}

export async function updateMealCategory(id: string, name: string, setValue?: number | null) {
    const payload: any = { name };
    if (setValue !== undefined) {
        payload.set_value = setValue;
    }
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabaseAdmin.from('breakfast_categories').update(payload).eq('id', id);
    handleError(error, 'updateMealCategory');
    revalidatePath('/admin');
}

export async function deleteMealCategory(id: string) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabaseAdmin.from('breakfast_categories').delete().eq('id', id);
    handleError(error, 'deleteMealCategory');
    revalidatePath('/admin');
}

export async function deleteMealType(mealType: string) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // Delete all categories for this meal type. 
    // Items will cascade delete because of FK 'ON DELETE CASCADE' on breakfast_items.category_id
    const { error } = await supabaseAdmin
        .from('breakfast_categories')
        .delete()
        .eq('meal_type', mealType);

    handleError(error, 'deleteMealType');
    revalidatePath('/admin');
}

export async function getMealItems() {
    const { data, error } = await supabase.from('breakfast_items')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
    if (error) {
        logQueryError(error, 'breakfast_items', 'select');
        return [];
    }
    return (data || []).map((i: any) => ({
        id: i.id,
        categoryId: i.category_id,
        name: i.name,
        value: i.quota_value, // Map quota_value to standardized 'value' property
        quotaValue: i.quota_value,
        priceEach: i.price_each ?? undefined,
        isActive: i.is_active,
        vendorId: i.vendor_id,
        imageUrl: i.image_url || null,
        sortOrder: i.sort_order ?? 0
    }));
}

export async function addMealItem(data: { categoryId: string, name: string, quotaValue: number, priceEach?: number, isActive: boolean, imageUrl?: string | null, sortOrder?: number }) {
    const payload: any = {
        category_id: data.categoryId,
        name: data.name,
        quota_value: data.quotaValue,
        is_active: data.isActive,
        image_url: data.imageUrl || null,
        sort_order: data.sortOrder ?? 0
    };
    if (data.priceEach !== undefined) {
        payload.price_each = data.priceEach;
    }

    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: res, error } = await supabaseAdmin.from('breakfast_items').insert([payload]).select().single();
    handleError(error, 'addMealItem');
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateMealItem(id: string, data: Partial<{ name: string, quotaValue: number, priceEach?: number, isActive: boolean, imageUrl?: string | null, sortOrder?: number }>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.imageUrl !== undefined) payload.image_url = data.imageUrl;
    if (data.sortOrder !== undefined) payload.sort_order = data.sortOrder;

    // R2 Cleanup: If image is being updated/removed, delete the old one
    if (data.imageUrl !== undefined) {
        const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { data: existing } = await supabaseAdmin.from('breakfast_items').select('image_url').eq('id', id).single();
        const oldUrl = existing?.image_url;

        if (oldUrl && oldUrl !== data.imageUrl) {
            try {
                const key = oldUrl.split('/').pop();
                if (key) await deleteFile(key);
            } catch (e) {
                console.error("Failed to delete stale meal image:", e);
            }
        }
    }

    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabaseAdmin.from('breakfast_items').update(payload).eq('id', id);
    handleError(error, 'updateMealItem');
    revalidatePath('/admin');
}

export async function deleteMealItem(id: string) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: item } = await supabaseAdmin.from('breakfast_items').select('image_url').eq('id', id).single();
    const { error } = await supabaseAdmin.from('breakfast_items').delete().eq('id', id);
    if (!error && item?.image_url) {
        try {
            const key = item.image_url.split('/').pop();
            if (key) await deleteFile(key);
        } catch (e) {
            console.error("Failed to delete meal image:", e);
        }
    }
    handleError(error, 'deleteMealItem');
    revalidatePath('/admin');
}

export async function updateMealItemOrder(updates: { id: string; sortOrder: number }[]) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('breakfast_items').update({ sort_order: sortOrder }).eq('id', id)
    );
    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

export async function updateMealCategoryOrder(updates: { id: string; sortOrder: number }[]) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('breakfast_categories').update({ sort_order: sortOrder }).eq('id', id)
    );
    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

// --- INDEPENDENT ORDER ACTIONS ---

export async function getClientFoodOrder(clientId: string): Promise<ClientFoodOrder | null> {
    // Use clients.upcoming_order JSON field (UPCOMING_ORDER_SCHEMA)
    const { data, error } = await supabase
        .from('clients')
        .select('id, upcoming_order, updated_at, updated_by')
        .eq('id', clientId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching client food order:', error);
        return null;
    }
    if (!data || !data.upcoming_order) return null;

    const activeOrder = typeof data.upcoming_order === 'string' 
        ? JSON.parse(data.upcoming_order) 
        : data.upcoming_order;

    // Only return if it's a Food service type order with deliveryDayOrders
    if (activeOrder.serviceType !== 'Food' || !activeOrder.deliveryDayOrders) {
        return null;
    }

    return {
        id: data.id, // Use client ID as the identifier
        clientId: data.id,
        caseId: activeOrder.caseId,
        deliveryDayOrders: activeOrder.deliveryDayOrders,
        created_at: undefined, // Not stored separately
        updated_at: data.updated_at,
        updated_by: data.updated_by || undefined
    };
}

export async function saveClientFoodOrder(clientId: string, data: Partial<ClientFoodOrder>, fullActiveOrder?: any) {
    const session = await getSession();
    const updatedBy = session?.userId || null;

    // Use Service Role client to bypass RLS for custom auth or public portal
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // CRITICAL FIX: If fullActiveOrder is provided, use it directly instead of fetching from DB
    // This ensures we're working with the latest prepared order structure and don't lose
    // vendorSelections or other fields that might be needed for syncCurrentOrderToUpcoming
    let activeOrder: any;
    
    if (fullActiveOrder) {
        // Use the provided activeOrder as the base (canonical Food structure from ClientProfile).
        // Preserve caseId, serviceType, mealSelections, vendorSelections, deliveryDayOrders.
        activeOrder = {
            ...fullActiveOrder,
            serviceType: 'Food',
            mealSelections: fullActiveOrder.mealSelections ?? {},
            vendorSelections: Array.isArray(fullActiveOrder.vendorSelections) ? fullActiveOrder.vendorSelections : []
        };
    } else {
        // Get current client data to preserve existing upcoming_order structure
        const { data: clientData, error: fetchError } = await supabaseAdmin
            .from('clients')
            .select('upcoming_order')
            .eq('id', clientId)
            .maybeSingle();

        if (fetchError) {
            handleError(fetchError);
            return null;
        }

        // Parse existing upcoming_order or create new one
        activeOrder = clientData?.upcoming_order 
            ? (typeof clientData.upcoming_order === 'string' 
                ? JSON.parse(clientData.upcoming_order) 
                : clientData.upcoming_order)
            : {};
    }

    // Update with new Food order data
    // CRITICAL FIX: Preserve the entire activeOrder structure, especially vendorSelections
    // The issue was that we were only updating deliveryDayOrders and caseId, which caused
    // the foods order to not save properly in upcoming_orders table because vendorSelections
    // (in old format) or the full structure was being lost
    activeOrder.serviceType = 'Food';
    if (data.caseId !== undefined) activeOrder.caseId = data.caseId;
    if (data.deliveryDayOrders !== undefined) {
        // CRITICAL: Only update deliveryDayOrders if the passed data has actual content
        // Don't overwrite with empty object {} as that would clear existing selections
        const hasData = typeof data.deliveryDayOrders === 'object' && 
                       data.deliveryDayOrders !== null &&
                       Object.keys(data.deliveryDayOrders).length > 0;
        if (hasData) {
            // Merge deliveryDayOrders to preserve any existing structure
            activeOrder.deliveryDayOrders = data.deliveryDayOrders;
        }
        // If data.deliveryDayOrders is empty/undefined, preserve existing activeOrder.deliveryDayOrders
        // This ensures we don't clear selections when saving
    }
    // CRITICAL: Preserve vendorSelections if they exist (old format compatibility)
    // Don't delete vendorSelections just because we're updating deliveryDayOrders
    // This ensures syncCurrentOrderToUpcoming can find the order data in either format

    // Sanitize vendor selection items: remove null/empty item keys that cause "Item null not found in menu items"
    const sanitizeItems = (items: any): Record<string, number> => {
        if (!items || typeof items !== 'object') return {};
        return Object.fromEntries(
            Object.entries(items).filter(([k]) => k != null && k !== '' && String(k) !== 'null')
        ) as Record<string, number>;
    };
    if (Array.isArray(activeOrder.vendorSelections)) {
        activeOrder.vendorSelections = activeOrder.vendorSelections.map((vs: any) => ({
            ...vs,
            items: sanitizeItems(vs.items)
        }));
    }
    if (activeOrder.deliveryDayOrders && typeof activeOrder.deliveryDayOrders === 'object') {
        for (const day of Object.keys(activeOrder.deliveryDayOrders)) {
            const dayOrder = activeOrder.deliveryDayOrders[day];
            if (dayOrder?.vendorSelections && Array.isArray(dayOrder.vendorSelections)) {
                dayOrder.vendorSelections = dayOrder.vendorSelections.map((vs: any) => ({
                    ...vs,
                    items: sanitizeItems(vs.items)
                }));
            }
        }
    }

    // Prepare update payload
    const updatePayload: any = {
        upcoming_order: activeOrder,
        updated_at: new Date().toISOString()
    };
    if (updatedBy) updatePayload.updated_by = updatedBy;

    // Update client's upcoming_order field
    let { data: updated, error } = await supabaseAdmin
        .from('clients')
        .update(updatePayload)
        .eq('id', clientId)
        .select()
        .single();

    // Retry without updated_by if foreign key violation
    if (error && error.code === '23503') {
        delete updatePayload.updated_by;
        const retry = await supabaseAdmin
            .from('clients')
            .update(updatePayload)
            .eq('id', clientId)
            .select()
            .single();
        updated = retry.data;
        error = retry.error;
    }

    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    
    // Return in ClientFoodOrder format
    return updated ? {
        id: updated.id,
        client_id: updated.id,
        case_id: activeOrder.caseId,
        delivery_day_orders: activeOrder.deliveryDayOrders,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
        updated_by: updated.updated_by
    } : null;
}

export async function getClientMealOrder(clientId: string): Promise<ClientMealOrder | null> {
    // Use clients.upcoming_order JSON field (UPCOMING_ORDER_SCHEMA)
    const { data, error } = await supabase
        .from('clients')
        .select('id, upcoming_order, updated_at, updated_by')
        .eq('id', clientId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching client meal order:', error);
        return null;
    }
    if (!data || !data.upcoming_order) return null;

    const activeOrder = typeof data.upcoming_order === 'string' 
        ? JSON.parse(data.upcoming_order) 
        : data.upcoming_order;

    // Only return if it's a Meal service type order with mealSelections
    if (activeOrder.serviceType !== 'Meal' || !activeOrder.mealSelections) {
        return null;
    }

    return {
        id: data.id, // Use client ID as the identifier
        clientId: data.id,
        caseId: activeOrder.caseId,
        mealSelections: activeOrder.mealSelections,
        created_at: undefined, // Not stored separately
        updated_at: data.updated_at,
        updated_by: data.updated_by || undefined
    };
}

/**
 * Flatten mealSelections to array of { menuItemId?, mealItemId?, quantity } for upcoming_order_items.
 * Resolves item ids to menu_item_id or meal_item_id using getMenuItems/getMealItems.
 */
async function flattenMealSelectionsToItems(
    mealSelections: ClientMealOrder['mealSelections']
): Promise<{ menuItemId: string | null; mealItemId: string | null; quantity: number }[]> {
    const byItemId = new Map<string, number>();
    for (const meal of Object.values(mealSelections || {})) {
        if (!meal?.items || typeof meal.items !== 'object') continue;
        for (const [itemId, qty] of Object.entries(meal.items)) {
            const quantity = Number(qty) || 0;
            if (quantity <= 0 || !itemId) continue;
            byItemId.set(itemId, (byItemId.get(itemId) || 0) + quantity);
        }
    }
    const menuItems = await getMenuItems();
    const menuIds = new Set(menuItems.map((m) => m.id));
    const mealItems = await getMealItems();
    const mealIds = new Set(mealItems.map((m) => m.id));
    const result: { menuItemId: string | null; mealItemId: string | null; quantity: number }[] = [];
    for (const [itemId, quantity] of byItemId) {
        if (menuIds.has(itemId)) {
            result.push({ menuItemId: itemId, mealItemId: null, quantity });
        } else if (mealIds.has(itemId)) {
            result.push({ menuItemId: null, mealItemId: itemId, quantity });
        }
        // Skip unknown itemIds (e.g. custom item keys) - do not set menu_item_id to avoid FK violation.
        // Custom items are added from meal_planner_custom_items via getEffectiveMealPlanItemsForDate.
    }
    return result;
}

/**
 * Sync client meal selections from active_order to meal_planner_orders and meal_planner_order_items (one row per delivery date).
 * Uses main vendor's delivery days to generate dates for the next 8 weeks.
 */
async function syncMealPlannerToOrders(
    clientId: string,
    mealSelections: ClientMealOrder['mealSelections']
) {
    if (!mealSelections || typeof mealSelections !== 'object') return;

    const vendors = await getVendors();
    const mainVendor = vendors.find((v) => v.isDefault === true) || vendors[0];
    const deliveryDays = mainVendor
        ? ('deliveryDays' in mainVendor ? mainVendor.deliveryDays : (mainVendor as any).delivery_days) || []
        : [];

    if (deliveryDays.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayNumbers = deliveryDays
        .map((d: string) => DAY_NAME_TO_NUMBER[d])
        .filter((n: number | undefined): n is number => n !== undefined);
    if (dayNumbers.length === 0) return;

    const deliveryDates: string[] = [];
    for (let i = 0; i < 56; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        if (dayNumbers.includes(d.getDay())) {
            deliveryDates.push(formatDateToYYYYMMDD(d));
        }
    }

    const flatItems = await flattenMealSelectionsToItems(mealSelections);
    const catalogTotal = flatItems.reduce((sum, i) => sum + i.quantity, 0);

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const caseId = await getUpcomingOrderCaseIdForFoodClient(supabaseAdmin, clientId);
    const todayStr = formatDateToYYYYMMDD(today);
    const { data: existing } = await supabaseAdmin
        .from('meal_planner_orders')
        .select('id')
        .eq('client_id', clientId)
        .in('status', ['draft', 'scheduled'])
        .gte('scheduled_delivery_date', todayStr);

    if (existing && existing.length > 0) {
        const existingIds = existing.map((r: { id: string }) => r.id);
        for (let j = 0; j < existingIds.length; j += 100) {
            await supabaseAdmin.from('meal_planner_orders').delete().in('id', existingIds.slice(j, j + 100));
        }
    }

    const dayNameFromDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T12:00:00');
        const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return names[d.getDay()];
    };

    type ItemRow = { id: string; meal_planner_order_id: string; meal_type: string; menu_item_id: string | null; meal_item_id: string | null; quantity: number; notes: string | null; custom_name: string | null; custom_price: number | null; sort_order: number };

    for (const dateStr of deliveryDates) {
        const customItemsForDate = await getEffectiveMealPlanItemsForDate(supabaseAdmin, clientId, dateStr);
        const customTotal = customItemsForDate.reduce((sum, i) => sum + i.quantity, 0);
        const totalItems = catalogTotal + customTotal;
        if (totalItems === 0) continue;

        const orderId = randomUUID();
        const { error: orderErr } = await supabaseAdmin.from('meal_planner_orders').insert({
            id: orderId,
            client_id: clientId,
            case_id: caseId ?? null,
            status: 'scheduled',
            scheduled_delivery_date: dateStr,
            delivery_day: dayNameFromDate(dateStr),
            total_items: totalItems,
            total_value: null,
            notes: null,
            processed_order_id: null,
            processed_at: null,
            user_modified: false
        });
        if (orderErr) {
            logQueryError(orderErr, 'meal_planner_orders', 'insert');
            console.error('[syncMealPlannerToOrders] Insert meal_planner_order failed:', { clientId, dateStr, message: orderErr.message, code: orderErr.code });
            continue;
        }

        const itemRows: ItemRow[] = [];
        let sortOrder = 0;
        for (const { menuItemId, mealItemId, quantity } of flatItems) {
            itemRows.push({
                id: randomUUID(),
                meal_planner_order_id: orderId,
                meal_type: 'Lunch',
                menu_item_id: menuItemId ?? null,
                meal_item_id: mealItemId ?? null,
                quantity,
                notes: null,
                custom_name: null,
                custom_price: null,
                sort_order: sortOrder++
            });
        }
        for (const item of customItemsForDate) {
            itemRows.push({
                id: randomUUID(),
                meal_planner_order_id: orderId,
                meal_type: 'Lunch',
                menu_item_id: null,
                meal_item_id: null,
                quantity: item.quantity,
                notes: null,
                custom_name: item.name,
                custom_price: item.price ?? null,
                sort_order: sortOrder++
            });
        }

        if (itemRows.length === 0) continue;
        const BATCH_ITEMS = 100;
        for (let i = 0; i < itemRows.length; i += BATCH_ITEMS) {
            const chunk = itemRows.slice(i, i + BATCH_ITEMS);
            const { error: itemErr } = await supabaseAdmin.from('meal_planner_order_items').insert(chunk);
            if (itemErr) {
                logQueryError(itemErr, 'meal_planner_order_items', 'insert');
                console.error('[syncMealPlannerToOrders] Insert meal_planner_order_items failed:', { orderId, dateStr, message: itemErr.message, code: itemErr.code, details: itemErr.details });
            }
        }
    }
}

export async function saveClientMealOrder(clientId: string, data: Partial<ClientMealOrder>) {
    const session = await getSession();
    const updatedBy = session?.userId || null;
    
    // Use Service Role client to bypass RLS for custom auth or public portal
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get current client data to preserve existing upcoming_order structure
    const { data: clientData, error: fetchError } = await supabaseAdmin
        .from('clients')
        .select('upcoming_order')
        .eq('id', clientId)
        .maybeSingle();

    if (fetchError) {
        handleError(fetchError);
        return null;
    }

    // Parse existing upcoming_order or create new one
    let activeOrder: any = clientData?.upcoming_order 
        ? (typeof clientData.upcoming_order === 'string' 
            ? JSON.parse(clientData.upcoming_order) 
            : clientData.upcoming_order)
        : {};

    // Update with new Meal order data
    activeOrder.serviceType = 'Meal';
    if (data.caseId !== undefined) activeOrder.caseId = data.caseId;
    if (data.mealSelections !== undefined) activeOrder.mealSelections = data.mealSelections;

    // Prepare update payload
    const updatePayload: any = {
        upcoming_order: activeOrder,
        updated_at: new Date().toISOString()
    };
    if (updatedBy) updatePayload.updated_by = updatedBy;

    // Update client's upcoming_order field
    let { data: updated, error } = await supabaseAdmin
        .from('clients')
        .update(updatePayload)
        .eq('id', clientId)
        .select()
        .single();

    // Retry without updated_by if foreign key violation
    if (error && error.code === '23503') {
        delete updatePayload.updated_by;
        const retry = await supabaseAdmin
            .from('clients')
            .update(updatePayload)
            .eq('id', clientId)
            .select()
            .single();
        updated = retry.data;
        error = retry.error;
    }

    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);

    if (updated && activeOrder.mealSelections) {
        try {
            await syncMealPlannerToOrders(clientId, activeOrder.mealSelections);
        } catch (syncErr) {
            console.error('[saveClientMealOrder] syncMealPlannerToOrders failed:', syncErr);
        }
    }

    // Return in ClientMealOrder format
    return updated ? {
        id: updated.id,
        client_id: updated.id,
        case_id: activeOrder.caseId,
        meal_selections: activeOrder.mealSelections,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
        updated_by: updated.updated_by
    } : null;
}

export async function getClientBoxOrder(clientId: string): Promise<ClientBoxOrder[]> {
    const { data, error } = await supabase
        .from('client_box_orders')
        .select('*')
        .eq('client_id', clientId);

    if (error) {
        console.error('Error fetching box order:', error);
        return [];
    }
    if (!data) return [];

    console.log('[getClientBoxOrder] Fetched data count:', data.length);
    if (data.length > 0) {
        console.log('[getClientBoxOrder] Sample item notes:', JSON.stringify(data[0].item_notes, null, 2));
    }

    return data.map(d => ({
        id: d.id,
        clientId: d.client_id,
        caseId: d.case_id,
        boxTypeId: d.box_type_id,
        vendorId: d.vendor_id,
        quantity: d.quantity,
        items: d.items,
        itemNotes: d.item_notes, // Map item_notes from DB
        created_at: d.created_at,
        updated_at: d.updated_at
    }));
}

export async function saveClientBoxOrder(clientId: string, data: Partial<ClientBoxOrder>[]) {
    const session = await getSession();
    const updatedBy = session?.userId || null;
    // if (!session || !session.userId) throw new Error('Unauthorized');
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Full replacement strategy: Delete all existing box orders for this client first
    const { error: deleteError } = await supabaseAdmin
        .from('client_box_orders')
        .delete()
        .eq('client_id', clientId);

    if (deleteError) {
        handleError(deleteError);
        throw deleteError;
    }

    if (!data || data.length === 0) {
        revalidatePath(`/client-portal/${clientId}`);
        revalidatePath(`/clients/${clientId}`);
        return [];
    }

    console.log('[saveClientBoxOrder] Received data:', JSON.stringify(data, null, 2));

    // Fetch all valid box type IDs to validate against foreign key constraint
    const { data: validBoxTypes, error: boxTypesError } = await supabaseAdmin
        .from('box_types')
        .select('id');
    
    if (boxTypesError) {
        console.warn('[saveClientBoxOrder] Could not fetch box types for validation:', boxTypesError.message);
    }
    
    const validBoxTypeIds = new Set((validBoxTypes || []).map(bt => bt.id));

    const insertPayload = data.map(order => {
        // Validate boxTypeId: if empty, undefined, or not in valid box types, set to null
        let boxTypeId: string | null | undefined = order.boxTypeId;
        const boxTypeIdStr = boxTypeId ? String(boxTypeId).trim() : '';
        if (!boxTypeIdStr || !validBoxTypeIds.has(boxTypeIdStr)) {
            if (boxTypeIdStr) {
                console.warn(`[saveClientBoxOrder] Invalid boxTypeId "${boxTypeIdStr}" not found in box_types table. Setting to null.`);
            }
            boxTypeId = null;
        } else {
            boxTypeId = boxTypeIdStr;
        }

        const payload: any = {
            client_id: clientId,
            case_id: order.caseId || null,
            box_type_id: boxTypeId,
            vendor_id: order.vendorId || null,
            quantity: order.quantity || 1,
            items: order.items || {},
            item_notes: (order as any).itemNotes || {} // Save item notes to DB
        };
        return payload;
    });

    let { data: created, error } = await supabaseAdmin
        .from('client_box_orders')
        .insert(insertPayload)
        .select();
    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    return created;
}

export async function saveClientCustomOrder(clientId: string, vendorId: string, itemDescription: string, price: number, deliveryDay: string, caseId?: string) {
    const session = await getSession();
    const currentUserName = session?.name || 'Admin';

    // 1. Check or Create Upcoming Order
    let { data: upcomingOrder, error: upcomingError } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', clientId)
        .neq('status', 'processed')
        .maybeSingle();

    if (upcomingError) throw new Error(upcomingError.message);

    if (upcomingOrder) {
        // Update existing
        const { error: updateError } = await supabase
            .from('upcoming_orders')
            .update({
                service_type: 'Custom', // Switch to Custom
                case_id: caseId || null,
                notes: `Custom Order: ${itemDescription}`,
                total_value: price,
                total_items: 1,
                updated_by: currentUserName,
                last_updated: (await getCurrentTime()).toISOString(),
                delivery_day: deliveryDay // Save the delivery day on the order itself for simple custom orders
            })
            .eq('id', upcomingOrder.id);
        if (updateError) throw new Error(updateError.message);
    } else {
        // Create new
        const { data: newUpcoming, error: createError } = await supabase
            .from('upcoming_orders')
            .insert({
                client_id: clientId,
                service_type: 'Custom',
                case_id: caseId || null,
                status: 'pending',
                notes: `Custom Order: ${itemDescription}`,
                total_value: price,
                total_items: 1,
                updated_by: currentUserName,
                last_updated: (await getCurrentTime()).toISOString(),
                delivery_day: deliveryDay
            })
            .select()
            .single();
        if (createError) throw new Error(createError.message);
        upcomingOrder = newUpcoming;
    }

    // 2. Clear existing items/selections for this upcoming order (since we're overwriting with a single custom order)
    // Delete items first to avoid FK issues
    await supabase.from('upcoming_order_items').delete().eq('upcoming_order_id', upcomingOrder.id);
    await supabase.from('upcoming_order_vendor_selections').delete().eq('upcoming_order_id', upcomingOrder.id);
    // Also clear box selections if any existed
    await supabase.from('upcoming_order_box_selections').delete().eq('upcoming_order_id', upcomingOrder.id);


    // 3. Create Vendor Selection
    const { data: vendorSelection, error: vsError } = await supabase
        .from('upcoming_order_vendor_selections')
        .insert({
            upcoming_order_id: upcomingOrder.id,
            vendor_id: vendorId
        })
        .select()
        .single();

    if (vsError || !vendorSelection) throw new Error(vsError?.message || 'Failed to create vendor selection');

    // 4. Create Item
    // We use the new columns: custom_name, custom_price. menu_item_id is null.
    const { error: itemError } = await supabase
        .from('upcoming_order_items')
        .insert({
            upcoming_order_id: upcomingOrder.id,
            vendor_selection_id: vendorSelection.id,
            menu_item_id: null,
            quantity: 1,
            custom_name: itemDescription,
            custom_price: price
        });

    if (itemError) throw new Error(itemError.message);

    // Update client service type to Custom
    await supabase.from('clients').update({ service_type: 'Custom' }).eq('id', clientId);

    revalidatePath(`/clients/${clientId}`);
    return { success: true };
}
