import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DriverCard } from '@/lib/api';
import { makeAddressKey } from '@/lib/addressKey';

type Props = {
    drivers: DriverCard[];
    selectedDate: string;
    deliveryDate: string;
};

export function DriversGrid({ drivers, selectedDate, deliveryDate }: Props) {
    const filtered =
        selectedDate && drivers.length > 0
            ? drivers.filter((d) => (d.stops || []).length > 0)
            : drivers;

    if (filtered.length === 0) {
        return (
            <View style={styles.empty}>
                <Text style={styles.emptyTitle}>{selectedDate ? 'No routes for selected date' : 'No routes available'}</Text>
                <Text style={styles.emptySub}>Try another date or pull to refresh.</Text>
            </View>
        );
    }

    return (
        <View style={styles.grid}>
            {filtered.map((d) => {
                const stops = d.stops || [];
                const total = stops.length;
                const done = stops.filter((s: any) => !!s?.completed).length;
                const pct = total > 0 ? (done / total) * 100 : 0;
                const proofCount = stops.filter((s: any) => !!((s?.proofUrl ?? s?.proof_url) || '').trim()).length;
                const pctProof = total > 0 ? (proofCount / total) * 100 : 0;
                const uniqueAddrCount = (() => {
                    const set = new Set<string>();
                    for (const s of stops) {
                        const k = makeAddressKey(s);
                        if (k) set.add(k);
                    }
                    return set.size;
                })();
                const color = (d.color || '#3665F3').trim();
                const href =
                    `/driver/${d.id}?delivery_date=` + encodeURIComponent(deliveryDate);

                return (
                    <Link key={String(d.id)} href={href as any} asChild>
                        <Pressable style={[styles.card, { borderLeftColor: color }]}>
                            <View style={styles.cardInner}>
                                <Text style={styles.name}>{d.name}</Text>
                                <Text style={styles.meta}>
                                    {uniqueAddrCount} {uniqueAddrCount === 1 ? 'address' : 'addresses'}
                                </Text>
                                <Text style={styles.meta}>
                                    {done} / {total} bags
                                </Text>
                                <View style={styles.progressBg}>
                                    <View style={[styles.progressFg, { width: `${pct}%`, backgroundColor: color }]} />
                                </View>
                                <Text style={styles.meta}>
                                    {proofCount} / {total} proof
                                </Text>
                                <View style={[styles.progressBg, styles.progressProofBg]}>
                                    <View style={[styles.progressFgProof, { width: `${pctProof}%`, backgroundColor: color }]} />
                                </View>
                            </View>
                        </Pressable>
                    </Link>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    grid: { gap: 14 },
    card: {
        backgroundColor: '#fff',
        borderRadius: 14,
        borderLeftWidth: 6,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 2,
    },
    cardInner: { padding: 16 },
    name: { fontSize: 18, fontWeight: '800', color: '#111' },
    meta: { marginTop: 6, color: '#6b7280', fontSize: 14 },
    progressBg: {
        height: 10,
        borderRadius: 999,
        backgroundColor: '#f1f5f9',
        marginTop: 10,
        overflow: 'hidden',
    },
    progressFg: { height: '100%', borderRadius: 999 },
    progressProofBg: { height: 8, backgroundColor: '#eef6fb', marginTop: 8 },
    progressFgProof: { height: '100%', borderRadius: 999, backgroundColor: '#0ea5e9' },
    empty: { padding: 40, alignItems: 'center' },
    emptyTitle: { fontSize: 16, fontWeight: '600', color: '#6b7280' },
    emptySub: { marginTop: 8, color: '#9ca3af', textAlign: 'center' },
});
