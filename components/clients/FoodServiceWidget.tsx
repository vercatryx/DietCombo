'use client';

import React from 'react';
import { ClientProfile, Vendor, MenuItem, MealCategory, MealItem } from '@/lib/types';
import { Plus, Trash2, Calendar, Check, AlertTriangle } from 'lucide-react';
import styles from './ClientProfile.module.css';
import MenuItemCard from './MenuItemCard';

interface Props {
    orderConfig: any;
    setOrderConfig: (config: any) => void;
    client: ClientProfile;
    vendors: Vendor[];
    menuItems: MenuItem[];
    mealCategories: MealCategory[];
    mealItems: MealItem[];
    settings?: any; // AppSettings for take effect date
    isClientPortal?: boolean;
    validationStatus?: {
        isValid: boolean;
        totalValue: number;
        error: string | null;
    };
}

// Helper functions
function isMeetingMinimum(value: number, minimum: number): boolean {
    return value >= minimum;
}

function isMeetingExactTarget(value: number, target: number): boolean {
    return value === target;
}

export default function FoodServiceWidget({
    orderConfig,
    setOrderConfig,
    client,
    vendors,
    menuItems,
    mealCategories,
    mealItems,
    settings,
    isClientPortal,
    validationStatus
}: Props) {
    // -- LOGIC HELPERS --

    function getVendorMenuItems(vendorId: string) {
        return menuItems
            .filter(i => i.vendorId === vendorId && i.isActive)
            .sort((a, b) => {
                const sortOrderA = a.sortOrder ?? 0;
                const sortOrderB = b.sortOrder ?? 0;
                if (sortOrderA !== sortOrderB) return sortOrderA - sortOrderB;
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
    }

    function getVendorMealCount(vendorId: string, selection: any): number {
        if (!selection) return 0;
        // Multi-day logic
        if (selection.itemsByDay && selection.selectedDeliveryDays) {
            let total = 0;
            for (const deliveryDay of selection.selectedDeliveryDays) {
                const dayItems = selection.itemsByDay[deliveryDay] || {};
                total += Object.entries(dayItems).reduce((sum: number, [itemId, qty]) => {
                    const item = menuItems.find(i => i.id === itemId);
                    // Use item.value for meal count
                    const multiplier = item ? (item.value || 0) : 0;
                    const val = ((Number(qty) || 0) * multiplier);
                    return sum + val;
                }, 0);
            }
            return total;
        }

        // Normal items structure
        if (!selection.items) return 0;
        let total = 0;

        // Calculate Days Count for Flat Mode multiplier
        const daysCount = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0)
            ? selection.selectedDeliveryDays.length
            : ((client as any).delivery_days?.length || 1);

        for (const [itemId, qty] of Object.entries(selection.items)) {
            const item = menuItems.find(i => i.id === itemId);
            // Use item.value for meal count
            const multiplier = item ? (item.value || 0) : 0;
            const val = ((qty as number) || 0) * multiplier * daysCount;
            total += val;
        }
        return total;
    }

    function getVendorMealCountForDay(vendorId: string, selection: any, day: string): number {
        if (!selection || !selection.itemsByDay || !selection.itemsByDay[day]) return 0;

        const dayItems = selection.itemsByDay[day] || {};
        return Object.entries(dayItems).reduce((sum: number, [itemId, qty]) => {
            const item = menuItems.find(i => i.id === itemId);
            const multiplier = item ? (item.value || 0) : 0;
            return sum + ((Number(qty) || 0) * multiplier);
        }, 0);
    }

    function getTotalMealCountAllDays(): number {
        // PREFER PASSED VALIDATION STATUS if available
        if (validationStatus) {
            return validationStatus.totalValue;
        }

        let total = 0;

        // If editing in 'vendorSelections' mode (transient state before save)
        if (orderConfig.vendorSelections) {
            for (const selection of orderConfig.vendorSelections) {
                total += getVendorMealCount(selection.vendorId, selection);
            }
        } else if (orderConfig.deliveryDayOrders) {
            // If in saved/multi-day format
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    const items = sel.items || {};
                    total += Object.entries(items).reduce((sum: number, [itemId, qty]) => {
                        const item = menuItems.find(i => i.id === itemId);
                        const multiplier = item ? (item.value || 0) : 0;
                        return sum + ((Number(qty) || 0) * multiplier);
                    }, 0);
                }
            }
        }

        // Include meal selections (Breakfast, Lunch, etc.)
        if (orderConfig.mealSelections) {
            for (const config of Object.values(orderConfig.mealSelections) as any[]) {
                if (config.items) {
                    for (const [itemId, qty] of Object.entries(config.items)) {
                        const item = mealItems.find(i => i.id === itemId);
                        const multiplier = item ? (item.value || 0) : 0;
                        total += (Number(qty) || 0) * multiplier;
                    }
                }
            }
        }

        return total;
    }

    // --- MEAL SELECTION HANDLERS ---

    function handleAddMeal(mealType: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (!newConfig.mealSelections) newConfig.mealSelections = {};
            if (!newConfig.mealSelections[mealType]) {
                newConfig.mealSelections[mealType] = {
                    vendorId: '',
                    items: {}
                };
            }
            return newConfig;
        });
    }

    function handleRemoveMeal(mealType: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections) {
                delete newConfig.mealSelections[mealType];
                if (Object.keys(newConfig.mealSelections).length === 0) {
                    newConfig.mealSelections = {};
                }
            }
            return newConfig;
        });
    }

    function handleMealVendorChange(mealType: string, vendorId: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[mealType]) {
                newConfig.mealSelections[mealType].vendorId = vendorId;
            }
            return newConfig;
        });
    }

    function handleMealItemChange(mealType: string, itemId: string, qty: number, note?: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[mealType]) {
                const updatedItems = { ...newConfig.mealSelections[mealType].items };
                const updatedNotes = { ...newConfig.mealSelections[mealType].itemNotes || {} };

                if (qty > 0) {
                    updatedItems[itemId] = qty;
                    if (note !== undefined) {
                        if (note.trim() === '') {
                            delete updatedNotes[itemId];
                        } else {
                            updatedNotes[itemId] = note;
                        }
                    }
                } else {
                    delete updatedItems[itemId];
                    delete updatedNotes[itemId];
                }
                newConfig.mealSelections[mealType].items = updatedItems;
                newConfig.mealSelections[mealType].itemNotes = updatedNotes;
            }
            return newConfig;
        });
    }

    // --- VENDOR SELECTION HANDLERS (Generic/Lunch) ---

    function handleAddVendorBlock() {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            newConfig.vendorSelections = newConfig.vendorSelections ? [...newConfig.vendorSelections] : [];
            newConfig.vendorSelections.push({
                vendorId: '',
                items: {}
            });
            return newConfig;
        });
    }

    function handleRemoveVendorBlock(index: number) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections) {
                const updated = [...newConfig.vendorSelections];
                updated.splice(index, 1);
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    function handleVendorSelectionChange(index: number, vendorId: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections) {
                const updated = [...newConfig.vendorSelections];

                // Find vendor to check delivery days
                const vendor = vendors.find(v => v.id === vendorId);
                // Auto-select day if vendor only has one delivery day
                const autoSelectDay = (vendor?.deliveryDays?.length === 1) ? vendor.deliveryDays[0] : null;

                updated[index] = {
                    ...updated[index],
                    vendorId,
                    items: {},
                    itemsByDay: autoSelectDay ? { [autoSelectDay]: {} } : {},
                    selectedDeliveryDays: autoSelectDay ? [autoSelectDay] : []
                };
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    function handleVendorItemChange(blockIndex: number, itemId: string, qty: number, day?: string, note?: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections && newConfig.vendorSelections[blockIndex]) {
                const updated = [...newConfig.vendorSelections];
                const block = { ...updated[blockIndex] };

                // Handle multi-day format (itemsByDay)
                if (day && block.selectedDeliveryDays && block.selectedDeliveryDays.length > 0) {
                    if (!block.itemsByDay) block.itemsByDay = {};
                    if (!block.itemsByDay[day]) block.itemsByDay[day] = {};

                    // Ensure itemNotesByDay initialization
                    if (!block.itemNotesByDay) block.itemNotesByDay = {};
                    if (!block.itemNotesByDay[day]) block.itemNotesByDay[day] = {};

                    if (qty > 0) {
                        block.itemsByDay[day][itemId] = qty;

                        if (note !== undefined) {
                            if (note.trim() === '') {
                                delete block.itemNotesByDay[day][itemId];
                            } else {
                                block.itemNotesByDay[day][itemId] = note;
                            }
                        }
                    } else {
                        delete block.itemsByDay[day][itemId];
                        delete block.itemNotesByDay[day][itemId];
                    }
                } else {
                    // Handle single-day format (items)
                    const items = { ...block.items || {} };
                    const itemNotes = { ...(block.itemNotes || {}) };

                    if (qty > 0) {
                        items[itemId] = qty;
                        if (note !== undefined) {
                            if (note.trim() === '') {
                                delete itemNotes[itemId];
                            } else {
                                itemNotes[itemId] = note;
                            }
                        }
                    } else {
                        delete items[itemId];
                        delete itemNotes[itemId];
                    }
                    block.items = items;
                    block.itemNotes = itemNotes;
                }

                updated[blockIndex] = block;
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    function handleDeliveryDayToggle(blockIndex: number, day: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections && newConfig.vendorSelections[blockIndex]) {
                const updated = [...newConfig.vendorSelections];
                const block = { ...updated[blockIndex] };

                block.selectedDeliveryDays = block.selectedDeliveryDays ? [...block.selectedDeliveryDays] : [];

                const dayIndex = block.selectedDeliveryDays.indexOf(day);
                if (dayIndex > -1) {
                    // Remove day
                    block.selectedDeliveryDays.splice(dayIndex, 1);

                    // Clean up itemsByDay for this day
                    if (block.itemsByDay) {
                        block.itemsByDay = { ...block.itemsByDay };
                        if (block.itemsByDay[day]) {
                            delete block.itemsByDay[day];
                        }
                    }

                    // If no days selected, revert to simple items structure
                    if (block.selectedDeliveryDays.length === 0) {
                        delete block.selectedDeliveryDays;
                        delete block.itemsByDay;
                        if (!block.items) block.items = {};
                    }
                } else {
                    // Add day
                    block.selectedDeliveryDays.push(day);
                    block.selectedDeliveryDays.sort();

                    // Initialize itemsByDay structure
                    if (!block.itemsByDay) {
                        block.itemsByDay = {};
                    } else {
                        block.itemsByDay = { ...block.itemsByDay };
                    }

                    if (!block.itemsByDay[day]) {
                        block.itemsByDay[day] = {};
                    }

                    // Clear the single-day items structure when switching to multi-day
                    if (block.items) {
                        block.items = {};
                    }
                }

                updated[blockIndex] = block;
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    // --- RENDER HELPERS ---

    const renderVendorBlocks = () => {
        const selections = orderConfig.vendorSelections || [];

        return selections.map((selection: any, index: number) => {
            const vendorId = selection.vendorId;
            const vendor = vendors.find(v => v.id === vendorId);
            const vendorItems = vendorId ? getVendorMenuItems(vendorId) : [];

            // Calculate vendor meal count
            const vendorMealCount = getVendorMealCount(vendorId, selection);
            const vendorMinimum = vendor?.minimumMeals || 0;
            const meetsMinimum = vendorMinimum === 0 || isMeetingMinimum(vendorMealCount, vendorMinimum);

            // Get vendor's delivery days
            const vendorDeliveryDays = vendor?.deliveryDays || [];
            const hasMultipleDays = vendorDeliveryDays.length > 1;

            // Check if multi-day mode is active for this vendor
            const selectedDays = selection.selectedDeliveryDays || [];

            return (
                <div key={index} id={`vendor-block-${index}`} className={styles.vendorBlock}>
                    {/* Header */}
                    <div className={styles.vendorHeader}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                            <select
                                className="input"
                                value={vendorId || ''}
                                onChange={(e) => handleVendorSelectionChange(index, e.target.value)}
                            >
                                <option value="">Select Vendor...</option>
                                {vendors
                                    .filter(v => {
                                        if (!v.serviceTypes.includes('Food') || !v.isActive) return false;
                                        return !selections.some((s: any, idx: number) => s.vendorId === v.id && idx !== index);
                                    })
                                    .map(v => (
                                        <option key={v.id} value={v.id}>{v.name}</option>
                                    ))}
                            </select>

                            {/* Multi-Day Selection - Toggle Buttons */}
                            {vendorId && hasMultipleDays && (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px',
                                    padding: '8px',
                                    backgroundColor: 'var(--bg-surface-hover)',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        <Calendar size={14} />
                                        <span style={{ fontWeight: 600 }}>Select Delivery Days:</span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        {vendorDeliveryDays.map(day => {
                                            const isSelected = selectedDays.includes(day);
                                            return (
                                                <button
                                                    key={day}
                                                    type="button"
                                                    onClick={() => {
                                                        handleDeliveryDayToggle(index, day);
                                                    }}
                                                    style={{
                                                        padding: '6px 14px',
                                                        backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-surface)',
                                                        color: isSelected ? 'white' : 'var(--text-primary)',
                                                        borderRadius: '20px',
                                                        cursor: 'pointer',
                                                        fontSize: '0.85rem',
                                                        fontWeight: isSelected ? 600 : 400,
                                                        border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                        transition: 'all 0.2s ease',
                                                        outline: 'none',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px'
                                                    }}
                                                >
                                                    {day}
                                                    {isSelected && <Check size={12} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleRemoveVendorBlock(index)}>
                            <Trash2 size={16} />
                        </button>
                    </div>

                    {/* Items Display */}
                    {vendorId && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {hasMultipleDays && selectedDays.length === 0 ? (
                                <div className={styles.hint} style={{ textAlign: 'center', padding: '1rem', fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                                    Please select at least one delivery day to view the menu.
                                </div>
                            ) : selectedDays.length > 0 ? (
                                // Multi-day view - show STACKED menu blocks for each selected day
                                selectedDays.map((day: string) => {
                                    return (
                                        <div key={day} style={{
                                            border: '1px solid var(--border-color)',
                                            borderRadius: '8px',
                                            padding: '16px',
                                            backgroundColor: 'var(--bg-surface)'
                                        }}>
                                            <div style={{
                                                marginBottom: '12px',
                                                paddingBottom: '8px',
                                                borderBottom: '1px solid var(--border-color)',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                            }}>
                                                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1rem' }}>
                                                    {day} Menu
                                                </span>
                                                {vendorMinimum > 0 && (() => {
                                                    const dayCount = getVendorMealCountForDay(vendorId, selection, day);
                                                    const dayMet = isMeetingMinimum(dayCount, vendorMinimum);
                                                    return (
                                                        <span style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px',
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            backgroundColor: dayMet ? '#d1fae5' : '#fee2e2',
                                                            color: dayMet ? '#065f46' : '#991b1b',
                                                            fontSize: '0.85rem',
                                                            fontWeight: 600
                                                        }}>
                                                            {dayMet ? <Check size={14} /> : <AlertTriangle size={14} />}
                                                            {dayCount} / {vendorMinimum} meals
                                                        </span>
                                                    );
                                                })()}
                                            </div>

                                            <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                                {vendorItems.map(item => {
                                                    const dayItems = selection.itemsByDay?.[day] || {};
                                                    const qty = dayItems[item.id] || 0;
                                                    const dayNotes = selection.itemNotesByDay?.[day] || {};
                                                    const note = dayNotes[item.id] || '';

                                                    return (
                                                        <MenuItemCard
                                                            key={item.id}
                                                            item={item}
                                                            quantity={qty}
                                                            note={note}
                                                            onQuantityChange={(newQty) => handleVendorItemChange(index, item.id, newQty, day)}
                                                            onNoteChange={(newNote) => handleVendorItemChange(index, item.id, qty, day, newNote)}
                                                        />
                                                    );
                                                })}
                                                {vendorItems.length === 0 && <span className={styles.hint}>No items available for this vendor.</span>}
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                // Single-day / No-day view
                                <>
                                    {vendorMinimum > 0 && (
                                        <div style={{
                                            marginBottom: '1rem',
                                            padding: '8px 12px',
                                            borderRadius: '6px',
                                            backgroundColor: meetsMinimum ? '#d1fae5' : '#fee2e2',
                                            color: meetsMinimum ? '#065f46' : '#991b1b',
                                            border: `1px solid ${meetsMinimum ? '#10b981' : '#ef4444'}`,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '0.9rem',
                                            fontWeight: 600
                                        }}>
                                            {meetsMinimum ? <Check size={16} /> : <AlertTriangle size={16} />}
                                            <span>Minimum: {vendorMinimum} meals | Selected: {vendorMealCount} meals</span>
                                        </div>
                                    )}
                                    <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                        {vendorItems.map(item => {
                                            const qty = selection.items?.[item.id] || 0;
                                            const note = selection.itemNotes?.[item.id] || '';
                                            return (
                                                <MenuItemCard
                                                    key={item.id}
                                                    item={item}
                                                    quantity={qty}
                                                    note={note}
                                                    onQuantityChange={(newQty) => handleVendorItemChange(index, item.id, newQty)}
                                                    onNoteChange={(newNote) => handleVendorItemChange(index, item.id, qty, undefined, newNote)}
                                                />
                                            );
                                        })}
                                        {vendorItems.length === 0 && <span className={styles.hint}>No items available for this vendor.</span>}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            );
        });
    };

    const renderMealBlocks = () => {
        if (!orderConfig?.mealSelections) return null;
        return Object.entries(orderConfig.mealSelections).map(([mealType, config]: [string, any]) => {

            // Get categories for this meal type
            const subCategories = mealCategories
                .filter(c => c.mealType === mealType)
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

            return (
                <div key={mealType} id={`meal-block-${mealType}`} className={styles.vendorBlock} style={{
                    borderLeft: '4px solid var(--color-primary)'
                }}>
                    {/* Header */}
                    <div className={styles.vendorHeader}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{mealType}</span>
                            {!isClientPortal && (
                                <select
                                    className="input"
                                    style={{ padding: '4px 8px', fontSize: '0.9rem', maxWidth: '200px' }}
                                    value={config.vendorId || ''}
                                    onChange={(e) => {
                                        const newSelections = { ...orderConfig.mealSelections };
                                        newSelections[mealType] = {
                                            ...newSelections[mealType],
                                            vendorId: e.target.value || null
                                        };
                                        setOrderConfig({ ...orderConfig, mealSelections: newSelections });
                                    }}
                                >
                                    <option value="">Select Vendor (Optional)</option>
                                    {vendors
                                        .filter(v => v.serviceTypes.includes('Food') && v.isActive)
                                        .map(v => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                </select>
                            )}
                            {isClientPortal && config.vendorId && (
                                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {vendors.find(v => v.id === config.vendorId)?.name}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleRemoveMeal(mealType)}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Items Grouped by Category */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {subCategories.map(subCat => {
                            const catItems = mealItems
                                .filter(i => i.categoryId === subCat.id)
                                .sort((a, b) => {
                                    const sortOrderA = a.sortOrder ?? 0;
                                    const sortOrderB = b.sortOrder ?? 0;
                                    if (sortOrderA !== sortOrderB) return sortOrderA - sortOrderB;
                                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                                });

                            if (catItems.length === 0) return null;

                            // Calculate quota for this specific category
                            let categorySelectedValue = 0;
                            if (config.items) {
                                for (const [itemId, qty] of Object.entries(config.items)) {
                                    const item = catItems.find(i => i.id === itemId);
                                    if (item) {
                                        categorySelectedValue += ((item.value || 0) * (qty as number));
                                    }
                                }
                            }
                            const requiredValue = subCat.setValue;
                            const isInvalid = requiredValue !== undefined && requiredValue !== null && !isMeetingExactTarget(categorySelectedValue, requiredValue);

                            return (
                                <div key={subCat.id} style={{
                                    border: isInvalid ? '1px solid #ef4444' : '1px solid transparent',
                                    padding: isInvalid ? '8px' : '0',
                                    borderRadius: '8px',
                                    backgroundColor: isInvalid ? '#fef2f2' : 'transparent'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'baseline',
                                        marginBottom: '0.75rem',
                                        borderBottom: '1px solid var(--border-color)',
                                        paddingBottom: '0.25rem'
                                    }}>
                                        <h5 style={{
                                            fontSize: '0.9rem',
                                            fontWeight: 600,
                                            color: isInvalid ? '#ef4444' : 'var(--text-secondary)',
                                            margin: 0
                                        }}>
                                            {subCat.name}
                                        </h5>
                                        {requiredValue !== undefined && requiredValue !== null && (
                                            <span style={{ fontSize: '0.85em', color: isInvalid ? '#ef4444' : 'var(--text-secondary)' }}>
                                                Selected: {categorySelectedValue} / {requiredValue}
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                        {catItems.map(item => {
                                            const qty = config.items?.[item.id] || 0;
                                            return (
                                                <MenuItemCard
                                                    key={item.id}
                                                    item={item}
                                                    quantity={qty}
                                                    note={config.itemNotes?.[item.id] || ''}
                                                    onQuantityChange={(newQty) => handleMealItemChange(mealType, item.id, newQty)}
                                                    onNoteChange={(newNote) => handleMealItemChange(mealType, item.id, qty, newNote)}
                                                    contextLabel={mealType}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                        {mealItems.filter(i => mealCategories.find(c => c.id === i.categoryId)?.mealType === mealType).length === 0 && (
                            <span className={styles.hint}>No items found for {mealType}.</span>
                        )}
                    </div>
                </div>
            );
        });
    };

    return (
        <div className={styles.vendorsList}>
            {/* Generic Vendor Blocks (Main/Lunch) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                {renderVendorBlocks()}
            </div>

            {/* Meal blocks */}
            {renderMealBlocks()}
        </div>
    );
}
