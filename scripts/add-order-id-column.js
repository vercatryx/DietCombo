// Script to add order_id column to signatures table
// Usage: node scripts/add-order-id-column.js

const mysql = require('mysql2/promise');

async function addOrderIdColumn() {
    let connection;
    try {
        console.log('Connecting to database...');
        
        // Database connection
        connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'localhost',
            port: parseInt(process.env.MYSQL_PORT || '3306'),
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || '',
            database: process.env.MYSQL_DATABASE || 'dietcombo'
        });

        console.log('Checking if order_id column exists...');
        
        // Check if column exists
        const [columnCheck] = await connection.execute(
            `SELECT COUNT(*) as cnt 
             FROM information_schema.COLUMNS 
             WHERE TABLE_SCHEMA = DATABASE() 
             AND TABLE_NAME = 'signatures' 
             AND COLUMN_NAME = 'order_id'`
        );

        if (columnCheck[0].cnt > 0) {
            console.log('✅ Column order_id already exists. Skipping...');
            return;
        }

        console.log('Adding order_id column...');
        await connection.execute(
            `ALTER TABLE signatures
             ADD COLUMN order_id VARCHAR(36) NULL AFTER client_id`
        );
        console.log('✅ Added order_id column');

        console.log('Adding index...');
        try {
            await connection.execute(
                `ALTER TABLE signatures
                 ADD INDEX idx_signatures_order_id (order_id)`
            );
            console.log('✅ Added index');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME') {
                console.log('ℹ️  Index already exists, skipping...');
            } else {
                throw err;
            }
        }

        console.log('Adding foreign key constraint...');
        try {
            await connection.execute(
                `ALTER TABLE signatures
                 ADD CONSTRAINT fk_signatures_order_id 
                 FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL`
            );
            console.log('✅ Added foreign key constraint');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_DUP_FIELDNAME') {
                console.log('ℹ️  Foreign key constraint already exists, skipping...');
            } else {
                throw err;
            }
        }

        console.log('✅ Migration completed successfully!');
    } catch (error) {
        console.error('❌ Error running migration:', error.message);
        if (error.code) {
            console.error('   Error code:', error.code);
        }
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

addOrderIdColumn();
