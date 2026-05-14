import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { loadDriversPage, postRouteCleanup, fetchOrdersDates, type DriverCard } from '@/lib/api';
import { getTodayInAppTz } from '@/lib/timezone';
import { usePendingUploads } from '@/contexts/PendingUploadContext';
import { DriversGrid } from '@/components/DriversGrid';
import { SearchStops } from '@/components/SearchStops';
import { DateStrip } from '@/components/DateStrip';

export default function DriversHomeScreen() {
    const router = useRouter();
    const { pendingCount, refreshPendingCount, flushQueue } = usePendingUploads();
    const [drivers, setDrivers] = useState<DriverCard[]>([]);
    const [allStops, setAllStops] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState(() => getTodayInAppTz());
    const [datesMap, setDatesMap] = useState<Map<string, number>>(new Map());

    const loadData = useCallback(
        async (showRefresh = false) => {
            if (showRefresh) setRefreshing(true);
            else setLoading(true);
            setError(null);
            try {
                const { drivers: d, allStops: s } = await loadDriversPage(selectedDate);
                setDrivers(d);
                setAllStops(s);
                postRouteCleanup(selectedDate);
                const dm = await fetchOrdersDates();
                setDatesMap(dm);
                await refreshPendingCount();
            } catch (e: any) {
                setError(e?.message || 'Failed to load routes');
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [selectedDate, refreshPendingCount]
    );

    useEffect(() => {
        loadData();
    }, [loadData]);

    if (loading && !refreshing) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color="#3665F3" />
                <Text style={styles.muted}>Loading routes…</Text>
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.centered}>
                <Text style={styles.title}>Connection error</Text>
                <Text style={styles.muted}>{error}</Text>
                <Pressable style={styles.btn} onPress={() => loadData()}>
                    <Text style={styles.btnText}>Try again</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadData(true)} />}
        >
            <View style={styles.header}>
                <Text style={styles.h1}>Delivery Routes</Text>
                <Text style={styles.sub}>Select your route to begin deliveries</Text>
                <Pressable style={styles.refreshBtn} onPress={() => loadData(true)}>
                    <Text style={styles.refreshBtnText}>Refresh</Text>
                </Pressable>
            </View>

            {pendingCount > 0 ? (
                <Pressable style={styles.pendingBanner} onPress={() => flushQueue()}>
                    <Text style={styles.pendingText}>
                        {pendingCount} proof upload{pendingCount === 1 ? '' : 's'} pending — tap to sync
                    </Text>
                </Pressable>
            ) : null}

            <DateStrip selectedDate={selectedDate} onDateChange={setSelectedDate} datesMap={datesMap} />

            <SearchStops allStops={allStops} drivers={drivers} deliveryDate={selectedDate} />

            <DriversGrid drivers={drivers} selectedDate={selectedDate} deliveryDate={selectedDate} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#eef2f7' },
    content: { padding: 16, paddingBottom: 32 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#eef2f7' },
    header: { marginBottom: 12 },
    h1: { fontSize: 26, fontWeight: '800', color: '#111' },
    sub: { marginTop: 4, color: '#6b7280', fontSize: 15 },
    refreshBtn: {
        alignSelf: 'flex-start',
        marginTop: 10,
        backgroundColor: '#3665F3',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 10,
    },
    refreshBtnText: { color: '#fff', fontWeight: '600' },
    muted: { color: '#6b7280', marginTop: 8, textAlign: 'center' },
    title: { fontSize: 22, fontWeight: '700' },
    btn: {
        marginTop: 16,
        backgroundColor: '#3665F3',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10,
    },
    btnText: { color: '#fff', fontWeight: '600' },
    pendingBanner: {
        backgroundColor: '#fef3c7',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#fcd34d',
    },
    pendingText: { color: '#92400e', fontWeight: '600', textAlign: 'center' },
});
