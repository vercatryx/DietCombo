'use client';

import { useState, useEffect } from 'react';
import { MenuItem, Vendor } from '@/lib/types';
import { addMenuItem, updateMenuItem, deleteMenuItem, uploadMenuItemImage } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, Upload, Loader2, Image as ImageIcon, Utensils } from 'lucide-react';
import styles from './MenuManagement.module.css';
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
import { GripVertical } from 'lucide-react';
import * as actions from '@/lib/actions';
import { DefaultOrderTemplate } from './DefaultOrderTemplate';

type MenuSubTab = 'items' | 'template';

export function MenuManagement() {
    const { getVendors, getMenuItems, invalidateReferenceData } = useDataCache();
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [mainVendor, setMainVendor] = useState<Vendor | null>(null);
    const [activeSubTab, setActiveSubTab] = useState<MenuSubTab>('items');

    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<MenuItem>>({
        name: '',
        value: 0,
        priceEach: 0,
        isActive: true,
        imageUrl: null
    });

    // Image Upload State
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
    const [imgRef, setImgRef] = useState<HTMLImageElement | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [showCropper, setShowCropper] = useState(false);

    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        const { width, height } = e.currentTarget;
        setImgRef(e.currentTarget);
        const newCrop = centerCrop(
            {
                unit: '%',
                width: 90,
                height: 80,
            },
            width,
            height
        );
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

    useEffect(() => {
        async function loadData() {
            const [vData, mData] = await Promise.all([getVendors(), getMenuItems()]);
            setVendors(vData);
            setMenuItems(mData);
            // Get main vendor (first active vendor)
            const main = vData.find(v => v.isActive) || vData[0] || null;
            setMainVendor(main);
        }
        loadData();
    }, [getVendors, getMenuItems]);

    const filteredItems = mainVendor
        ? menuItems.filter(item => item.vendorId === mainVendor.id)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        : [];

    // Dnd Sensors
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            // Find indices
            const oldIndex = filteredItems.findIndex((item) => item.id === active.id);
            const newIndex = filteredItems.findIndex((item) => item.id === over.id);

            if (oldIndex === -1 || newIndex === -1) return;

            // Optimistic update of local state
            // We need to update the global menuItems list, preserving items not in this filtered view
            // const newFilteredItems = arrayMove(filteredItems, oldIndex, newIndex);

            // Re-calculate the whole list is tricky.
            // Simplest: just swap order of the two items locally in the filtered list?
            // Actually arrayMove returns a new array.

            const reorderedFilteredItems = arrayMove(filteredItems, oldIndex, newIndex);

            // Calculate new sortOrder for everyone in this filtered list
            const updates = reorderedFilteredItems.map((item, index) => ({
                id: item.id,
                sortOrder: index
            }));

            // Optimistic Update: Update menuItems state
            const newMenuItems = menuItems.map(item => {
                const update = updates.find(u => u.id === item.id);
                return update ? { ...item, sortOrder: update.sortOrder } : item;
            });
            setMenuItems(newMenuItems);

            // Server Update
            await actions.updateMenuItemOrder(updates);
        }
    };

    function resetForm() {
        setFormData({
            name: '',
            value: 0,
            priceEach: 0,
            isActive: true,
            quotaValue: 1,
            categoryId: '',
            imageUrl: null,
            sortOrder: 0
        });
        setIsCreating(false);
        setEditingId(null);
        setImageSrc(null);
        setShowCropper(false);
    }

    function handleEditInit(item: MenuItem) {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsCreating(false);
        setImageSrc(null); // Reset crop state on edit init
        setShowCropper(false);
        setCompletedCrop(null);
    }



    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const imageDataUrl = await readFile(file);
            setImageSrc(imageDataUrl);
            setShowCropper(true);
        }
    };

    const readFile = (file: File) => {
        return new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(reader.result as string));
            reader.readAsDataURL(file);
        });
    };

    const handleUploadImage = async () => {
        // Use imgRef natural dimensions if possible for better quality, but the util handles scaling
        if (!imageSrc || !completedCrop) return;
        setIsUploading(true);
        try {
            // We need to pass the image element or source. our util takes source url.
            // But standard react-image-crop utils usually take the image element. 
            // My getCroppedImg takes imageSrc string and pixelCrop.
            // Let's verify pixelCrop is correct relative to the image SOURCE dimensions, not displayed dimensions.
            // React-image-crop onComplete gives pixels relative to the displayed image if we're not careful?
            // Actually, if we pass the image DOM element to the util it might be safer, but the util loads a new Image().
            // Wait, getCroppedImg loads `new Image()`. 
            // If the `completedCrop` is based on the *displayed* image size (which might be scaled down via CSS),
            // but `getCroppedImg` loads the *full resolution* image, coordinates will be wrong!
            // FIX: We must scale the crop coordinates.

            let finalCrop = completedCrop;

            if (imgRef) {
                // If the displayed image is scaled, we need to map the crop to natural dimensions
                const scaleX = imgRef.naturalWidth / imgRef.width;
                const scaleY = imgRef.naturalHeight / imgRef.height;
                finalCrop = {
                    ...completedCrop,
                    x: completedCrop.x * scaleX,
                    y: completedCrop.y * scaleY,
                    width: completedCrop.width * scaleX,
                    height: completedCrop.height * scaleY,
                    unit: 'px'
                };
            }

            const croppedImageBlob = await getCroppedImg(imageSrc, finalCrop);
            if (!croppedImageBlob) throw new Error('Failed to crop image');

            const file = new File([croppedImageBlob], "menu-item.jpg", { type: "image/jpeg" });
            const uploadFormData = new FormData();
            uploadFormData.append('file', file);

            const result = await uploadMenuItemImage(uploadFormData);
            if (result.success) {
                setFormData(prev => ({ ...prev, imageUrl: result.url }));
                setShowCropper(false);
                setImageSrc(null);
            }
        } catch (error) {
            console.error('Upload failed', error);
            alert('Failed to upload image. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    async function handleSubmit() {
        if (!mainVendor) return;
        if (!formData.name) return;
        if (!formData.priceEach || formData.priceEach <= 0) {
            alert('Price must be greater than 0');
            return;
        }

        if (editingId) {
            await updateMenuItem(editingId, formData);
        } else {
            await addMenuItem({
                ...formData,
                vendorId: mainVendor.id
            } as Omit<MenuItem, 'id'>);
        }

        invalidateReferenceData(); // Invalidate cache after update/add
        // Refresh items
        const mData = await getMenuItems();
        setMenuItems(mData);
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this menu item?')) {
            const result = await deleteMenuItem(id);
            if (result && !result.success && result.message) {
                alert(result.message);
            }
            invalidateReferenceData(); // Invalidate cache after delete
            const mData = await getMenuItems();
            setMenuItems(mData);
        }
    }

    if (vendors.length === 0) {
        return <div className={styles.emptyState}>No vendors available. Please create a vendor first.</div>;
    }

    if (!mainVendor) {
        return <div className={styles.emptyState}>No active vendor found. Please activate a vendor first.</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.main} style={{ width: '100%' }}>
                {/* Sub-tabs */}
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-lg)', borderBottom: '1px solid var(--border-color)' }}>
                    <button
                        className={`${styles.tab} ${activeSubTab === 'items' ? styles.activeTab : ''}`}
                        onClick={() => setActiveSubTab('items')}
                        style={{
                            padding: 'var(--spacing-sm) var(--spacing-md)',
                            background: 'none',
                            border: 'none',
                            borderBottom: activeSubTab === 'items' ? '2px solid var(--color-primary)' : '2px solid transparent',
                            color: activeSubTab === 'items' ? 'var(--color-primary)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontWeight: activeSubTab === 'items' ? 600 : 400
                        }}
                    >
                        Menu Items
                    </button>
                    <button
                        className={`${styles.tab} ${activeSubTab === 'template' ? styles.activeTab : ''}`}
                        onClick={() => setActiveSubTab('template')}
                        style={{
                            padding: 'var(--spacing-sm) var(--spacing-md)',
                            background: 'none',
                            border: 'none',
                            borderBottom: activeSubTab === 'template' ? '2px solid var(--color-primary)' : '2px solid transparent',
                            color: activeSubTab === 'template' ? 'var(--color-primary)' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontWeight: activeSubTab === 'template' ? 600 : 400
                        }}
                    >
                        Default Order Template
                    </button>
                </div>

                {activeSubTab === 'items' && (
                    <>
                        <div className={styles.header}>
                            <div>
                                <h2 className={styles.title}>Menu Items</h2>
                                <p className={styles.subtitle}>Manage items for {mainVendor.name}</p>
                            </div>
                    {!isCreating && !editingId && (
                        <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                            <Plus size={16} /> Add Item
                        </button>
                    )}
                </div>

                {(isCreating || editingId) && (
                    <div className={styles.formCard}>
                        <h3 className={styles.formTitle}>{editingId ? 'Edit Item' : 'New Item'}</h3>
                        <div className={styles.row}>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Item Name</label>
                                <input
                                    className="input"
                                    value={formData.name}
                                    autoFocus
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className={styles.row}>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Value (Price/Points)</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={formData.value}
                                    onChange={e => setFormData({ ...formData, value: Number(e.target.value) })}
                                />
                            </div>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Price Each</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={formData.priceEach ?? ''}
                                    onChange={e => setFormData({ ...formData, priceEach: Number(e.target.value) || undefined })}
                                />
                            </div>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Sort Order</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={formData.sortOrder}
                                    onChange={e => setFormData({ ...formData, sortOrder: Number(e.target.value) })}
                                />
                            </div>
                        </div>

                        <div className={styles.row}>
                            <div className={styles.formGroup}>
                                <label className="label">Product Image</label>

                                {/* Modal Overlay for Cropper */}
                                {showCropper && imageSrc && (
                                    <div style={{
                                        position: 'fixed',
                                        top: 0,
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                        zIndex: 9999,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '20px'
                                    }}>
                                        <div style={{
                                            backgroundColor: 'white',
                                            padding: '20px',
                                            borderRadius: '8px',
                                            width: '90%',
                                            maxWidth: '800px', // Bigger space as requested
                                            maxHeight: '90vh',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '20px'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600 }}>Crop Image</h3>
                                                <button onClick={() => { setShowCropper(false); setImageSrc(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                                    <X size={24} />
                                                </button>
                                            </div>

                                            <div style={{
                                                maxHeight: '60vh',
                                                overflow: 'auto',
                                                background: '#333',
                                                display: 'flex',
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                                minHeight: '400px'
                                            }}>
                                                <ReactCrop
                                                    crop={crop}
                                                    onChange={(_, percentCrop) => setCrop(percentCrop)}
                                                    onComplete={(c) => setCompletedCrop(c)}
                                                    style={{ maxWidth: '100%' }}
                                                >
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src={imageSrc}
                                                        onLoad={onImageLoad}
                                                        alt="Crop me"
                                                        style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }}
                                                    />
                                                </ReactCrop>
                                            </div>

                                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '10px', borderTop: '1px solid #eee' }}>
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => { setShowCropper(false); setImageSrc(null); }}
                                                    disabled={isUploading}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={handleUploadImage}
                                                    disabled={isUploading}
                                                >
                                                    {isUploading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                                                    {isUploading ? 'Uploading...' : 'Confirm & Upload'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Preview and Upload Button (Always visible when not cropping) */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                    {formData.imageUrl ? (
                                        <div style={{ position: 'relative', width: '120px', height: '120px', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', background: '#f9f9f9' }}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                key={formData.imageUrl} // Force re-render if URL changes
                                                src={formData.imageUrl}
                                                alt="Menu Item Preview"
                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    target.style.display = 'none';
                                                    // Fallback or alert could be added here
                                                    console.error('Image failed to load:', formData.imageUrl);
                                                }}
                                            />
                                            <button
                                                onClick={() => setFormData({ ...formData, imageUrl: null })}
                                                style={{
                                                    position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.6)',
                                                    color: '#fff', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '50%'
                                                }}
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{
                                            width: '120px', height: '120px', border: '2px dashed #ccc', borderRadius: '8px',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc',
                                            flexDirection: 'column', gap: '5px'
                                        }}>
                                            <Utensils size={32} />
                                        </div>
                                    )}

                                    <div>
                                        <input
                                            type="file"
                                            id="file-upload"
                                            accept="image/*"
                                            style={{ display: 'none' }}
                                            onChange={onFileChange}
                                        />
                                        <label htmlFor="file-upload" className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                            <Upload size={16} /> {formData.imageUrl ? 'Change Photo' : 'Upload Photo'}
                                        </label>
                                        <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '5px' }}>
                                            Upload will open a cropping tool.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                Active
                            </label>
                        </div>

                        <div className={styles.formActions}>
                            <button className="btn btn-primary" onClick={handleSubmit}>
                                <Check size={16} /> Save
                            </button>
                            <button className="btn btn-secondary" onClick={resetForm}>
                                <X size={16} /> Cancel
                            </button>
                        </div>
                    </div>
                )}

                <div className={styles.list}>
                    <div className={styles.listHeader}>
                        <span style={{ width: '40px' }}></span> {/* Drag Handle Column */}
                        <span style={{ width: '60px' }}>Image</span>
                        <span style={{ flex: 3 }}>Name</span>
                        <span style={{ flex: 1 }}>Value</span>
                        <span style={{ flex: 1 }}>Price Each</span>
                        <span style={{ flex: 1 }}>Status</span>
                        <span style={{ width: '120px', textAlign: 'right' }}>Actions</span>
                    </div>

                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={filteredItems.map(i => i.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            {filteredItems.map(item => (
                                <SortableMenuItem
                                    key={item.id}
                                    item={item}
                                    onEdit={handleEditInit}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>

                    {filteredItems.length === 0 && !isCreating && (
                        <div className={styles.emptyList}>No items found for this vendor.</div>
                    )}
                </div>
                    </>
                )}

                {activeSubTab === 'template' && (
                    <DefaultOrderTemplate mainVendor={mainVendor} menuItems={filteredItems} />
                )}
            </div>
        </div >
    );
}

function SortableMenuItem({ item, onEdit, onDelete }: { item: MenuItem, onEdit: (i: MenuItem) => void, onDelete: (id: string) => void }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: item.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 1000 : 'auto',
        position: 'relative' as 'relative',
        opacity: isDragging ? 0.5 : 1,
        border: isDragging ? '1px dashed #ccc' : 'none',
        display: 'flex',
        alignItems: 'center',
        padding: '12px 16px',
        borderBottom: '1px solid #eee',
        backgroundColor: 'white'
    };

    return (
        <div ref={setNodeRef} style={style}>
            <div {...attributes} {...listeners} style={{ width: '40px', cursor: 'grab', display: 'flex', alignItems: 'center', color: '#aaa', paddingRight: '10px' }}>
                <GripVertical size={20} />
            </div>
            <div style={{ width: '60px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: '10px' }}>
                {item.imageUrl ? (
                    <img
                        src={item.imageUrl}
                        alt={item.name}
                        style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
                    />
                ) : (
                    <div style={{ width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', borderRadius: '4px' }}>
                        <Utensils size={18} color="#ccc" />
                    </div>
                )}
            </div>
            <span style={{ flex: 3, fontWeight: 500, fontSize: '1.1rem' }}>{item.name}</span>
            <span style={{ flex: 1, fontSize: '1rem' }}>{item.value}</span>
            <span style={{ flex: 1, fontSize: '1rem' }}>{item.priceEach ?? '-'}</span>
            <span style={{ flex: 1 }}>
                {item.isActive ? <span className="badge" style={{ color: 'var(--color-success)', background: 'rgba(34, 197, 94, 0.1)', fontSize: '0.9rem', padding: '4px 12px' }}>Active</span> : <span className="badge" style={{ fontSize: '0.9rem', padding: '4px 12px' }}>Inactive</span>}
            </span>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', width: '120px' }}>
                <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }}
                    onClick={() => onEdit(item)}
                >
                    <Edit2 size={20} />
                </button>
                <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}
                    onClick={() => onDelete(item.id)}
                >
                    <Trash2 size={20} />
                </button>
            </div>
        </div>
    );
}
