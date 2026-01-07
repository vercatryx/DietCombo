import mysql from 'mysql2/promise';

// MySQL connection configuration
const dbConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'dietcombo',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

// Create connection pool
let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
    if (!pool) {
        pool = mysql.createPool(dbConfig);
    }
    return pool;
}

// Helper function to execute queries
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const connection = await getPool().getConnection();
    try {
        const [rows] = await connection.execute(sql, params);
        // mysql2 should automatically parse JSON fields, but ensure they're objects
        const parsedRows = (rows as any[]).map((row: any) => {
            if (!row || typeof row !== 'object') return row;
            const parsed: any = { ...row };
            // Handle JSON fields that might come as strings or Buffers
            ['active_order', 'billings', 'visits', 'delivery_days', 'delivery_distribution', 'items', 'options', 'conditional_text_inputs', 'snapshot', 'strokes', 'stop_ids', 'data'].forEach(field => {
                if (parsed[field] !== null && parsed[field] !== undefined) {
                    if (Buffer.isBuffer(parsed[field])) {
                        try {
                            parsed[field] = JSON.parse(parsed[field].toString());
                        } catch (e) {
                            // Keep as is if parsing fails
                        }
                    } else if (typeof parsed[field] === 'string' && (parsed[field].startsWith('{') || parsed[field].startsWith('['))) {
                        try {
                            parsed[field] = JSON.parse(parsed[field]);
                        } catch (e) {
                            // Keep as is if parsing fails
                        }
                    }
                }
            });
            return parsed;
        });
        return parsedRows as T[];
    } catch (error) {
        console.error('[mysql.query] Error executing query:', error, { sql, params });
        throw error;
    } finally {
        connection.release();
    }
}

// Helper function for single row queries
export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const results = await query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
}

// Helper function for insert operations (returns the inserted ID or UUID)
export async function insert(sql: string, params?: any[]): Promise<string | number> {
    const connection = await getPool().getConnection();
    try {
        const [result] = await connection.execute(sql, params) as any;
        // For UUID-based tables, we need to return the UUID from params, not insertId
        // Check if the first param is a UUID (36 chars)
        if (params && params.length > 0 && typeof params[0] === 'string' && params[0].length === 36) {
            return params[0];
        }
        return result.insertId;
    } finally {
        connection.release();
    }
}

// Helper function for update/delete operations (returns affected rows)
export async function execute(sql: string, params?: any[]): Promise<number> {
    const connection = await getPool().getConnection();
    try {
        const [result] = await connection.execute(sql, params) as any;
        return result.affectedRows;
    } finally {
        connection.release();
    }
}

// Helper to generate UUID (MySQL doesn't have gen_random_uuid, so we use UUID() function)
export function generateUUID(): string {
    return crypto.randomUUID();
}

// Helper to convert snake_case to camelCase for result mapping
export function toCamelCase(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
        return obj.map(toCamelCase);
    }
    if (typeof obj !== 'object') return obj;
    
    const camelObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        camelObj[camelKey] = toCamelCase(value);
    }
    return camelObj;
}

// Helper to convert camelCase to snake_case for database operations
export function toSnakeCase(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) {
        return obj.map(toSnakeCase);
    }
    if (typeof obj !== 'object') return obj;
    
    const snakeObj: any = {};
    for (const [key, value] of Object.entries(obj)) {
        const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        snakeObj[snakeKey] = toSnakeCase(value);
    }
    return snakeObj;
}

