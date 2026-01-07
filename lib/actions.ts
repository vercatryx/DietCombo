'use server';

import { getCurrentTime } from './time';
import { revalidatePath } from 'next/cache';
import { query, queryOne, insert, execute, generateUUID } from './mysql';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, Nutritionist, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota, ServiceType, Equipment } from './types';
import { randomUUID } from 'crypto';
import { getSession } from './session';
import {
    getNextDeliveryDate,
    getNextDeliveryDateForDay,
    getTakeEffectDate as getTakeEffectDateFromUtils,
    getAllDeliveryDatesForOrder as getAllDeliveryDatesFromUtils
} from './order-dates';
import { supabase } from './supabase';

// --- HELPERS ---
function handleError(error: any) {
    if (error) {
        console.error('MySQL Error:', error);
        throw new Error(error.message);
    }
}

// --- STATUS ACTIONS ---

export async function getStatuses() {
    try {
        const data = await query<any>('SELECT * FROM client_statuses ORDER BY created_at ASC');
        return data.map((s: any) => ({
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
    const id = generateUUID();
    await insert(
        'INSERT INTO client_statuses (id, name, is_system_default, deliveries_allowed, requires_units_on_change) VALUES (?, ?, ?, ?, ?)',
        [id, name, false, true, false]
    );
    revalidatePath('/admin');
    const data = await queryOne<any>('SELECT * FROM client_statuses WHERE id = ?', [id]);
    if (!data) throw new Error('Failed to retrieve created status');
    return {
        id: data.id,
        name: data.name,
        isSystemDefault: data.is_system_default,
        deliveriesAllowed: data.deliveries_allowed,
        requiresUnitsOnChange: data.requires_units_on_change ?? false
    };
}

export async function deleteStatus(id: string) {
    await execute('DELETE FROM client_statuses WHERE id = ?', [id]);
    revalidatePath('/admin');
}

export async function updateStatus(id: string, data: Partial<ClientStatus>) { // Modified signature to take Partial<ClientStatus> instead of just name
    const updates: string[] = [];
    const params: any[] = [];
    
    if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.deliveriesAllowed !== undefined) {
        updates.push('deliveries_allowed = ?');
        params.push(data.deliveriesAllowed);
    }
    if (data.requiresUnitsOnChange !== undefined) {
        updates.push('requires_units_on_change = ?');
        params.push(data.requiresUnitsOnChange);
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE client_statuses SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    
    revalidatePath('/admin');
    const res = await queryOne<any>('SELECT * FROM client_statuses WHERE id = ?', [id]);
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
        const data = await query<any>('SELECT * FROM vendors');
        return data.map((v: any) => ({
            id: v.id,
            name: v.name,
            email: v.email || null,
            serviceTypes: (v.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ServiceType[],
            deliveryDays: typeof v.delivery_days === 'string' ? JSON.parse(v.delivery_days) : (v.delivery_days || []),
            allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
            isActive: v.is_active,
            minimumMeals: v.minimum_meals ?? 0,
            cutoffHours: v.cutoff_hours ?? 0
        }));
    } catch (error) {
        console.error('Error fetching vendors:', error);
        return [];
    }
}

export async function getVendor(id: string) {
    try {
        const v = await queryOne<any>('SELECT * FROM vendors WHERE id = ?', [id]);
        if (!v) return null;

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
    const id = generateUUID();
    let password = null;
    
    if (data.password && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        password = await hashPassword(data.password.trim());
    }
    
    const email = data.email !== undefined && data.email !== null 
        ? (data.email.trim() === '' ? null : data.email.trim())
        : null;
    
    await insert(
        'INSERT INTO vendors (id, name, email, password, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            id,
            data.name,
            email,
            password,
            (data.serviceTypes || []).join(','),
            JSON.stringify(data.deliveryDays || []),
            data.allowsMultipleDeliveries ? 'Multiple' : 'Once',
            data.isActive,
            data.minimumMeals ?? 0,
            data.cutoffHours ?? 0
        ]
    );
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateVendor(id: string, data: Partial<Vendor & { password?: string }>) {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.serviceTypes) {
        updates.push('service_type = ?');
        params.push(data.serviceTypes.join(','));
    }
    if (data.deliveryDays) {
        updates.push('delivery_days = ?');
        params.push(JSON.stringify(data.deliveryDays));
    }
    if (data.allowsMultipleDeliveries !== undefined) {
        updates.push('delivery_frequency = ?');
        params.push(data.allowsMultipleDeliveries ? 'Multiple' : 'Once');
    }
    if (data.isActive !== undefined) {
        updates.push('is_active = ?');
        params.push(data.isActive);
    }
    if (data.minimumMeals !== undefined) {
        updates.push('minimum_meals = ?');
        params.push(data.minimumMeals);
    }
    if (data.cutoffHours !== undefined) {
        updates.push('cutoff_hours = ?');
        params.push(data.cutoffHours);
    }
    if (data.email !== undefined) {
        updates.push('email = ?');
        const trimmedEmail = data.email?.trim() || '';
        params.push(trimmedEmail === '' ? null : trimmedEmail);
    }
    if (data.password !== undefined && data.password !== null && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        updates.push('password = ?');
        params.push(await hashPassword(data.password.trim()));
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE vendors SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    revalidatePath('/admin');
}

export async function deleteVendor(id: string) {
    await execute('DELETE FROM vendors WHERE id = ?', [id]);
    revalidatePath('/admin');
}

// --- MENU ACTIONS ---

export async function getMenuItems() {
    try {
        const data = await query<any>('SELECT * FROM menu_items');
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
    } catch (error) {
        console.error('Error fetching menu items:', error);
        return [];
    }
}

export async function addMenuItem(data: Omit<MenuItem, 'id'>) {
    if (!data.priceEach || data.priceEach <= 0) {
        throw new Error('Price is required and must be greater than 0');
    }
    
    const id = generateUUID();
    await insert(
        'INSERT INTO menu_items (id, vendor_id, name, value, price_each, is_active, category_id, quota_value, minimum_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            id,
            data.vendorId || null,
            data.name,
            data.value,
            data.priceEach,
            data.isActive,
            data.categoryId || null,
            data.quotaValue || null,
            data.minimumOrder ?? 0
        ]
    );
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateMenuItem(id: string, data: Partial<MenuItem>) {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.value !== undefined) {
        updates.push('value = ?');
        params.push(data.value);
    }
    if (data.priceEach !== undefined) {
        updates.push('price_each = ?');
        params.push(data.priceEach);
    }
    if (data.isActive !== undefined) {
        updates.push('is_active = ?');
        params.push(data.isActive);
    }
    if (data.categoryId !== undefined) {
        updates.push('category_id = ?');
        params.push(data.categoryId || null);
    }
    if (data.quotaValue !== undefined) {
        updates.push('quota_value = ?');
        params.push(data.quotaValue);
    }
    if (data.minimumOrder !== undefined) {
        updates.push('minimum_order = ?');
        params.push(data.minimumOrder);
    }
    if (data.vendorId !== undefined) {
        updates.push('vendor_id = ?');
        params.push(data.vendorId || null);
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    revalidatePath('/admin');
}

export async function deleteMenuItem(id: string) {
    try {
        await execute('DELETE FROM menu_items WHERE id = ?', [id]);
        revalidatePath('/admin');
        return { success: true };
    } catch (error: any) {
        // If the item is referenced by orders (FK violation), we can't hard delete it.
        // Instead, we mark it as inactive (soft delete) so it doesn't appear in new order selections
        // but preserves history for existing orders.
        if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === '23000') {
            await execute('UPDATE menu_items SET is_active = ? WHERE id = ?', [false, id]);
            revalidatePath('/admin');
            return { success: false, message: 'Item is in use by existing orders. It has been deactivated instead of permanently deleted.' };
        }
        throw error;
    }
}

// --- ITEM CATEGORY ACTIONS ---

export async function getCategories() {
    try {
        const data = await query<any>('SELECT * FROM item_categories ORDER BY name');
        return data.map((c: any) => ({
            id: c.id,
            name: c.name,
            setValue: c.set_value ?? undefined
        }));
    } catch (error) {
        console.error('Error fetching categories:', error);
        return [];
    }
}

export async function addCategory(name: string, setValue?: number | null) {
    const id = generateUUID();
    await insert(
        'INSERT INTO item_categories (id, name, set_value) VALUES (?, ?, ?)',
        [id, name, setValue ?? null]
    );
    revalidatePath('/admin');
    const data = await queryOne<any>('SELECT * FROM item_categories WHERE id = ?', [id]);
    if (!data) throw new Error('Failed to retrieve created category');
    return { id: data.id, name: data.name, setValue: data.set_value ?? undefined };
}

export async function deleteCategory(id: string) {
    await execute('DELETE FROM item_categories WHERE id = ?', [id]);
    revalidatePath('/admin');
}

export async function updateCategory(id: string, name: string, setValue?: number | null) {
    await execute(
        'UPDATE item_categories SET name = ?, set_value = ? WHERE id = ?',
        [name, setValue ?? null, id]
    );
    revalidatePath('/admin');
}

// --- EQUIPMENT ACTIONS ---

export async function getEquipment() {
    try {
        const data = await query<any>('SELECT * FROM equipment ORDER BY name');
        return data.map((e: any) => ({
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
    const id = generateUUID();
    await insert(
        'INSERT INTO equipment (id, name, price, vendor_id) VALUES (?, ?, ?, ?)',
        [id, data.name, data.price, data.vendorId || null]
    );
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateEquipment(id: string, data: Partial<Equipment>) {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.price !== undefined) {
        updates.push('price = ?');
        params.push(data.price);
    }
    if (data.vendorId !== undefined) {
        updates.push('vendor_id = ?');
        params.push(data.vendorId || null);
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE equipment SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    revalidatePath('/admin');
}

export async function deleteEquipment(id: string) {
    await execute('DELETE FROM equipment WHERE id = ?', [id]);
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

    const orderId = generateUUID();
    await insert(
        'INSERT INTO orders (id, client_id, service_type, case_id, status, last_updated, updated_by, scheduled_delivery_date, total_value, total_items, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [orderId, clientId, orderData.service_type, orderData.case_id, orderData.status, orderData.last_updated, orderData.updated_by, orderData.scheduled_delivery_date, orderData.total_value, orderData.total_items, orderData.notes]
    );

    const newOrder = await queryOne<any>('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!newOrder) {
        throw new Error('Failed to create order');
    }

    // Ensure order_number is at least 6 digits (100000+)
    // The database default should handle this, but we'll verify and fix if needed
    if (newOrder && (!newOrder.order_number || newOrder.order_number < 100000)) {
        // Get the max order_number and ensure next is at least 6 digits
        const maxOrder = await queryOne<any>(
            'SELECT order_number FROM orders ORDER BY order_number DESC LIMIT 1'
        );

        const nextNumber = Math.max((maxOrder?.order_number || 99999) + 1, 100000);
        await execute(
            'UPDATE orders SET order_number = ? WHERE id = ?',
            [nextNumber, newOrder.id]
        );

        newOrder.order_number = nextNumber;
    }

    // Also create a vendor selection record so it shows up in vendor tab
    // We'll use order_vendor_selections table for Equipment orders too
    if (newOrder) {
        const vsId = generateUUID();
        try {
            await insert(
                'INSERT INTO order_vendor_selections (id, order_id, vendor_id) VALUES (?, ?, ?)',
                [vsId, newOrder.id, vendorId]
            );
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
        const data = await query<any>('SELECT * FROM box_quotas WHERE box_type_id = ?', [boxTypeId]);
        return data.map((q: any) => ({
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
    const id = generateUUID();
    await insert(
        'INSERT INTO box_quotas (id, box_type_id, category_id, target_value) VALUES (?, ?, ?, ?)',
        [id, data.boxTypeId, data.categoryId, data.targetValue]
    );
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateBoxQuota(id: string, targetValue: number) {
    await execute('UPDATE box_quotas SET target_value = ? WHERE id = ?', [targetValue, id]);
    revalidatePath('/admin');
}

export async function deleteBoxQuota(id: string) {
    await execute('DELETE FROM box_quotas WHERE id = ?', [id]);
    revalidatePath('/admin');
}

// --- BOX TYPE ACTIONS ---

export async function getBoxTypes() {
    try {
        const data = await query<any>('SELECT * FROM box_types');
        return data.map((b: any) => ({
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
        price_each: data.priceEach ?? 1
    };

    if (data.priceEach !== undefined && data.priceEach <= 0) {
        throw new Error('Price must be greater than 0');
    }
    if (data.priceEach !== undefined) {
        payload.price_each = data.priceEach;
    }
    const id = generateUUID();
    await insert(
        'INSERT INTO box_types (id, name, is_active, price_each, vendor_id) VALUES (?, ?, ?, ?, ?)',
        [id, payload.name, payload.is_active, payload.price_each, data.vendorId || null]
    );
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateBoxType(id: string, data: Partial<BoxType>) {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.isActive !== undefined) {
        updates.push('is_active = ?');
        params.push(data.isActive);
    }
    if (data.priceEach !== undefined) {
        updates.push('price_each = ?');
        params.push(data.priceEach);
    }
    if (data.vendorId !== undefined) {
        updates.push('vendor_id = ?');
        params.push(data.vendorId);
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE box_types SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    revalidatePath('/admin');
}

export async function deleteBoxType(id: string) {
    await execute('DELETE FROM box_types WHERE id = ?', [id]);
    revalidatePath('/admin');
}

// --- SETTINGS ACTIONS ---

export async function getSettings() {
    try {
        const data = await queryOne<any>('SELECT * FROM app_settings WHERE id = ?', ['1']);
        if (!data) return { weeklyCutoffDay: 'Friday', weeklyCutoffTime: '17:00', reportEmail: '', enablePasswordlessLogin: false };

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
        await execute(
            'UPDATE app_settings SET weekly_cutoff_day = ?, weekly_cutoff_time = ?, report_email = ?, enable_passwordless_login = ? WHERE id = ?',
            [settings.weeklyCutoffDay, settings.weeklyCutoffTime, settings.reportEmail || null, settings.enablePasswordlessLogin || false, '1']
        );
    } catch (error) {
        console.error('Error updating settings:', error);
    }
    revalidatePath('/admin');
}

// --- NAVIGATOR ACTIONS ---

export async function getNavigators() {
    try {
        const data = await query<any>('SELECT * FROM navigators');
        return data.map((n: any) => ({
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

    const id = generateUUID();
    await insert(
        'INSERT INTO navigators (id, name, email, password, is_active) VALUES (?, ?, ?, ?, ?)',
        [id, payload.name, payload.email || null, payload.password || null, payload.is_active]
    );
    revalidatePath('/admin');
    return { ...data, id };
}

export async function updateNavigator(id: string, data: Partial<Navigator>) {
    const updates: string[] = [];
    const params: any[] = [];
    
    if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.isActive !== undefined) {
        updates.push('is_active = ?');
        params.push(data.isActive);
    }
    if (data.email !== undefined) {
        const trimmedEmail = data.email?.trim() || '';
        updates.push('email = ?');
        params.push(trimmedEmail === '' ? null : trimmedEmail);
    }
    if (data.password !== undefined && data.password !== null && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        updates.push('password = ?');
        params.push(await hashPassword(data.password.trim()));
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE navigators SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    revalidatePath('/admin');
}

export async function deleteNavigator(id: string) {
    await execute('DELETE FROM navigators WHERE id = ?', [id]);
    revalidatePath('/admin');
}

// --- NUTRITIONIST ACTIONS ---

export async function getNutritionists() {
    try {
        const data = await query<any>('SELECT * FROM nutritionists ORDER BY created_at ASC');
        return data.map((n: any) => ({
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

    const id = generateUUID();
    await insert(
        'INSERT INTO nutritionists (id, name, email) VALUES (?, ?, ?)',
        [id, payload.name, payload.email || null]
    );
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

    const updates: string[] = [];
    const params: any[] = [];
    
    if (data.name) {
        updates.push('name = ?');
        params.push(data.name);
    }
    if (data.email !== undefined) {
        const trimmedEmail = data.email?.trim() || '';
        updates.push('email = ?');
        params.push(trimmedEmail === '' ? null : trimmedEmail);
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE nutritionists SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    
    const updated = await queryOne<any>('SELECT * FROM nutritionists WHERE id = ?', [id]);
    revalidatePath('/admin');
    return {
        id: updated.id,
        name: updated.name,
        email: updated.email || null
    };
}

export async function deleteNutritionist(id: string) {
    await execute('DELETE FROM nutritionists WHERE id = ?', [id]);
    revalidatePath('/admin');
}

// --- CLIENT ACTIONS ---

function mapClientFromDB(c: any): ClientProfile {
    // Parse JSON fields if they come as strings (MySQL JSON type can return as string in some cases)
    // MySQL2 returns JSON as objects, but sometimes as strings or Buffers
    let activeOrder = c.active_order;
    if (activeOrder !== null && activeOrder !== undefined) {
        // Handle Buffer (mysql2 sometimes returns JSON as Buffer)
        if (Buffer.isBuffer(activeOrder)) {
            try {
                activeOrder = JSON.parse(activeOrder.toString());
            } catch (e) {
                console.warn('Failed to parse active_order from Buffer:', e);
                activeOrder = {};
            }
        } else if (typeof activeOrder === 'string') {
            try {
                activeOrder = JSON.parse(activeOrder);
            } catch (e) {
                console.warn('Failed to parse active_order JSON:', e);
                activeOrder = {};
            }
        }
        // If it's already an object, use it as-is
    } else {
        activeOrder = {};
    }

    let billings = c.billings;
    if (billings !== null && billings !== undefined) {
        if (Buffer.isBuffer(billings)) {
            try {
                billings = JSON.parse(billings.toString());
            } catch (e) {
                console.warn('Failed to parse billings from Buffer:', e);
                billings = null;
            }
        } else if (typeof billings === 'string') {
            try {
                billings = JSON.parse(billings);
            } catch (e) {
                console.warn('Failed to parse billings JSON:', e);
                billings = null;
            }
        }
    }

    let visits = c.visits;
    if (visits !== null && visits !== undefined) {
        if (Buffer.isBuffer(visits)) {
            try {
                visits = JSON.parse(visits.toString());
            } catch (e) {
                console.warn('Failed to parse visits from Buffer:', e);
                visits = null;
            }
        } else if (typeof visits === 'string') {
            try {
                visits = JSON.parse(visits);
            } catch (e) {
                console.warn('Failed to parse visits JSON:', e);
                visits = null;
            }
        }
    }

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
        createdAt: c.created_at,
        updatedAt: c.updated_at
    };
}

export async function getClients() {
    try {
        console.log('[getClients] Fetching all clients...');
        const data = await query<any>('SELECT * FROM clients');
        console.log('[getClients] Raw data returned:', { count: data?.length, firstClient: data?.[0] ? { id: data[0].id, full_name: data[0].full_name } : null });
        // Map clients with error handling for individual clients
        const mapped = data.map((c: any) => {
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
        const data = await queryOne<any>('SELECT * FROM clients WHERE id = ?', [id]);
        if (!data) return undefined;
        return mapClientFromDB(data);
    } catch (error) {
        console.error('Error fetching client:', error);
        return undefined;
    }
}

export async function getPublicClient(id: string) {
    if (!id) return undefined;

    try {
        const data = await queryOne<any>('SELECT * FROM clients WHERE id = ?', [id]);
        if (!data) return undefined;
        return mapClientFromDB(data);
    } catch (error) {
        console.error('Error fetching public client:', error);
        return undefined;
    }
}

export async function addClient(data: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'>) {
    const payload: any = {
        full_name: data.fullName,
        email: data.email,
        address: data.address,
        phone_number: data.phoneNumber,
        secondary_phone_number: data.secondaryPhoneNumber || null,
        navigator_id: data.navigatorId || null,
        end_date: data.endDate,
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

    const id = generateUUID();
    const activeOrderJson = JSON.stringify(payload.active_order || {});
    const billingsJson = payload.billings;
    const visitsJson = payload.visits;
    
    await insert(
        `INSERT INTO clients (id, full_name, email, address, phone_number, secondary_phone_number, navigator_id, end_date, screening_took_place, screening_signed, notes, status_id, service_type, approved_meals_per_week, authorized_amount, expiration_date, active_order, first_name, last_name, apt, city, state, zip, county, client_id_external, case_id_external, medicaid, paused, complex, bill, delivery, dislikes, latitude, longitude, lat, lng, geocoded_at, billings, visits, sign_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, payload.full_name, payload.email, payload.address, payload.phone_number, payload.secondary_phone_number, payload.navigator_id, payload.end_date, payload.screening_took_place, payload.screening_signed, payload.notes, payload.status_id, payload.service_type, payload.approved_meals_per_week, payload.authorized_amount, payload.expiration_date, activeOrderJson, payload.first_name, payload.last_name, payload.apt, payload.city, payload.state, payload.zip, payload.county, payload.client_id_external, payload.case_id_external, payload.medicaid, payload.paused, payload.complex, payload.bill, payload.delivery, payload.dislikes, payload.latitude, payload.longitude, payload.lat, payload.lng, payload.geocoded_at, billingsJson, visitsJson, payload.sign_token]
    );

    const res = await queryOne<any>('SELECT * FROM clients WHERE id = ?', [id]);
    if (!res) {
        throw new Error('Failed to create client: no data returned');
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

    const payload = {
        full_name: name.trim(),
        email: null,
        address: '',
        phone_number: '',
        navigator_id: null,
        end_date: '',
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

    const id = generateUUID();
    const activeOrderJson = JSON.stringify(payload.active_order || {});
    
    await insert(
        `INSERT INTO clients (id, full_name, email, address, phone_number, secondary_phone_number, navigator_id, end_date, screening_took_place, screening_signed, notes, status_id, service_type, approved_meals_per_week, authorized_amount, expiration_date, active_order, parent_client_id, dob, cin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, payload.full_name, payload.email, payload.address, payload.phone_number, payload.secondary_phone_number, payload.navigator_id, payload.end_date, payload.screening_took_place, payload.screening_signed, payload.notes, payload.status_id, payload.service_type, payload.approved_meals_per_week, payload.authorized_amount, payload.expiration_date, activeOrderJson, payload.parent_client_id, payload.dob, payload.cin]
    );

    const res = await queryOne<any>('SELECT * FROM clients WHERE id = ?', [id]);
    if (!res) {
        throw new Error('Failed to create dependent: no data returned');
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
        const data = await query<any>(
            'SELECT * FROM clients WHERE parent_client_id IS NULL ORDER BY full_name'
        );

        return data.map(mapClientFromDB);
    } catch (error: any) {
        // If error (e.g., column doesn't exist), fall back to getting all clients
        // This handles the case where the migration hasn't been run yet
        try {
            const allData = await query<any>('SELECT * FROM clients ORDER BY full_name');
            return allData.map(mapClientFromDB);
        } catch (allError) {
            console.error('Error fetching clients:', allError);
            return [];
        }
    }
}

export async function getDependentsByParentId(parentClientId: string) {
    try {
        const data = await query<any>(
            'SELECT * FROM clients WHERE parent_client_id = ? ORDER BY full_name',
            [parentClientId]
        );
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

    const updates: string[] = [];
    const params: any[] = [];
    
    for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined) {
            if (key === 'active_order' || key === 'billings' || key === 'visits') {
                updates.push(`${key} = ?`);
                params.push(typeof value === 'string' ? value : JSON.stringify(value));
            } else {
                updates.push(`${key} = ?`);
                params.push(value);
            }
        }
    }
    
    if (updates.length > 0) {
        params.push(id);
        await execute(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // If activeOrder was updated, sync to upcoming_orders
    if (data.activeOrder) {
        const updatedClient = await getClient(id);
        if (updatedClient) {
            await syncCurrentOrderToUpcoming(id, updatedClient, true);
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
    const dependents = await query<any>(
        'SELECT id FROM clients WHERE parent_client_id = ?',
        [id]
    );

    // Delete all dependents first (cascade delete)
    // Dependents cannot have their own dependents (enforced in addDependent),
    // so we can safely delete them directly
    if (dependents && dependents.length > 0) {
        const dependentIds = dependents.map(d => d.id);
        const placeholders = dependentIds.map(() => '?').join(',');

        // Delete upcoming orders for all dependents
        await execute(
            `DELETE FROM upcoming_orders WHERE client_id IN (${placeholders})`,
            dependentIds
        );

        // Delete active orders for all dependents
        await execute(
            `DELETE FROM orders WHERE client_id IN (${placeholders}) AND status IN (?, ?, ?)`,
            [...dependentIds, 'pending', 'confirmed', 'processing']
        );

        // Delete form submissions for all dependents
        await execute(
            `DELETE FROM form_submissions WHERE client_id IN (${placeholders})`,
            dependentIds
        );

        // Delete all dependents
        await execute(
            `DELETE FROM clients WHERE id IN (${placeholders})`,
            dependentIds
        );
    }

    // Delete all upcoming orders for this client
    await execute('DELETE FROM upcoming_orders WHERE client_id = ?', [id]);

    // Delete active orders (pending, confirmed, processing) but preserve order history
    // Order history includes: completed, waiting_for_proof, billing_pending, cancelled
    await execute(
        'DELETE FROM orders WHERE client_id = ? AND status IN (?, ?, ?)',
        [id, 'pending', 'confirmed', 'processing']
    );

    // Delete form submissions for this client
    await execute('DELETE FROM form_submissions WHERE client_id = ?', [id]);

    // Delete the client
    // Note: Client IDs are generated identifiers (e.g. CLIENT-XXX) which CAN be reused after deletion.
    // We must ensure the local cache is synced to remove any stale data associated with this ID.
    await execute('DELETE FROM clients WHERE id = ?', [id]);
    revalidatePath('/clients');

    // Trigger local DB sync in background to remove deleted client data from cache
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();
}

// --- DELIVERY ACTIONS ---

export async function generateDeliveriesForDate(dateStr: string) {
    // Fetch required data
    const clients = await query<any>('SELECT * FROM clients');
    const vendors = await query<any>('SELECT * FROM vendors');
    const boxTypes = await query<any>('SELECT * FROM box_types');
    const existingHistory = await query<any>(
        'SELECT * FROM delivery_history WHERE delivery_date = ?',
        [dateStr]
    );

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

            const historyId = generateUUID();
            try {
                await insert(
                    'INSERT INTO delivery_history (id, client_id, vendor_id, service_type, delivery_date, items_summary, proof_of_delivery_image) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [historyId, c.id, vendor.id, c.service_type, dateStr, summary, '']
                );
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
        const data = await query<any>(
            'SELECT * FROM delivery_history WHERE client_id = ? ORDER BY delivery_date DESC',
            [clientId]
        );

        return data.map((d: any) => ({
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
        await execute(
            'UPDATE delivery_history SET proof_of_delivery_image = ? WHERE id = ?',
            [proofUrl, id]
        );
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
        const historyId = generateUUID();
        await insert(
            'INSERT INTO order_history (id, client_id, who, summary, timestamp) VALUES (?, ?, ?, ?, ?)',
            [historyId, clientId, userName, summary, new Date().toISOString()]
        );
    } catch (error) {
        console.error('Error recording audit log:', error);
    }
}

export async function getOrderHistory(clientId: string) {
    if (!clientId) return [];

    try {
        // Try with timestamp column first, fallback to created_at if needed
        let data = await query<any>(
            'SELECT * FROM order_history WHERE client_id = ? ORDER BY timestamp DESC',
            [clientId]
        );

        // If no results or error, try with created_at
        if (!data || data.length === 0) {
            data = await query<any>(
                'SELECT * FROM order_history WHERE client_id = ? ORDER BY created_at DESC',
                [clientId]
            );
        }

        if (!data || data.length === 0) return [];

        return data.map((d: any) => ({
            id: d.id,
            clientId: d.client_id || d.clientId,
            who: d.who,
            summary: d.summary,
            timestamp: d.timestamp || d.created_at || new Date().toISOString()
        }));
    } catch (error) {
        console.error('Error fetching order history:', error);
        return [];
    }
}

export async function getCompletedOrdersWithDeliveryProof(clientId: string) {
    if (!clientId) return [];

    try {
        const data = await query<any>(
            'SELECT * FROM orders WHERE client_id = ? AND proof_of_delivery_url IS NOT NULL ORDER BY created_at DESC',
            [clientId]
        );

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
                    const vendorSelections = await query<any>(
                        'SELECT * FROM order_vendor_selections WHERE order_id = ?',
                        [orderData.id]
                    );

                    console.log(`[getCompletedOrdersWithDeliveryProof] Found ${vendorSelections?.length || 0} vendor selections for order ${orderData.id}`);

                    if (vendorSelections && vendorSelections.length > 0) {
                        const vendorSelectionsWithItems = await Promise.all(
                            vendorSelections.map(async (vs: any) => {
                                console.log(`[getCompletedOrdersWithDeliveryProof] Processing vendor selection ${vs.id} for vendor ${vs.vendor_id}`);
                                const items = await query<any>(
                                    'SELECT * FROM order_items WHERE vendor_selection_id = ?',
                                    [vs.id]
                                );

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
                const boxSelectionData = await queryOne<any>(
                    'SELECT * FROM order_box_selections WHERE order_id = ?',
                    [orderData.id]
                );
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
        const billingRecords = await query<any>(
            'SELECT * FROM billing_records WHERE client_id = ? ORDER BY created_at DESC',
            [clientId]
        );

        // Fetch reference data once for all orders
        const [menuItems, vendors, boxTypes] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes()
        ]);

        // Fetch order details separately if order_id exists
        const recordsWithOrderData = await Promise.all(
            billingRecords.map(async (d: any) => {
                let deliveryDate: string | undefined = undefined;
                let orderDetails: any = undefined;

                if (d.order_id) {
                    const orderData = await queryOne<any>(
                        'SELECT * FROM orders WHERE id = ?',
                        [d.order_id]
                    );

                    if (orderData) {
                        // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                        deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;

                        // Build order details based on service type
                        if (orderData.service_type === 'Food') {
                            console.log(`[getBillingHistory] Processing Food order ${orderData.id}`);
                            // Fetch vendor selections and items
                            const vendorSelections = await query<any>(
                                'SELECT * FROM order_vendor_selections WHERE order_id = ?',
                                [d.order_id]
                            );

                            console.log(`[getBillingHistory] Found ${vendorSelections?.length || 0} vendor selections for order ${orderData.id}`);

                            if (vendorSelections && vendorSelections.length > 0) {
                                const vendorSelectionsWithItems = await Promise.all(
                                    vendorSelections.map(async (vs: any) => {
                                        console.log(`[getBillingHistory] Processing vendor selection ${vs.id} for vendor ${vs.vendor_id}`);
                                        const items = await query<any>(
                                            'SELECT * FROM order_items WHERE vendor_selection_id = ?',
                                            [vs.id]
                                        );

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
                        const boxSelectionData = await queryOne<any>(
                            'SELECT * FROM order_box_selections WHERE order_id = ?',
                            [d.order_id]
                        );
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

    return recordsWithOrderData;
    } catch (error) {
        console.error('Error fetching billing history:', error);
        return [];
    }
}

export async function getBillingOrders() {
    try {
        // Get orders with billing_pending status
        const pendingOrders = await query<any>(
            `SELECT o.*, c.full_name as client_full_name 
             FROM orders o 
             LEFT JOIN clients c ON o.client_id = c.id 
             WHERE o.status = ? 
             ORDER BY o.created_at DESC`,
            ['billing_pending']
        );

        // Get billing records with status "success" and their associated orders
        const billingRecords = await query<any>(
            'SELECT order_id, status FROM billing_records WHERE status = ?',
            ['success']
        );

        const successfulOrderIds = new Set((billingRecords || []).map((br: any) => br.order_id).filter(Boolean));

        // Get orders that have successful billing records
        let successfulOrders: any[] = [];
        if (successfulOrderIds.size > 0) {
            const placeholders = Array.from(successfulOrderIds).map(() => '?').join(',');
            successfulOrders = await query<any>(
                `SELECT o.*, c.full_name as client_full_name 
                 FROM orders o 
                 LEFT JOIN clients c ON o.client_id = c.id 
                 WHERE o.id IN (${placeholders}) 
                 ORDER BY o.created_at DESC`,
                Array.from(successfulOrderIds)
            );
        }

        // Combine and map orders
        const allOrders = [
            ...((pendingOrders || []).map((o: any) => ({
                ...o,
                clientName: o.client_full_name || 'Unknown',
                amount: o.total_value || 0,
                billingStatus: 'billing_pending' as const
            }))),
            ...(successfulOrders.map((o: any) => ({
                ...o,
                clientName: o.client_full_name || 'Unknown',
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
        const billingPendingOrders = await query<any>(
            'SELECT * FROM orders WHERE status = ?',
            ['billing_pending']
        );

        if (billingPendingOrders) {
            // For each billing_pending order, check if billing record exists
            for (const order of billingPendingOrders) {
                const existingBilling = await queryOne<any>(
                    'SELECT id FROM billing_records WHERE order_id = ?',
                    [order.id]
                );

                if (!existingBilling) {
                    // Fetch client to get navigator and name
                    const client = await queryOne<any>(
                        'SELECT navigator_id, full_name FROM clients WHERE id = ?',
                        [order.client_id]
                    );

                    if (client) {
                        // Create billing record for this order
                        const billingId = generateUUID();
                        await insert(
                            'INSERT INTO billing_records (id, client_id, order_id, status, amount, navigator, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)',
                            [
                                billingId,
                                order.client_id,
                                order.id,
                                'pending',
                                order.total_value || 0,
                                client.navigator_id || 'Unknown',
                                'Auto-generated for billing_pending order'
                            ]
                        );
                    }
                }
            }
        }

        // Now fetch all billing records
        const billingRecords = await query<any>(
            'SELECT * FROM billing_records ORDER BY created_at DESC'
        );

        // Fetch reference data once for all orders
        const [menuItems, vendors, boxTypes] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes()
        ]);

        // Fetch order details separately if order_id exists
        const recordsWithOrderData = await Promise.all(
            billingRecords.map(async (d: any) => {
                let deliveryDate: string | undefined = undefined;
                let calculatedAmount = d.amount; // Default to stored amount

                if (d.order_id) {
                    const orderData = await queryOne<any>(
                        'SELECT * FROM orders WHERE id = ?',
                        [d.order_id]
                    );

                    if (orderData) {
                        // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                        deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;

                        // Calculate amount from order items
                        if (orderData.service_type === 'Food') {
                            // Fetch vendor selections and items
                            const vendorSelections = await query<any>(
                                'SELECT * FROM order_vendor_selections WHERE order_id = ?',
                                [d.order_id]
                            );

                            if (vendorSelections && vendorSelections.length > 0) {
                                const vendorAmounts = await Promise.all(
                                    vendorSelections.map(async (vs: any) => {
                                        const items = await query<any>(
                                            'SELECT * FROM order_items WHERE vendor_selection_id = ?',
                                            [vs.id]
                                        );

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
                            const boxSelection = await queryOne<any>(
                                'SELECT * FROM order_box_selections WHERE order_id = ?',
                                [d.order_id]
                            );

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
        boxQuantity: orderConfig.boxQuantity
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

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) {
        const vendorIds = orderConfig.vendorSelections
            .map((s: any) => s.vendorId)
            .filter((id: string) => id);

        if (vendorIds.length > 0) {
            if (deliveryDay) {
                // Calculate scheduled delivery date for the specific day
                const currentTime = await getCurrentTime();
                scheduledDeliveryDate = getNextDeliveryDateForDay(deliveryDay, vendors, vendorIds[0], currentTime, currentTime);
            } else {
                // Fallback: find the first delivery date
                const firstVendorId = vendorIds[0];
                const vendor = vendors.find(v => v.id === firstVendorId);
                if (vendor && vendor.deliveryDays) {
                    const dayNameToNumber: { [key: string]: number } = {
                        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                        'Thursday': 4, 'Friday': 5, 'Saturday': 6
                    };
                    const deliveryDayNumbers = vendor.deliveryDays
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

            // IMPORTANT: take_effect_date must always be a Sunday using weekly locking logic
            takeEffectDate = getTakeEffectDateFromUtils(settings);
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
                // Calculate scheduled delivery date for the specific day
                const currentTime = await getCurrentTime();
                scheduledDeliveryDate = getNextDeliveryDateForDay(deliveryDay, vendors, boxVendorId, currentTime, currentTime);
            } else {
                // Fallback: find the first delivery date
                const vendor = vendors.find(v => v.id === boxVendorId);
                if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 0) {
                    const today = await getCurrentTime();
                    today.setHours(0, 0, 0, 0);
                    const dayNameToNumber: { [key: string]: number } = {
                        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                        'Thursday': 4, 'Friday': 5, 'Saturday': 6
                    };
                    const deliveryDayNumbers = vendor.deliveryDays
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
    if (orderConfig.serviceType === 'Food' && (!takeEffectDate || !scheduledDeliveryDate)) {
        console.warn(`[syncSingleOrderForDeliveryDay] Skipping sync - missing dates for Food order`);
        return;
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
    const upcomingOrderData: any = {
        client_id: clientId,
        service_type: orderConfig.serviceType,
        case_id: orderConfig.caseId,
        status: 'scheduled',
        last_updated: orderConfig.lastUpdated || currentTime.toISOString(),
        updated_by: updatedBy,
        // For Boxes orders, dates are optional (can be null)
        // Note: scheduled_delivery_date column doesn't exist in upcoming_orders table
        take_effect_date: takeEffectDate ? takeEffectDate.toISOString().split('T')[0] : null,
        total_value: totalValue,
        total_items: totalItems,
        notes: null
    };

    // Add delivery_day if provided
    if (deliveryDay) {
        upcomingOrderData.delivery_day = deliveryDay;
    }

    // Check if upcoming order exists for this delivery day
    let existing;
    if (deliveryDay) {
        existing = await queryOne<any>(
            'SELECT id FROM upcoming_orders WHERE client_id = ? AND delivery_day = ?',
            [clientId, deliveryDay]
        );
    } else {
        // For backward compatibility, check for orders without delivery_day
        existing = await queryOne<any>(
            'SELECT id FROM upcoming_orders WHERE client_id = ? AND delivery_day IS NULL',
            [clientId]
        );
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
        const updates: string[] = [];
        const params: any[] = [];
        
        for (const [key, value] of Object.entries(upcomingOrderData)) {
            if (value !== undefined) {
                updates.push(`${key} = ?`);
                if (key === 'delivery_distribution' && typeof value !== 'string') {
                    params.push(JSON.stringify(value));
                } else {
                    params.push(value);
                }
            }
        }
        
        params.push(existing.id);
        
        try {
            await execute(
                `UPDATE upcoming_orders SET ${updates.join(', ')} WHERE id = ?`,
                params
            );
            upcomingOrderId = existing.id;
        } catch (error: any) {
            console.error('[syncSingleOrderForDeliveryDay] Error updating upcoming order:', error);
            throw new Error(`Failed to update upcoming order: ${error.message}`);
        }
    } else {
        // Insert new
        const upcomingOrderId_new = generateUUID();
        const columns = Object.keys(upcomingOrderData).filter(k => upcomingOrderData[k as keyof typeof upcomingOrderData] !== undefined);
        const values = columns.map(k => {
            const val = upcomingOrderData[k as keyof typeof upcomingOrderData];
            return (k === 'delivery_distribution' && typeof val !== 'string') ? JSON.stringify(val) : val;
        });
        
        try {
            await insert(
                `INSERT INTO upcoming_orders (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
                [upcomingOrderId_new, ...values]
            );
            upcomingOrderId = upcomingOrderId_new;
        } catch (error: any) {
            console.error('[syncSingleOrderForDeliveryDay] Error creating upcoming order:', error);
            throw new Error(`Failed to create upcoming order: ${error.message}`);
        }
    }

    // Now sync related data (vendor selections, items, box selections)
    // Delete existing related records
    await execute('DELETE FROM upcoming_order_vendor_selections WHERE upcoming_order_id = ?', [upcomingOrderId]);
    await execute('DELETE FROM upcoming_order_items WHERE upcoming_order_id = ?', [upcomingOrderId]);
    await execute('DELETE FROM upcoming_order_box_selections WHERE upcoming_order_id = ?', [upcomingOrderId]);

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections) {
        // Insert vendor selections and items
        let calculatedTotalFromItems = 0;
        const allVendorSelections: any[] = [];

        console.log(`[syncSingleOrderForDeliveryDay] Starting to insert items for upcoming_order_id: ${upcomingOrderId}`);

        for (const selection of orderConfig.vendorSelections) {
            if (!selection.vendorId || !selection.items) {
                console.log(`[syncSingleOrderForDeliveryDay] Skipping vendor selection - missing vendorId or items`);
                continue;
            }

            console.log(`[syncSingleOrderForDeliveryDay] Creating vendor selection for vendor ${selection.vendorId}`);
            const vsId = generateUUID();
            let vendorSelection;
            try {
                await insert(
                    'INSERT INTO upcoming_order_vendor_selections (id, upcoming_order_id, vendor_id) VALUES (?, ?, ?)',
                    [vsId, upcomingOrderId, selection.vendorId]
                );
                vendorSelection = { id: vsId, upcoming_order_id: upcomingOrderId, vendor_id: selection.vendorId };
                allVendorSelections.push(vendorSelection);
                console.log(`[syncSingleOrderForDeliveryDay] Created vendor selection ${vendorSelection.id}`);
            } catch (error) {
                console.error(`[syncSingleOrderForDeliveryDay] Error creating vendor selection:`, error);
                continue;
            }
            
            if (!vendorSelection) continue;

            // Insert items
            for (const [itemId, qty] of Object.entries(selection.items)) {
                const item = menuItems.find(i => i.id === itemId);
                const quantity = qty as number;
                if (item && quantity > 0) {
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
                        calculatedTotalBefore: calculatedTotalFromItems
                    });
                    calculatedTotalFromItems += itemTotal;
                    console.log(`[syncSingleOrderForDeliveryDay] Updated calculatedTotalFromItems: ${calculatedTotalFromItems}`);

                    const itemId_uuid = generateUUID();
                    try {
                        await insert(
                            'INSERT INTO upcoming_order_items (id, upcoming_order_id, vendor_selection_id, menu_item_id, quantity) VALUES (?, ?, ?, ?, ?)',
                            [itemId_uuid, upcomingOrderId, vendorSelection.id, itemId, quantity]
                        );
                        console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted item ${itemId}`);
                    } catch (error) {
                        console.error(`[syncSingleOrderForDeliveryDay] Error inserting item:`, error);
                    }
                } else {
                    console.log(`[syncSingleOrderForDeliveryDay] Skipping item ${itemId} - item not found or quantity is 0`);
                }
            }
        }

        console.log(`[syncSingleOrderForDeliveryDay] Final calculatedTotalFromItems: ${calculatedTotalFromItems}`);
        console.log(`[syncSingleOrderForDeliveryDay] Original totalValue: ${totalValue}`);

        // Update total_value to match calculated total from items
        if (calculatedTotalFromItems !== totalValue) {
            console.log(`[syncSingleOrderForDeliveryDay] Mismatch detected! Updating total_value from ${totalValue} to ${calculatedTotalFromItems}`);
            totalValue = calculatedTotalFromItems;
            try {
                await execute(
                    'UPDATE upcoming_orders SET total_value = ? WHERE id = ?',
                    [totalValue, upcomingOrderId]
                );
                console.log(`[syncSingleOrderForDeliveryDay] Successfully updated total_value to ${totalValue}`);
            } catch (error) {
                console.error(`[syncSingleOrderForDeliveryDay] Error updating total_value:`, error);
            }
        } else {
            console.log(`[syncSingleOrderForDeliveryDay] Total values match, no update needed`);
        }

        // Add total as a separate item in the order_items table
        // Use the first vendor selection or create a special one for the total
        if (allVendorSelections.length > 0 && calculatedTotalFromItems > 0) {
            // Use the first vendor selection to attach the total item
            const firstVendorSelection = allVendorSelections[0];
            const totalItemId = generateUUID();
            await insert(
                'INSERT INTO upcoming_order_items (id, upcoming_order_id, vendor_selection_id, menu_item_id, quantity) VALUES (?, ?, ?, ?, ?)',
                [totalItemId, upcomingOrderId, firstVendorSelection.id, null, 1]
            );
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        console.log('[syncSingleOrderForDeliveryDay] Processing Boxes order for upcoming_order_id:', upcomingOrderId);
        console.log('[syncSingleOrderForDeliveryDay] Box orderConfig:', {
            vendorId: orderConfig.vendorId,
            boxTypeId: orderConfig.boxTypeId,
            boxQuantity: orderConfig.boxQuantity,
            hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0
        });

        // Insert box selection with prices
        const quantity = orderConfig.boxQuantity || 1;

        // Get vendor ID from orderConfig, or from boxType if boxTypeId is present
        // Check explicitly for undefined/null/empty string to properly handle vendor assignment
        let boxVendorId = (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') ? orderConfig.vendorId : null;
        if (!boxVendorId && orderConfig.boxTypeId) {
            const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
            boxVendorId = boxType?.vendorId || null;
            console.log('[syncSingleOrderForDeliveryDay] Vendor ID from boxType:', { boxTypeId: orderConfig.boxTypeId, vendorId: boxVendorId });
        }

        console.log('[syncSingleOrderForDeliveryDay] Final boxVendorId to save:', boxVendorId);

        const boxItemsRaw = (orderConfig as any).items || {};
        const boxItemPrices = (orderConfig as any).itemPrices || {};
        console.log('[syncSingleOrderForDeliveryDay] Box items raw:', boxItemsRaw);
        console.log('[syncSingleOrderForDeliveryDay] Box item prices:', boxItemPrices);
        const boxItems: any = {};
        for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
            const price = boxItemPrices[itemId];
            if (price !== undefined && price !== null) {
                boxItems[itemId] = { quantity: qty, price: price };
            } else {
                boxItems[itemId] = qty;
            }
        }
        console.log('[syncSingleOrderForDeliveryDay] Box items formatted:', boxItems);
        console.log('[syncSingleOrderForDeliveryDay] Box items count:', Object.keys(boxItems).length);

        // Calculate total from item prices
        let calculatedTotal = 0;
        for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
            const quantity = typeof qty === 'number' ? qty : 0;
            const price = boxItemPrices[itemId];
            if (price !== undefined && price !== null && quantity > 0) {
                calculatedTotal += price * quantity;
            }
        }

        const boxSelectionData: any = {
            upcoming_order_id: upcomingOrderId,
            vendor_id: boxVendorId,
            quantity: quantity,
            unit_value: 0, // No longer using box type pricing
            total_value: calculatedTotal,
            items: boxItems
        };

        // Include box_type_id if available (for backward compatibility)
        if (orderConfig.boxTypeId) {
            boxSelectionData.box_type_id = orderConfig.boxTypeId;
        }

        const boxSelectionId = generateUUID();
        try {
            await insert(
                'INSERT INTO upcoming_order_box_selections (id, upcoming_order_id, vendor_id, box_type_id, quantity, items) VALUES (?, ?, ?, ?, ?, ?)',
                [boxSelectionId, upcomingOrderId, boxVendorId, orderConfig.boxTypeId || null, quantity, JSON.stringify(boxItems)]
            );
            console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted box selection for upcoming_order_id=${upcomingOrderId}, vendor_id=${boxVendorId}, items_count=${Object.keys(boxItems).length}, items=${JSON.stringify(boxItems)}`);
        } catch (error) {
            console.error(`[syncSingleOrderForDeliveryDay] Error inserting box selection:`, error);
            console.error(`[syncSingleOrderForDeliveryDay] Insert data:`, {
                upcoming_order_id: upcomingOrderId,
                vendor_id: boxVendorId,
                quantity: quantity,
                items: boxItems
            });
            throw error;
        }
    }
}

/**
 * Sync Current Order Request (activeOrder) to upcoming_orders table
 * This ensures upcoming_orders always reflects the latest order configuration
 * Now supports multiple orders per client (one per delivery day)
 */
export async function syncCurrentOrderToUpcoming(clientId: string, client: ClientProfile, skipClientUpdate: boolean = false) {
    // console.log('[syncCurrentOrderToUpcoming] START', { clientId, serviceType: client.activeOrder?.serviceType });

    // 1. DRAFT PERSISTENCE: Save the raw activeOrder metadata to the clients table.
    // This ensures Case ID, Vendor, and other selections are persisted even if the 
    // full sync to upcoming_orders fails (e.g. if the vendor/delivery day isn't fully set yet).
    const orderConfig = client.activeOrder;
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
        try {
            await execute(
                'UPDATE clients SET active_order = ?, updated_at = ? WHERE id = ?',
                [JSON.stringify(client.activeOrder), currentTime.toISOString(), clientId]
            );
            revalidatePath('/clients');
        } catch (updateError: any) {
            console.error('[syncCurrentOrderToUpcoming] Error updating clients.active_order:', updateError);
            throw new Error(`Failed to save order: ${updateError.message}`);
        }
    }

    if (!orderConfig) {
        // If no active order, remove any existing upcoming orders
        await execute('DELETE FROM upcoming_orders WHERE client_id = ?', [clientId]);
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
        const existingOrders = await query<any>(
            'SELECT id, delivery_day FROM upcoming_orders WHERE client_id = ?',
            [clientId]
        );

        if (existingOrders && existingOrders.length > 0) {
            const existingDeliveryDays = new Set(existingOrders.map(o => o.delivery_day).filter(Boolean));
            const currentDeliveryDays = new Set(deliveryDays);

            // Delete orders for days that are no longer in the config
            for (const day of existingDeliveryDays) {
                if (!currentDeliveryDays.has(day)) {
                    const orderToDelete = existingOrders.find(o => o.delivery_day === day);
                    if (orderToDelete) {
                        await execute('DELETE FROM upcoming_orders WHERE id = ?', [orderToDelete.id]);
                    }
                }
            }
        }

        // Sync each delivery day order
        for (const deliveryDay of deliveryDays) {
            const dayOrder = deliveryDayOrders[deliveryDay];
            if (dayOrder && dayOrder.vendorSelections) {
                // Create a full order config for this day
                const dayOrderConfig = {
                    serviceType: orderConfig.serviceType,
                    caseId: orderConfig.caseId,
                    vendorSelections: dayOrder.vendorSelections.filter((s: any) => {
                        // Only include vendors with items
                        if (!s.vendorId) return false;
                        const items = s.items || {};
                        const hasItems = Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                        return hasItems;
                    }),
                    lastUpdated: orderConfig.lastUpdated,
                    updatedBy: orderConfig.updatedBy
                };

                // Only sync if there are vendors with items
                if (dayOrderConfig.vendorSelections.length > 0) {
                    // console.log(`[syncCurrentOrderToUpcoming] Syncing order for ${deliveryDay} with ${dayOrderConfig.vendorSelections.length} vendor(s)`);
                    await syncSingleOrderForDeliveryDay(
                        clientId,
                        dayOrderConfig,
                        deliveryDay,
                        vendors,
                        menuItems,
                        boxTypes
                    );
                } else {
                    // console.log(`[syncCurrentOrderToUpcoming] Skipping ${deliveryDay} - no vendors with items`);
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
                    if (vendor && vendor.deliveryDays) {
                        vendor.deliveryDays.forEach((day: string) => allDeliveryDays.add(day));
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
                hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0
            });

            const boxType = orderConfig.boxTypeId ? boxTypes.find(bt => bt.id === orderConfig.boxTypeId) : null;
            // Check explicitly for undefined/null/empty string to properly handle vendor assignment
            const boxVendorId = (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') ? orderConfig.vendorId : (boxType?.vendorId || null);

            console.log('[syncCurrentOrderToUpcoming] Box vendor resolution:', {
                orderConfigVendorId: orderConfig.vendorId,
                boxTypeVendorId: boxType?.vendorId,
                resolvedVendorId: boxVendorId
            });

            if (boxVendorId) {
                const vendor = vendors.find(v => v.id === boxVendorId);
                if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 0) {
                    // FIX: For Boxes, we strictly want ONE recurring order per week, not one per delivery day.
                    // Since the UI doesn't currently allow selecting a specific day for Boxes,
                    // we default to the first available delivery day of the vendor.
                    deliveryDays = [vendor.deliveryDays[0]];
                } else {
                    // If vendor has no delivery days, still try to sync (will use default logic)
                    console.warn(`[syncCurrentOrderToUpcoming] Vendor ${boxVendorId} has no delivery days configured, will attempt sync anyway`);
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
            await execute('DELETE FROM upcoming_orders WHERE client_id = ? AND delivery_day IS NULL', [clientId]);

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
                const existing = await query<any>(
                    'SELECT id, delivery_day FROM upcoming_orders WHERE client_id = ? AND service_type = ?',
                    [clientId, 'Boxes']
                );

                if (existing) {
                    const idsToDelete = existing
                        .filter((o: any) => o.delivery_day !== targetDay)
                        .map((o: any) => o.id);

                    if (idsToDelete.length > 0) {
                        const placeholders = idsToDelete.map(() => '?').join(',');
                        await execute(`DELETE FROM upcoming_orders WHERE id IN (${placeholders})`, idsToDelete);
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
    await syncLocalDBFromSupabase();

    revalidatePath('/clients');
    revalidatePath(`/client-portal/${clientId}`);
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
        upcomingOrders = await query<any>(
            'SELECT * FROM upcoming_orders WHERE status = ? AND take_effect_date <= ?',
            ['scheduled', todayStr]
        );
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

            const orderId = generateUUID();
            try {
                await insert(
                    'INSERT INTO orders (id, client_id, service_type, case_id, status, last_updated, updated_by, scheduled_delivery_date, delivery_distribution, total_value, total_items, notes, order_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        orderId,
                        orderData.client_id,
                        orderData.service_type,
                        orderData.case_id,
                        orderData.status,
                        orderData.last_updated,
                        orderData.updated_by,
                        orderData.scheduled_delivery_date,
                        orderData.delivery_distribution ? JSON.stringify(orderData.delivery_distribution) : null,
                        orderData.total_value,
                        orderData.total_items,
                        orderData.notes,
                        orderData.order_number
                    ]
                );
                
                const newOrder = await queryOne<any>('SELECT * FROM orders WHERE id = ?', [orderId]);
                if (!newOrder) {
                    errors.push(`Failed to create order for client ${upcomingOrder.client_id}: Order not found after insert`);
                    continue;
                }
            } catch (orderError: any) {
                errors.push(`Failed to create order for client ${upcomingOrder.client_id}: ${orderError?.message}`);
                continue;
            }
            
            const newOrder = await queryOne<any>('SELECT * FROM orders WHERE id = ?', [orderId]);
            if (!newOrder) {
                errors.push(`Failed to retrieve order for client ${upcomingOrder.client_id}`);
                continue;
            }

            // Copy vendor selections and items (for Food orders)
            const vendorSelections = await query<any>(
                'SELECT * FROM upcoming_order_vendor_selections WHERE upcoming_order_id = ?',
                [upcomingOrder.id]
            );

            if (vendorSelections) {
                for (const vs of vendorSelections) {
                    const newVsId = generateUUID();
                    try {
                        await insert(
                            'INSERT INTO order_vendor_selections (id, order_id, vendor_id) VALUES (?, ?, ?)',
                            [newVsId, newOrder.id, vs.vendor_id]
                        );
                        const newVs = { id: newVsId, order_id: newOrder.id, vendor_id: vs.vendor_id };

                        // Copy items
                        const items = await query<any>(
                            'SELECT * FROM upcoming_order_items WHERE vendor_selection_id = ?',
                            [vs.id]
                        );

                        if (items) {
                            for (const item of items) {
                                const itemId = generateUUID();
                                await insert(
                                    'INSERT INTO order_items (id, vendor_selection_id, menu_item_id, quantity) VALUES (?, ?, ?, ?)',
                                    [itemId, newVs.id, item.menu_item_id, item.quantity]
                                );
                            }
                        }
                    } catch (vsError) {
                        console.error('Error creating vendor selection:', vsError);
                        continue;
                    }
                }
            }

            // Copy box selections (for Box orders)
            const boxSelections = await query<any>(
                'SELECT * FROM upcoming_order_box_selections WHERE upcoming_order_id = ?',
                [upcomingOrder.id]
            );

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

                    const boxSelectionId = generateUUID();
                    try {
                        await insert(
                            'INSERT INTO order_box_selections (id, order_id, vendor_id, box_type_id, quantity, items) VALUES (?, ?, ?, ?, ?, ?)',
                            [boxSelectionId, newOrder.id, bs.vendor_id, bs.box_type_id, bs.quantity, JSON.stringify(bs.items || {})]
                        );
                        console.log('[processUpcomingOrders] Successfully inserted box selection for order_id:', newOrder.id);
                    } catch (error) {
                        console.error('[processUpcomingOrders] Error inserting box selection:', error);
                    }
                }
            }

            // Update upcoming order status
            await execute(
                'UPDATE upcoming_orders SET status = ?, processed_order_id = ?, processed_at = ? WHERE id = ?',
                ['processed', newOrder.id, (await getCurrentTime()).toISOString(), upcomingOrder.id]
            );

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
                proofOfDelivery: orderData.proof_of_delivery_image || orderData.delivery_proof_url // URL to proof of delivery image (check both fields)
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
                        // Both upcoming_order_items and order_items use 'vendor_selection_id' field
                        const { data: items, error: itemsError } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .eq('vendor_selection_id', vs.id);

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

                    // Pull items from boxSelection.items (JSONB) - this is the source for box orders
                    if (boxSelection.items && Object.keys(boxSelection.items).length > 0) {
                        const itemsMap: any = {};
                        for (const [itemId, val] of Object.entries(boxSelection.items)) {
                            if (val && typeof val === 'object') {
                                itemsMap[itemId] = (val as any).quantity;
                            } else {
                                itemsMap[itemId] = val;
                            }
                        }
                        orderConfig.items = itemsMap;
                    }
                }

                // If items still empty, try to fetch from separate items table as fallback (for migrated data)
                if ((!orderConfig.items || Object.keys(orderConfig.items).length === 0) && boxSelection?.vendor_id) {
                    // Find the vendor_selection for the box vendor in this order
                    const { data: vendorSelection } = await supabase
                        .from(vendorSelectionsTable)
                        .select('id')
                        .eq(orderIdField, orderData.id)
                        .eq('vendor_id', boxSelection.vendor_id)
                        .maybeSingle();

                    if (vendorSelection) {
                        // Fetch box items - both upcoming_order_items and order_items use 'vendor_selection_id' field
                        const { data: boxItems } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .eq('vendor_selection_id', vendorSelection.id);

                        if (boxItems && boxItems.length > 0) {
                            const itemsMap: any = {};
                            for (const item of boxItems) {
                                itemsMap[item.menu_item_id] = item.quantity;
                            }
                            orderConfig.items = itemsMap;
                        }
                    }
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
 * Get upcoming order from upcoming_orders table for a client
 * This is used for "Current Order Request" form
 */
/**
 * Get upcoming order from upcoming_orders table for a client
 * This is used for "Current Order Request" form
 * Now uses local database for fast access
 */
export async function getUpcomingOrderForClient(clientId: string) {
    if (!clientId) return null;

    try {
        // Use local database for fast access
        const { getUpcomingOrderForClientLocal } = await import('./local-db');
        return await getUpcomingOrderForClientLocal(clientId);
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
        const logId = generateUUID();
        await insert(
            'INSERT INTO navigator_logs (id, navigator_id, client_id, action, details) VALUES (?, ?, ?, ?, ?)',
            [logId, data.navigatorId, data.clientId, `Status changed from ${data.oldStatus} to ${data.newStatus}`, JSON.stringify({ unitsAdded: data.unitsAdded })]
        );
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
            const allBoxesClients = await query<any>('SELECT id FROM clients WHERE service_type = ?', ['Boxes']);

            if (!allBoxesClients || allBoxesClients.length === 0) {
                return { clients: [], total: 0 };
            }

            const boxesClientIds = allBoxesClients.map(c => c.id);
            const placeholders = boxesClientIds.map(() => '?').join(',');

            // Get all upcoming box selections for these clients with JOIN to upcoming_orders
            const boxSelections = await query<any>(`
                SELECT 
                    uobs.vendor_id,
                    uobs.box_type_id,
                    uo.client_id,
                    uo.service_type,
                    uo.status
                FROM upcoming_order_box_selections uobs
                INNER JOIN upcoming_orders uo ON uobs.upcoming_order_id = uo.id
                WHERE uo.client_id IN (${placeholders})
                    AND uo.service_type = ?
                    AND uo.status = ?
            `, [...boxesClientIds, 'Boxes', 'scheduled']);

            // Get all box types to check their vendor_id
            const boxTypes = await query<any>('SELECT id, vendor_id FROM box_types');

            const boxTypeMap = new Map((boxTypes || []).map((bt: any) => [bt.id, bt.vendor_id]));

            // Group box selections by client_id
            const clientBoxSelections = new Map<string, any[]>();
            if (boxSelections) {
                for (const bs of boxSelections) {
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
            const clientPlaceholders = clientIdsNeedingVendor.map(() => '?').join(',');
            let whereClause = `WHERE id IN (${clientPlaceholders})`;
            const baseParams: any[] = [...clientIdsNeedingVendor];

            if (searchQuery) {
                whereClause += ' AND LOWER(full_name) LIKE LOWER(?)';
                baseParams.push(`%${searchQuery}%`);
            }

            // Get total count
            const countResult = await queryOne<{ count: number }>(`
                SELECT COUNT(*) as count
                FROM clients
                ${whereClause}
            `, baseParams);

            const total = countResult?.count || 0;

            // Get paginated data
            const paginationParams = [...baseParams, pageSize, (page - 1) * pageSize];
            const data = await query<any>(`
                SELECT *
                FROM clients
                ${whereClause}
                ORDER BY full_name
                LIMIT ? OFFSET ?
            `, paginationParams);

            // Map clients with error handling for individual clients
            const mappedClients = data.map((c: any) => {
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
        let whereClause = '';
        const baseParams: any[] = [];

        if (searchQuery) {
            whereClause = 'WHERE LOWER(full_name) LIKE LOWER(?)';
            baseParams.push(`%${searchQuery}%`);
        }

        // Get total count
        const countResult = await queryOne<{ count: number }>(`
            SELECT COUNT(*) as count
            FROM clients
            ${whereClause}
        `, baseParams);

        const total = countResult?.count || 0;

        // Get paginated data
        const paginationParams = [...baseParams, pageSize, (page - 1) * pageSize];
        console.log('[getClientsPaginated] Executing query with params:', { whereClause, paginationParams });
        const data = await query<any>(`
            SELECT *
            FROM clients
            ${whereClause}
            ORDER BY full_name
            LIMIT ? OFFSET ?
        `, paginationParams);

        console.log('[getClientsPaginated] Raw data returned:', { count: data?.length, total, firstClient: data?.[0] ? { id: data[0].id, full_name: data[0].full_name, active_order_type: typeof data[0].active_order } : null });

        // Map clients with error handling for individual clients
        const mappedClients = data.map((c: any) => {
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
            upcomingOrder
        ] = await Promise.all([
            getClient(clientId),
            getClientHistory(clientId),
            getOrderHistory(clientId),
            getBillingHistory(clientId),
            getActiveOrderForClient(clientId),
            getUpcomingOrderForClient(clientId)
        ]);

        if (!client) return null;

        return {
            client,
            history,
            orderHistory,
            billingHistory,
            activeOrder,
            upcomingOrder
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
            // Both upcoming_order_items and order_items use 'vendor_selection_id' field
            const { data: items } = await supabase
                .from(itemsTable)
                .select('*')
                .eq('vendor_selection_id', vs.id);

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
                        // Fetch box items - both upcoming_order_items and order_items use 'vendor_selection_id' field
                        const { data: boxItems } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .eq('vendor_selection_id', vendorSelection.id);

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
        .select('delivery_proof_url')
        .eq('id', orderId)
        .single();

    if (error || !data) return false;
    return !!data.delivery_proof_url;
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
            delivery_proof_url: proofUrl,
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
        .select('navigator_id, fullName, authorized_amount')
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
            client_name: client?.fullName || 'Unknown Client',
            order_id: order.id,
            status: 'pending',
            amount: order.total_value || 0,
            navigator: client?.navigator_id || 'Unknown',
            delivery_date: order.actual_delivery_date,
            remarks: 'Auto-generated upon proof upload'
        };

        const billingId = generateUUID();
        try {
            await insert(
                'INSERT INTO billing_records (id, client_id, order_id, status, amount, navigator, remarks) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [billingId, billingPayload.client_id, billingPayload.order_id, billingPayload.status, billingPayload.amount, billingPayload.navigator || null, billingPayload.remarks]
            );
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
        delivery_proof_url: proofUrl.trim(),
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
            .select('navigator_id, fullName, authorized_amount')
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
                client_name: client?.fullName || 'Unknown Client',
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

    // Fetch client information
    const { data: clientData } = await supabase
        .from('clients')
        .select('id, full_name, address, email, phone_number')
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