'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, AppSettings, ItemCategory } from './types';
import * as serverActions from './actions';

// Cache entry with timestamp for freshness checking
interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// Cache configuration
const CACHE_DURATION = {
    REFERENCE_DATA: 5 * 60 * 1000, // 5 minutes for reference data (statuses, vendors, etc.)
    CLIENT_DATA: 2 * 60 * 1000, // 2 minutes for client-specific data
    CLIENT_LIST: 1 * 60 * 1000, // 1 minute for client list (changes more frequently)
};

interface DataCacheContextType {
    // Reference data cache
    getStatuses: () => Promise<ClientStatus[]>;
    getNavigators: () => Promise<Navigator[]>;
    getVendors: () => Promise<Vendor[]>;
    getMenuItems: () => Promise<MenuItem[]>;
    getBoxTypes: () => Promise<BoxType[]>;
    getCategories: () => Promise<ItemCategory[]>;
    getSettings: () => Promise<AppSettings>;
    
    // Client data cache
    getClients: () => Promise<ClientProfile[]>;
    getClient: (id: string) => Promise<ClientProfile | undefined>;
    
    // Cache invalidation
    invalidateReferenceData: () => void;
    invalidateClientData: (clientId?: string) => void;
    invalidateAll: () => void;
    
    // Force refresh
    refreshReferenceData: () => Promise<void>;
}

const DataCacheContext = createContext<DataCacheContextType | null>(null);

export function DataCacheProvider({ children }: { children: React.ReactNode }) {
    // Cache storage using refs to avoid unnecessary re-renders
    const referenceCacheRef = useRef<{
        statuses?: CacheEntry<ClientStatus[]>;
        navigators?: CacheEntry<Navigator[]>;
        vendors?: CacheEntry<Vendor[]>;
        menuItems?: CacheEntry<MenuItem[]>;
        boxTypes?: CacheEntry<BoxType[]>;
        categories?: CacheEntry<ItemCategory[]>;
        settings?: CacheEntry<AppSettings>;
    }>({});
    
    const clientsCacheRef = useRef<CacheEntry<ClientProfile[]> | undefined>(undefined);
    const clientCacheRef = useRef<Map<string, CacheEntry<ClientProfile>>>(new Map());
    
    // State for triggering re-renders when cache updates
    const [, setCacheVersion] = useState(0);
    
    // Helper to check if cache entry is stale
    const isStale = <T,>(entry: CacheEntry<T> | undefined, duration: number): boolean => {
        if (!entry) return true;
        return Date.now() - entry.timestamp > duration;
    };
    
    // Helper to fetch and cache reference data
    const fetchAndCache = useCallback(async <T,>(
        key: keyof typeof referenceCacheRef.current,
        fetchFn: () => Promise<T>,
        duration: number = CACHE_DURATION.REFERENCE_DATA
    ): Promise<T> => {
        const cached = referenceCacheRef.current[key] as CacheEntry<T> | undefined;
        
        // Return cached data if still fresh
        if (!isStale(cached, duration)) {
            return cached!.data;
        }
        
        // Fetch fresh data
        const data = await fetchFn();
        (referenceCacheRef.current[key] as any) = { data, timestamp: Date.now() };
        setCacheVersion(v => v + 1); // Trigger re-render if needed
        return data;
    }, []);
    
    // Reference data getters
    const getStatuses = useCallback(async () => {
        return fetchAndCache('statuses', () => serverActions.getStatuses());
    }, [fetchAndCache]);
    
    const getNavigators = useCallback(async () => {
        return fetchAndCache('navigators', () => serverActions.getNavigators());
    }, [fetchAndCache]);
    
    const getVendors = useCallback(async () => {
        return fetchAndCache('vendors', () => serverActions.getVendors());
    }, [fetchAndCache]);
    
    const getMenuItems = useCallback(async () => {
        return fetchAndCache('menuItems', () => serverActions.getMenuItems());
    }, [fetchAndCache]);
    
    const getBoxTypes = useCallback(async () => {
        return fetchAndCache('boxTypes', () => serverActions.getBoxTypes());
    }, [fetchAndCache]);
    
    const getCategories = useCallback(async () => {
        return fetchAndCache('categories', () => serverActions.getCategories());
    }, [fetchAndCache]);
    
    const getSettings = useCallback(async () => {
        return fetchAndCache('settings', () => serverActions.getSettings());
    }, [fetchAndCache]);
    
    // Client list getter
    const getClients = useCallback(async () => {
        // Check cache
        if (!isStale(clientsCacheRef.current, CACHE_DURATION.CLIENT_LIST)) {
            return clientsCacheRef.current!.data;
        }
        
        // Fetch fresh data
        const data = await serverActions.getClients();
        clientsCacheRef.current = { data, timestamp: Date.now() };
        setCacheVersion(v => v + 1);
        return data;
    }, []);
    
    // Single client getter
    const getClient = useCallback(async (id: string) => {
        // Check cache
        const cached = clientCacheRef.current.get(id);
        if (!isStale(cached, CACHE_DURATION.CLIENT_DATA)) {
            return cached!.data;
        }
        
        // Fetch fresh data
        const data = await serverActions.getClient(id);
        if (data) {
            clientCacheRef.current.set(id, { data, timestamp: Date.now() });
            setCacheVersion(v => v + 1);
        }
        return data;
    }, []);
    
    // Cache invalidation
    const invalidateReferenceData = useCallback(() => {
        referenceCacheRef.current = {};
        setCacheVersion(v => v + 1);
    }, []);
    
    const invalidateClientData = useCallback((clientId?: string) => {
        if (clientId) {
            clientCacheRef.current.delete(clientId);
        } else {
            clientCacheRef.current.clear();
            clientsCacheRef.current = undefined;
        }
        setCacheVersion(v => v + 1);
    }, []);
    
    const invalidateAll = useCallback(() => {
        referenceCacheRef.current = {};
        clientCacheRef.current.clear();
        clientsCacheRef.current = undefined;
        setCacheVersion(v => v + 1);
    }, []);
    
    // Force refresh reference data
    const refreshReferenceData = useCallback(async () => {
        const [
            statuses,
            navigators,
            vendors,
            menuItems,
            boxTypes,
            categories,
            settings
        ] = await Promise.all([
            serverActions.getStatuses(),
            serverActions.getNavigators(),
            serverActions.getVendors(),
            serverActions.getMenuItems(),
            serverActions.getBoxTypes(),
            serverActions.getCategories(),
            serverActions.getSettings()
        ]);
        
        referenceCacheRef.current = {
            statuses: { data: statuses, timestamp: Date.now() },
            navigators: { data: navigators, timestamp: Date.now() },
            vendors: { data: vendors, timestamp: Date.now() },
            menuItems: { data: menuItems, timestamp: Date.now() },
            boxTypes: { data: boxTypes, timestamp: Date.now() },
            categories: { data: categories, timestamp: Date.now() },
            settings: { data: settings, timestamp: Date.now() }
        };
        setCacheVersion(v => v + 1);
    }, []);
    
    // Background refresh for stale cache entries (runs silently)
    useEffect(() => {
        const interval = setInterval(() => {
            // Refresh stale reference data in background without blocking
            const keys: (keyof typeof referenceCacheRef.current)[] = ['statuses', 'navigators', 'vendors', 'menuItems', 'boxTypes', 'categories', 'settings'];
            const refreshFns: { [key: string]: () => Promise<any> } = {
                statuses: () => serverActions.getStatuses(),
                navigators: () => serverActions.getNavigators(),
                vendors: () => serverActions.getVendors(),
                menuItems: () => serverActions.getMenuItems(),
                boxTypes: () => serverActions.getBoxTypes(),
                categories: () => serverActions.getCategories(),
                settings: () => serverActions.getSettings()
            };
            
            keys.forEach(key => {
                const cached = referenceCacheRef.current[key] as any;
                if (isStale(cached, CACHE_DURATION.REFERENCE_DATA * 1.5)) {
                    // If cache is getting stale, refresh in background
                    refreshFns[key]().then((data: any) => {
                        (referenceCacheRef.current[key] as any) = { data, timestamp: Date.now() };
                        setCacheVersion(v => v + 1);
                    }).catch(console.error);
                }
            });
        }, 60000); // Check every minute
        
        return () => clearInterval(interval);
    }, []);
    
    const value: DataCacheContextType = {
        getStatuses,
        getNavigators,
        getVendors,
        getMenuItems,
        getBoxTypes,
        getCategories,
        getSettings,
        getClients,
        getClient,
        invalidateReferenceData,
        invalidateClientData,
        invalidateAll,
        refreshReferenceData
    };
    
    return (
        <DataCacheContext.Provider value={value}>
            {children}
        </DataCacheContext.Provider>
    );
}

export function useDataCache() {
    const context = useContext(DataCacheContext);
    if (!context) {
        throw new Error('useDataCache must be used within DataCacheProvider');
    }
    return context;
}

