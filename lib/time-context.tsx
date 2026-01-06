'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface TimeContextType {
    currentTime: Date;
    isFakeTime: boolean;
    setFakeTime: (time: Date | null) => void;
}

const TimeContext = createContext<TimeContextType | undefined>(undefined);

export function TimeProvider({ children, initialFakeTime }: { children: React.ReactNode, initialFakeTime?: string | null }) {
    const [fakeTime, setFakeTimeState] = useState<Date | null>(
        initialFakeTime ? new Date(initialFakeTime) : null
    );

    // If fake time is set, that's the "current" time. Otherwise, basic new Date().
    // NOTE: In a real "clock" scenario, we might want this to tick. 
    // But for a "testing override", usually a static fixed time is easier to debug, or a "simulated clock" offset.
    // The user request implies "setting what time the system thinks it is".
    // If we want it to actually tick from that point, we'd need an offset.
    // For now, let's treat the fake time as a static snapshot unless changed, or just the base.
    // Actually simplicity: if fake time is set, return that. If not, return real date.
    const currentTime = fakeTime || new Date();

    const setFakeTime = (time: Date | null) => {
        setFakeTimeState(time);
        if (time) {
            document.cookie = `x-fake-time=${time.toISOString()}; path=/; max-age=86400; SameSite=Lax`;
        } else {
            document.cookie = 'x-fake-time=; path=/; max-age=0; SameSite=Lax';
        }
    };

    // Optional: Auto-refresh "real" time if not fake? 
    // For many apps, just getting new Date() on render is enough, but to show a ticking clock we might need state.
    // Let's stick to the override logic primarily.

    return (
        <TimeContext.Provider value={{ currentTime, isFakeTime: !!fakeTime, setFakeTime }}>
            {children}
        </TimeContext.Provider>
    );
}

export function useTime() {
    const context = useContext(TimeContext);
    if (context === undefined) {
        throw new Error('useTime must be used within a TimeProvider');
    }
    return context;
}
