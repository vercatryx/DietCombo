'use server';

import { sendEmail } from './email';

interface SchedulingReport {
    totalCreated: number;
    breakdown: {
        Food: number;
        Meal: number;
        Boxes: number;
        Custom: number;
    };
    unexpectedFailures: Array<{
        clientName: string;
        orderType: string;
        date: string;
        reason: string;
    }>;
}

export async function sendSchedulingReport(report: SchedulingReport, reportEmail: string): Promise<void> {
    const html = `
        <h2>Scheduling Report</h2>
        <p><strong>Total Orders Created:</strong> ${report.totalCreated}</p>
        <h3>Breakdown by Type:</h3>
        <ul>
            <li>Food: ${report.breakdown.Food}</li>
            <li>Meal: ${report.breakdown.Meal}</li>
            <li>Boxes: ${report.breakdown.Boxes}</li>
            <li>Custom: ${report.breakdown.Custom}</li>
        </ul>
        ${report.unexpectedFailures.length > 0 ? `
            <h3>Unexpected Failures (${report.unexpectedFailures.length}):</h3>
            <table border="1" cellpadding="5" cellspacing="0">
                <tr>
                    <th>Client Name</th>
                    <th>Order Type</th>
                    <th>Date</th>
                    <th>Reason</th>
                </tr>
                ${report.unexpectedFailures.map(f => `
                    <tr>
                        <td>${f.clientName}</td>
                        <td>${f.orderType}</td>
                        <td>${f.date}</td>
                        <td>${f.reason}</td>
                    </tr>
                `).join('')}
            </table>
        ` : '<p>No unexpected failures.</p>'}
    `;

    await sendEmail({
        to: reportEmail,
        subject: 'Scheduling Report - Order Creation Summary',
        html
    });
}
