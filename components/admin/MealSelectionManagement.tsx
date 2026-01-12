'use client';

import { useState, useEffect } from 'react';
import { MealCategory, MealItem } from '@/lib/types';
import { getMealCategories, addMealCategory, updateMealCategory, deleteMealCategory, getMealItems, addMealItem, updateMealItem, deleteMealItem, deleteMealType, uploadMenuItemImage, updateMealItemOrder, updateMealCategoryOrder } from '@/lib/actions';
import { Plus, Edit2, Trash2, X, Check, Utensils, Image as ImageIcon, Upload, Loader2, GripVertical } from 'lucide-react';
import styles from './BoxTypeManagement.module.css'; // Reusing styles
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

export function MealSelectionManagement() {
    const [categories, setCategories] = useState<MealCategory[]>([]);
    const [items, setItems] = useState<MealItem[]>([]);
    const [activeMealType, setActiveMealType] = useState<string>('Breakfast');
    const [mealTypes, setMealTypes] = useState<string[]>([]);

    // Category Creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategorySetValue, setNewCategorySetValue] = useState<string>('');

    // Category Editing
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [tempCategoryName, setTempCategoryName] = useState('');
    const [tempCategorySetValue, setTempCategorySetValue] = useState<string>('');

    // Item Creation/Editing (Now using common state for Modal)
    const [isEditingItem, setIsEditingItem] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null); // To know which category we are adding to

    const [itemForm, setItemForm] = useState<Partial<MealItem>>({
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
        const [cData, iData] = await Promise.all([getMealCategories(), getMealItems()]);
        setCategories(cData);
        setItems(iData);

        // Extract unique meal types from data
        const existingTypes = Array.from(new Set(cData.map(c => c.mealType)));

        // If nothing exists, default to standards for a better Empty State experience
        const defaultTypes = ['Breakfast', 'Lunch', 'Dinner'];
        const allTypes = existingTypes.length > 0
            ? existingTypes.sort((a, b) => defaultTypes.indexOf(a) - defaultTypes.indexOf(b))
            : defaultTypes;

        setMealTypes(allTypes);

        // Ensure active tab is valid
        if (!allTypes.includes(activeMealType) && allTypes.length > 0) {
            setActiveMealType(allTypes[0]);
        }
    }

    // --- MEAL TYPE MANAGEMENT ---
    function handleAddMealType() {
        const name = prompt("Enter new Meal Type name (e.g. 'Snack'):");
        if (name && name.trim()) {
            setMealTypes(prev => Array.from(new Set([...prev, name.trim()])));
            setActiveMealType(name.trim());
        }
    }

    async function handleDeleteMealType(type: string) {
        if (confirm(`Are you sure you want to delete '${type}'? This will remove ALL categories and items associated with it.`)) {
            await deleteMealType(type);
            await loadData();

            // Allow deleting defaults from the UI list if the user explicitly actioned it
            setMealTypes(prev => prev.filter(t => t !== type));
            if (activeMealType === type) {
                setActiveMealType(mealTypes.find(t => t !== type) || 'Breakfast');
            }
        }
    }

    // --- CATEGORY ACTIONS ---
    async function handleAddCategory() {
        if (!newCategoryName.trim()) return;
        const setValue = newCategorySetValue.trim() === '' ? null : parseInt(newCategorySetValue, 10);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }

        await addMealCategory(activeMealType, newCategoryName, setValue);
        await loadData();

        setIsAddingCategory(false);
        setNewCategoryName('');
        setNewCategorySetValue('');
    }

    async function handleDeleteCategory(id: string) {
        const hasItems = items.some(i => i.categoryId === id);
        if (hasItems) {
            alert('Cannot delete category with items. Remove items first.');
            return;
        }
        if (confirm('Delete this category?')) {
            await deleteMealCategory(id);
            await loadData();
        }
    }

    async function handleUpdateCategory() {
        if (!editingCategoryId || !tempCategoryName.trim()) return;
        const setValue = tempCategorySetValue.trim() === '' ? null : parseInt(tempCategorySetValue, 10);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }
        await updateMealCategory(editingCategoryId, tempCategoryName, setValue);
        await loadData();
        setEditingCategoryId(null);
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

    function openEditItem(item: MealItem) {
        setActiveCategoryId(item.categoryId);
        setEditingItemId(item.id);
        setItemForm({ ...item, priceEach: item.priceEach || 0 });
        setIsEditingItem(true);
        setImageSrc(null);
        setCompletedCrop(null);
    }

    async function handleSaveItem() {
        if (!activeCategoryId || !itemForm.name) return;

        if (editingItemId) {
            await updateMealItem(editingItemId, {
                name: itemForm.name,
                quotaValue: itemForm.quotaValue,
                priceEach: (itemForm.priceEach || 0) > 0 ? itemForm.priceEach : undefined,
                imageUrl: itemForm.imageUrl,
                sortOrder: itemForm.sortOrder
            });
        } else {
            await addMealItem({
                categoryId: activeCategoryId,
                name: itemForm.name,
                quotaValue: itemForm.quotaValue || 1,
                priceEach: (itemForm.priceEach || 0) > 0 ? itemForm.priceEach : undefined,
                isActive: true,
                imageUrl: itemForm.imageUrl,
                sortOrder: itemForm.sortOrder
            });
        }
        await loadData();
        setIsEditingItem(false);
    }

    async function handleDeleteItem(id: string) {
        if (confirm('Delete this item?')) {
            await deleteMealItem(id);
            await loadData();
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
            const currentTypeCategories = currentCategories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            const oldIndex = currentTypeCategories.findIndex(c => c.id === active.id);
            const newIndex = currentTypeCategories.findIndex(c => c.id === over.id);

            if (oldIndex === -1 || newIndex === -1) return;

            const reordered = arrayMove(currentTypeCategories, oldIndex, newIndex);

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

            await updateMealCategoryOrder(updates);

        } else {
            // Item Reordering (Existing Logic)
            const activeItem = items.find(i => i.id === active.id);
            const overItem = items.find(i => i.id === over.id);

            if (!activeItem || !overItem) return;
            if (activeItem.categoryId !== overItem.categoryId) return;

            const categoryItems = items.filter(i => i.categoryId === activeItem.categoryId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
            const oldIndex = categoryItems.findIndex(i => i.id === active.id);
            const newIndex = categoryItems.findIndex(i => i.id === over.id);

            const reordered = arrayMove(categoryItems, oldIndex, newIndex);

            const updates = reordered.map((item, index) => ({
                id: item.id,
                sortOrder: index
            }));

            const newItems = items.map(item => {
                const update = updates.find(u => u.id === item.id);
                return update ? { ...item, sortOrder: update.sortOrder } : item;
            });
            setItems(newItems);

            await updateMealItemOrder(updates);
        }
    };


    // --- IMAGE HELPERS (Copied from MenuManagement) ---
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
            const file = new File([blob], "meal-item.jpg", { type: "image/jpeg" });
            const formData = new FormData();
            formData.append('file', file);
            const result = await uploadMenuItemImage(formData); // Reusing same bucket/logic
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

    // --- RENDER HELPERS ---
    const currentCategories = categories.filter(c => c.mealType === activeMealType);

    // Sortable Item Component
    function SortableItemRow({ item, onEdit, onDelete }: { item: MealItem, onEdit: () => void, onDelete: () => void }) {
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
                    <img src={item.imageUrl} alt="" style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'cover' }} />
                )}
                <span>{item.name}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue})</span>
                {item.priceEach && <span style={{ fontWeight: 600 }}>${item.priceEach.toFixed(2)}</span>}
                <button onClick={onEdit} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-primary)', marginLeft: 'auto' }}><Edit2 size={12} /></button>
                <button onClick={onDelete} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-tertiary)', marginLeft: '4px' }}><X size={12} /></button>
            </div>
        );
    }

    // Sortable Category Row Component
    function SortableCategoryRow({
        cat, items, activeMealType,
        editingCategoryId, tempCategoryName, tempCategorySetValue, setEditingCategoryId, setTempCategoryName, setTempCategorySetValue, handleUpdateCategory, handleDeleteCategory,
        isEditingItem, editingItemId, openEditItem, handleDeleteItem, openAddItem
    }: any) {
        const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });

        const style = {
            transform: CSS.Transform.toString(transform),
            transition,
            zIndex: isDragging ? 100 : 'auto',
            opacity: isDragging ? 0.5 : 1,
            background: 'var(--bg-surface-hover)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)'
        };

        return (
            <div ref={setNodeRef} style={style}>
                {/* Category Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    {editingCategoryId === cat.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                            {/* No drag handle while editing */}
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
                            <button onClick={handleUpdateCategory} style={{ color: 'var(--color-success)', background: 'transparent', border: 'none', cursor: 'pointer' }}><Check size={18} /></button>
                            <button onClick={() => setEditingCategoryId(null)} style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <div {...attributes} {...listeners} style={{ cursor: 'grab', display: 'flex', alignItems: 'center', color: '#aaa' }}>
                                    <GripVertical size={16} />
                                </div>
                                <span style={{ fontWeight: 600, fontSize: '1rem' }}>{cat.name}</span>
                                {cat.setValue && (
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
                        items={items.filter((i: any) => i.categoryId === cat.id).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((i: any) => i.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {items.filter((i: any) => i.categoryId === cat.id).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((item: any) => (
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

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className={styles.container} style={{ flexDirection: 'column', display: 'flex', width: '100%', alignItems: 'stretch' }}>

                <div className={styles.header} style={{ marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                    <div>
                        <h2 className={styles.title}>Meal Selection Management</h2>
                        <p className={styles.subtitle}>Configure meals, categories, and items.</p>
                    </div>
                </div>

                {/* MEAL TYPE TABS - Compact horizontal scroll if needed */}
                <div style={{
                    display: 'flex',
                    gap: '0.5rem',
                    marginBottom: '1rem',
                    overflowX: 'auto',
                    paddingBottom: '0.5rem',
                    borderBottom: '1px solid var(--border-color)',
                    alignItems: 'center'
                }}>
                    {mealTypes.map(type => {
                        const isActive = activeMealType === type;
                        return (
                            <div
                                key={type}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.5rem 1rem',
                                    borderRadius: '9999px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    backgroundColor: isActive ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.05)',
                                    color: isActive ? '#000000' : 'var(--text-secondary)',
                                    fontWeight: isActive ? 600 : 400,
                                    border: isActive ? '1px solid var(--color-primary)' : '1px solid transparent',
                                }}
                                onClick={() => setActiveMealType(type)}
                                onMouseEnter={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                                        e.currentTarget.style.color = 'var(--text-primary)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!isActive) {
                                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                                        e.currentTarget.style.color = 'var(--text-secondary)';
                                    }
                                }}
                            >
                                <Utensils size={14} />
                                <span>{type}</span>
                                {isActive && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteMealType(type);
                                        }}
                                        style={{
                                            marginLeft: '0.5rem',
                                            padding: '2px',
                                            borderRadius: '50%',
                                            border: 'none',
                                            background: 'rgba(0,0,0,0.1)',
                                            color: '#000',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center'
                                        }}
                                        title={`Delete ${type}`}
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    <button
                        onClick={handleAddMealType}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.5rem 1rem',
                            borderRadius: '9999px',
                            border: '1px dashed var(--text-tertiary)',
                            background: 'transparent',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontSize: '0.875rem',
                            transition: 'all 0.2s',
                            whiteSpace: 'nowrap'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = 'var(--text-primary)';
                            e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--text-tertiary)';
                            e.currentTarget.style.color = 'var(--text-secondary)';
                        }}
                    >
                        <Plus size={14} /> Add Type
                    </button>
                </div>

                {/* TOOLBAR */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>{activeMealType} Menu</h3>
                    <button
                        className="btn btn-primary"
                        onClick={() => setIsAddingCategory(true)}
                    >
                        <Plus size={16} /> Add Category
                    </button>
                </div>

                {/* ADD CATEGORY FORM */}
                {isAddingCategory && (
                    <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-surface-hover)', borderRadius: '6px', border: '1px solid var(--color-primary)' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                                className="input"
                                placeholder="Category Name (e.g., Starters, Main Course)"
                                value={newCategoryName}
                                onChange={e => setNewCategoryName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                autoFocus
                                style={{ flex: 1 }}
                            />
                            <input
                                type="number"
                                className="input"
                                placeholder="Set Value (opt)"
                                value={newCategorySetValue}
                                onChange={e => setNewCategorySetValue(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                min="1"
                                style={{ width: '120px' }}
                                title="Required quota value for this category"
                            />
                            <button className="btn btn-primary" onClick={handleAddCategory}><Check size={16} /> Save</button>
                            <button className="btn btn-secondary" onClick={() => { setIsAddingCategory(false); setNewCategoryName(''); setNewCategorySetValue(''); }}><X size={16} /></button>
                        </div>
                    </div>
                )}

                {/* CATEGORY LIST */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {currentCategories.length === 0 && !isAddingCategory && (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontStyle: 'italic', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                            No categories for {activeMealType}. Add one to start.
                        </div>
                    )}

                    <SortableContext
                        items={currentCategories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(c => c.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {currentCategories.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map(cat => (
                            <SortableCategoryRow
                                key={cat.id}
                                cat={cat}
                                items={items}
                                activeMealType={activeMealType}

                                // Edit props
                                editingCategoryId={editingCategoryId}
                                tempCategoryName={tempCategoryName}
                                tempCategorySetValue={tempCategorySetValue}
                                setEditingCategoryId={setEditingCategoryId}
                                setTempCategoryName={setTempCategoryName}
                                setTempCategorySetValue={setTempCategorySetValue}
                                handleUpdateCategory={handleUpdateCategory}
                                handleDeleteCategory={handleDeleteCategory}

                                // Item props
                                isEditingItem={isEditingItem}
                                editingItemId={editingItemId}
                                openEditItem={openEditItem}
                                handleDeleteItem={handleDeleteItem}
                                openAddItem={openAddItem}
                                handleSaveItem={handleSaveItem} // Not needed here directly but contextually relevant
                            />
                        ))}
                    </SortableContext>
                </div>

                {/* ITEM MODAL */}
                {isEditingItem && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                        <div style={{ background: 'var(--bg-surface)', padding: '20px', borderRadius: '8px', width: '500px', maxWidth: '90%', border: '1px solid var(--border-color)' }}>
                            <h3 style={{ marginBottom: '16px' }}>{editingItemId ? 'Edit Item' : 'New Item'}</h3>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div>
                                    <label className="label">Name</label>
                                    <input className="input" value={itemForm.name} onChange={e => setItemForm({ ...itemForm, name: e.target.value })} autoFocus />
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label className="label">Quota Value</label>
                                        <input type="number" className="input" value={itemForm.quotaValue} onChange={e => setItemForm({ ...itemForm, quotaValue: Number(e.target.value) })} min="1" />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label className="label">Price ($)</label>
                                        <input type="number" className="input" value={itemForm.priceEach} onChange={e => setItemForm({ ...itemForm, priceEach: Number(e.target.value) })} step="0.01" />
                                    </div>
                                </div>
                                <div>
                                    <label className="label">Sort Order</label>
                                    <input type="number" className="input" value={itemForm.sortOrder} onChange={e => setItemForm({ ...itemForm, sortOrder: Number(e.target.value) })} />
                                </div>

                                {/* IMAGE UPLOADER */}
                                <div>
                                    <label className="label">Image</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        {itemForm.imageUrl ? (
                                            <div style={{ width: '60px', height: '60px', position: 'relative' }}>
                                                <img src={itemForm.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                                                <button onClick={() => setItemForm({ ...itemForm, imageUrl: null })} style={{ position: 'absolute', top: -5, right: -5, background: 'red', color: 'white', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer' }}><X size={10} /></button>
                                            </div>
                                        ) : (
                                            <div style={{ width: '60px', height: '60px', background: '#333', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <ImageIcon size={20} color="#666" />
                                            </div>
                                        )}
                                        <input type="file" id="meal-item-upload" style={{ display: 'none' }} accept="image/*" onChange={onFileChange} />
                                        <label htmlFor="meal-item-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}><Upload size={14} /> Upload</label>
                                    </div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                                <button className="btn btn-secondary" onClick={() => setIsEditingItem(false)}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleSaveItem}>Save</button>
                            </div>
                        </div>
                    </div>
                )}

                {/* CROPPER OVERLAY */}
                {showCropper && imageSrc && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                        <div style={{ background: 'white', padding: '20px', borderRadius: '8px', maxWidth: '600px', width: '100%', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <h3>Crop Image</h3>
                            <div style={{ maxHeight: '60vh', overflow: 'auto', display: 'flex', justifyContent: 'center', background: '#333' }}>
                                <ReactCrop crop={crop} onChange={(_, c) => setCrop(c)} onComplete={c => setCompletedCrop(c)}>
                                    <img src={imageSrc} onLoad={onImageLoad} alt="" style={{ maxHeight: '60vh' }} />
                                </ReactCrop>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                <button className="btn btn-secondary" onClick={() => { setShowCropper(false); setImageSrc(null); }}>Cancel</button>
                                <button className="btn btn-primary" onClick={handleUploadImage} disabled={isUploading}>
                                    {isUploading ? 'Uploading...' : 'Confirm'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </DndContext>
    );
}
