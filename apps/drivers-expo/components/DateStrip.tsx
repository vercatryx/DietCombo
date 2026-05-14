import { useEffect, useMemo, useState } from 'react';
import {
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';

import { getTodayInAppTz } from '@/lib/timezone';

function shiftLocalCalendar(iso: string, deltaDays: number): string {
    const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
    const dt = new Date(y, m - 1, d + deltaDays);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

type Props = {
    selectedDate: string;
    onDateChange: (d: string) => void;
    datesMap: Map<string, number>;
};

export function DateStrip({ selectedDate, onDateChange, datesMap }: Props) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [manual, setManual] = useState(selectedDate);

    useEffect(() => {
        setManual(selectedDate);
    }, [selectedDate]);

    const sortedDates = useMemo(() => {
        return Array.from(datesMap.keys()).sort((a, b) => (a > b ? -1 : 1));
    }, [datesMap]);

    return (
        <View style={styles.wrap}>
            <View style={styles.row}>
                <Pressable style={styles.dayBtn} onPress={() => onDateChange(shiftLocalCalendar(selectedDate, -1))}>
                    <Text style={styles.dayBtnText}>◀</Text>
                </Pressable>
                <Pressable style={styles.dateMid} onPress={() => setPickerOpen(true)}>
                    <Text style={styles.dateLabel}>Delivery date</Text>
                    <Text style={styles.dateVal}>{selectedDate}</Text>
                </Pressable>
                <Pressable style={styles.dayBtn} onPress={() => onDateChange(shiftLocalCalendar(selectedDate, 1))}>
                    <Text style={styles.dayBtnText}>▶</Text>
                </Pressable>
            </View>
            <View style={styles.actions}>
                <Pressable style={styles.secondary} onPress={() => onDateChange(getTodayInAppTz())}>
                    <Text style={styles.secondaryText}>Today</Text>
                </Pressable>
                <Pressable style={styles.secondary} onPress={() => setPickerOpen(true)}>
                    <Text style={styles.secondaryText}>Dates with orders</Text>
                </Pressable>
            </View>

            <Modal visible={pickerOpen} transparent animationType="slide">
                <View style={styles.modalBackdrop}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Set date (YYYY-MM-DD)</Text>
                        <TextInput
                            style={styles.input}
                            value={manual}
                            onChangeText={setManual}
                            placeholder="2026-05-08"
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <Pressable
                            style={styles.primaryBtn}
                            onPress={() => {
                                const t = manual.trim();
                                if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
                                    onDateChange(t);
                                    setPickerOpen(false);
                                }
                            }}
                        >
                            <Text style={styles.primaryBtnText}>Apply</Text>
                        </Pressable>

                        <Text style={styles.listHdr}>Recent order dates</Text>
                        <FlatList
                            style={styles.list}
                            data={sortedDates.slice(0, 40)}
                            keyExtractor={(item) => item}
                            renderItem={({ item }) => (
                                <Pressable
                                    style={styles.listRow}
                                    onPress={() => {
                                        onDateChange(item);
                                        setManual(item);
                                        setPickerOpen(false);
                                    }}
                                >
                                    <Text style={styles.listRowText}>{item}</Text>
                                    <Text style={styles.listRowCt}>{datesMap.get(item) ?? 0}</Text>
                                </Pressable>
                            )}
                        />
                        <Pressable style={styles.closeBtn} onPress={() => setPickerOpen(false)}>
                            <Text style={styles.closeBtnText}>Close</Text>
                        </Pressable>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { marginBottom: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dayBtn: {
        width: 44,
        height: 48,
        borderRadius: 10,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        justifyContent: 'center',
        alignItems: 'center',
    },
    dayBtnText: { fontSize: 18, color: '#374151' },
    dateMid: {
        flex: 1,
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    dateLabel: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
    dateVal: { fontSize: 18, fontWeight: '800', color: '#111', marginTop: 4 },
    actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
    secondary: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        alignItems: 'center',
    },
    secondaryText: { fontWeight: '600', color: '#3665F3', fontSize: 13 },
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    modalCard: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 20,
        maxHeight: '85%',
    },
    modalTitle: { fontWeight: '700', fontSize: 16, marginBottom: 8 },
    input: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        borderRadius: 10,
        padding: 12,
        fontSize: 16,
        marginBottom: 12,
    },
    primaryBtn: {
        backgroundColor: '#3665F3',
        paddingVertical: 12,
        borderRadius: 10,
        alignItems: 'center',
        marginBottom: 16,
    },
    primaryBtnText: { color: '#fff', fontWeight: '700' },
    listHdr: { fontWeight: '600', color: '#6b7280', marginBottom: 8 },
    list: { maxHeight: 280 },
    listRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    listRowText: { fontSize: 16, color: '#111' },
    listRowCt: { color: '#6b7280' },
    closeBtn: { marginTop: 12, padding: 12, alignItems: 'center' },
    closeBtnText: { color: '#6b7280', fontWeight: '600' },
});
