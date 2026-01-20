'use server';

import { getCurrentTime } from './time';
import { revalidatePath } from 'next/cache';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, Nutritionist, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota, ServiceType, Equipment, MealCategory, MealItem, ClientFoodOrder, ClientMealOrder, ClientBoxOrder } from './types';
import { randomUUID } from 'crypto';
import { getSession } from './session';
import {
    getNextDeliveryDate,
    getNextDeliveryDateForDay,
    getTakeEffectDate as getTakeEffectDateFromUtils,
    getAllDeliveryDatesForOrder as getAllDeliveryDatesFromUtils,
    getNextOccurrence
} from './order-dates';
import { supabase } from './supabase';
import { createClient } from '@supabase/supabase-js';
import { uploadFile, deleteFile } from './storage';
import { getClientSubmissions } from './form-actions';

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
            console.error(`⚠️  RLS may be blocking ${table} queries. Check RLS configuration.`);
        }
    }
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

export async function getVendors() {
    try {
        // Check if we're using service role key (important for RLS)
        const isUsingServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!isUsingServiceKey) {
            console.warn('[getVendors] ⚠️  Not using service role key - RLS may block queries');
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
                console.error('[getVendors] ❌ RLS is blocking the query. Ensure SUPABASE_SERVICE_ROLE_KEY is set in environment variables.');
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
            console.log(`[getVendors] ✅ Fetched ${data.length} vendors from database`);
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
        return mapped;
    } catch (error) {
        console.error('[getVendors] Unexpected error:', error);
        return [];
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
    }
    revalidatePath('/admin');
}

export async function deleteVendor(id: string) {
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    handleError(error);
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
        const today = await getCurrentTime();
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
        last_updated: (await getCurrentTime()).toISOString(),
        updated_by: currentUserName,
        scheduled_delivery_date: scheduledDeliveryDate ? scheduledDeliveryDate.toISOString().split('T')[0] : null,
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
    const activeOrder = c.active_order || {};
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
        activeOrder: activeOrder, // Metadata matches structure
        // New fields from dietfantasy
        firstName: c.first_name || null,
        lastName: c.last_name || null,
        apt: c.apt || null,
        city: c.city || null,
        state: c.state || null,
        zip: c.zip || null,
        county: c.county || null,
        clientIdExternal: c.client_id_external || null,
        caseIdExternal: c.case_id_external || null,
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

export async function getClients() {
    try {
        console.log('[getClients] Fetching all clients...');
        const { data, error } = await supabase.from('clients').select('*');
        if (error) {
            logQueryError(error, 'clients');
            return [];
        }
        console.log('[getClients] Raw data returned:', { count: data?.length, firstClient: data?.[0] ? { id: data[0].id, full_name: data[0].full_name } : null });
        // Map clients with error handling for individual clients
        const mapped = (data || []).map((c: any) => {
            try {
                return mapClientFromDB(c);
            } catch (error) {
                console.error(`[getClients] Error mapping client ${c?.id}:`, error);
                return null;
            }
        }).filter((c: any) => c !== null);
        console.log('[getClients] Mapped clients:', { count: mapped.length });
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

    // Save active_order if provided (ClientProfile component handles validation)
    if (data.activeOrder !== undefined && data.activeOrder !== null) {
        payload.active_order = data.activeOrder;
    } else {
        payload.active_order = {};
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
        active_order: payload.active_order || {},
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

    if (newClient.activeOrder && newClient.activeOrder.caseId) {
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
        approved_meals_per_week: 0,
        authorized_amount: null,
        expiration_date: null,
        active_order: {},
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
        active_order: payload.active_order || {},
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
    if (data.endDate !== undefined) payload.end_date = data.endDate;
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
    if (data.activeOrder) payload.active_order = data.activeOrder;
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
        await supabase
            .from('clients')
            .update(dbPayload)
            .eq('id', id);
    }

    // If activeOrder was updated, sync to upcoming_orders
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
            // Ensure activeOrder is set on the client object
            updatedClient.activeOrder = data.activeOrder;
            await syncCurrentOrderToUpcoming(id, updatedClient, true);
            console.log('[updateClient] Successfully synced order to upcoming_orders');
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
        await supabase
            .from('upcoming_orders')
            .delete()
            .in('client_id', dependentIds);

        // Delete active orders for all dependents
        await supabase
            .from('orders')
            .delete()
            .in('client_id', dependentIds)
            .in('status', ['pending', 'confirmed', 'processing']);

        // Delete form submissions for all dependents
        await supabase
            .from('form_submissions')
            .delete()
            .in('client_id', dependentIds);

        // Delete all dependents
        await supabase
            .from('clients')
            .delete()
            .in('id', dependentIds);
    }

    // Delete all upcoming orders for this client
    await supabase
        .from('upcoming_orders')
        .delete()
        .eq('client_id', id);

    // Delete active orders (pending, confirmed, processing) but preserve order history
    // Order history includes: completed, waiting_for_proof, billing_pending, cancelled
    await supabase
        .from('orders')
        .delete()
        .eq('client_id', id)
        .in('status', ['pending', 'confirmed', 'processing']);

    // Delete form submissions for this client
    await supabase
        .from('form_submissions')
        .delete()
        .eq('client_id', id);

    // Delete the client
    // Note: Client IDs are generated identifiers (e.g. CLIENT-XXX) which CAN be reused after deletion.
    // We must ensure the local cache is synced to remove any stale data associated with this ID.
    await supabase
        .from('clients')
        .delete()
        .eq('id', id);
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
        const activeOrder = typeof c.active_order === 'string' 
            ? JSON.parse(c.active_order) 
            : (c.active_order || {});
        
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
                clientName: d.client_name,
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
        // Get orders with billing_pending status
        const { data: pendingOrders, error: pendingError } = await supabase
            .from('orders')
            .select(`
                *,
                clients (
                    id,
                    full_name
                )
            `)
            .eq('status', 'billing_pending')
            .order('created_at', { ascending: false });

        if (pendingError) {
            console.error('[getBillingOrders] Error fetching pending orders:', pendingError);
        }

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
                .select(`
                    *,
                    clients (
                        id,
                        full_name
                    )
                `)
                .in('id', Array.from(successfulOrderIds))
                .order('created_at', { ascending: false });
            
            if (successfulError) {
                console.error('[getBillingOrders] Error fetching successful orders:', successfulError);
            }
            successfulOrders = successfulOrdersData || [];
        }

        // Combine and map orders
        // Note: Supabase join returns clients as an object (not array) for one-to-many relationships
        const allOrders = [
            ...((pendingOrders || []).map((o: any) => ({
                ...o,
                clientName: (o.clients?.full_name) || 'Unknown',
                amount: o.total_value || 0,
                billingStatus: 'billing_pending' as const
            }))),
            ...(successfulOrders.map((o: any) => ({
                ...o,
                clientName: (o.clients?.full_name) || 'Unknown',
                amount: o.total_value || 0,
                billingStatus: 'billing_successful' as const
            })))
        ];

        // Remove duplicates (in case an order is both pending and has a successful record - prioritize successful)
        const orderMap = new Map();
        for (const order of allOrders) {
            if (!orderMap.has(order.id) || order.billingStatus === 'billing_successful') {
                orderMap.set(order.id, order);
            }
        }

        return Array.from(orderMap.values()).sort((a, b) => {
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();
            return dateB - dateA;
        });
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
                clientName: d.client_name,
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
            // For client-selected delivery day, get the nearest occurrence of that day
            // First validate that vendor can deliver on that day
            const vendor = vendors.find(v => v.id === vendorIds[0]);
            if (vendor) {
                const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                if (!deliveryDays || !deliveryDays.includes(deliveryDay)) {
                    const vendorName = vendor?.name || vendorIds[0];
                    const errorMsg = `Cannot save Food order: Vendor "${vendorName}" does not deliver on ${deliveryDay}. Please select a different delivery day or vendor.`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                        serviceType: orderConfig.serviceType,
                        deliveryDay,
                        vendorId: vendorIds[0],
                        vendorName
                    });
                    throw new Error(errorMsg);
                }
            }
            
            // Get the nearest occurrence of the client-selected delivery day
            const currentTime = await getCurrentTime();
            scheduledDeliveryDate = getNextOccurrence(deliveryDay, currentTime);
            
            if (!scheduledDeliveryDate) {
                const errorMsg = `Cannot save Food order: Could not calculate delivery date for ${deliveryDay}.`;
                console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                    serviceType: orderConfig.serviceType,
                    deliveryDay
                });
                throw new Error(errorMsg);
            }
        } else {
            // Fallback: find the first delivery date
            const firstVendorId = vendorIds[0];
            const vendor = vendors.find(v => v.id === firstVendorId);
            if (vendor) {
                const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                if (deliveryDays && deliveryDays.length > 0) {
                    const dayNameToNumber: { [key: string]: number } = {
                        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                        'Thursday': 4, 'Friday': 5, 'Saturday': 6
                    };
                    const deliveryDayNumbers = deliveryDays
                        .map((day: string) => dayNameToNumber[day])
                        .filter((num: number | undefined): num is number => num !== undefined);

                    const today = await getCurrentTime();
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
            
            // If still no scheduled delivery date, try using getNextDeliveryDate
            if (!scheduledDeliveryDate) {
                const currentTime = await getCurrentTime();
                scheduledDeliveryDate = getNextDeliveryDate(vendorIds[0], vendors, currentTime);
                
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
                // For client-selected delivery day, get the nearest occurrence of that day
                // First validate that vendor can deliver on that day
                const vendor = vendors.find(v => v.id === boxVendorId);
                if (vendor) {
                    const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                    if (!deliveryDays || !deliveryDays.includes(deliveryDay)) {
                        const vendorName = vendor?.name || boxVendorId;
                        const errorMsg = `Cannot save Boxes order: Vendor "${vendorName}" does not deliver on ${deliveryDay}. Please select a different delivery day or vendor.`;
                        console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                            serviceType: orderConfig.serviceType,
                            deliveryDay,
                            vendorId: boxVendorId,
                            vendorName
                        });
                        throw new Error(errorMsg);
                    }
                }
                
                // Get the nearest occurrence of the client-selected delivery day
                const currentTime = await getCurrentTime();
                scheduledDeliveryDate = getNextOccurrence(deliveryDay, currentTime);
                
                if (!scheduledDeliveryDate) {
                    const errorMsg = `Cannot save Boxes order: Could not calculate delivery date for ${deliveryDay}.`;
                    console.error(`[syncSingleOrderForDeliveryDay] ${errorMsg}`, {
                        serviceType: orderConfig.serviceType,
                        deliveryDay
                    });
                    throw new Error(errorMsg);
                }
            } else {
                // Fallback: find the first delivery date
                const vendor = vendors.find(v => v.id === boxVendorId);
                if (vendor) {
                    const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
                    if (deliveryDays && deliveryDays.length > 0) {
                        const today = await getCurrentTime();
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
    }

    // For Boxes orders, dates are optional - they can be set later
    // Only require dates for Food orders
    // This check should rarely be hit now since we validate earlier, but keep as a safety net
    if (orderConfig.serviceType === 'Food' && (!takeEffectDate || !scheduledDeliveryDate)) {
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
    const currentTime = await getCurrentTime();
    
    // Validate and normalize service_type to match database constraint
    // Allowed values: 'Food', 'Meal', 'Boxes', 'Equipment', 'Custom'
    const validServiceTypes = ['Food', 'Meal', 'Boxes', 'Equipment', 'Custom'] as const;
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
    }
    
    const upcomingOrderData: any = {
        client_id: clientId,
        service_type: serviceType,
        case_id: orderConfig.caseId,
        status: 'scheduled',
        last_updated: orderConfig.lastUpdated || currentTime.toISOString(),
        updated_by: updatedBy,
        // For Boxes orders, dates are optional (can be null)
        scheduled_delivery_date: scheduledDeliveryDate ? scheduledDeliveryDate.toISOString().split('T')[0] : null,
        take_effect_date: takeEffectDate ? takeEffectDate.toISOString().split('T')[0] : null,
        total_value: totalValue,
        total_items: totalItems,
        notes: null,
        vendor_id: vendorId
    };

    // Add delivery_day if provided
    if (deliveryDay) {
        upcomingOrderData.delivery_day = deliveryDay;
    }

    // Check if upcoming order exists for this delivery day
    // IMPORTANT: Must filter by service_type to avoid conflicts between Food and Boxes orders
    let existing;
    if (deliveryDay) {
        const { data: existingData } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('client_id', clientId)
            .eq('service_type', serviceType)
            .eq('delivery_day', deliveryDay)
            .maybeSingle();
        existing = existingData;
    } else {
        // For backward compatibility, check for orders without delivery_day
        const { data: existingData } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('client_id', clientId)
            .eq('service_type', serviceType)
            .is('delivery_day', null)
            .maybeSingle();
        existing = existingData;
    }

    console.log('[syncSingleOrderForDeliveryDay] Checking existing', {
        deliveryDay,
        foundExisting: !!existing,
        existingId: existing?.id,
        willCreateNew: !existing
    });

    let upcomingOrderId: string;

    if (existing) {
        // Update existing
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
        // Insert new
        const upcomingOrderId_new = randomUUID();
        const insertPayload = { ...upcomingOrderData, id: upcomingOrderId_new };
        
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
        // Get current client's active_order
        const { data: clientData } = await supabase
            .from('clients')
            .select('active_order')
            .eq('id', clientId)
            .single();

        if (!clientData) {
            console.warn(`[updateClientActiveOrderFromUpcomingOrder] Client ${clientId} not found`);
            return;
        }

        const currentActiveOrder: any = clientData.active_order || { serviceType };

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
            // Get vendor ID from upcoming_order_box_selections
            const { data: boxSelections } = await supabase
                .from('upcoming_order_box_selections')
                .select('vendor_id')
                .eq('upcoming_order_id', upcomingOrderId)
                .limit(1);

            if (boxSelections && boxSelections.length > 0) {
                const vendorId = boxSelections[0].vendor_id;
                
                if (vendorId) {
                    // Update active_order with vendor ID, preserving other fields
                    currentActiveOrder.vendorId = vendorId;
                    currentActiveOrder.serviceType = 'Boxes';
                }
            }
        }

        // Always update the clients table to ensure vendor IDs are persisted
        const currentTime = await getCurrentTime();
        const { error: updateError } = await supabase
            .from('clients')
            .update({
                active_order: currentActiveOrder,
                updated_at: currentTime.toISOString()
            })
            .eq('id', clientId);

        if (updateError) {
            console.error(`[updateClientActiveOrderFromUpcomingOrder] Error updating client ${clientId} active_order:`, updateError);
        } else {
            console.log(`[updateClientActiveOrderFromUpcomingOrder] Successfully updated client ${clientId} active_order with vendor info from upcoming order ${upcomingOrderId} (deliveryDay: ${deliveryDay || 'none'})`);
        }
    } catch (error) {
        console.error(`[updateClientActiveOrderFromUpcomingOrder] Error updating client active_order:`, error);
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

    // 1. DRAFT PERSISTENCE: Save the raw activeOrder metadata to the clients table.
    // This ensures Case ID, Vendor, and other selections are persisted even if the 
    // full sync to upcoming_orders fails (e.g. if the vendor/delivery day isn't fully set yet).
    const orderConfig = client.activeOrder;
    
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
        hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0,
        itemsCount: (orderConfig as any)?.items ? Object.keys((orderConfig as any).items || {}).length : 0
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

    // 1. DRAFT PERSISTENCE: Save the raw activeOrder metadata to the clients table.
    // This ensures Case ID, Vendor, and other selections are persisted even if the 
    // full sync to upcoming_orders fails (e.g. if the vendor/delivery day isn't fully set yet).
    if (!skipClientUpdate && client.activeOrder) {
        const currentTime = await getCurrentTime();
        const { error: updateError } = await supabase
            .from('clients')
            .update({ 
                active_order: client.activeOrder,
                updated_at: currentTime.toISOString()
            })
            .eq('id', clientId);
        
        if (updateError) {
            // Check for RLS/permission errors
            const isRLSError = updateError?.code === 'PGRST301' || 
                              updateError?.message?.includes('permission denied') || 
                              updateError?.message?.includes('RLS') ||
                              updateError?.message?.includes('row-level security');
            
            console.error('[syncCurrentOrderToUpcoming] Error updating clients.active_order:', {
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
        
        revalidatePath('/clients');
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
    const hasDeliveryDayOrders = orderConfig &&
        orderConfig.serviceType !== 'Boxes' &&
        (orderConfig as any).deliveryDayOrders &&
        typeof (orderConfig as any).deliveryDayOrders === 'object';

    if (hasDeliveryDayOrders) {
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
        const { data: existingOrders } = await supabase
            .from('upcoming_orders')
            .select('id, delivery_day')
            .eq('client_id', clientId)
            .eq('service_type', orderConfig.serviceType);

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
            for (const selection of orderConfig.vendorSelections) {
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
                    .eq('service_type', 'Boxes');

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
    const today = await getCurrentTime();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Find all upcoming orders where take_effect_date <= today and status is 'scheduled'
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
                    currentTime,
                    currentTime
                );
                if (calculatedDate) {
                    scheduledDeliveryDate = calculatedDate.toISOString().split('T')[0];
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
                notes: upcomingOrder.notes,
                order_number: upcomingOrder.order_number // Preserve the assigned 6-digit number
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

        const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];
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
                const { data: boxItems, error: boxItemsError } = await supabase
                    .from(itemsTable)
                    .select('*')
                    .eq('order_id', orderData.id)
                    .is('vendor_selection_id', null); // Box items don't have vendor selections

                if (boxItemsError) {
                    console.error('Error fetching box items from items table:', boxItemsError);
                }

                // Build items map from order_items table
                let itemsFromTable: any = {};
                const itemPricesMap: any = {};
                if (boxItems && boxItems.length > 0) {
                    for (const item of boxItems) {
                        if (item.menu_item_id) {
                            itemsFromTable[item.menu_item_id] = item.quantity;
                            // Store price if available (from custom_price or calculated)
                            if (item.custom_price) {
                                itemPricesMap[item.menu_item_id] = parseFloat(item.custom_price.toString());
                            }
                        }
                    }
                }

                // Map to boxOrders format
                orderConfig.boxOrders = boxSelections.map((box: any) => {
                    // PRIORITY 1: Use items from order_items table if available
                    let items: any = {};
                    if (Object.keys(itemsFromTable).length > 0) {
                        items = itemsFromTable;
                        console.log('[getRecentOrdersForClient] Using items from order_items table:', Object.keys(items).length, 'items');
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

                    return {
                        boxTypeId: box.box_type_id,
                        vendorId: box.vendor_id,
                        quantity: box.quantity,
                        items: items,
                        itemNotes: box.item_notes || {}
                    };
                });
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
        // Use local database for fast access
        const { getUpcomingOrderForClientLocal } = await import('./local-db');
        return await getUpcomingOrderForClientLocal(clientId, caseId);
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
        console.log('[getClientsPaginated] Called with:', { page, pageSize, query: searchQuery, filter });
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

        // Default behavior - get all clients
        let clientsQuery = supabase
            .from('clients')
            .select('*', { count: 'exact' });

        if (searchQuery) {
            clientsQuery = clientsQuery.ilike('full_name', `%${searchQuery}%`);
        }

        console.log('[getClientsPaginated] Executing query with searchQuery:', searchQuery);
        const { data, count, error } = await clientsQuery
            .order('full_name')
            .range((page - 1) * pageSize, page * pageSize - 1);

        if (error) {
            console.error('Error fetching clients:', error);
            return { clients: [], total: 0 };
        }

        const total = count || 0;

        console.log('[getClientsPaginated] Raw data returned:', { count: data?.length, total, firstClient: data?.[0] ? { id: data[0].id, full_name: data[0].full_name, active_order_type: typeof data[0].active_order } : null });

        // Map clients with error handling for individual clients
        const mappedClients = (data || []).map((c: any) => {
            try {
                return mapClientFromDB(c);
            } catch (error) {
                console.error(`Error mapping client ${c?.id}:`, error, { clientData: c });
                return null;
            }
        }).filter((c: any) => c !== null);

        console.log('[getClientsPaginated] Mapped clients:', { count: mappedClients.length, total });

        return {
            clients: mappedClients,
            total: total
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
        const [
            client,
            history,
            orderHistory,
            billingHistory,
            activeOrder,
            upcomingOrder,
            submissionsResult
        ] = await Promise.all([
            getClient(clientId),
            getClientHistory(clientId),
            getOrderHistory(clientId),
            getBillingHistory(clientId),
            getActiveOrderForClient(clientId),
            getUpcomingOrderForClient(clientId),
            getClientSubmissions(clientId)
        ]);

        if (!client) return null;

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
            submissions: submissionsResult.success ? (submissionsResult.data || []) : []
        };
    } catch (error) {
        console.error('Error fetching full client details:', error);
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
        // 1. Fetch completed orders (from orders table)
        // Include Food, Boxes, and Equipment orders
        const { data: foodOrderIds } = await supabase
            .from('order_vendor_selections')
            .select('order_id')
            .eq('vendor_id', vendorId);

        const { data: boxOrderIds } = await supabase
            .from('order_box_selections')
            .select('order_id')
            .eq('vendor_id', vendorId);

        // Also get Equipment orders - they use order_vendor_selections too
        // But we need to filter by service_type='Equipment' in the orders table
        const orderIds = Array.from(new Set([
            ...(foodOrderIds?.map(o => o.order_id) || []),
            ...(boxOrderIds?.map(o => o.order_id) || [])
        ]));

        let orders: any[] = [];
        if (orderIds.length > 0) {
            const { data: ordersData } = await supabase
                .from('orders')
                .select('*')
                .in('id', orderIds)
                .order('created_at', { ascending: false });

            if (ordersData) {
                // Filter to only include orders for this vendor
                // For Equipment orders, check if vendor_id matches in notes
                const filteredOrders = ordersData.filter(order => {
                    if (order.service_type === 'Equipment') {
                        try {
                            const notes = order.notes ? JSON.parse(order.notes) : null;
                            return notes && notes.vendorId === vendorId;
                        } catch {
                            return false;
                        }
                    }
                    // For Food and Boxes, they're already filtered by vendor_selections/box_selections
                    return true;
                });

                orders = await Promise.all(filteredOrders.map(async (order) => {
                    const processed = await processVendorOrderDetails(order, vendorId, false);
                    return { ...processed, orderType: 'completed' };
                }));
            }
        }

        return orders;

    } catch (err) {
        console.error('Error in getOrdersByVendor:', err);
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

            // If items field is empty, try to fetch from client's active_order (same source as client profile uses)
            if (!bs.items || Object.keys(bs.items).length === 0) {
                // Get the client's active_order from clients table (this is where client profile gets box items from)
                const { data: clientData } = await supabase
                    .from('clients')
                    .select('active_order')
                    .eq('id', order.client_id)
                    .maybeSingle();

                if (clientData && clientData.active_order) {
                    const activeOrder = clientData.active_order;
                    // Check if this is a box order and has items
                    if (activeOrder.serviceType === 'Boxes' && activeOrder.items && Object.keys(activeOrder.items).length > 0) {
                        // Use items from client's active_order (same as client profile uses)
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
        const billingPayload = {
            client_id: order.client_id,
            client_name: client?.full_name || 'Unknown Client',
            order_id: order.id,
            status: 'pending',
            amount: order.total_value || 0,
            navigator: client?.navigator_id || 'Unknown',
            delivery_date: order.actual_delivery_date,
            remarks: 'Auto-generated upon proof upload'
        };

        const billingId = randomUUID();
        try {
            await supabase
                .from('billing_records')
                .insert([{
                    id: billingId,
                    client_id: billingPayload.client_id,
                    order_id: billingPayload.order_id,
                    status: billingPayload.status,
                    amount: billingPayload.amount,
                    navigator: billingPayload.navigator || null,
                    remarks: billingPayload.remarks
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
                    // Calculate scheduled_delivery_date from delivery_day if available
                    let scheduledDeliveryDate: string | null = null;
                    if (upcomingOrder.delivery_day) {
                        const currentTime = await getCurrentTime();
                        const calculatedDate = getNextDeliveryDateForDay(
                            upcomingOrder.delivery_day,
                            await getVendors(),
                            undefined,
                            currentTime,
                            currentTime
                        );
                        if (calculatedDate) {
                            scheduledDeliveryDate = calculatedDate.toISOString().split('T')[0];
                        }
                    }

                    // Create order in orders table
                    console.log(`[Process Pending Order] Creating new Order for Case ${upcomingOrder.case_id} with status 'billing_pending'`);
                    const currentTime = await getCurrentTime();
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
                        notes: upcomingOrder.notes,
                        actual_delivery_date: currentTime.toISOString()
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
                        const billingPayload = {
                            client_id: upcomingOrder.client_id,
                            client_name: client?.full_name || 'Unknown Client',
                            order_id: newOrder.id,
                            status: 'pending',
                            amount: upcomingOrder.total_value || 0,
                            navigator: client?.navigator_id || 'Unknown',
                            delivery_date: newOrder.actual_delivery_date,
                            remarks: 'Auto-generated when order processed for delivery'
                        };

                        const { error: billingError } = await supabase
                            .from('billing_records')
                            .insert([billingPayload]);

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

                                // Copy items
                                const { data: items } = await supabase
                                    .from('upcoming_order_items')
                                    .select('*')
                                    .eq('vendor_selection_id', vs.id);

                                if (items) {
                                    for (const item of items) {
                                        const { error: itemError } = await supabase
                                            .from('order_items')
                                            .insert({
                                                order_id: newOrder.id,
                                                vendor_selection_id: newVs.id,
                                                menu_item_id: item.menu_item_id,
                                                quantity: item.quantity,
                                                unit_value: item.unit_value,
                                                total_value: item.total_value
                                            });

                                        if (itemError) {
                                            errors.push(`Failed to copy item: ${itemError.message}`);
                                        }
                                    }
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

                        if (boxSelections) {
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
                                }
                            }
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
            const billingPayload = {
                client_id: order.client_id,
                client_name: client?.full_name || 'Unknown Client',
                order_id: order.id,
                status: 'pending',
                amount: order.total_value || 0,
                navigator: client?.navigator_id || 'Unknown',
                delivery_date: order.actual_delivery_date || new Date().toISOString(),
                remarks: 'Auto-generated upon proof upload'
            };

            const { error: billingError } = await supabase
                .from('billing_records')
                .insert([billingPayload]);

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
    // For the Orders tab, show orders from the orders table
    // Exclude billing_pending orders (those should only show on billing page)
    // Only show scheduled orders (orders with scheduled_delivery_date)
    let query = supabase
        .from('orders')
        .select(`
            *,
            clients (
                full_name
            )
        `, { count: 'exact' })
        .neq('status', 'billing_pending')
        .not('scheduled_delivery_date', 'is', null);

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

        const orderIdsNeedingVendor = [
            ...((orderBoxSelectionsResult.data || []).map((bs: any) => bs.order_id)),
            ...((upcomingBoxSelectionsResult.data || []).map((bs: any) => bs.upcoming_order_id))
        ];

        if (orderIdsNeedingVendor.length === 0) {
            return { orders: [], total: 0 };
        }

        // Filter to only upcoming orders that need vendor
        const orderIdsFromUpcoming = orderIdsNeedingVendor.filter(id => boxesUpcomingOrderIds.includes(id));
        if (orderIdsFromUpcoming.length > 0) {
            query = query.in('id', orderIdsFromUpcoming);
        } else {
            // If no upcoming orders need vendor, return empty
            return { orders: [], total: 0 };
        }
    }

    const { data, count, error } = await query
        .range((page - 1) * pageSize, page * pageSize - 1)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching paginated orders:', error);
        return { orders: [], total: 0 };
    }

    return {
        orders: (data || []).map((o: any) => ({
            ...o,
            clientName: o.clients?.full_name || 'Unknown',
            // Ensure status is 'scheduled' for upcoming_orders
            status: 'scheduled',
            // Map delivery_day to scheduled_delivery_date if needed
            scheduled_delivery_date: o.scheduled_delivery_date || null
        })),
        total: count || 0
    };
}

export async function getOrderById(orderId: string) {
    if (!orderId) return null;

    // Fetch the order
    const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

    if (orderError || !orderData) {
        console.error('Error fetching order:', orderError);
        return null;
    }

    // Fetch client information (including sign_token for signature reports)
    const { data: clientData } = await supabase
        .from('clients')
        .select('id, full_name, address, email, phone_number, sign_token')
        .eq('id', orderData.client_id)
        .single();

    // Fetch reference data
    const [menuItems, vendors, boxTypes, equipmentList, categories] = await Promise.all([
        getMenuItems(),
        getVendors(),
        getBoxTypes(),
        getEquipment(),
        getCategories()
    ]);

    let orderDetails: any = undefined;

    if (orderData.service_type === 'Food') {
        // Fetch vendor selections and items
        const { data: vendorSelections } = await supabase
            .from('order_vendor_selections')
            .select('*')
            .eq('order_id', orderId);

        if (vendorSelections && vendorSelections.length > 0) {
            const vendorSelectionsWithItems = await Promise.all(
                vendorSelections.map(async (vs: any) => {
                    const { data: items } = await supabase
                        .from('order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);

                    const vendor = vendors.find(v => v.id === vs.vendor_id);
                    const itemsWithDetails = (items || []).map((item: any) => {
                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                        const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value);
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
    } else if (orderData.service_type === 'Boxes') {
        // Fetch box selection
        const { data: boxSelection } = await supabase
            .from('order_box_selections')
            .select('*')
            .eq('order_id', orderId)
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
                if (menuItem && menuItem.categoryId) {
                    const category = categories.find(c => c.id === menuItem.categoryId);
                    if (category) {
                        if (!itemsByCategory[category.id]) {
                            itemsByCategory[category.id] = {
                                categoryName: category.name,
                                items: []
                            };
                        }
                        // Handle both object format {quantity: X} and direct number format
                        const quantity = typeof qty === 'object' && qty !== null ? (qty as any).quantity : qty;
                        itemsByCategory[category.id].items.push({
                            itemId: itemId,
                            itemName: menuItem.name,
                            quantity: Number(quantity) || 0,
                            quotaValue: menuItem.quotaValue || 1
                        });
                    }
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
            // Fallback: try to get vendor from order_vendor_selections
            const { data: vendorSelections } = await supabase
                .from('order_vendor_selections')
                .select('*')
                .eq('order_id', orderId)
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
        lastUpdated: orderData.updated_at,
        updatedBy: orderData.updated_by,
        orderDetails: orderDetails
    };
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
    // Use clients.active_order JSON field instead of separate table
    const { data, error } = await supabase
        .from('clients')
        .select('id, active_order, updated_at, updated_by')
        .eq('id', clientId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching client food order:', error);
        return null;
    }
    if (!data || !data.active_order) return null;

    const activeOrder = typeof data.active_order === 'string' 
        ? JSON.parse(data.active_order) 
        : data.active_order;

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

export async function saveClientFoodOrder(clientId: string, data: Partial<ClientFoodOrder>) {
    const session = await getSession();
    const updatedBy = session?.userId || null;

    // Use Service Role client to bypass RLS for custom auth or public portal
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get current client data to preserve existing active_order structure
    const { data: clientData, error: fetchError } = await supabaseAdmin
        .from('clients')
        .select('active_order')
        .eq('id', clientId)
        .maybeSingle();

    if (fetchError) {
        handleError(fetchError);
        return null;
    }

    // Parse existing active_order or create new one
    let activeOrder: any = clientData?.active_order 
        ? (typeof clientData.active_order === 'string' 
            ? JSON.parse(clientData.active_order) 
            : clientData.active_order)
        : {};

    // Update with new Food order data
    activeOrder.serviceType = 'Food';
    if (data.caseId !== undefined) activeOrder.caseId = data.caseId;
    if (data.deliveryDayOrders !== undefined) activeOrder.deliveryDayOrders = data.deliveryDayOrders;

    // Prepare update payload
    const updatePayload: any = {
        active_order: activeOrder,
        updated_at: new Date().toISOString()
    };
    if (updatedBy) updatePayload.updated_by = updatedBy;

    // Update client's active_order field
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
    // Use clients.active_order JSON field instead of separate table
    const { data, error } = await supabase
        .from('clients')
        .select('id, active_order, updated_at, updated_by')
        .eq('id', clientId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching client meal order:', error);
        return null;
    }
    if (!data || !data.active_order) return null;

    const activeOrder = typeof data.active_order === 'string' 
        ? JSON.parse(data.active_order) 
        : data.active_order;

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

export async function saveClientMealOrder(clientId: string, data: Partial<ClientMealOrder>) {
    const session = await getSession();
    const updatedBy = session?.userId || null;
    
    // Use Service Role client to bypass RLS for custom auth or public portal
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get current client data to preserve existing active_order structure
    const { data: clientData, error: fetchError } = await supabaseAdmin
        .from('clients')
        .select('active_order')
        .eq('id', clientId)
        .maybeSingle();

    if (fetchError) {
        handleError(fetchError);
        return null;
    }

    // Parse existing active_order or create new one
    let activeOrder: any = clientData?.active_order 
        ? (typeof clientData.active_order === 'string' 
            ? JSON.parse(clientData.active_order) 
            : clientData.active_order)
        : {};

    // Update with new Meal order data
    activeOrder.serviceType = 'Meal';
    if (data.caseId !== undefined) activeOrder.caseId = data.caseId;
    if (data.mealSelections !== undefined) activeOrder.mealSelections = data.mealSelections;

    // Prepare update payload
    const updatePayload: any = {
        active_order: activeOrder,
        updated_at: new Date().toISOString()
    };
    if (updatedBy) updatePayload.updated_by = updatedBy;

    // Update client's active_order field
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
            unit_value: 0, // Not really relevant for custom price, or could be price
            total_value: 0, // Standard fields might be ignored or used for reporting, but custom_price is the source of truth for value here?
            // Wait, logic usually sums total_value. Let's set total_value to 0 and rely on custom_price? 
            // Or better, set unit_value/total_value to 0 and rely on the order total_value we set above.
            // Actually, let's look at `saveCustomOrder` (one-off).
            // It sets custom_price and custom_name. 
            custom_name: itemDescription,
            custom_price: price
        });

    if (itemError) throw new Error(itemError.message);

    // Update client service type to Custom
    await supabase.from('clients').update({ service_type: 'Custom' }).eq('id', clientId);

    revalidatePath(`/clients/${clientId}`);
    return { success: true };
}