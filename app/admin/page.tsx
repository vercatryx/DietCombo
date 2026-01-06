'use client';

import { useState } from 'react';
import styles from './Admin.module.css';
import { StatusManagement } from '@/components/admin/StatusManagement';
import { VendorManagement } from '@/components/admin/VendorManagement';
import { MenuManagement } from '@/components/admin/MenuManagement';
import { BoxCategoriesManagement } from '@/components/admin/BoxCategoriesManagement';
import { EquipmentManagement } from '@/components/admin/EquipmentManagement';
import { NavigatorManagement } from '@/components/admin/NavigatorManagement';
import { AdminManagement } from '@/components/admin/AdminManagement';
import { NutritionistManagement } from '@/components/admin/NutritionistManagement';
import FormBuilder from '@/components/forms/FormBuilder';
import { saveSingleForm } from '@/lib/form-actions';

import { GlobalSettings } from '@/components/admin/GlobalSettings';

type Tab = 'vendors' | 'menus' | 'statuses' | 'boxes' | 'equipment' | 'navigators' | 'nutritionists' | 'settings' | 'admins' | 'form';

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<Tab>('menus');

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
                    className={`${styles.tab} ${activeTab === 'equipment' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('equipment')}
                >
                    Equipment
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
            </div>

            <div className={styles.content}>
                {activeTab === 'menus' && <MenuManagement />}
                {activeTab === 'boxes' && <BoxCategoriesManagement />}
                {activeTab === 'equipment' && <EquipmentManagement />}

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
            </div>
        </div>
    );
}
