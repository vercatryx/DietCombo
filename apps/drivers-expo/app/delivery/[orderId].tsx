import * as FileSystem from 'expo-file-system/legacy';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import NetInfo from '@react-native-community/netinfo';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { postDeliveryProof } from '@/lib/api';
import { queueProofUpload } from '@/lib/uploadQueue';
import { usePendingUploads } from '@/contexts/PendingUploadContext';

type Step = 'VERIFY' | 'CAPTURE' | 'PREVIEW' | 'UPLOADING' | 'SUCCESS' | 'ERROR';

function first(v: string | string[] | undefined): string {
    if (v == null) return '';
    return Array.isArray(v) ? v[0] ?? '' : v;
}

function decodeParam(s: string): string {
    if (!s) return '';
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

const PROOF_DIR = `${FileSystem.documentDirectory ?? ''}proofs`;

async function ensureProofDir() {
    await FileSystem.makeDirectoryAsync(PROOF_DIR, { intermediates: true }).catch(() => {});
}

async function persistShot(uri: string): Promise<string> {
    await ensureProofDir();
    const dest = `${PROOF_DIR}/shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
}

export default function DeliveryProofScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const orderId = first(params.orderId);
    const clientName = decodeParam(first(params.clientName));
    const orderNumberDisp = decodeParam(first(params.orderNumberDisp));
    const address = decodeParam(first(params.address));
    const deliveryDate = decodeParam(first(params.deliveryDate));
    const phone = decodeParam(first(params.phone));
    const alreadyDelivered = first(params.alreadyDelivered) === '1';

    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);
    const [cameraReady, setCameraReady] = useState(false);

    const [step, setStep] = useState<Step>(alreadyDelivered ? 'SUCCESS' : 'CAPTURE');
    const [shots, setShots] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [queuedOffline, setQueuedOffline] = useState(false);
    const { refreshPendingCount } = usePendingUploads();

    useEffect(() => {
        ensureProofDir();
    }, []);

    useEffect(() => {
        if (step !== 'CAPTURE') setCameraReady(false);
    }, [step]);

    const removeShotAt = useCallback(async (index: number) => {
        const uri = shots[index];
        setShots((prev) => prev.filter((_, i) => i !== index));
        try {
            await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {
            /* ignore */
        }
    }, [shots]);

    const takePicture = useCallback(async () => {
        try {
            const cam = cameraRef.current;
            if (!cam || !cameraReady) return;
            const photo = await cam.takePictureAsync({ quality: 0.85 });
            if (photo?.uri) {
                const path = await persistShot(photo.uri);
                setShots((s) => [...s, path]);
            }
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Camera error');
        }
    }, [cameraReady]);

    const pickGallery = useCallback(async () => {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') return;
        const res = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            quality: 0.85,
        });
        if (res.canceled) return;
        const paths: string[] = [];
        for (const a of res.assets) {
            if (a.uri) paths.push(await persistShot(a.uri));
        }
        if (paths.length) setShots((s) => [...s, ...paths]);
    }, []);

    const submit = useCallback(async () => {
        if (shots.length === 0 || !orderId) return;
        setStep('UPLOADING');
        setError('');
        const net = await NetInfo.fetch();
        const online = !!net.isConnected;
        try {
            if (!online) {
                setQueuedOffline(true);
                await queueProofUpload(orderId, shots);
                await refreshPendingCount();
                setStep('SUCCESS');
                return;
            }
            setQueuedOffline(false);
            const result = await postDeliveryProof(orderId, shots);
            if (result.success) {
                for (const u of shots) {
                    try {
                        await FileSystem.deleteAsync(u, { idempotent: true });
                    } catch {
                        /* ignore */
                    }
                }
                setShots([]);
                setStep('SUCCESS');
            } else {
                setError((result as { error?: string }).error || 'Upload failed');
                setStep('ERROR');
            }
        } catch (e: any) {
            setError(e?.message || 'Upload failed');
            setStep('ERROR');
        }
    }, [orderId, shots, refreshPendingCount]);

    useEffect(() => {
        if (step === 'CAPTURE' && !permission?.granted) {
            requestPermission();
        }
    }, [step, permission, requestPermission]);

    if (step === 'VERIFY') {
        return (
            <SafeAreaView style={styles.safe}>
                <ScrollView contentContainerStyle={styles.scroll}>
                    <View style={styles.badge}>
                        <Text style={styles.badgeTxt}>Verify delivery</Text>
                    </View>
                    <Text style={styles.title}>Order #{orderNumberDisp || '—'}</Text>
                    <Text style={styles.sub}>{deliveryDate || '—'}</Text>
                    <View style={styles.panel}>
                        <Text style={styles.k}>Client</Text>
                        <Text style={styles.v}>{clientName || '—'}</Text>
                        <Text style={styles.k}>Phone</Text>
                        <Text style={styles.v}>{phone || '—'}</Text>
                        <Text style={styles.k}>Address</Text>
                        <Text style={styles.v}>{address || '—'}</Text>
                    </View>
                    <Pressable style={styles.primary} onPress={() => setStep('CAPTURE')}>
                        <Text style={styles.primaryTxt}>Take delivery photos</Text>
                    </Pressable>
                    <Pressable style={styles.ghost} onPress={() => router.back()}>
                        <Text style={styles.ghostTxt}>Close</Text>
                    </Pressable>
                </ScrollView>
            </SafeAreaView>
        );
    }

    if (step === 'CAPTURE') {
        if (!permission?.granted) {
            return (
                <SafeAreaView style={styles.safe}>
                    <View style={styles.center}>
                        <Text style={styles.title}>Camera permission</Text>
                        <Text style={styles.muted}>Allow camera access to take proof photos.</Text>
                        <Pressable style={styles.primary} onPress={requestPermission}>
                            <Text style={styles.primaryTxt}>Grant permission</Text>
                        </Pressable>
                        <Pressable style={styles.ghost} onPress={() => setStep('VERIFY')}>
                            <Text style={styles.ghostTxt}>Back</Text>
                        </Pressable>
                    </View>
                </SafeAreaView>
            );
        }
        return (
            <View style={styles.cameraRoot}>
                <CameraView
                    ref={cameraRef}
                    style={styles.camera}
                    facing="back"
                    onCameraReady={() => setCameraReady(true)}
                />
                <View style={styles.camOverlayTop}>
                    <Text style={styles.camHintName}>{clientName || 'Delivery'}</Text>
                    {phone ? <Text style={styles.camHintPhone}>{phone}</Text> : null}
                </View>
                <Text style={styles.camBanner}>
                    {shots.length === 0
                        ? 'Tap the shutter for each photo'
                        : `${shots.length} photo(s) — add more or review`}
                </Text>
                <Pressable style={styles.closeX} onPress={() => setStep('VERIFY')}>
                    <Text style={styles.closeXT}>✕</Text>
                </Pressable>
                <View style={styles.camBar}>
                    {shots.length > 0 ? (
                        <Pressable style={styles.reviewBtn} onPress={() => setStep('PREVIEW')}>
                            <Text style={styles.reviewTxt}>Review {shots.length}</Text>
                        </Pressable>
                    ) : null}
                    <Pressable style={styles.shutter} onPress={takePicture} />
                </View>
            </View>
        );
    }

    if (step === 'PREVIEW') {
        return (
            <SafeAreaView style={styles.safe}>
                <ScrollView contentContainerStyle={styles.previewScroll}>
                    <Text style={styles.previewHdr}>Review photos</Text>
                    {shots.map((uri, i) => (
                        <View key={uri} style={styles.shotWrap}>
                            <Image source={{ uri }} style={styles.shotImg} resizeMode="contain" />
                            <Pressable style={styles.removeBtn} onPress={() => removeShotAt(i)}>
                                <Text style={styles.removeTxt}>Remove</Text>
                            </Pressable>
                        </View>
                    ))}
                    <Pressable style={styles.secondary} onPress={pickGallery}>
                        <Text style={styles.secondaryTxt}>Add from gallery</Text>
                    </Pressable>
                    <View style={styles.rowBtns}>
                        <Pressable style={styles.primary} onPress={submit} disabled={shots.length === 0}>
                            <Text style={styles.primaryTxt}>Submit {shots.length} photo(s)</Text>
                        </Pressable>
                        <Pressable style={styles.outline} onPress={() => setStep('CAPTURE')}>
                            <Text style={styles.outlineTxt}>Add more</Text>
                        </Pressable>
                    </View>
                </ScrollView>
            </SafeAreaView>
        );
    }

    if (step === 'UPLOADING') {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#3665F3" />
                <Text style={styles.muted}>Saving proof…</Text>
            </View>
        );
    }

    if (step === 'SUCCESS') {
        return (
            <View style={styles.center}>
                <Text style={styles.ok}>
                    {alreadyDelivered ? 'Already delivered' : queuedOffline ? 'Queued for upload' : 'Proof saved'}
                </Text>
                <Text style={styles.muted}>
                    {alreadyDelivered
                        ? 'This order already has proof on file.'
                        : queuedOffline
                          ? 'Photos are saved on this device and will upload when you are online.'
                          : 'You can close this screen.'}
                </Text>
                <Pressable style={styles.primary} onPress={() => router.back()}>
                    <Text style={styles.primaryTxt}>Done</Text>
                </Pressable>
            </View>
        );
    }

    if (step === 'ERROR') {
        return (
            <View style={styles.center}>
                <Text style={styles.err}>Upload failed</Text>
                <Text style={styles.errBody}>{error}</Text>
                <Pressable style={styles.outline} onPress={() => setStep('PREVIEW')}>
                    <Text style={styles.outlineTxt}>Try again</Text>
                </Pressable>
                <Pressable style={styles.ghost} onPress={() => router.back()}>
                    <Text style={styles.ghostTxt}>Close</Text>
                </Pressable>
            </View>
        );
    }

    return null;
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: '#fff' },
    scroll: { padding: 20, paddingBottom: 40 },
    badge: {
        alignSelf: 'center',
        backgroundColor: '#e0e7ff',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        marginBottom: 8,
    },
    badgeTxt: { color: '#3730a3', fontWeight: '700' },
    title: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
    sub: { textAlign: 'center', color: '#6b7280', marginTop: 6 },
    panel: { marginTop: 20, backgroundColor: '#f9fafb', borderRadius: 14, padding: 16, gap: 6 },
    k: { fontSize: 12, color: '#6b7280', fontWeight: '600', marginTop: 8 },
    v: { fontSize: 16, color: '#111', fontWeight: '600' },
    primary: {
        backgroundColor: '#3665F3',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 20,
    },
    primaryTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
    ghost: { marginTop: 12, alignItems: 'center', padding: 12 },
    ghostTxt: { color: '#6b7280', fontWeight: '600' },
    cameraRoot: { flex: 1, backgroundColor: '#000' },
    camera: { flex: 1 },
    camOverlayTop: {
        position: 'absolute',
        top: 56,
        left: 16,
        right: 16,
        backgroundColor: 'rgba(0,0,0,0.65)',
        padding: 12,
        borderRadius: 12,
    },
    camHintName: { color: '#fff', fontWeight: '700', fontSize: 16 },
    camHintPhone: { color: '#93c5fd', marginTop: 4 },
    camBanner: {
        position: 'absolute',
        top: 140,
        left: 16,
        right: 16,
        textAlign: 'center',
        backgroundColor: 'rgba(59, 130, 246, 0.92)',
        color: '#fff',
        padding: 10,
        borderRadius: 12,
        fontWeight: '600',
        overflow: 'hidden',
    },
    closeX: {
        position: 'absolute',
        top: 48,
        right: 16,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeXT: { color: '#fff', fontSize: 22, fontWeight: '700' },
    camBar: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: 36,
        paddingTop: 16,
        alignItems: 'center',
        gap: 12,
        backgroundColor: 'rgba(0,0,0,0.55)',
    },
    reviewBtn: {
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.35)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 999,
    },
    reviewTxt: { color: '#fff', fontWeight: '700' },
    shutter: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#fff',
        borderWidth: 4,
        borderColor: '#d1d5db',
    },
    previewScroll: { padding: 16, paddingBottom: 40 },
    previewHdr: { fontSize: 20, fontWeight: '800', marginBottom: 12 },
    shotWrap: { marginBottom: 16 },
    shotImg: { width: '100%', height: 220, backgroundColor: '#111', borderRadius: 12 },
    removeBtn: {
        position: 'absolute',
        top: 8,
        right: 8,
        backgroundColor: 'rgba(220,38,38,0.95)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
    },
    removeTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },
    secondary: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 12,
    },
    secondaryTxt: { fontWeight: '700', color: '#111' },
    rowBtns: { gap: 10, marginTop: 8 },
    outline: {
        borderWidth: 1,
        borderColor: '#e5e7eb',
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        backgroundColor: '#fff',
    },
    outlineTxt: { fontWeight: '700', color: '#111' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' },
    muted: { marginTop: 10, color: '#6b7280', textAlign: 'center' },
    ok: { fontSize: 22, fontWeight: '800', color: '#16a34a' },
    err: { fontSize: 20, fontWeight: '800', color: '#dc2626' },
    errBody: { color: '#991b1b', marginTop: 8, textAlign: 'center' },
});
