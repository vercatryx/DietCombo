'use server';

import nodemailer from 'nodemailer';

/**
 * Email configuration for GoDaddy hosted email
 * Set these environment variables:
 * - SMTP_HOST (e.g., smtp.secureserver.net for GoDaddy)
 * - SMTP_PORT (usually 465 for SSL or 587 for TLS)
 * - SMTP_SECURE (true for port 465, false for port 587)
 * - SMTP_USER (your email address)
 * - SMTP_PASS (your email password)
 * 
 * Backup Gmail credentials (used if main email service fails):
 * - GMAIL_BACKUP_USER (Gmail email address)
 * - GMAIL_BACKUP_PASS (Gmail app password)
 */

interface EmailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
}

async function sendWithTransporter(
    transporter: nodemailer.Transporter,
    fromEmail: string,
    options: EmailOptions
): Promise<void> {
    await transporter.sendMail({
        from: `"Triangle Square System" <${fromEmail}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]*>/g, '') // Strip HTML for text version
    });
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
    // Try main email service first
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    // If main email is configured, try it first
    if (host && user && pass) {
        try {
            const transporter = nodemailer.createTransport({
                host,
                port,
                secure,
                auth: {
                    user,
                    pass
                }
            });

            await sendWithTransporter(transporter, user, options);
            return { success: true };
        } catch (error: any) {
            console.warn('Main email service failed, attempting Gmail fallback:', error.message);
            // Fall through to Gmail backup
        }
    } else {
        console.warn('Main email not configured, using Gmail fallback');
    }

    // Fallback to Gmail
    const gmailUser = process.env.GMAIL_BACKUP_USER;
    const gmailPass = process.env.GMAIL_BACKUP_PASS;

    if (!gmailUser || !gmailPass) {
        return {
            success: false,
            error: 'Main email service failed and Gmail backup credentials are not configured. Please set GMAIL_BACKUP_USER and GMAIL_BACKUP_PASS environment variables.'
        };
    }

    try {
        const gmailTransporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false, // Use TLS
            auth: {
                user: gmailUser,
                pass: gmailPass
            }
        });

        await sendWithTransporter(gmailTransporter, gmailUser, options);
        console.log('Email sent successfully using Gmail fallback');
        return { success: true };
    } catch (error: any) {
        console.error('Error sending email with Gmail fallback:', error);
        return {
            success: false,
            error: error.message || 'Failed to send email with both main service and Gmail fallback'
        };
    }
}

