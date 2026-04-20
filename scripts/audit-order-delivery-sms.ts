/**
 * Audit whether a delivery SMS should have been sent after a proof image upload.
 *
 * Code facts (see app/delivery/actions.ts, app/produce/actions.ts, lib/delivery-notification.ts):
 * - Client delivery and produce proof uploads call sendDeliveryNotificationIfEnabled when proof is saved successfully.
 * - Vendor/admin proof via saveDeliveryProofUrlAndProcessOrder alone does NOT send that SMS (unless the request goes through those client flows).
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/audit-order-delivery-sms.ts [order_number]
 *
 * Requires DATABASE_URL in .env.local (same DB as production).
 */

import { PrismaClient } from '../lib/generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = value;
        }
    });
} else {
    console.error('No .env.local found (need DATABASE_URL)');
    process.exit(1);
}

const ORDER_NUM = parseInt(process.argv[2] || '6960135', 10);

function guessProofSource(url: string | null): string {
    if (!url) return '(no url)';
    if (url.includes('/produce-proof-')) return 'likely Produce client flow (R2 key produce-proof-*)';
    if (url.includes('/proof-')) return 'likely Delivery client flow (R2 key proof-*)';
    return 'unknown (check URL path)';
}

async function main() {
    const prisma = new PrismaClient();
    try {
        await prisma.$connect();

        const order = await prisma.order.findFirst({
            where: { orderNumber: ORDER_NUM },
            select: {
                id: true,
                clientId: true,
                orderNumber: true,
                status: true,
                serviceType: true,
                proofOfDeliveryUrl: true,
                actualDeliveryDate: true,
                lastUpdated: true,
            },
        });

        const upcoming = order
            ? null
            : await prisma.upcomingOrder.findFirst({
                  where: { orderNumber: ORDER_NUM },
                  select: {
                      id: true,
                      clientId: true,
                      orderNumber: true,
                      status: true,
                      serviceType: true,
                      processedOrderId: true,
                      processedAt: true,
                      lastUpdated: true,
                  },
              });

        if (!order && !upcoming) {
            console.log(`No row in orders or upcoming_orders with order_number = ${ORDER_NUM}`);
            process.exit(0);
        }

        const clientId = order?.clientId ?? upcoming!.clientId;
        const proofUrl = order?.proofOfDeliveryUrl ?? null;

        const clientRows = await prisma.$queryRaw<
            {
                id: string;
                full_name: string;
                phone_number: string | null;
                secondary_phone_number: string | null;
                do_not_text: boolean | null;
                do_not_text_numbers: unknown | null;
                do_not_text_reason: string | null;
            }[]
        >`
            SELECT id, full_name, phone_number, secondary_phone_number,
                   do_not_text, do_not_text_numbers, do_not_text_reason
            FROM clients WHERE id = ${clientId} LIMIT 1
        `;
        const client = clientRows[0] ?? null;

        const settingsRows = await prisma.$queryRaw<{ text_on_delivery: boolean | null }[]>`
            SELECT text_on_delivery FROM app_settings WHERE id = '1' LIMIT 1
        `;
        const textOnDelivery = settingsRows[0]?.text_on_delivery === true;

        const smsRows = await prisma.$queryRaw<
            {
                id: string;
                created_at: Date;
                message_type: string;
                success: boolean;
                phone_to: string;
                error: string | null;
                telnyx_message_id: string | null;
            }[]
        >`
            SELECT id, created_at, message_type, success, phone_to, error, telnyx_message_id
            FROM sms_outbound_log
            WHERE client_id = ${clientId}
              AND message_type = 'delivery_notification'
            ORDER BY created_at DESC
            LIMIT 25
        `;

        const stopProof = order
            ? await prisma.$queryRaw<{ proof_url: string | null; updated_at: Date }[]>`
                SELECT proof_url, updated_at FROM stops WHERE order_id = ${order.id} LIMIT 1
            `
            : [];

        console.log('\n=== Order ===');
        if (order) {
            console.log(JSON.stringify({ table: 'orders', ...order }, null, 2));
            console.log('Proof source guess:', guessProofSource(order.proofOfDeliveryUrl));
        } else {
            console.log(JSON.stringify({ table: 'upcoming_orders', ...upcoming }, null, 2));
            console.log('Note: upcoming_orders has no proof_of_delivery_url in Prisma; proof may live on processed orders row or stops.');
        }

        console.log('\n=== App setting: text_on_delivery ===');
        console.log(textOnDelivery ? 'ENABLED (delivery flow will attempt SMS)' : 'DISABLED (delivery flow skips SMS entirely)');

        console.log('\n=== Client (SMS eligibility) ===');
        console.log(JSON.stringify(client, null, 2));

        console.log('\n=== sms_outbound_log: delivery_notification (last 25 for this client) ===');
        if (smsRows.length === 0) {
            console.log('(none)');
        } else {
            console.table(
                smsRows.map((r) => ({
                    created_at: r.created_at.toISOString(),
                    success: r.success,
                    phone_to: r.phone_to,
                    error: r.error?.slice(0, 80) ?? '',
                    telnyx_id: r.telnyx_message_id?.slice(0, 12) ?? '',
                })),
            );
        }

        if (stopProof.length) {
            console.log('\n=== stops row for this order (proof sync from delivery flow) ===');
            console.log(JSON.stringify(stopProof[0], null, 2));
        }

        console.log('\n=== Conclusion ===');
        if (!proofUrl && order) {
            console.log('- No proof_of_delivery_url on orders row; if an image exists only elsewhere, say where (stops/vendor).');
        }
        if (!textOnDelivery) {
            console.log('- text_on_delivery is off: even a client /delivery upload would NOT send SMS.');
        }
        if (client?.do_not_text) {
            console.log('- Client do_not_text: SMS would be skipped.');
        }
        const hasSuccessDeliverySms = smsRows.some((r) => r.success);
        if (hasSuccessDeliverySms) {
            console.log('- At least one successful delivery_notification SMS exists in the log for this client (may or may not match this order’s time).');
        } else if (smsRows.length > 0) {
            console.log('- delivery_notification attempts exist but none succeeded (see errors in table).');
        } else {
            console.log('- No delivery_notification rows for this client: consistent with “no SMS sent” OR SMS path never ran (e.g. Produce/vendor upload, or text_on_delivery off).');
        }
        if (proofUrl && proofUrl.includes('produce-proof-')) {
            console.log('- Proof URL pattern suggests Produce flow: that code path does not send delivery_notification SMS.');
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
