'use client';

/**
 * Client-side cached wrappers around server actions
 * These functions check cache first before calling server actions
 */

import { useDataCache } from './data-cache';

// This file provides React hooks to use cached data
// For non-React contexts, we'll export a singleton cache manager

// In-memory cache store (shared across all components)
interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

const CACHE_DURATION = {
    REFERENCE_DATA: 5 * 60 * 1000, // 5 minutes
    CLIENT_DATA: 2 * 60 * 1000, // 2 minutes
    CLIENT_LIST: 1 * 60 * 1000, // 1 minute
};

class CacheManager {
    private referenceCache: Map<string, CacheEntry<any>> = new Map();
    private clientsCache: CacheEntry<any> | undefined;
    private clientCache: Map<string, CacheEntry<any>> = new Map();
    
    private isStale<T>(entry: CacheEntry<T> | undefined, duration: number): boolean {
        if (!entry) return true;
        return Date.now() - entry.timestamp > duration;
    }
    
    async getCached<T>(
        key: string,
        fetchFn: () => Promise<T>,
        duration: number = CACHE_DURATION.REFERENCE_DATA
    ): Promise<T> {
        const cached = this.referenceCache.get(key);
        if (!this.isStale(cached, duration)) {
            return cached!.data;
        }
        
        const data = await fetchFn();
        this.referenceCache.set(key, { data, timestamp: Date.now() });
        return data;
    }
    
    async getCachedClients(fetchFn: () => Promise<any[]>): Promise<any[]> {
        if (!this.isStale(this.clientsCache, CACHE_DURATION.CLIENT_LIST)) {
            return this.clientsCache!.data;
        }
        const data = await fetchFn();
        this.clientsCache = { data, timestamp: Date.now() };
        return data;
    }
    
    async getCachedClient(id: string, fetchFn: () => Promise<any>): Promise<any> {
        const cached = this.clientCache.get(id);
        if (!this.isStale(cached, CACHE_DURATION.CLIENT_DATA)) {
            return cached!.data;
        }
        const data = await fetchFn();
        if (data !== undefined) {
            this.clientCache.set(id, { data, timestamp: Date.now() });
        }
        return data;
    }
    
    invalidateReferenceData(key?: string) {
        if (key) {
            this.referenceCache.delete(key);
        } else {
            this.referenceCache.clear();
        }
    }
    
    invalidateClientData(clientId?: string) {
        if (clientId) {
            this.clientCache.delete(clientId);
        } else {
            this.clientCache.clear();
            this.clientsCache = undefined;
        }
    }
    
    invalidateAll() {
        this.referenceCache.clear();
        this.clientCache.clear();
        this.clientsCache = undefined;
    }
}

export const cacheManager = new CacheManager();

// Export hook for React components to use cached data
export { useDataCache } from './data-cache';

