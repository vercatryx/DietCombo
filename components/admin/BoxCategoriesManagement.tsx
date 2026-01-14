'use client';

import { useState, useEffect } from 'react';
import { ItemCategory, MenuItem } from '@/lib/types';
import { addCategory, updateCategory, deleteCategory, addMenuItem, updateMenuItem, deleteMenuItem, updateMenuItemOrder, updateCategoryOrder, uploadMenuItemImage } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, Package, Image as ImageIcon, Upload, Loader2, GripVertical } from 'lucide-react';
import styles from './BoxTypeManagement.module.css';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import getCroppedImg from '@/lib/canvasUtils';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function BoxCategoriesManagement() {
    const { getCategories, getMenuItems, invalidateReferenceData } = useDataCache();
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

    // Category Creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategorySetValue, setNewCategorySetValue] = useState<string>('');

    // Item Creation/Editing (Modal-based like MealSelectionManagement)
    const [isEditingItem, setIsEditingItem] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
    const [itemForm, setItemForm] = useState<Partial<MenuItem>>({
        name: '',
        quotaValue: 1,
        priceEach: 0,
        imageUrl: null,
        sortOrder: 0
    });

    // Image Upload State
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
    const [imgRef, setImgRef] = useState<HTMLImageElement | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [showCropper, setShowCropper] = useState(false);

    // Category Editing States
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [tempCategoryName, setTempCategoryName] = useState('');
    const [tempCategorySetValue, setTempCategorySetValue] = useState<string>('');

    // Dnd Sensors
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

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

    // --- ITEM ACTIONS (MODAL) ---
    function openAddItem(categoryId: string) {
        setActiveCategoryId(categoryId);
        setEditingItemId(null);
        setItemForm({ name: '', quotaValue: 1, priceEach: 0, imageUrl: null, sortOrder: 0 });
        setIsEditingItem(true);
        setImageSrc(null);
        setCompletedCrop(null);
    }

    function openEditItem(item: MenuItem) {
        setActiveCategoryId(item.categoryId || null);
        setEditingItemId(item.id);
        setItemForm({ ...item, priceEach: item.priceEach || 0, imageUrl: item.imageUrl || null, sortOrder: item.sortOrder || 0 });
        setIsEditingItem(true);
        setImageSrc(null);
        setCompletedCrop(null);
    }

    async function handleSaveItem() {
        if (!activeCategoryId || !itemForm.name) return;

        if (editingItemId) {
            await updateMenuItem(editingItemId, {
                name: itemForm.name,
                quotaValue: itemForm.quotaValue,
                priceEach: (itemForm.priceEach || 0) > 0 ? itemForm.priceEach : undefined,
                imageUrl: itemForm.imageUrl,
                sortOrder: itemForm.sortOrder
            });
        } else {
            // Get max sortOrder for this category to append at end
            const categoryItems = menuItems.filter(i => i.categoryId === activeCategoryId && (i.vendorId === null || i.vendorId === ''));
            const maxSortOrder = categoryItems.length > 0 
                ? Math.max(...categoryItems.map(i => i.sortOrder || 0))
                : -1;

            await addMenuItem({
                vendorId: '', // Box items are universal
                name: itemForm.name,
                value: 0,
                isActive: true,
                categoryId: activeCategoryId,
                quotaValue: itemForm.quotaValue || 1,
                priceEach: (itemForm.priceEach || 0) > 0 ? itemForm.priceEach : undefined,
                imageUrl: itemForm.imageUrl || null,
                sortOrder: maxSortOrder + 1
            });
        }
        invalidateReferenceData();
        const mData = await getMenuItems();
        setMenuItems(mData);
        setIsEditingItem(false);
    }

    async function handleDeleteItem(id: string) {
        if (confirm('Delete this item?')) {
            await deleteMenuItem(id);
            invalidateReferenceData();
            const mData = await getMenuItems();
            setMenuItems(mData);
        }
    }

    // --- DRAG AND DROP HANDLERS ---
    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;
        if (active.id === over.id) return;

        // Check if we are dragging a CATEGORY or an ITEM
        const isCategory = categories.some(c => c.id === active.id);

        if (isCategory) {
            // Category Reordering
            const sortedCategories = [...categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            const oldIndex = sortedCategories.findIndex(c => c.id === active.id);
            const newIndex = sortedCategories.findIndex(c => c.id === over.id);

            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(sortedCategories, oldIndex, newIndex);

            const updates = reordered.map((cat, index) => ({
                id: cat.id,
                sortOrder: index
            }));

            // Optimistic Update
            const newCategories = categories.map(cat => {
                const update = updates.find(u => u.id === cat.id);
                return update ? { ...cat, sortOrder: update.sortOrder } : cat;
            });
            setCategories(newCategories);

            await updateCategoryOrder(updates);

        } else {
            // Item Reordering
            const activeItem = menuItems.find(i => i.id === active.id);
            const overItem = menuItems.find(i => i.id === over.id);

            if (!activeItem || !overItem) return;
            if (activeItem.categoryId !== overItem.categoryId) return;

            const categoryItems = menuItems
                .filter(i => i.categoryId === activeItem.categoryId && (i.vendorId === null || i.vendorId === ''))
                .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            const oldIndex = categoryItems.findIndex(i => i.id === active.id);
            const newIndex = categoryItems.findIndex(i => i.id === over.id);

            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(categoryItems, oldIndex, newIndex);

            const updates = reordered.map((item, index) => ({
                id: item.id,
                sortOrder: index
            }));

            const newItems = menuItems.map(item => {
                const update = updates.find(u => u.id === item.id);
                return update ? { ...item, sortOrder: update.sortOrder } : item;
            });
            setMenuItems(newItems);

            await updateMenuItemOrder(updates);
        }
    };

    // --- IMAGE HELPERS ---
    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        const { width, height } = e.currentTarget;
        setImgRef(e.currentTarget);
        const newCrop = centerCrop({ unit: '%', width: 90, height: 80 }, width, height);
        setCrop(newCrop);
        setCompletedCrop(convertToPixelCrop(newCrop, width, height));
    }

    function convertToPixelCrop(crop: Crop, imageWidth: number, imageHeight: number): PixelCrop {
        return {
            unit: 'px',
            x: crop.unit === '%' ? (crop.x / 100) * imageWidth : crop.x,
            y: crop.unit === '%' ? (crop.y / 100) * imageHeight : crop.y,
            width: crop.unit === '%' ? (crop.width / 100) * imageWidth : crop.width,
            height: crop.unit === '%' ? (crop.height / 100) * imageHeight : crop.height,
        };
    }

    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.addEventListener('load', () => {
                setImageSrc(reader.result as string);
                setShowCropper(true);
            });
            reader.readAsDataURL(file);
        }
    };

    const handleUploadImage = async () => {
        if (!imageSrc || !completedCrop) return;
        setIsUploading(true);
        try {
            let finalCrop = completedCrop;
            if (imgRef) {
                const scaleX = imgRef.naturalWidth / imgRef.width;
                const scaleY = imgRef.naturalHeight / imgRef.height;
                finalCrop = { ...completedCrop, x: completedCrop.x * scaleX, y: completedCrop.y * scaleY, width: completedCrop.width * scaleX, height: completedCrop.height * scaleY, unit: 'px' };
            }
            const blob = await getCroppedImg(imageSrc, finalCrop);
            if (!blob) throw new Error('Failed to crop');
            const file = new File([blob], "box-item.jpg", { type: "image/jpeg" });
            const formData = new FormData();
            formData.append('file', file);
            const result = await uploadMenuItemImage(formData);
            if (result.success) {
                setItemForm(prev => ({ ...prev, imageUrl: result.url }));
                setShowCropper(false);
                setImageSrc(null);
            }
        } catch (e) {
            console.error(e);
            alert('Upload failed');
        } finally {
            setIsUploading(false);
        }
    };

    // Get box items (items without a vendorId) sorted by sortOrder
    function getBoxItemsForCategory(categoryId: string) {
        return menuItems
            .filter(i => i.categoryId === categoryId && (i.vendorId === null || i.vendorId === ''))
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    }

    // Sortable Item Component
    function SortableItemRow({ item, onEdit, onDelete }: { item: MenuItem, onEdit: () => void, onDelete: () => void }) {
        const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            opacity: isDragging ? 0.5 : 1,
            display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.85rem'
        };

        return (
            <div ref={setNodeRef} style={style}>
                <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: '#aaa', marginRight: '4px' }}>
                    <GripVertical size={14} />
                </div>
                {/* Tiny Image Preview */}
                {item.imageUrl && (
                    <img src={item.imageUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'cover' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span>{item.name}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span>
                {item.priceEach !== undefined && item.priceEach !== null && (
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${item.priceEach.toFixed(2)}</span>
                )}
                <button onClick={onEdit} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-primary)', marginLeft: 'auto' }}><Edit2 size={12} /></button>
                <button onClick={onDelete} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-tertiary)', marginLeft: '4px' }}><X size={12} /></button>
            </div>
        );
    }

    // Sortable Category Row Component
    function SortableCategoryRow({
        cat, items,
        editingCategoryId, tempCategoryName, tempCategorySetValue, setEditingCategoryId, setTempCategoryName, setTempCategorySetValue, handleSaveEditCategory, handleDeleteCategory,
        openEditItem, handleDeleteItem, openAddItem
    }: any) {
        const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });

        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            zIndex: isDragging ? 100 : 'auto',
            opacity: isDragging ? 0.5 : 1,
            background: 'var(--bg-surface-hover)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)'
        };

        const categoryItems = getBoxItemsForCategory(cat.id);

        return (
            <div ref={setNodeRef} style={style}>
                {/* Category Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    {editingCategoryId === cat.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                            <input
                                className="input"
                                value={tempCategoryName}
                                onChange={e => setTempCategoryName(e.target.value)}
                                style={{ flex: 1 }}
                            />
                            <input
                                type="number"
                                className="input"
                                value={tempCategorySetValue}
                                onChange={e => setTempCategorySetValue(e.target.value)}
                                style={{ width: '100px' }}
                                placeholder="Set Value"
                            />
                            <button onClick={handleSaveEditCategory} style={{ color: 'var(--color-success)', background: 'transparent', border: 'none', cursor: 'pointer' }}><Check size={18} /></button>
                            <button onClick={() => setEditingCategoryId(null)} style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: '#aaa' }}>
                                    <GripVertical size={16} />
                                </div>
                                <Package size={18} style={{ color: 'var(--color-primary)' }} />
                                <span style={{ fontWeight: 600, fontSize: '1rem' }}>{cat.name}</span>
                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                                    ({categoryItems.length} items)
                                </span>
                                {cat.setValue !== undefined && cat.setValue !== null && (
                                    <span style={{ fontSize: '0.75rem', background: 'var(--color-primary)', color: '#000', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                                        Set: {cat.setValue}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button onClick={() => {
                                    setEditingCategoryId(cat.id);
                                    setTempCategoryName(cat.name);
                                    setTempCategorySetValue(cat.setValue?.toString() || '');
                                }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}><Edit2 size={16} /></button>
                                <button onClick={() => handleDeleteCategory(cat.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }}><Trash2 size={16} /></button>
                            </div>
                        </>
                    )}
                </div>

                {/* ITEMS */}
                <div style={{ padding: '0.5rem', background: 'var(--bg-app)', borderRadius: '4px' }}>
                    <SortableContext
                        items={categoryItems.map(i => i.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {categoryItems.map((item: MenuItem) => (
                                <SortableItemRow
                                    key={item.id}
                                    item={item}
                                    onEdit={() => openEditItem(item)}
                                    onDelete={() => handleDeleteItem(item.id)}
                                />
                            ))}
                        </div>
                    </SortableContext>

                    <button
                        onClick={() => openAddItem(cat.id)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                        <Plus size={14} /> Add Item
                    </button>
                </div>
            </div>
        );
    }

    // Sort categories by sortOrder
    const sortedCategories = [...categories].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className={styles.container} style={{ display: 'block' }}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>Box Categories & Items</h2>
                        <p className={styles.subtitle}>Configure categories and items for box service. Drag to reorder.</p>
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
                <SortableContext
                    items={sortedCategories.map(c => c.id)}
                    strategy={verticalListSortingStrategy}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {sortedCategories.length === 0 && !isAddingCategory && (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontStyle: 'italic', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                                No categories yet. Add a category to start configuring box items.
                            </div>
                        )}

                        {sortedCategories.map(cat => (
                            <SortableCategoryRow
                                key={cat.id}
                                cat={cat}
                                items={menuItems}
                                editingCategoryId={editingCategoryId}
                                tempCategoryName={tempCategoryName}
                                tempCategorySetValue={tempCategorySetValue}
                                setEditingCategoryId={setEditingCategoryId}
                                setTempCategoryName={setTempCategoryName}
                                setTempCategorySetValue={setTempCategorySetValue}
                                handleSaveEditCategory={handleSaveEditCategory}
                                handleDeleteCategory={handleDeleteCategory}
                                openEditItem={openEditItem}
                                handleDeleteItem={handleDeleteItem}
                                openAddItem={openAddItem}
                            />
                        ))}
                    </div>
                </SortableContext>
            </div>

            {/* Item Edit Modal */}
            {isEditingItem && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        background: 'var(--bg-app)',
                        padding: '1.5rem',
                        borderRadius: '8px',
                        maxWidth: '600px',
                        width: '90%',
                        maxHeight: '90vh',
                        overflow: 'auto'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>
                                {editingItemId ? 'Edit Item' : 'Add Item'}
                            </h3>
                            <button onClick={() => setIsEditingItem(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label className="label">Item Name</label>
                                <input
                                    className="input"
                                    value={itemForm.name || ''}
                                    onChange={e => setItemForm(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="e.g. Apple"
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label className="label">Quota Value</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={itemForm.quotaValue || 1}
                                        onChange={e => setItemForm(prev => ({ ...prev, quotaValue: Number(e.target.value) }))}
                                        min="1"
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label className="label">Price Each</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={itemForm.priceEach || ''}
                                        onChange={e => setItemForm(prev => ({ ...prev, priceEach: parseFloat(e.target.value) || 0 }))}
                                        min="0"
                                        step="0.01"
                                    />
                                </div>
                            </div>

                            {/* Image Upload Section */}
                            <div>
                                <label className="label">Image</label>
                                {itemForm.imageUrl ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
                                        <img src={itemForm.imageUrl} alt="Preview" style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '4px' }} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => setItemForm(prev => ({ ...prev, imageUrl: null }))}
                                        >
                                            Remove Image
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            onChange={onFileChange}
                                            style={{ display: 'none' }}
                                            id="image-upload"
                                        />
                                        <label htmlFor="image-upload" className="btn btn-secondary" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Upload size={16} /> Upload Image
                                        </label>
                                    </div>
                                )}

                                {/* Image Cropper */}
                                {showCropper && imageSrc && (
                                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-surface-hover)', borderRadius: '6px' }}>
                                        <ReactCrop
                                            crop={crop}
                                            onChange={(_, percentCrop) => setCrop(percentCrop)}
                                            onComplete={(c) => setCompletedCrop(c)}
                                            aspect={undefined}
                                        >
                                            <img
                                                ref={setImgRef}
                                                alt="Crop me"
                                                src={imageSrc}
                                                style={{ maxWidth: '100%', maxHeight: '400px' }}
                                                onLoad={onImageLoad}
                                            />
                                        </ReactCrop>
                                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                                            <button
                                                className="btn btn-primary"
                                                onClick={handleUploadImage}
                                                disabled={isUploading || !completedCrop}
                                            >
                                                {isUploading ? <><Loader2 size={16} className="animate-spin" /> Uploading...</> : <><Check size={16} /> Apply Crop</>}
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => {
                                                    setShowCropper(false);
                                                    setImageSrc(null);
                                                    setCrop(undefined);
                                                    setCompletedCrop(null);
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                                <button className="btn btn-secondary" onClick={() => setIsEditingItem(false)}>
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleSaveItem}
                                    disabled={!itemForm.name || (itemForm.priceEach !== undefined && itemForm.priceEach <= 0)}
                                >
                                    {editingItemId ? 'Update' : 'Add'} Item
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DndContext>
    );
}
