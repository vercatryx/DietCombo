'use client';

import { useState, useEffect } from 'react';
import { Vendor, MenuItem, OrderConfiguration, BoxType, BoxConfiguration } from '@/lib/types';
import { getDefaultOrderTemplate, saveDefaultOrderTemplate } from '@/lib/actions';
import { Save, Loader2, Plus, Trash2, Package } from 'lucide-react';
import styles from './DefaultOrderTemplate.module.css';
import { useDataCache } from '@/lib/data-cache';

interface Props {
    mainVendor: Vendor;
    menuItems: MenuItem[];
}

export function DefaultOrderTemplate({ mainVendor, menuItems }: Props) {
    const { getBoxTypes, getVendors } = useDataCache();
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [template, setTemplate] = useState<OrderConfiguration>({
        serviceType: 'Food',
        vendorSelections: [{ vendorId: mainVendor.id, items: {} }]
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        async function loadData() {
            const [bt, v] = await Promise.all([getBoxTypes(), getVendors()]);
            setBoxTypes(bt);
            setVendors(v);
            setDataLoaded(true);
        }
        loadData();
    }, [getBoxTypes, getVendors]);

    useEffect(() => {
        // Only load template after reference data is loaded
        if (dataLoaded) {
            loadTemplate();
        }
    }, [mainVendor.id, dataLoaded]);

    async function loadTemplate() {
        setLoading(true);
        try {
            const saved = await getDefaultOrderTemplate();
            if (saved) {
                // Ensure proper initialization based on service type
                if (saved.serviceType === 'Food') {
                    // Ensure vendorId matches main vendor for Food orders
                    if (saved.vendorSelections && saved.vendorSelections.length > 0) {
                        saved.vendorSelections[0].vendorId = mainVendor.id;
                    } else {
                        saved.vendorSelections = [{ vendorId: mainVendor.id, items: {} }];
                    }
                } else if (saved.serviceType === 'Boxes') {
                    // Ensure boxes array exists
                    if (!saved.boxes || saved.boxes.length === 0) {
                        const firstBoxType = boxTypes.find(bt => bt.isActive) || boxTypes[0];
                        saved.boxes = firstBoxType ? [{
                            boxNumber: 1,
                            boxTypeId: firstBoxType.id,
                            items: {},
                            itemPrices: {},
                            itemNotes: {}
                        }] : [];
                    }
                } else if (saved.serviceType === 'Custom') {
                    // Ensure customItems array exists
                    if (!saved.customItems) {
                        saved.customItems = [];
                    }
                    // Ensure vendorId is set
                    if (!saved.vendorId && vendors.length > 0) {
                        saved.vendorId = vendors.find(v => v.isActive)?.id || vendors[0]?.id || '';
                    }
                }
                setTemplate(saved);
            } else {
                // Initialize with default structure based on service type
                setTemplate({
                    serviceType: 'Food',
                    vendorSelections: [{ vendorId: mainVendor.id, items: {} }]
                });
            }
        } catch (error) {
            console.error('Error loading template:', error);
            setMessage('Error loading template');
            setTimeout(() => setMessage(null), 3000);
        } finally {
            setLoading(false);
        }
    }

    async function handleSave() {
        setSaving(true);
        setMessage(null);
        try {
            const templateToSave = { ...template };
            
            // Clean and validate based on service type
            if (templateToSave.serviceType === 'Food') {
                // Ensure vendorId matches main vendor for Food orders
                templateToSave.vendorSelections = templateToSave.vendorSelections?.map((vs, index) => 
                    index === 0 ? { ...vs, vendorId: mainVendor.id } : vs
                ) || [{ vendorId: mainVendor.id, items: {} }];
                // Remove boxes and customItems for Food
                delete templateToSave.boxes;
                delete templateToSave.customItems;
                delete templateToSave.vendorId;
            } else if (templateToSave.serviceType === 'Boxes') {
                // Ensure boxes array is valid
                if (!templateToSave.boxes || templateToSave.boxes.length === 0) {
                    const firstBoxType = boxTypes.find(bt => bt.isActive) || boxTypes[0];
                    if (firstBoxType) {
                        templateToSave.boxes = [{
                            boxNumber: 1,
                            boxTypeId: firstBoxType.id,
                            items: {},
                            itemPrices: {},
                            itemNotes: {}
                        }];
                    } else {
                        templateToSave.boxes = [];
                    }
                }
                // Remove Food and Custom fields
                delete templateToSave.vendorSelections;
                delete templateToSave.customItems;
            } else if (templateToSave.serviceType === 'Custom') {
                // Ensure customItems array exists and is valid
                if (!templateToSave.customItems) {
                    templateToSave.customItems = [];
                }
                // Filter out empty items
                templateToSave.customItems = templateToSave.customItems.filter(
                    item => item.name && item.name.trim() !== ''
                );
                // Ensure vendorId is set
                if (!templateToSave.vendorId && vendors.length > 0) {
                    templateToSave.vendorId = vendors.find(v => v.isActive)?.id || vendors[0]?.id || '';
                }
                // Remove Food and Boxes fields
                delete templateToSave.vendorSelections;
                delete templateToSave.boxes;
            }
            
            await saveDefaultOrderTemplate(templateToSave);
            setTemplate(templateToSave);
            setMessage('Default order template saved successfully!');
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error('Error saving template:', error);
            setMessage('Error saving template');
            setTimeout(() => setMessage(null), 3000);
        } finally {
            setSaving(false);
        }
    }

    function updateItemQuantity(itemId: string, quantity: number) {
        const newItems = { ...template.vendorSelections?.[0]?.items || {} };
        if (quantity > 0) {
            newItems[itemId] = quantity;
        } else {
            delete newItems[itemId];
        }
        
        setTemplate({
            ...template,
            vendorSelections: [{
                vendorId: mainVendor.id,
                items: newItems
            }]
        });
    }

    function handleServiceTypeChange(newServiceType: string) {
        // Initialize appropriate structure based on service type
        if (newServiceType === 'Food') {
            setTemplate({
                serviceType: 'Food',
                vendorSelections: [{ vendorId: mainVendor.id, items: {} }]
            });
        } else if (newServiceType === 'Boxes') {
            const firstBoxType = boxTypes.find(bt => bt.isActive) || boxTypes[0];
            setTemplate({
                serviceType: 'Boxes',
                boxes: firstBoxType ? [{
                    boxNumber: 1,
                    boxTypeId: firstBoxType.id,
                    items: {},
                    itemPrices: {},
                    itemNotes: {}
                }] : []
            });
        } else if (newServiceType === 'Custom') {
            const defaultVendor = vendors.find(v => v.isActive) || vendors[0];
            setTemplate({
                serviceType: 'Custom',
                vendorId: defaultVendor?.id || '',
                customItems: []
            });
        } else {
            setTemplate({
                serviceType: newServiceType as any
            });
        }
    }

    // Box management functions
    function addBox() {
        const currentBoxes = template.boxes || [];
        const nextBoxNumber = currentBoxes.length + 1;
        const firstBoxType = boxTypes.find(bt => bt.isActive) || boxTypes[0];
        
        if (!firstBoxType) {
            setMessage('No box types available. Please create a box type first.');
            setTimeout(() => setMessage(null), 3000);
            return;
        }

        const newBox: BoxConfiguration = {
            boxNumber: nextBoxNumber,
            boxTypeId: firstBoxType.id,
            items: {},
            itemPrices: {},
            itemNotes: {}
        };

        setTemplate({
            ...template,
            boxes: [...currentBoxes, newBox]
        });
    }

    function removeBox(boxNumber: number) {
        const updatedBoxes = (template.boxes || [])
            .filter(b => b.boxNumber !== boxNumber)
            .map((b, index) => ({ ...b, boxNumber: index + 1 })); // Renumber

        setTemplate({
            ...template,
            boxes: updatedBoxes
        });
    }

    function updateBoxItem(boxNumber: number, itemId: string, quantity: number) {
        const updatedBoxes = (template.boxes || []).map(box => {
            if (box.boxNumber !== boxNumber) return box;
            const newItems = { ...(box.items || {}) };
            if (quantity > 0) {
                newItems[itemId] = quantity;
            } else {
                delete newItems[itemId];
            }
            return { ...box, items: newItems };
        });

        setTemplate({
            ...template,
            boxes: updatedBoxes
        });
    }

    function updateBoxType(boxNumber: number, boxTypeId: string) {
        const updatedBoxes = (template.boxes || []).map(box => {
            if (box.boxNumber !== boxNumber) return box;
            return { ...box, boxTypeId };
        });

        setTemplate({
            ...template,
            boxes: updatedBoxes
        });
    }

    // Custom items management functions
    function addCustomItem() {
        const customItems = template.customItems || [];
        setTemplate({
            ...template,
            customItems: [...customItems, { name: '', price: 0, quantity: 1 }]
        });
    }

    function removeCustomItem(index: number) {
        const customItems = [...(template.customItems || [])];
        customItems.splice(index, 1);
        setTemplate({
            ...template,
            customItems
        });
    }

    function updateCustomItem(index: number, field: 'name' | 'price' | 'quantity', value: string | number) {
        const customItems = [...(template.customItems || [])];
        customItems[index] = {
            ...customItems[index],
            [field]: field === 'name' ? value : (field === 'price' ? parseFloat(value as string) || 0 : parseInt(value as string) || 1)
        };
        setTemplate({
            ...template,
            customItems
        });
    }

    // Get box items (items without vendorId)
    function getBoxItems() {
        return menuItems.filter(item => 
            (item.vendorId === null || item.vendorId === '') && item.isActive
        );
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '400px' }}>
                <Loader2 className="animate-spin" size={32} />
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Default Order Template</h2>
                    <p className={styles.subtitle}>
                        Set the default order configuration for newly created clients. This template will be applied when a new client is created.
                    </p>
                </div>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    {saving ? 'Saving...' : 'Save Template'}
                </button>
            </div>

            {message && (
                <div className={styles.message} style={{ 
                    padding: 'var(--spacing-sm) var(--spacing-md)',
                    marginBottom: 'var(--spacing-md)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: message.includes('Error') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
                    color: message.includes('Error') ? 'var(--color-danger)' : 'var(--color-success)'
                }}>
                    {message}
                </div>
            )}

            <div className={styles.formCard}>
                <h3 className={styles.sectionTitle}>Service Type</h3>
                <select
                    className="input"
                    value={template.serviceType}
                    onChange={e => handleServiceTypeChange(e.target.value)}
                    style={{ maxWidth: '300px' }}
                >
                    <option value="Food">Food</option>
                    <option value="Boxes">Boxes</option>
                    <option value="Custom">Custom</option>
                </select>
            </div>

            {template.serviceType === 'Food' && (
                <div className={styles.formCard}>
                    <h3 className={styles.sectionTitle}>Menu Items</h3>
                    <p className={styles.description}>
                        Select the default items and quantities for new clients.
                    </p>
                    
                    {menuItems.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            No menu items available. Add items in the Menu Items tab first.
                        </p>
                    ) : (
                        <div className={styles.itemsList}>
                            {menuItems.map(item => (
                                <div key={item.id} className={styles.itemRow}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 500, marginBottom: '4px' }}>{item.name}</div>
                                        <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                            Value: {item.value} | Price: ${item.priceEach || 0}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => updateItemQuantity(item.id, (template.vendorSelections?.[0]?.items[item.id] || 0) - 1)}
                                            disabled={(template.vendorSelections?.[0]?.items[item.id] || 0) <= 0}
                                            style={{ minWidth: '32px', padding: '4px 8px' }}
                                        >
                                            -
                                        </button>
                                        <input
                                            type="number"
                                            className="input"
                                            value={template.vendorSelections?.[0]?.items[item.id] || 0}
                                            onChange={e => updateItemQuantity(item.id, parseInt(e.target.value) || 0)}
                                            min="0"
                                            style={{ width: '80px', textAlign: 'center' }}
                                        />
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => updateItemQuantity(item.id, (template.vendorSelections?.[0]?.items[item.id] || 0) + 1)}
                                            style={{ minWidth: '32px', padding: '4px 8px' }}
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {template.serviceType === 'Boxes' && (
                <div className={styles.formCard}>
                    <h3 className={styles.sectionTitle}>Box Configuration</h3>
                    <p className={styles.description}>
                        Configure default boxes for new clients. Each box can have its own type and items.
                    </p>
                    
                    {boxTypes.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                            No box types available. Add box types in the Box Types tab first.
                        </p>
                    ) : (
                        <>
                            {(template.boxes || []).map((box) => {
                                const boxType = boxTypes.find(bt => bt.id === box.boxTypeId);
                                const boxItems = getBoxItems();
                                
                                return (
                                    <div key={box.boxNumber} style={{
                                        marginBottom: '1.5rem',
                                        padding: '1rem',
                                        background: 'var(--bg-surface)',
                                        borderRadius: '8px',
                                        border: '2px solid var(--border-color)'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                                                Box {box.boxNumber}
                                            </h4>
                                            {(template.boxes || []).length > 1 && (
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => removeBox(box.boxNumber)}
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                                >
                                                    <Trash2 size={14} /> Remove
                                                </button>
                                            )}
                                        </div>
                                        
                                        <div style={{ marginBottom: '1rem' }}>
                                            <label className="label" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Box Type</label>
                                            <select
                                                className="input"
                                                value={box.boxTypeId || ''}
                                                onChange={e => updateBoxType(box.boxNumber, e.target.value)}
                                            >
                                                <option value="">Select Box Type...</option>
                                                {boxTypes.filter(bt => bt.isActive).map(bt => (
                                                    <option key={bt.id} value={bt.id}>{bt.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {box.boxTypeId && boxItems.length > 0 && (
                                            <div>
                                                <label className="label" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>Items</label>
                                                <div className={styles.itemsList}>
                                                    {boxItems.map(item => {
                                                        const qty = (box.items || {})[item.id] || 0;
                                                        return (
                                                            <div key={item.id} className={styles.itemRow}>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ fontWeight: 500, marginBottom: '4px' }}>{item.name}</div>
                                                                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                                                        Value: {item.value} | Price: ${item.priceEach || 0}
                                                                    </div>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                                                    <button
                                                                        className="btn btn-secondary"
                                                                        onClick={() => updateBoxItem(box.boxNumber, item.id, qty - 1)}
                                                                        disabled={qty <= 0}
                                                                        style={{ minWidth: '32px', padding: '4px 8px' }}
                                                                    >
                                                                        -
                                                                    </button>
                                                                    <input
                                                                        type="number"
                                                                        className="input"
                                                                        value={qty}
                                                                        onChange={e => updateBoxItem(box.boxNumber, item.id, parseInt(e.target.value) || 0)}
                                                                        min="0"
                                                                        style={{ width: '80px', textAlign: 'center' }}
                                                                    />
                                                                    <button
                                                                        className="btn btn-secondary"
                                                                        onClick={() => updateBoxItem(box.boxNumber, item.id, qty + 1)}
                                                                        style={{ minWidth: '32px', padding: '4px 8px' }}
                                                                    >
                                                                        +
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            
                            <button
                                className="btn btn-primary"
                                onClick={addBox}
                                style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                            >
                                <Plus size={16} /> Add Another Box
                            </button>
                        </>
                    )}
                </div>
            )}

            {template.serviceType === 'Custom' && (
                <div className={styles.formCard}>
                    <h3 className={styles.sectionTitle}>Custom Order Configuration</h3>
                    <p className={styles.description}>
                        Configure default custom items for new clients. Custom orders allow flexible item definitions.
                    </p>
                    
                    <div style={{ marginBottom: '1rem' }}>
                        <label className="label">Default Vendor</label>
                        <select
                            className="input"
                            value={template.vendorId || ''}
                            onChange={e => setTemplate({ ...template, vendorId: e.target.value })}
                        >
                            <option value="">Select Vendor...</option>
                            {vendors.filter(v => v.isActive).map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                        </select>
                    </div>

                    {template.vendorId && (
                        <div style={{ marginTop: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Package size={16} /> Custom Items
                                </h4>
                                <button
                                    className="btn btn-secondary"
                                    onClick={addCustomItem}
                                    style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                >
                                    <Plus size={14} /> Add Item
                                </button>
                            </div>

                            {(template.customItems || []).length === 0 ? (
                                <div style={{
                                    padding: '1.5rem',
                                    backgroundColor: 'var(--bg-surface-active)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px dashed var(--border-color)',
                                    color: 'var(--text-secondary)',
                                    textAlign: 'center'
                                }}>
                                    <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                        No custom items added yet. Click "Add Item" to add custom order items.
                                    </p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    {(template.customItems || []).map((item, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                padding: '0.75rem',
                                                backgroundColor: 'var(--bg-surface-hover)',
                                                borderRadius: 'var(--radius-sm)',
                                                border: '1px solid var(--border-color)',
                                                display: 'flex',
                                                gap: '0.5rem',
                                                alignItems: 'flex-start'
                                            }}
                                        >
                                            <div style={{ flex: 1 }}>
                                                <label className="label" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>Item Name</label>
                                                <input
                                                    className="input"
                                                    value={item.name || ''}
                                                    onChange={e => updateCustomItem(index, 'name', e.target.value)}
                                                    placeholder="Enter item name"
                                                    style={{ fontSize: '0.9rem' }}
                                                />
                                            </div>
                                            <div style={{ width: '120px' }}>
                                                <label className="label" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>Price</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="input"
                                                    value={item.price || 0}
                                                    onChange={e => updateCustomItem(index, 'price', e.target.value)}
                                                    placeholder="0.00"
                                                    style={{ fontSize: '0.9rem' }}
                                                />
                                            </div>
                                            <div style={{ width: '100px' }}>
                                                <label className="label" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>Quantity</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    className="input"
                                                    value={item.quantity || 1}
                                                    onChange={e => updateCustomItem(index, 'quantity', e.target.value)}
                                                    style={{ fontSize: '0.9rem' }}
                                                />
                                            </div>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => removeCustomItem(index)}
                                                style={{ marginTop: '1.5rem', padding: '4px 8px' }}
                                                title="Remove Item"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
