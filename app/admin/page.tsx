'use client';

import { useState, useEffect } from 'react';
import styles from './Admin.module.css';
import { StatusManagement } from '@/components/admin/StatusManagement';
import { VendorManagement } from '@/components/admin/VendorManagement';
import { MenuManagement } from '@/components/admin/MenuManagement';
import { BoxCategoriesManagement } from '@/components/admin/BoxCategoriesManagement';
import { NavigatorManagement } from '@/components/admin/NavigatorManagement';
import { AdminManagement } from '@/components/admin/AdminManagement';
import { NutritionistManagement } from '@/components/admin/NutritionistManagement';
import FormBuilder from '@/components/forms/FormBuilder';
import { saveSingleForm } from '@/lib/form-actions';
import { DefaultOrderTemplate } from '@/components/admin/DefaultOrderTemplate';
import { useDataCache } from '@/lib/data-cache';
import { Vendor, MenuItem } from '@/lib/types';

import { GlobalSettings } from '@/components/admin/GlobalSettings';
import { MealSelectionManagement } from '@/components/admin/MealSelectionManagement';

type Tab = 'vendors' | 'menus' | 'statuses' | 'boxes' | 'navigators' | 'nutritionists' | 'settings' | 'admins' | 'form' | 'meals' | 'template';

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<Tab>('menus');
    const { getVendors, getMenuItems } = useDataCache();
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [mainVendor, setMainVendor] = useState<Vendor | null>(null);

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

    const filteredMenuItems = mainVendor
        ? menuItems.filter(item => item.vendorId === mainVendor.id)
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        : [];

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>Admin Control Panel</h1>
                <p className={styles.subtitle}>Manage global configurations and resources.</p>
            </header>

            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'menus' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('menus')}
                >
                    Menus
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'boxes' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('boxes')}
                >
                    Box Categories
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'vendors' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('vendors')}
                >
                    Vendors
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'navigators' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('navigators')}
                >
                    Navigators
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'nutritionists' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('nutritionists')}
                >
                    Nutritionists
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'statuses' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('statuses')}
                >
                    Statuses
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'form' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('form')}
                >
                    Screening Form
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'settings' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'admins' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('admins')}
                >
                    Admins
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'meals' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('meals')}
                >
                    Meal Selection
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'template' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('template')}
                >
                    Default Order Template
                </button>
            </div>

            <div className={styles.content}>
                {activeTab === 'menus' && <MenuManagement />}
                {activeTab === 'boxes' && <BoxCategoriesManagement />}
                {activeTab === 'vendors' && <VendorManagement />}
                {activeTab === 'navigators' && <NavigatorManagement />}
                {activeTab === 'nutritionists' && <NutritionistManagement />}
                {activeTab === 'statuses' && <StatusManagement />}
                {activeTab === 'form' && (
                    <div className="bg-[#1a1a1a] p-6 rounded-xl border border-white/5">
                        <h2 className="text-xl font-bold mb-4 text-white">Screening Form Configuration</h2>
                      <br/><br/>
                        {/* We will update FormBuilder to handle singleton logic internally or pass a specific onSave */}
                        <FormBuilder onSave={async (schema) => {
                            // This is a bit of a hack until we fully update FormBuilder to be singleton-aware internally
                            // or we can just ignore the schema return and trust the action inside FormBuilder
                            // But wait, FormBuilder calls safeForm internally. We need to update FormBuilder to call saveSingleForm instead.
                            console.log("Form saved");
                        }} />
                    </div>
                )}
                {activeTab === 'settings' && <GlobalSettings />}
                {activeTab === 'admins' && <AdminManagement />}
                {activeTab === 'meals' && <MealSelectionManagement />}
                {activeTab === 'template' && mainVendor && (
                    <DefaultOrderTemplate mainVendor={mainVendor} menuItems={filteredMenuItems} />
                )}
                {activeTab === 'template' && !mainVendor && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No active vendor found. Please activate a vendor first.
                    </div>
                )}
            </div>
        </div>
    );
}
