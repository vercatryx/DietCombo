import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DriverCard } from '@/lib/api';

type Props = {
    allStops: any[];
    drivers: DriverCard[];
    deliveryDate: string;
};

export function SearchStops({ allStops, drivers, deliveryDate }: Props) {
    const router = useRouter();
    const [q, setQ] = useState('');

    const routeByStopId = useMemo(() => {
        const map = new Map<string, DriverCard>();
        for (const r of drivers || []) {
            for (const sid of r?.stopIds ?? []) {
                map.set(String(sid), r);
            }
        }
        return map;
    }, [drivers]);

    const results = useMemo(() => {
        const term = q.trim().toLowerCase();
        if (!term) return [];
        return allStops
            .filter((s) => {
                const hay = [s.name, s.address, s.apt, s.city, s.state, s.zip, s.phone]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                return hay.includes(term);
            })
            .slice(0, 30);
    }, [q, allStops]);

    return (
        <View style={styles.wrap}>
            <TextInput
                style={styles.input}
                placeholder="Search address, name, city…"
                value={q}
                onChangeText={setQ}
                autoCapitalize="none"
                autoCorrect={false}
            />
            {results.length > 0 ? (
                <FlatList
                    style={styles.list}
                    data={results}
                    keyExtractor={(item) => String(item.id)}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => {
                        const route = routeByStopId.get(String(item.id));
                        const href = route
                            ? `/driver/${route.id}?delivery_date=${encodeURIComponent(deliveryDate)}&highlightStop=${encodeURIComponent(String(item.id))}`
                            : null;
                        return (
                            <Pressable
                                style={styles.row}
                                disabled={!href}
                                onPress={() => {
                                    if (!href) return;
                                    router.push(href as any);
                                }}
                            >
                                <Text style={styles.rowTitle} numberOfLines={1}>
                                    {item.name || 'Stop'}
                                </Text>
                                <Text style={styles.rowSub} numberOfLines={2}>
                                    {[item.address, item.city, item.state, item.zip].filter(Boolean).join(', ')}
                                </Text>
                                <Text style={styles.rowHint}>{route ? route.name : 'Route unknown'}</Text>
                            </Pressable>
                        );
                    }}
                />
            ) : q.trim() ? (
                <Text style={styles.none}>No matches</Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { marginBottom: 14 },
    input: {
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        paddingHorizontal: 14,
        paddingVertical: 12,
        fontSize: 16,
    },
    list: { maxHeight: 220, marginTop: 8 },
    row: {
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    rowTitle: { fontWeight: '700', fontSize: 15, color: '#111' },
    rowSub: { marginTop: 4, color: '#4b5563', fontSize: 13 },
    rowHint: { marginTop: 6, color: '#3665F3', fontSize: 12, fontWeight: '600' },
    none: { marginTop: 8, color: '#9ca3af', fontSize: 14 },
});
