import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from './supabase-env';
import { sendSms, formatDeliveryTimestamp } from './telnyx';
import { getTodayInAppTz, APP_TIMEZONE } from './timezone';
import { mealPlannerDateOnly, mealPlannerCutoffDate } from './meal-planner-utils';

const CONVERSATION_TTL_HOURS = 24;
const MAX_HISTORY_MESSAGES = 20;
const MAX_SMS_LENGTH = 1500;

function getSupabaseAdmin(): SupabaseClient {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!,
    );
}

// ── Client identification ───────────────────────────────────────────

export async function identifyClientByPhone(
    supabase: SupabaseClient,
    phone: string,
): Promise<{ id: string; full_name: string; service_type: string; phone_number: string; secondary_phone_number: string | null; address: string | null; apt: string | null; city: string | null; state: string | null; zip: string | null; parent_client_id: string | null; expiration_date: string | null; approved_meals_per_week: number | null }[]> {
    const cleaned = phone.replace(/[^\d+]/g, '');
    const digits = cleaned.replace(/\D/g, '');
    const e164 = cleaned.startsWith('+') ? cleaned : `+1${digits}`;

    const patterns = [e164, digits, digits.slice(-10)];
    const seen = new Set<string>();
    const results: any[] = [];

    for (const p of patterns) {
        if (!p || p.length < 10) continue;
        const { data } = await supabase
            .from('clients')
            .select('id, full_name, service_type, phone_number, secondary_phone_number, address, apt, city, state, zip, parent_client_id, expiration_date, approved_meals_per_week')
            .or(`phone_number.ilike.%${p}%,secondary_phone_number.ilike.%${p}%`);
        if (data) {
            for (const row of data) {
                if (!seen.has(row.id)) {
                    seen.add(row.id);
                    results.push(row);
                }
            }
        }
        if (results.length > 0) break;
    }
    return results;
}

// ── Conversation history ────────────────────────────────────────────

async function loadHistory(
    supabase: SupabaseClient,
    phone: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const cutoff = new Date(Date.now() - CONVERSATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
        .from('sms_conversations')
        .select('role, content')
        .eq('phone_number', phone)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(MAX_HISTORY_MESSAGES);
    return (data ?? []).map((r: any) => ({ role: r.role, content: r.content }));
}

async function saveMessage(
    supabase: SupabaseClient,
    phone: string,
    clientId: string | null,
    role: 'user' | 'assistant',
    content: string,
) {
    await supabase.from('sms_conversations').insert({
        phone_number: phone,
        client_id: clientId,
        role,
        content,
    });
}

async function pruneOldMessages(supabase: SupabaseClient, phone: string) {
    const cutoff = new Date(Date.now() - CONVERSATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
    await supabase
        .from('sms_conversations')
        .delete()
        .eq('phone_number', phone)
        .lt('created_at', cutoff);
}

// ── Tool definitions for Claude ─────────────────────────────────────

function defineBotTools(): Anthropic.Tool[] {
    return [
        {
            name: 'get_account_info',
            description: 'Get the client\'s account information including name, address, phone numbers, service type, and all household members (dependents) on this account.',
            input_schema: {
                type: 'object' as const,
                properties: {},
                required: [],
            },
        },
        {
            name: 'get_meal_plan_for_date',
            description: 'Get the client\'s saved meal plan (items and quantities) for a specific delivery date. Returns what is currently ordered for that date.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    date: { type: 'string', description: 'Delivery date in YYYY-MM-DD format' },
                },
                required: ['date'],
            },
        },
        {
            name: 'get_available_menu_for_date',
            description: 'Get all available menu items for a specific delivery date. Use this to show the client what they can order.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    date: { type: 'string', description: 'Delivery date in YYYY-MM-DD format' },
                },
                required: ['date'],
            },
        },
        {
            name: 'get_meal_plan_for_month',
            description: 'Get the client\'s meal plan for an entire month, showing all delivery dates and what is ordered on each. Use when the client wants to see their schedule or upcoming deliveries.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    year: { type: 'number', description: 'Year (e.g. 2026)' },
                    month: { type: 'number', description: 'Month number 1-12 (e.g. 4 for April)' },
                },
                required: ['year', 'month'],
            },
        },
        {
            name: 'save_meal_plan_for_date',
            description: 'Update the meal plan for a specific delivery date. Provide the complete list of items and quantities. The date must be today or in the future. Always confirm with the client before saving.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    date: { type: 'string', description: 'Delivery date in YYYY-MM-DD format' },
                    items: {
                        type: 'array',
                        description: 'Complete list of items for this date',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Item name (must match an available menu item exactly)' },
                                quantity: { type: 'number', description: 'Quantity to order (0 to remove)' },
                            },
                            required: ['name', 'quantity'],
                        },
                    },
                },
                required: ['date', 'items'],
            },
        },
    ];
}

// ── Tool executors ──────────────────────────────────────────────────

async function executeTool(
    supabase: SupabaseClient,
    clientId: string,
    toolName: string,
    args: any,
): Promise<string> {
    switch (toolName) {
        case 'get_account_info':
            return executeGetAccountInfo(supabase, clientId);
        case 'get_meal_plan_for_date':
            return executeGetMealPlanForDate(supabase, clientId, args.date);
        case 'get_available_menu_for_date':
            return executeGetAvailableMenu(supabase, clientId, args.date);
        case 'get_meal_plan_for_month':
            return executeGetMealPlanForMonth(supabase, clientId, args.year, args.month);
        case 'save_meal_plan_for_date':
            return executeSaveMealPlan(supabase, clientId, args.date, args.items);
        default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
}

async function executeGetAccountInfo(supabase: SupabaseClient, clientId: string): Promise<string> {
    const { data: client } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number, address, apt, city, state, zip, service_type, approved_meals_per_week, expiration_date, parent_client_id')
        .eq('id', clientId)
        .single();

    if (!client) return JSON.stringify({ error: 'Client not found' });

    const { data: dependents } = await supabase
        .from('clients')
        .select('id, full_name, service_type')
        .eq('parent_client_id', clientId)
        .order('full_name');

    const fullAddress = [client.address, client.apt, client.city, client.state, client.zip]
        .filter(Boolean).join(', ');

    return JSON.stringify({
        name: client.full_name,
        phone: client.phone_number,
        secondary_phone: client.secondary_phone_number,
        address: fullAddress || 'Not on file',
        service_type: client.service_type,
        approved_meals_per_week: client.approved_meals_per_week,
        expiration_date: client.expiration_date,
        household_members: (dependents ?? []).map((d: any) => d.full_name),
    });
}

async function executeGetMealPlanForDate(supabase: SupabaseClient, clientId: string, date: string): Promise<string> {
    const dateOnly = mealPlannerDateOnly(date);
    const [yearStr, monthStr] = dateOnly.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    const { getMealPlanForMonth } = await import('./actions');
    const plans = await getMealPlanForMonth(clientId, year, month);
    const dayPlan = plans.find(p => mealPlannerDateOnly(p.scheduledDeliveryDate) === dateOnly);

    if (!dayPlan) {
        return JSON.stringify({ date: dateOnly, message: 'No delivery scheduled for this date', items: [] });
    }

    return JSON.stringify({
        date: dateOnly,
        delivery_day: dayPlan.deliveryDay,
        total_items: dayPlan.totalItems,
        expected_total_meals: dayPlan.expectedTotalMeals,
        items: dayPlan.items.map(i => ({ name: i.name, quantity: i.quantity })),
    });
}

async function executeGetAvailableMenu(supabase: SupabaseClient, clientId: string, date: string): Promise<string> {
    const dateOnly = mealPlannerDateOnly(date);
    const { getCombinedMenuItemsForDate } = await import('./actions');
    const items = await getCombinedMenuItemsForDate(dateOnly, clientId);

    return JSON.stringify({
        date: dateOnly,
        available_items: items.map(i => ({ name: i.name, default_quantity: i.quantity })),
    });
}

async function executeGetMealPlanForMonth(supabase: SupabaseClient, clientId: string, year: number, month: number): Promise<string> {
    const { getMealPlanForMonth } = await import('./actions');
    const plans = await getMealPlanForMonth(clientId, year, month);

    if (plans.length === 0) {
        return JSON.stringify({ year, month, message: 'No deliveries scheduled this month', dates: [] });
    }

    return JSON.stringify({
        year,
        month,
        dates: plans.map(p => ({
            date: p.scheduledDeliveryDate,
            day: p.deliveryDay,
            total_items: p.totalItems,
            items: p.items.map(i => ({ name: i.name, quantity: i.quantity })),
        })),
    });
}

async function executeSaveMealPlan(
    supabase: SupabaseClient,
    clientId: string,
    date: string,
    items: { name: string; quantity: number }[],
): Promise<string> {
    const dateOnly = mealPlannerDateOnly(date);
    const today = getTodayInAppTz();
    const cutoff = mealPlannerCutoffDate();

    if (dateOnly < today) {
        return JSON.stringify({ success: false, error: 'Cannot edit meal plans for past dates.' });
    }
    if (dateOnly < cutoff) {
        return JSON.stringify({ success: false, error: 'This date is past the editing cutoff.' });
    }

    const { getCombinedMenuItemsForDate } = await import('./actions');
    const availableItems = await getCombinedMenuItemsForDate(dateOnly, clientId);
    const availableByName = new Map(availableItems.map(i => [i.name.trim().toLowerCase(), i]));

    const mappedItems = items.map((item, idx) => {
        const match = availableByName.get(item.name.trim().toLowerCase());
        return {
            id: match?.id ?? `sms-${idx}`,
            name: match?.name ?? item.name,
            quantity: Math.max(0, item.quantity),
            value: match?.value ?? null,
        };
    });

    const unmatched = items.filter(i => !availableByName.has(i.name.trim().toLowerCase()));
    if (unmatched.length > 0) {
        return JSON.stringify({
            success: false,
            error: `These items are not on the menu for ${dateOnly}: ${unmatched.map(i => i.name).join(', ')}. Use get_available_menu_for_date to see valid items.`,
        });
    }

    const { saveClientMealPlannerData } = await import('./actions');
    const result = await saveClientMealPlannerData(clientId, dateOnly, mappedItems);

    if (!result.ok) {
        return JSON.stringify({ success: false, error: result.error || 'Failed to save.' });
    }

    return JSON.stringify({
        success: true,
        date: dateOnly,
        saved_items: mappedItems.map(i => ({ name: i.name, quantity: i.quantity })),
    });
}

// ── System prompt ───────────────────────────────────────────────────

function buildSystemPrompt(
    client: { full_name: string; service_type: string; approved_meals_per_week: number | null; expiration_date: string | null },
    householdCount: number,
): string {
    const now = new Date();
    const timestamp = new Intl.DateTimeFormat('en-US', {
        timeZone: APP_TIMEZONE,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(now);

    return `You are The Diet Fantasy's SMS assistant. You help clients manage their meal deliveries via text message.

ABOUT THE SERVICE:
The Diet Fantasy is a medically tailored meal delivery service. Clients receive food deliveries on scheduled dates. Each delivery date has a menu of available items and the client chooses quantities for each item.

CLIENT CONTEXT:
- Name: ${client.full_name}
- Service type: ${client.service_type}
- Approved meals per week: ${client.approved_meals_per_week ?? 'Not set'}
- Account expiration: ${client.expiration_date ?? 'None'}
- Household size: ${householdCount} ${householdCount === 1 ? 'person' : 'people'}
- Current date/time: ${timestamp}

CAPABILITIES:
- View account information (name, address, phones, household members)
- View meal plan for any delivery date (what's currently ordered)
- View available menu items for a delivery date
- View the full month schedule
- Edit meal plans for future delivery dates (change item quantities)

RULES:
1. Be concise. This is SMS — keep responses short and clear. Use line breaks, not long paragraphs.
2. When showing menus or orders, use a simple list format (item name: quantity).
3. Before saving changes, always confirm with the client what you're about to save.
4. You can only edit meal plans for today or future dates, never past dates.
5. When editing, always fetch the current plan first, then the available menu, so you know valid item names.
6. Be professional and friendly. Sign off as "The Diet Fantasy" only on the first message.
7. If the client asks something outside your capabilities, let them know and suggest they call (845) 478-6605 for further assistance.
8. Dates should be shown in a friendly format like "Monday, April 7" not "2026-04-07".`;
}

// ── Main conversation handler ───────────────────────────────────────

export async function handleInboundSms(phone: string, messageText: string): Promise<void> {
    const supabase = getSupabaseAdmin();

    const clients = await identifyClientByPhone(supabase, phone);

    if (clients.length === 0) {
        await sendSms(
            phone,
            'Thank you for your message. This number is not able to receive replies. ' +
            'For any questions or support, please call us at (845) 478-6605. ' +
            '— The Diet Fantasy',
        );
        return;
    }

    // Use first matched Food client; filter to Food service type
    const foodClients = clients.filter(c => c.service_type === 'Food');
    const client = foodClients[0] ?? clients[0];

    if (!client) {
        await sendSms(phone, 'We couldn\'t find your account. Please call (845) 478-6605 for assistance.');
        return;
    }

    const clientId = client.id;

    await pruneOldMessages(supabase, phone);
    await saveMessage(supabase, phone, clientId, 'user', messageText);

    const history = await loadHistory(supabase, phone);

    const { data: dependents } = await supabase
        .from('clients')
        .select('id')
        .eq('parent_client_id', clientId);
    const householdCount = 1 + (dependents?.length ?? 0);

    const systemPrompt = buildSystemPrompt(
        {
            full_name: client.full_name,
            service_type: client.service_type,
            approved_meals_per_week: client.approved_meals_per_week,
            expiration_date: client.expiration_date,
        },
        householdCount,
    );

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tools = defineBotTools();

    const messages: Anthropic.MessageParam[] = history.map(h => ({
        role: h.role,
        content: h.content,
    }));

    let response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
    });

    while (response.stop_reason === 'tool_use') {
        const toolBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolBlocks) {
            console.log(`[SMS Bot] Tool call: ${block.name}`, JSON.stringify(block.input).slice(0, 200));
            const result = await executeTool(supabase, clientId, block.name, block.input);
            console.log(`[SMS Bot] Tool result (${block.name}):`, result.slice(0, 300));
            toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result,
            });
        }

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });

        response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: systemPrompt,
            tools,
            messages,
        });
    }

    const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
    );
    const replyText = textBlocks.map(b => b.text).join('\n').trim();

    if (!replyText) {
        console.warn('[SMS Bot] Claude returned empty response');
        return;
    }

    const truncated = replyText.length > MAX_SMS_LENGTH
        ? replyText.slice(0, MAX_SMS_LENGTH - 3) + '...'
        : replyText;

    await saveMessage(supabase, phone, clientId, 'assistant', truncated);
    await sendSms(phone, truncated);

    console.log(`[SMS Bot] Replied to ${phone} (client: ${client.full_name}): ${truncated.slice(0, 100)}...`);
}
