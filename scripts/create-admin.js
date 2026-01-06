// Script to create an admin user in the database
// Usage: node scripts/create-admin.js <username> <password> <name>

const { hash } = require('bcryptjs');
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');

async function createAdmin() {
    const username = process.argv[2] || 'admin';
    const password = process.argv[3] || 'admin123';
    const name = process.argv[4] || 'Admin';

    // Hash the password
    const hashedPassword = await hash(password, 10);
    const id = randomUUID();

    // Database connection
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'dietcombo'
    });

    try {
        // Insert admin
        await connection.execute(
            'INSERT INTO admins (id, username, password, name) VALUES (?, ?, ?, ?)',
            [id, username, hashedPassword, name]
        );
        console.log(`✅ Admin created successfully!`);
        console.log(`   Username: ${username}`);
        console.log(`   Password: ${password}`);
        console.log(`   Name: ${name}`);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            console.error(`❌ Error: Username "${username}" already exists`);
        } else {
            console.error('❌ Error creating admin:', error.message);
        }
    } finally {
        await connection.end();
    }
}

createAdmin();

