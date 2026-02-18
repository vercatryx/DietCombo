'use server';

import nodemailer from 'nodemailer';

/**
 * Single-sender email. Credentials are read from the environment.
 *
 * Set in .env (or your env file):
 *   SMTP_HOST       - e.g. smtp.secureserver.net (GoDaddy), smtp.gmail.com
 *   SMTP_PORT       - e.g. 465 (SSL) or 587 (TLS)
 *   SMTP_SECURE     - "true" for port 465, "false" for 587
 *   SMTP_USER       - sender email (login)
 *   SMTP_PASS       - sender password or app password
 *   SMTP_FROM_NAME  - (optional) display name, e.g. "Diet Fantasy"
 */

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

function getTransporter(): { transporter: nodemailer.Transporter; from: string } {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const fromName = process.env.SMTP_FROM_NAME || 'Diet Fantasy';

    if (!host || !user || !pass) {
        throw new Error(
            'Email not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env file.'
        );
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
    });

    const from = `"${fromName}" <${user}>`;
    return { transporter, from };
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    try {
        const { transporter, from } = getTransporter();
        await transporter.sendMail({
            from,
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text ?? options.html.replace(/<[^>]*>/g, ''),
        });
        return { success: true };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to send email';
        console.error('Email send error:', message);
        return { success: false, error: message };
    }
}

