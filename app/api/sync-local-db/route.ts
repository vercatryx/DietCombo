import { NextRequest, NextResponse } from 'next/server';
import { syncLocalDBFromSupabase } from '@/lib/local-db';

/**
 * API route to sync local database from Supabase
 * This can be called periodically to keep local DB updated
 */
export async function GET(request: NextRequest) {
    try {
        await syncLocalDBFromSupabase();
        return NextResponse.json({ 
            success: true, 
            message: 'Local database synced successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Error syncing local database:', error);
        return NextResponse.json(
            { 
                success: false, 
                error: error.message || 'Failed to sync local database' 
            },
            { status: 500 }
        );
    }
}

/**
 * POST endpoint to trigger sync manually
 */
export async function POST(request: NextRequest) {
    try {
        await syncLocalDBFromSupabase();
        return NextResponse.json({ 
            success: true, 
            message: 'Local database synced successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Error syncing local database:', error);
        return NextResponse.json(
            { 
                success: false, 
                error: error.message || 'Failed to sync local database' 
            },
            { status: 500 }
        );
    }
}

