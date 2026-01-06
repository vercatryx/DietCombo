import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { email, skippedReasons, errors, skippedCount } = body;

        if (!email) {
            return NextResponse.json(
                { success: false, error: 'Email address is required' },
                { status: 400 }
            );
        }

        if (!skippedReasons || skippedReasons.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No skipped orders to report' },
                { status: 400 }
            );
        }

        // Build HTML email content
        const skippedList = skippedReasons.map((reason: string, index: number) => 
            `<li style="margin-bottom: 8px;">${reason}</li>`
        ).join('');

        const errorsList = errors && errors.length > 0 
            ? `<h3 style="color: #dc2626; margin-top: 20px;">Errors (${errors.length})</h3>
               <ul style="color: #6b7280;">${errors.map((error: string) => 
                   `<li style="margin-bottom: 8px;">${error}</li>`
               ).join('')}</ul>`
            : '';

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                    .content { background-color: #ffffff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 5px; }
                    h2 { color: #1f2937; margin-top: 0; }
                    h3 { color: #f59e0b; margin-top: 20px; }
                    ul { margin: 10px 0; padding-left: 20px; }
                    li { margin-bottom: 8px; }
                    .summary { background-color: #fef3c7; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h2>Delivery Simulation Report</h2>
                    </div>
                    <div class="content">
                        <div class="summary">
                            <strong>Summary:</strong> ${skippedCount || skippedReasons.length} order(s) were skipped during the delivery simulation.
                        </div>
                        
                        <h3>Skipped Orders (${skippedReasons.length})</h3>
                        <ul style="color: #6b7280;">
                            ${skippedList}
                        </ul>
                        
                        ${errorsList}
                        
                        <p style="margin-top: 30px; color: #6b7280; font-size: 0.9em;">
                            This is an automated report from the Delivery Simulation system.
                        </p>
                    </div>
                </div>
            </body>
            </html>
        `;

        const text = `
Delivery Simulation Report

Summary: ${skippedCount || skippedReasons.length} order(s) were skipped during the delivery simulation.

Skipped Orders (${skippedReasons.length}):
${skippedReasons.map((reason: string, index: number) => `${index + 1}. ${reason}`).join('\n')}

${errors && errors.length > 0 ? `\nErrors (${errors.length}):\n${errors.map((error: string, index: number) => `${index + 1}. ${error}`).join('\n')}` : ''}

This is an automated report from the Delivery Simulation system.
        `;

        const result = await sendEmail({
            to: email,
            subject: `Delivery Simulation Report - ${skippedCount || skippedReasons.length} Skipped Order(s)`,
            html,
            text
        });

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error || 'Failed to send email' },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error sending skipped orders report:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'An error occurred while sending the email' },
            { status: 500 }
        );
    }
}








