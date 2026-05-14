import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Linking,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { fetchDriverDetail, type DriverCard } from '@/lib/api';
import { makeAddressKey } from '@/lib/addressKey';

function firstOrString(v: string | string[] | undefined): string {
    if (v == null) return '';
    return Array.isArray(v) ? v[0] ?? '' : v;
}

function mapsUrlFromStop(s: any): string {
    const q = [s.address, s.city, s.state, s.zip].filter(Boolean).join(', ');
    return `https://maps.apple.com/?q=${encodeURIComponent(q)}`;
}

export default function DriverDetailScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const id = firstOrString(params.id);
    const deliveryDate = firstOrString(params.delivery_date) || '';
    const highlightStop = firstOrString(params.highlightStop);

    const [driver, setDriver] = useState<DriverCard | null>(null);
    const [stops, setStops] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [mapOpen, setMapOpen] = useState(false);
    const listRef = useRef<FlatList<any>>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { driver: d, orderedStops } = await fetchDriverDetail(id, deliveryDate);
            setDriver(d);
            setStops(orderedStops);
        } catch (e) {
            console.error(e);
            setDriver(null);
            setStops([]);
        } finally {
            setLoading(false);
        }
    }, [id, deliveryDate]);

    useEffect(() => {
        load();
    }, [load]);

    const addressGroups = useMemo(() => {
        const groups = new Map<string, any[]>();
        for (const stop of stops) {
            const key = makeAddressKey(stop);
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(stop);
        }
        return groups;
    }, [stops]);

    const stopsFlagged = useMemo(() => {
        return stops.map((stop) => {
            const key = makeAddressKey(stop);
            const group = addressGroups.get(key || '');
            return { ...stop, hasDuplicateAtAddress: group && group.length > 1 };
        });
    }, [stops, addressGroups]);

    useEffect(() => {
        if (!highlightStop || !stopsFlagged.length) return;
        const idx = stopsFlagged.findIndex((s) => String(s.id) === String(highlightStop));
        if (idx >= 0) {
            setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 }), 400);
        }
    }, [highlightStop, stopsFlagged]);

    const proofCount = useMemo(
        () => stops.filter((s) => !!((s?.proofUrl || s?.proof_url) || '').trim()).length,
        [stops]
    );
    const total = stops.length;
    const pctProof = total > 0 ? (proofCount / total) * 100 : 0;
    const brand = driver?.color || '#3665F3';

    const mapRegion = useMemo(() => {
        const pts = stops
            .map((s) => ({ lat: Number(s.lat), lng: Number(s.lng) }))
            .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        if (pts.length === 0) return { latitude: 40.7, longitude: -73.9, latitudeDelta: 0.15, longitudeDelta: 0.15 };
        const lats = pts.map((p) => p.lat);
        const lngs = pts.map((p) => p.lng);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        return {
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
            latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.8 || 0.08),
            longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.8 || 0.08),
        };
    }, [stops]);

    function openDelivery(s: any) {
        const orderUuid = s.orderId ?? s.order_id;
        if (!orderUuid) return;
        const hasProof = !!((s.proofUrl || s.proof_url) || '').trim();
        const orderNum = s.orderNumber ?? s.order_number ?? '';
        const q = new URLSearchParams({
            clientName: String(s.name || ''),
            orderNumberDisp: String(orderNum),
            address: [s.address, s.city, s.state, s.zip].filter(Boolean).join(', '),
            deliveryDate: deliveryDate,
            phone: String(s.phone || ''),
            alreadyDelivered: hasProof ? '1' : '0',
        });
        router.push(`/delivery/${encodeURIComponent(String(orderUuid))}?${q.toString()}` as any);
    }

    if (loading) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color="#3665F3" />
                <Text style={styles.muted}>Loading stops…</Text>
            </View>
        );
    }

    if (!driver) {
        return (
            <View style={styles.centered}>
                <Text style={styles.title}>Route not found</Text>
            </View>
        );
    }

    return (
        <View style={styles.screen}>
            <View style={[styles.banner, { backgroundColor: brand }]}>
                <Text style={styles.bannerTitle}>{driver.name}</Text>
                <Text style={styles.bannerSub}>
                    Proof {proofCount}/{total}
                </Text>
                <View style={styles.proofBar}>
                    <View style={[styles.proofFill, { width: `${pctProof}%` }]} />
                </View>
            </View>

            <Pressable style={[styles.mapBtn, { backgroundColor: brand }]} onPress={() => setMapOpen(true)}>
                <Text style={styles.mapBtnText}>View map</Text>
            </Pressable>

            <FlatList
                ref={listRef}
                data={stopsFlagged}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={styles.listPad}
                onScrollToIndexFailed={(info) => {
                    setTimeout(() => {
                        listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.3 });
                    }, 100);
                }}
                renderItem={({ item: s, index }) => {
                    const hasProof = !!((s.proofUrl || s.proof_url) || '').trim();
                    const proofUrl = (s.proofUrl || s.proof_url) || '';
                    const orderUuid = s.orderId ?? s.order_id;
                    return (
                        <View
                            style={[
                                styles.card,
                                s.hasDuplicateAtAddress && styles.cardDup,
                                hasProof && styles.cardOk,
                            ]}
                        >
                            <View style={[styles.rail, { backgroundColor: hasProof ? '#059669' : brand }]} />
                            <View style={styles.cardBody}>
                                <View style={styles.rowTop}>
                                    <View style={styles.pill}>
                                        <Text style={styles.pillText}>{index + 1}</Text>
                                    </View>
                                    <Text style={styles.stopName} numberOfLines={2}>
                                        {s.name}
                                    </Text>
                                    <Text style={[styles.chip, hasProof && styles.chipOk]}>
                                        {hasProof ? 'Proof ✓' : 'No proof'}
                                    </Text>
                                </View>
                                <Text style={styles.addr}>
                                    {s.address}
                                    {s.apt || s.unit ? ` (Unit ${s.apt ?? s.unit})` : ''}, {s.city}, {s.state} {s.zip}
                                </Text>
                                <Text style={styles.orderLine}>
                                    Order #: {s.orderNumber ?? s.order_number ?? 'N/A'}
                                </Text>
                                <View style={styles.actions}>
                                    <Pressable
                                        style={styles.btnPrimary}
                                        onPress={() => Linking.openURL(mapsUrlFromStop(s))}
                                    >
                                        <Text style={styles.btnPrimaryText}>Maps</Text>
                                    </Pressable>
                                    {!hasProof && orderUuid ? (
                                        <>
                                            <Pressable style={styles.btnOutline} onPress={() => openDelivery(s)}>
                                                <Text style={styles.btnOutlineText}>Take photos</Text>
                                            </Pressable>
                                        </>
                                    ) : hasProof && proofUrl ? (
                                        <Pressable
                                            style={styles.btnOutline}
                                            onPress={() => Linking.openURL(proofUrl)}
                                        >
                                            <Text style={styles.btnOutlineText}>View proof</Text>
                                        </Pressable>
                                    ) : (
                                        <Text style={styles.warn}>No order linked — can&apos;t add proof</Text>
                                    )}
                                </View>
                            </View>
                        </View>
                    );
                }}
                ListEmptyComponent={
                    <Text style={styles.empty}>No stops assigned for this route.</Text>
                }
            />

            <Modal visible={mapOpen} animationType="slide">
                <View style={styles.mapSheet}>
                    <View style={styles.mapHeader}>
                        <Text style={styles.mapTitle}>Route map</Text>
                        <Pressable onPress={() => setMapOpen(false)}>
                            <Text style={styles.mapClose}>Close</Text>
                        </Pressable>
                    </View>
                    <MapView style={styles.map} region={mapRegion}>
                        {stops.map((s) => {
                            const lat = Number(s.lat);
                            const lng = Number(s.lng);
                            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
                            return (
                                <Marker
                                    key={String(s.id)}
                                    coordinate={{ latitude: lat, longitude: lng }}
                                    title={String(s.name || '')}
                                />
                            );
                        })}
                    </MapView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#f7f8fb' },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f7f8fb' },
    muted: { marginTop: 8, color: '#6b7280' },
    title: { fontSize: 18, fontWeight: '600', color: '#374151' },
    banner: { padding: 16, paddingTop: 8 },
    bannerTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
    bannerSub: { color: 'rgba(255,255,255,0.95)', marginTop: 6, fontWeight: '600' },
    proofBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 999, marginTop: 12, overflow: 'hidden' },
    proofFill: { height: '100%', backgroundColor: '#fff', borderRadius: 999 },
    mapBtn: {
        marginHorizontal: 16,
        marginTop: 12,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    mapBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    listPad: { padding: 16, paddingBottom: 40 },
    card: {
        flexDirection: 'row',
        backgroundColor: '#fff',
        borderRadius: 16,
        marginBottom: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#e8eaef',
    },
    cardDup: { backgroundColor: '#fefce8' },
    cardOk: { borderColor: '#a7f3d0', backgroundColor: '#ecfdf5' },
    rail: { width: 6 },
    cardBody: { flex: 1, padding: 14 },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
    pill: {
        minWidth: 28,
        height: 28,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: '#3665F3',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pillText: { fontWeight: '800', fontSize: 14, color: '#3665F3' },
    stopName: { flex: 1, fontWeight: '800', fontSize: 17, color: '#111' },
    chip: {
        fontSize: 11,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        color: '#6b7280',
        fontWeight: '600',
    },
    chipOk: { borderColor: '#10b981', color: '#059669', backgroundColor: '#ecfdf5' },
    addr: { marginTop: 8, color: '#374151', fontSize: 15, lineHeight: 20 },
    orderLine: { marginTop: 6, fontSize: 12, color: '#4b5563', backgroundColor: '#f3f4f6', padding: 8, borderRadius: 8 },
    actions: { marginTop: 12, gap: 10 },
    btnPrimary: {
        backgroundColor: '#3665F3',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
    btnPrimaryText: { color: '#fff', fontWeight: '700' },
    btnOutline: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    btnOutlineText: { fontWeight: '700', color: '#111' },
    warn: { color: '#6b7280', fontSize: 13, padding: 10 },
    empty: { textAlign: 'center', color: '#6b7280', padding: 24 },
    mapSheet: { flex: 1, backgroundColor: '#fff' },
    mapHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    mapTitle: { fontWeight: '800', fontSize: 18 },
    mapClose: { color: '#3665F3', fontWeight: '700', fontSize: 16 },
    map: { flex: 1 },
});
