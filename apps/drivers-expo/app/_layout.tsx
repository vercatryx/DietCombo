import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { PendingUploadProvider } from '@/contexts/PendingUploadContext';
import { useColorScheme } from '@/components/useColorScheme';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export { ErrorBoundary } from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
    const [loaded, error] = useFonts({
        SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
        ...FontAwesome.font,
    });

    useEffect(() => {
        if (error) throw error;
    }, [error]);

    useEffect(() => {
        if (loaded) SplashScreen.hideAsync();
    }, [loaded]);

    if (!loaded) return null;

    return <RootLayoutNav />;
}

function RootLayoutNav() {
    const colorScheme = useColorScheme();

    return (
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <SafeAreaProvider>
            <PendingUploadProvider>
                <Stack>
                    <Stack.Screen name="index" options={{ title: 'Delivery Routes', headerShown: true }} />
                    <Stack.Screen name="driver/[id]" options={{ title: 'Route', headerBackTitle: 'Routes' }} />
                    <Stack.Screen
                        name="delivery/[orderId]"
                        options={{
                            title: 'Delivery proof',
                            presentation: 'modal',
                            headerShown: true,
                        }}
                    />
                </Stack>
            </PendingUploadProvider>
            </SafeAreaProvider>
        </ThemeProvider>
    );
}
