import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import * as Pending from '@/lib/pendingUploadsDb';
import { flushUploadQueue } from '@/lib/uploadQueue';

type Ctx = {
    pendingCount: number;
    refreshPendingCount: () => Promise<void>;
    flushQueue: () => Promise<void>;
};

const PendingUploadContext = createContext<Ctx | null>(null);

export function PendingUploadProvider({ children }: { children: React.ReactNode }) {
    const [pendingCount, setPendingCount] = useState(0);

    const refreshPendingCount = useCallback(async () => {
        const n = await Pending.countPendingUploads();
        setPendingCount(n);
    }, []);

    const flushQueue = useCallback(async () => {
        await flushUploadQueue();
        await refreshPendingCount();
    }, [refreshPendingCount]);

    useEffect(() => {
        (async () => {
            await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory + 'proofs', { intermediates: true }).catch(
                () => {}
            );
            await refreshPendingCount();
        })();
    }, [refreshPendingCount]);

    useEffect(() => {
        const sub = NetInfo.addEventListener((s: NetInfoState) => {
            if (s.isConnected) {
                flushQueue().catch(() => {});
            }
        });
        return () => sub();
    }, [flushQueue]);

    useEffect(() => {
        const onApp = (s: AppStateStatus) => {
            if (s === 'active') {
                flushQueue().catch(() => {});
            }
        };
        const sub = AppState.addEventListener('change', onApp);
        return () => sub.remove();
    }, [flushQueue]);

    const value = useMemo(
        () => ({ pendingCount, refreshPendingCount, flushQueue }),
        [pendingCount, refreshPendingCount, flushQueue]
    );

    return <PendingUploadContext.Provider value={value}>{children}</PendingUploadContext.Provider>;
}

export function usePendingUploads() {
    const v = useContext(PendingUploadContext);
    if (!v) throw new Error('usePendingUploads must be used within PendingUploadProvider');
    return v;
}
