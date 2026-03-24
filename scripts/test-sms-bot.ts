/**
 * Test the SMS bot locally by simulating an inbound message.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/test-sms-bot.ts
 *
 * Or with a custom message:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/test-sms-bot.ts "What's on my menu?"
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const TEST_PHONE = '+13472150400';

async function main() {
    const message = process.argv[2] || 'Hi, what can you help me with?';

    console.log('=== SMS Bot Test ===');
    console.log(`Phone: ${TEST_PHONE}`);
    console.log(`Message: "${message}"`);
    console.log('');

    const { handleInboundSms } = await import('../lib/sms-bot');
    await handleInboundSms(TEST_PHONE, message);

    console.log('\n=== Done ===');
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
