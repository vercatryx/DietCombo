'use client';

import { useState, useEffect } from 'react';
import { ItemCategory, MenuItem } from '@/lib/types';
import { addCategory, updateCategory, deleteCategory, addMenuItem, updateMenuItem, deleteMenuItem } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, Package } from 'lucide-react';
import styles from './BoxTypeManagement.module.css';

export function BoxCategoriesManagement() {
    const { getCategories, getMenuItems, invalidateReferenceData } = useDataCache();
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

    // Category Creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategorySetValue, setNewCategorySetValue] = useState<string>('');

    // Inline Item Creation
    const [newItemName, setNewItemName] = useState('');
    const [newItemQuotaValue, setNewItemQuotaValue] = useState(1);
    const [newItemPrice, setNewItemPrice] = useState<number>(0);
    const [addingItemForCategory, setAddingItemForCategory] = useState<string | null>(null);

    // Category Editing States
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [tempCategoryName, setTempCategoryName] = useState('');
    const [tempCategorySetValue, setTempCategorySetValue] = useState<string>('');

    // Item Editing States
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [tempItemName, setTempItemName] = useState('');
    const [tempItemQuotaValue, setTempItemQuotaValue] = useState<number>(1);
    const [tempItemPrice, setTempItemPrice] = useState<number>(0);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const [cData, mData] = await Promise.all([getCategories(), getMenuItems()]);
        setCategories(cData);
        setMenuItems(mData);
    }

    async function handleAddCategory() {
        if (!newCategoryName.trim()) return;
        const setValue = newCategorySetValue.trim() === '' ? null : parseInt(newCategorySetValue, 10);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }
        await addCategory(newCategoryName, setValue);
        invalidateReferenceData();
        const cData = await getCategories();
        setCategories(cData);
        setIsAddingCategory(false);
        setNewCategoryName('');
        setNewCategorySetValue('');
    }

    async function handleDeleteCategory(id: string) {
        // Check if category has items
        const hasItems = menuItems.some(i => i.categoryId === id && (i.vendorId === null || i.vendorId === ''));
        if (hasItems) {
            alert('Cannot delete category with items. Remove items first.');
            return;
        }
        if (confirm('Delete this category?')) {
            await deleteCategory(id);
            invalidateReferenceData();
            const cData = await getCategories();
            setCategories(cData);
        }
    }

    function handleEditCategory(category: ItemCategory) {
        setEditingCategoryId(category.id);
        setTempCategoryName(category.name);
        setTempCategorySetValue(category.setValue?.toString() || '');
    }

    function handleCancelEditCategory() {
        setEditingCategoryId(null);
        setTempCategoryName('');
        setTempCategorySetValue('');
    }

    async function handleSaveEditCategory() {
        if (!editingCategoryId || !tempCategoryName.trim()) return;
        const setValue = tempCategorySetValue.trim() === '' ? null : parseInt(tempCategorySetValue, 10);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }
        await updateCategory(editingCategoryId, tempCategoryName, setValue);
        invalidateReferenceData();
        const cData = await getCategories();
        setCategories(cData);
        handleCancelEditCategory();
    }

    async function handleAddItem(categoryId: string) {
        if (!newItemName.trim()) return;
        if (newItemPrice <= 0) {
            alert('Price must be greater than 0');
            return;
        }

        await addMenuItem({
            vendorId: '', // Box items are universal
            name: newItemName,
            value: 0,
            isActive: true,
            categoryId: categoryId,
            quotaValue: newItemQuotaValue,
            priceEach: newItemPrice > 0 ? newItemPrice : undefined
        });
        invalidateReferenceData();

        const mData = await getMenuItems();
        setMenuItems(mData);
        setNewItemName('');
        setNewItemQuotaValue(1);
        setNewItemPrice(0);
        setAddingItemForCategory(null);
    }

    async function handleDeleteItem(id: string) {
        if (confirm('Remove this item?')) {
            await deleteMenuItem(id);
            invalidateReferenceData();
            const mData = await getMenuItems();
            setMenuItems(mData);
        }
    }

    function handleEditItem(item: MenuItem) {
        setEditingItemId(item.id);
        setTempItemName(item.name);
        setTempItemQuotaValue(item.quotaValue || 1);
        setTempItemPrice(item.priceEach || 0);
    }

    function handleCancelEditItem() {
        setEditingItemId(null);
        setTempItemName('');
        setTempItemQuotaValue(1);
        setTempItemPrice(0);
    }

    async function handleSaveEditItem() {
        if (!editingItemId) return;
        if (tempItemPrice <= 0) {
            alert('Price must be greater than 0');
            return;
        }

        await updateMenuItem(editingItemId, {
            name: tempItemName,
            quotaValue: tempItemQuotaValue,
            priceEach: tempItemPrice > 0 ? tempItemPrice : undefined
        });
        invalidateReferenceData();

        const mData = await getMenuItems();
        setMenuItems(mData);
        handleCancelEditItem();
    }

    // Get box items (items without a vendorId)
    function getBoxItemsForCategory(categoryId: string) {
        return menuItems.filter(i => i.categoryId === categoryId && (i.vendorId === null || i.vendorId === ''));
    }

    return (
        <div className={styles.container} style={{ display: 'block' }}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Box Categories & Items</h2>
                    <p className={styles.subtitle}>Configure categories and items for box service.</p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setIsAddingCategory(true)}
                >
                    <Plus size={16} /> Add Category
                </button>
            </div>

            {/* Add Category Form */}
            {isAddingCategory && (
                <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-surface-hover)', borderRadius: '6px', border: '1px solid var(--color-primary)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                                className="input"
                                placeholder="Category Name (e.g., Fruits, Dairy, Proteins)"
                                value={newCategoryName}
                                onChange={e => setNewCategoryName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                autoFocus
                                style={{ flex: 1 }}
                            />
                            <input
                                type="number"
                                className="input"
                                placeholder="Set Value (optional)"
                                value={newCategorySetValue}
                                onChange={e => setNewCategorySetValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                min="1"
                                style={{ width: '120px' }}
                                title="Required quota value - users must select items that sum to exactly this value"
                            />
                            <button className="btn btn-primary" onClick={handleAddCategory}>
                                <Check size={16} /> Save
                            </button>
                            <button className="btn btn-secondary" onClick={() => { setIsAddingCategory(false); setNewCategoryName(''); setNewCategorySetValue(''); }}>
                                <X size={16} /> Cancel
                            </button>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: '0.25rem' }}>
                            Set Value: Required quota value for this category. Leave empty for no requirement.
                        </div>
                    </div>
                </div>
            )}

            {/* Categories List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {categories.length === 0 && !isAddingCategory && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontStyle: 'italic', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                        No categories yet. Add a category to start configuring box items.
                    </div>
                )}

                {categories.map(cat => (
                    <div key={cat.id} style={{ background: 'var(--bg-surface-hover)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        {/* Category Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            {editingCategoryId === cat.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input
                                            className="input"
                                            value={tempCategoryName}
                                            onChange={e => setTempCategoryName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSaveEditCategory()}
                                            style={{ fontSize: '1rem', fontWeight: 600, flex: 1 }}
                                            autoFocus
                                        />
                                        <input
                                            type="number"
                                            className="input"
                                            placeholder="Set Value"
                                            value={tempCategorySetValue}
                                            onChange={e => setTempCategorySetValue(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleSaveEditCategory()}
                                            min="1"
                                            style={{ width: '120px' }}
                                            title="Required quota value - users must select items that sum to exactly this value"
                                        />
                                        <button
                                            onClick={handleSaveEditCategory}
                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-success)' }}
                                            title="Save"
                                        >
                                            <Check size={18} />
                                        </button>
                                        <button
                                            onClick={handleCancelEditCategory}
                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                            title="Cancel"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Package size={18} style={{ color: 'var(--color-primary)' }} />
                                        <span style={{ fontWeight: 600, fontSize: '1rem' }}>{cat.name}</span>
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                                            ({getBoxItemsForCategory(cat.id).length} items)
                                        </span>
                                        {cat.setValue !== undefined && cat.setValue !== null && (
                                            <span style={{
                                                color: '#000000',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                                background: 'var(--color-primary)',
                                                padding: '2px 8px',
                                                borderRadius: '12px',
                                                border: '1px solid rgba(0,0,0,0.1)'
                                            }}>
                                                Set Value: {cat.setValue}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                        <button
                                            onClick={() => handleEditCategory(cat)}
                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)' }}
                                            title="Edit Category"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteCategory(cat.id)}
                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-danger)' }}
                                            title="Delete Category"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Items in Category */}
                        <div style={{ padding: '0.5rem', background: 'var(--bg-app)', borderRadius: '4px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                {getBoxItemsForCategory(cat.id).map(item => (
                                    editingItemId === item.id ? (
                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '4px 8px', borderRadius: '4px', border: '2px solid var(--color-primary)', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                                            <input
                                                className="input"
                                                value={tempItemName}
                                                onChange={e => setTempItemName(e.target.value)}
                                                style={{ padding: '2px 6px', fontSize: '0.8rem', height: '24px', minWidth: '100px', flex: '1 1 120px' }}
                                                placeholder="Item Name"
                                            />
                                            <input
                                                type="number"
                                                className="input"
                                                value={tempItemQuotaValue}
                                                onChange={e => setTempItemQuotaValue(Number(e.target.value))}
                                                style={{ padding: '2px 6px', fontSize: '0.8rem', width: '50px', height: '24px' }}
                                                min="1"
                                                placeholder="Qty"
                                            />
                                            <input
                                                type="number"
                                                className="input"
                                                value={tempItemPrice || ''}
                                                onChange={e => setTempItemPrice(parseFloat(e.target.value) || 0)}
                                                style={{ padding: '2px 6px', fontSize: '0.8rem', width: '70px', height: '24px' }}
                                                min="0"
                                                step="0.01"
                                                placeholder="Price"
                                            />
                                            <button
                                                onClick={handleSaveEditItem}
                                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-success)', padding: 0 }}
                                                title="Save"
                                            >
                                                <Check size={14} />
                                            </button>
                                            <button
                                                onClick={handleCancelEditItem}
                                                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', padding: 0 }}
                                                title="Cancel"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ) : (
                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                                            <span>{item.name}</span>
                                            <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span>
                                            {item.priceEach !== undefined && item.priceEach !== null && (
                                                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${item.priceEach.toFixed(2)}</span>
                                            )}
                                            <button onClick={() => handleEditItem(item)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)', padding: 0 }} title="Edit Item">
                                                <Edit2 size={12} />
                                            </button>
                                            <button onClick={() => handleDeleteItem(item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0 }} title="Delete Item">
                                                <X size={12} />
                                            </button>
                                        </div>
                                    )
                                ))}
                                {getBoxItemsForCategory(cat.id).length === 0 && (
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No items in this category yet.</span>
                                )}
                            </div>

                            {/* Add Item Form */}
                            {addingItemForCategory === cat.id ? (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                    <input
                                        placeholder="Item Name (e.g. Apple)"
                                        className="input"
                                        autoFocus
                                        style={{ padding: '4px 8px', fontSize: '0.85rem', height: '28px', flex: '1 1 150px', minWidth: '120px' }}
                                        value={newItemName}
                                        onChange={e => setNewItemName(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddItem(cat.id)}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Qty"
                                        className="input"
                                        style={{ padding: '4px 8px', fontSize: '0.85rem', width: '65px', height: '28px' }}
                                        value={newItemQuotaValue}
                                        onChange={e => setNewItemQuotaValue(Number(e.target.value))}
                                        min="1"
                                    />
                                    <input
                                        type="number"
                                        placeholder="Price"
                                        className="input"
                                        style={{ padding: '4px 8px', fontSize: '0.85rem', width: '80px', height: '28px' }}
                                        value={newItemPrice || ''}
                                        onChange={e => setNewItemPrice(parseFloat(e.target.value) || 0)}
                                        min="0"
                                        step="0.01"
                                    />
                                    <button className="btn btn-primary" style={{ padding: '4px 12px', height: '28px', fontSize: '0.8rem' }} onClick={() => handleAddItem(cat.id)}>Add</button>
                                    <button className="btn btn-secondary" style={{ padding: '4px 12px', height: '28px', fontSize: '0.8rem' }} onClick={() => {
                                        setAddingItemForCategory(null);
                                        setNewItemName('');
                                        setNewItemQuotaValue(1);
                                        setNewItemPrice(0);
                                    }}>Cancel</button>
                                </div>
                            ) : (
                                <button
                                    className="btn btn-secondary"
                                    style={{ padding: '4px 12px', height: '28px', fontSize: '0.8rem', marginTop: '0.5rem' }}
                                    onClick={() => {
                                        setAddingItemForCategory(cat.id);
                                        setNewItemName('');
                                        setNewItemQuotaValue(1);
                                        setNewItemPrice(0);
                                    }}
                                >
                                    <Plus size={14} /> Add Item
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
