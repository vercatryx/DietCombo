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

    // Tick state: when using real time, update every second so the sidebar clock ticks.
    // When fake time is set, no tick (static override for testing).
    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (fakeTime) return;
        const id = setInterval(() => setTick((t) => t + 1), 1000);
        return () => clearInterval(id);
    }, [fakeTime]);

    const currentTime = fakeTime ?? new Date();

    const setFakeTime = (time: Date | null) => {
        setFakeTimeState(time);
        if (time) {
            document.cookie = `x-fake-time=${time.toISOString()}; path=/; max-age=86400; SameSite=Lax`;
        } else {
            document.cookie = 'x-fake-time=; path=/; max-age=0; SameSite=Lax';
        }
    };

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
