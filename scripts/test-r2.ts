
import { uploadFile } from '../lib/storage';

async function testConnection() {
    console.log('Testing R2 Connection...');
    try {
        const testContent = Buffer.from('Hello R2, this is a test from the verification script.');
        const key = `test-connection-${Date.now()}.txt`;

        console.log(`Attempting to upload ${key} to bucket...`);
        const result = await uploadFile(key, testContent, 'text/plain');

        if (result.success) {
            console.log('✅ Upload successful!');
            console.log(`Key: ${result.key}`);
        } else {
            console.error('❌ Upload returned failure status.');
        }
    } catch (error) {
        console.error('❌ Connection failed:', error);
        process.exit(1);
    }
}

testConnection();
