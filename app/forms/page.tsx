
"use client";

import { useState, useEffect } from 'react';
import FormFiller from '@/components/forms/FormFiller';
import { FormSchema } from '@/lib/form-types';
import { getSingleForm } from '@/lib/form-actions';

export default function FormsPage() {
    const [currentSchema, setCurrentSchema] = useState<FormSchema | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadForm();
    }, []);

    const loadForm = async () => {
        setIsLoading(true);
        try {
            const result = await getSingleForm();
            if (result.success && result.data) {
                setCurrentSchema(result.data);
            } else if (!result.data) {
                setError("Forms are currently unavailable. Please check back later.");
            }
        } catch (err) {
            setError("Failed to load the form.");
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-gray-400">Loading form...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white p-4">
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-8 max-w-md text-center">
                    <h2 className="text-xl font-bold text-red-400 mb-2">Unavailable</h2>
                    <p className="text-gray-300">{error}</p>
                </div>
            </div>
        );
    }

    if (!currentSchema) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white p-4">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-gray-200 mb-2">No Form Found</h2>
                    <p className="text-gray-400">The administrator has not configured the screening form yet.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-12 font-sans selection:bg-purple-500/30">
            <div className="max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-500">
                <header className="mb-8 text-center">
                    <p className="text-gray-500 uppercase tracking-widest text-xs font-bold mb-2">Secure Submission</p>
                    <h1 className="text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 tracking-tight">
                        {currentSchema.title}
                    </h1>
                </header>

                <FormFiller
                    schema={currentSchema}
                    onBack={() => {
                        // In single form mode, "back" might just refresh or do nothing if there's no list to go back to.
                        // Or we could redirect to home. For now, we'll reload.
                        window.location.reload();
                    }}
                />
            </div>
        </div>
    );
}

