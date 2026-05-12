/**
 * Verify SMTP credentials (same env as lib/email.ts).
 *
 * Set in .env.local:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS
 *
 * Run:
 *   npm run test-smtp
 */
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');

    if (!host || !user || !pass) {
        console.error('Missing SMTP_HOST, SMTP_USER, or SMTP_PASS. Set them in .env.local');
        process.exit(1);
    }

    console.log('SMTP verify (no email sent)...');
    console.log('  Host:', host);
    console.log('  Port:', port);
    console.log('  Secure:', secure);
    console.log('  User:', user);

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
    });

    try {
        await transporter.verify();
        console.log('OK: SMTP authentication succeeded.');
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('FAILED:', msg);
        process.exit(1);
    }
}

main();
