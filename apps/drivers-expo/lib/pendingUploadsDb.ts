import * as SQLite from 'expo-sqlite';

export type PendingRow = {
    id: string;
    order_id: string;
    local_uris: string;
    created_at: string;
    attempts: number;
    last_error: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (!dbPromise) {
        dbPromise = (async () => {
            const database = await SQLite.openDatabaseAsync('drivers_pending.db');
            await database.execAsync(`
        CREATE TABLE IF NOT EXISTS pending_uploads (
          id TEXT PRIMARY KEY NOT NULL,
          order_id TEXT NOT NULL,
          local_uris TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        );
      `);
            return database;
        })();
    }
    return dbPromise;
}

export async function enqueuePendingUpload(id: string, orderId: string, localUris: string[]): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    await db.runAsync(
        `INSERT OR REPLACE INTO pending_uploads (id, order_id, local_uris, created_at, attempts, last_error) VALUES (?, ?, ?, ?, 0, NULL)`,
        [id, orderId, JSON.stringify(localUris), now]
    );
}

export async function listPendingUploads(): Promise<PendingRow[]> {
    const db = await getDatabase();
    return db.getAllAsync<PendingRow>(`SELECT * FROM pending_uploads ORDER BY created_at ASC`);
}

export async function countPendingUploads(): Promise<number> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM pending_uploads`);
    return row?.c ?? 0;
}

export async function deletePendingUpload(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`DELETE FROM pending_uploads WHERE id = ?`, [id]);
}

export async function bumpAttempt(id: string, err: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(`UPDATE pending_uploads SET attempts = attempts + 1, last_error = ? WHERE id = ?`, [err, id]);
}
