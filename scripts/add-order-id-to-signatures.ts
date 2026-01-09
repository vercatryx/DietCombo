// Script to add order_id column to signatures table
// Usage: tsx scripts/add-order-id-to-signatures.ts

import { query, execute } from '../lib/mysql';

async function addOrderIdColumn() {
    try {
        console.log('Checking if order_id column exists...');
        
        // Check if column exists
        const columnCheck = await query<{ exists: number }>(
            `SELECT COUNT(*) as exists 
             FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'signatures' 
             AND COLUMN_NAME = 'order_id'`
        );

        if (columnCheck[0]?.exists > 0) {
            console.log('✅ Column order_id already exists. Skipping...');
            return;
        }

        console.log('Adding order_id column...');
        await execute(
            `ALTER TABLE signatures
             ADD COLUMN order_id VARCHAR(36) NULL AFTER client_id`
        );
        console.log('✅ Added order_id column');

        console.log('Adding index...');
        try {
            await execute(
                `ALTER TABLE signatures
                 ADD INDEX idx_signatures_order_id (order_id)`
            );
            console.log('✅ Added index');
        } catch (err: any) {
            if (err.code === 'ER_DUP_KEYNAME') {
                console.log('ℹ️  Index already exists, skipping...');
            } else {
                throw err;
            }
        }

        console.log('Adding foreign key constraint...');
        try {
            await execute(
                `ALTER TABLE signatures
                 ADD CONSTRAINT fk_signatures_order_id 
                 FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL`
            );
            console.log('✅ Added foreign key constraint');
        } catch (err: any) {
            if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_DUP_FIELDNAME') {
                console.log('ℹ️  Foreign key constraint already exists, skipping...');
            } else {
                throw err;
            }
        }

        console.log('✅ Migration completed successfully!');
    } catch (error: any) {
        console.error('❌ Error running migration:', error.message);
        process.exit(1);
    }
}

addOrderIdColumn();
