'use client';

import { useState, useEffect } from 'react';
import { BoxType, Vendor, BoxQuota, ItemCategory, MenuItem } from '@/lib/types';
import { addBoxType, updateBoxType, deleteBoxType, getBoxQuotas, addBoxQuota, updateBoxQuota, deleteBoxQuota, addCategory, updateCategory, addMenuItem, updateMenuItem, deleteMenuItem } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, Package, Scale, Save } from 'lucide-react';
import styles from './BoxTypeManagement.module.css';

export function BoxTypeManagement() {
    const { getCategories, getMenuItems, getBoxTypes, invalidateReferenceData } = useDataCache();
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [selectedBoxId, setSelectedBoxId] = useState<string>('');

    // Quota State
    const [currentQuotas, setCurrentQuotas] = useState<BoxQuota[]>([]);
    const [newQuotaCategoryId, setNewQuotaCategoryId] = useState('');
    const [newQuotaTarget, setNewQuotaTarget] = useState(1);

    // Box Type Creation
    const [isAddingBoxType, setIsAddingBoxType] = useState(false);
    const [newBoxTypeName, setNewBoxTypeName] = useState('');
    const [newBoxTypePrice, setNewBoxTypePrice] = useState(1);

    // Inline Category Creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

    // Inline Item Creation
    const [newItemName, setNewItemName] = useState('');
    const [newItemQuotaValue, setNewItemQuotaValue] = useState(1);
    const [newItemPrice, setNewItemPrice] = useState<number>(0);
    const [addingItemForCategory, setAddingItemForCategory] = useState<string | null>(null);

    // Editing States
    const [editingQuotaId, setEditingQuotaId] = useState<string | null>(null);
    const [tempQuotaTarget, setTempQuotaTarget] = useState<number>(0);

    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [tempCategoryName, setTempCategoryName] = useState('');

    // Item Editing States
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [tempItemName, setTempItemName] = useState('');
    const [tempItemQuotaValue, setTempItemQuotaValue] = useState<number>(1);
    const [tempItemPrice, setTempItemPrice] = useState<number>(0);

    useEffect(() => {
        loadData();
    }, []);

    // When box type changes, load its quotas
    useEffect(() => {
        if (selectedBoxId) {
            loadBoxQuotas(selectedBoxId);
        } else {
            setCurrentQuotas([]);
        }
    }, [selectedBoxId]);

    async function loadData() {
        const [bData, cData, mData] = await Promise.all([getBoxTypes(), getCategories(), getMenuItems()]);
        setBoxTypes(bData);
        setCategories(cData);
        setMenuItems(mData);
        if (bData.length > 0 && !selectedBoxId) {
            setSelectedBoxId(bData[0].id);
        }
    }

    async function loadBoxQuotas(boxId: string) {
        const qData = await getBoxQuotas(boxId);
        setCurrentQuotas(qData);
    }

    async function handleAddBoxType() {
        if (!newBoxTypeName.trim()) return;
        const newBox = await addBoxType({
            name: newBoxTypeName,
            isActive: true,
            priceEach: newBoxTypePrice
        });
        invalidateReferenceData();
        const bData = await getBoxTypes();
        setBoxTypes(bData);
        setSelectedBoxId(newBox.id);
        setIsAddingBoxType(false);
        setNewBoxTypeName('');
        setNewBoxTypePrice(1);
    }

    async function handleAddQuota() {
        if (!selectedBoxId || !newQuotaCategoryId) return;

        await addBoxQuota({
            boxTypeId: selectedBoxId,
            categoryId: newQuotaCategoryId,
            targetValue: newQuotaTarget
        });
        const qData = await getBoxQuotas(selectedBoxId);
        setCurrentQuotas(qData);
        setNewQuotaCategoryId('');
        setNewQuotaTarget(1);
    }

    async function handleQuickAddCategory() {
        if (!newCategoryName.trim()) return;
        const newCat = await addCategory(newCategoryName);
        invalidateReferenceData(); // Invalidate cache after category creation

        // Refresh categories
        const cData = await getCategories();
        setCategories(cData);
        setNewQuotaCategoryId(newCat.id);
        setIsAddingCategory(false);
        setNewCategoryName('');
    }

    async function handleAddItem(categoryId: string) {
        if (!newItemName.trim()) return;
        if (newItemPrice <= 0) {
            alert('Price must be greater than 0');
            return;
        }

        await addMenuItem({
            vendorId: '', // Box items are universal (empty string instead of null)
            name: newItemName,
            value: 0, // Default value for box items
            isActive: true,
            categoryId: categoryId,
            quotaValue: newItemQuotaValue,
            priceEach: newItemPrice > 0 ? newItemPrice : undefined
        });
        invalidateReferenceData(); // Invalidate cache after menu item creation

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
            invalidateReferenceData(); // Invalidate cache after menu item deletion
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
        invalidateReferenceData(); // Invalidate cache after menu item update

        const mData = await getMenuItems();
        setMenuItems(mData);
        handleCancelEditItem();
    }

    async function handleDeleteQuota(id: string) {
        if (!selectedBoxId) return;
        await deleteBoxQuota(id);
        const qData = await getBoxQuotas(selectedBoxId);
        setCurrentQuotas(qData);
    }

    function handleEditQuota(quotaId: string, currentCategoryName: string, currentTarget: number) {
        setEditingQuotaId(quotaId);
        setTempCategoryName(currentCategoryName);
        setTempQuotaTarget(currentTarget);
    }

    function handleCancelEdit() {
        setEditingQuotaId(null);
        setTempCategoryName('');
        setTempQuotaTarget(0);
    }

    async function handleSaveEdit() {
        if (!editingQuotaId || !selectedBoxId) return;

        // 1. Update quota target
        await updateBoxQuota(editingQuotaId, tempQuotaTarget);

        // 2. Update category name if needed (find category id from quota)
        const quota = currentQuotas.find(q => q.id === editingQuotaId);
        if (quota && quota.categoryId) {
            // Note: This updates the category GLOBALLY for all boxes/items
            await updateCategory(quota.categoryId, tempCategoryName);
        }
        invalidateReferenceData(); // Invalidate cache after quota/category update

        // 3. Refresh
        const qData = await getBoxQuotas(selectedBoxId);
        setCurrentQuotas(qData);
        const cData = await getCategories();
        setCategories(cData);

        handleCancelEdit();
    }

    return (
        <div className={styles.container}>
            <div className={styles.sidebar}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h3 className={styles.sidebarTitle} style={{ margin: 0 }}>Box Types</h3>
                    <button
                        className="btn btn-primary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => setIsAddingBoxType(true)}
                    >
                        <Plus size={14} /> New
                    </button>
                </div>
                {isAddingBoxType && (
                    <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--bg-surface-hover)', borderRadius: '4px', border: '1px solid var(--color-primary)' }}>
                        <input
                            className="input"
                            placeholder="Box Name"
                            value={newBoxTypeName}
                            onChange={e => setNewBoxTypeName(e.target.value)}
                            style={{ marginBottom: '0.5rem', width: '100%', fontSize: '0.85rem' }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Price</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={newBoxTypePrice}
                                    onChange={e => setNewBoxTypePrice(Number(e.target.value))}
                                    style={{ width: '100%', fontSize: '0.85rem' }}
                                />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-primary" style={{ flex: 1, fontSize: '0.8rem' }} onClick={handleAddBoxType}>Save</button>
                            <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.8rem' }} onClick={() => setIsAddingBoxType(false)}>Cancel</button>
                        </div>
                    </div>
                )}
                <div className={styles.vendorList}>
                    {boxTypes.map(b => (
                        <button
                            key={b.id}
                            className={`${styles.vendorBtn} ${selectedBoxId === b.id ? styles.activeVendor : ''}`}
                            onClick={() => setSelectedBoxId(b.id)}
                        >
                            {b.name}
                            <span style={{ fontSize: '0.75rem', opacity: 0.7, marginLeft: '0.5rem' }}>${b.priceEach}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.main}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>Box Configuration</h2>
                        <p className={styles.subtitle}>Configure box contents for {boxTypes.find(b => b.id === selectedBoxId)?.name}</p>
                    </div>
                </div>

                {/* Quota Management Section - Always Visible for Selected Box */}
                {selectedBoxId && (
                    <div className={styles.quotaSection} style={{ marginTop: '0', paddingTop: '0' }}>
                        <div className={styles.quotaList} style={{ marginBottom: '1rem' }}>
                            {currentQuotas.map(q => {
                                const cat = categories.find(c => c.id === q.categoryId);
                                return (
                                    <div key={q.id} style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                            {editingQuotaId === q.id ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                                    <input
                                                        className="input"
                                                        value={tempCategoryName}
                                                        onChange={e => setTempCategoryName(e.target.value)}
                                                        style={{ fontSize: '0.95rem', padding: '4px', width: '150px' }}
                                                        placeholder="Category Name"
                                                    />
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Target:</span>
                                                        <input
                                                            type="number"
                                                            className="input"
                                                            value={tempQuotaTarget}
                                                            onChange={e => setTempQuotaTarget(Number(e.target.value))}
                                                            style={{ fontSize: '0.85rem', padding: '4px', width: '60px' }}
                                                        />
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                        <button
                                                            onClick={handleSaveEdit}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-success)' }}
                                                            title="Save"
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                        <button
                                                            onClick={handleCancelEdit}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                                            title="Cancel"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{cat?.name || 'Unknown Category'}</span>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Target: <strong style={{ color: 'var(--text-primary)' }}>{q.targetValue}</strong></span>
                                                        <button
                                                            onClick={() => handleEditQuota(q.id, cat?.name || '', q.targetValue)}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)' }}
                                                            title="Edit Rule"
                                                        >
                                                            <Edit2 size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteQuota(q.id)}
                                                            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-danger)' }}
                                                            title="Remove Rule"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        {/* Inline Item Management */}
                                        <div style={{ padding: '0.5rem', background: 'var(--bg-app)', borderRadius: '4px' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                {menuItems.filter(i => i.categoryId === q.categoryId && (i.vendorId === null || i.vendorId === '')).map(item => (
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
                                                                placeholder="Quota"
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
                                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
                                                            <span>{item.name}</span>
                                                            <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span>
                                                            {item.priceEach !== undefined && item.priceEach !== null && (
                                                                <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>${item.priceEach.toFixed(2)}</span>
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
                                                {menuItems.filter(i => i.categoryId === q.categoryId && (i.vendorId === null || i.vendorId === '')).length === 0 && (
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No items in this category yet.</span>
                                                )}
                                            </div>

                                            {addingItemForCategory === q.categoryId ? (
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                                    <input
                                                        placeholder="Item Name (e.g. Apple)"
                                                        className="input"
                                                        autoFocus
                                                        style={{ padding: '2px 6px', fontSize: '0.8rem', height: '24px', flex: '1 1 150px', minWidth: '120px' }}
                                                        value={newItemName}
                                                        onChange={e => setNewItemName(e.target.value)}
                                                        onKeyDown={e => e.key === 'Enter' && handleAddItem(q.categoryId)}
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Quota"
                                                        className="input"
                                                        style={{ padding: '2px 6px', fontSize: '0.8rem', width: '60px', height: '24px' }}
                                                        value={newItemQuotaValue}
                                                        onChange={e => setNewItemQuotaValue(Number(e.target.value))}
                                                        min="1"
                                                    />
                                                    <input
                                                        type="number"
                                                        placeholder="Price"
                                                        className="input"
                                                        style={{ padding: '2px 6px', fontSize: '0.8rem', width: '70px', height: '24px' }}
                                                        value={newItemPrice || ''}
                                                        onChange={e => setNewItemPrice(parseFloat(e.target.value) || 0)}
                                                        min="0"
                                                        step="0.01"
                                                    />
                                                    <button className="btn btn-primary" style={{ padding: '2px 8px', height: '24px', fontSize: '0.75rem' }} onClick={() => handleAddItem(q.categoryId)}>Add</button>
                                                    <button className="btn btn-secondary" style={{ padding: '2px 8px', height: '24px', fontSize: '0.75rem' }} onClick={() => {
                                                        setAddingItemForCategory(null);
                                                        setNewItemName('');
                                                        setNewItemQuotaValue(1);
                                                        setNewItemPrice(0);
                                                    }}>Cancel</button>
                                                </div>
                                            ) : (
                                                <button
                                                    className="btn btn-secondary"
                                                    style={{ padding: '2px 8px', height: '24px', fontSize: '0.75rem', marginTop: '4px' }}
                                                    onClick={() => {
                                                        setAddingItemForCategory(q.categoryId);
                                                        setNewItemName('');
                                                        setNewItemQuotaValue(1);
                                                        setNewItemPrice(0);
                                                    }}
                                                >
                                                    <Plus size={12} /> Add Item
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {currentQuotas.length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '1rem', border: '1px dashed var(--border-color)', borderRadius: '6px', textAlign: 'center' }}>No configuration logic defined. Add a Category Rule below to start.</div>}
                        </div>

                        <div style={{ background: 'var(--bg-surface)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                            {!isAddingCategory ? (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                                    <div style={{ flex: 2 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Category</label>
                                        <select
                                            className="select"
                                            style={{
                                                fontSize: '0.85rem',
                                                padding: '8px',
                                                width: '100%',
                                                backgroundColor: 'var(--bg-app)',
                                                color: 'var(--text-primary)',
                                                borderColor: 'var(--border-color)'
                                            }}
                                            value={newQuotaCategoryId}
                                            onChange={e => {
                                                if (e.target.value === 'NEW') {
                                                    setIsAddingCategory(true);
                                                    setNewQuotaCategoryId('');
                                                } else {
                                                    setNewQuotaCategoryId(e.target.value);
                                                }
                                            }}
                                        >
                                            <option value="">-- Select Category --</option>
                                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                            <option value="NEW" style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>+ Create New Category</option>
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.35rem', color: 'var(--text-secondary)' }}>Qty</label>
                                        <input
                                            type="number"
                                            className="input"
                                            style={{ fontSize: '0.85rem', padding: '8px' }}
                                            value={newQuotaTarget}
                                            onChange={e => setNewQuotaTarget(Number(e.target.value))}
                                        />
                                    </div>
                                    <button
                                        className="btn btn-primary"
                                        style={{ padding: '8px 16px', fontSize: '0.85rem', height: '38px' }}
                                        onClick={handleAddQuota}
                                        disabled={!newQuotaCategoryId}
                                    >
                                        <Plus size={14} /> Add Rule
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', animation: 'fadeIn 0.2s' }}>
                                    <div style={{ flex: 3 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', marginBottom: '0.35rem', color: 'var(--color-primary)' }}>New Category Name</label>
                                        <input
                                            className="input"
                                            autoFocus
                                            placeholder="e.g., Dairy"
                                            value={newCategoryName}
                                            onChange={e => setNewCategoryName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleQuickAddCategory()}
                                        />
                                    </div>
                                    <button className="btn btn-primary" onClick={handleQuickAddCategory}>Create</button>
                                    <button className="btn btn-secondary" onClick={() => setIsAddingCategory(false)}>Cancel</button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
