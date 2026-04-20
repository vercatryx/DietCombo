import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSmsToClient, formatDeliveryTimestamp } from './telnyx';

/**
 * If app_settings.text_on_delivery is on, send the standard “food has been delivered” SMS
 * to the client (respecting do_not_text / per-number flags). Used by client delivery and produce proof flows.
 */
export async function sendDeliveryNotificationIfEnabled(
    supabase: SupabaseClient,
    clientId: string,
): Promise<void> {
    try {
        const { data: settings } = await supabase
            .from('app_settings')
            .select('text_on_delivery')
            .eq('id', '1')
            .single();

        if (!settings?.text_on_delivery) return;

        const { data: client } = await supabase
            .from('clients')
            .select('id, phone_number, secondary_phone_number, full_name, do_not_text, do_not_text_numbers')
            .eq('id', clientId)
            .single();

        if (!client || client.do_not_text) return;

        const timestamp = formatDeliveryTimestamp(new Date());
        const name = client.full_name?.split(' ')[0] || '';
        const greeting = name ? `Hello ${name}, this` : 'Hello, this';
        const message = `${greeting} is The Diet Fantasy. Your food has been delivered on ${timestamp}. If you have any questions, please don't hesitate to reach out.`;

        await sendSmsToClient(client, message);
    } catch (err) {
        console.error('[Delivery SMS] Failed to send notification:', err);
    }
}
