import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { identifyClientByPhone } from '@/lib/sms-bot';
import { getTodayInAppTz, APP_TIMEZONE } from '@/lib/timezone';
import { mealPlannerDateOnly, mealPlannerCutoffDate } from '@/lib/meal-planner-utils';
import Anthropic from '@anthropic-ai/sdk';

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!,
    );
}

const CONVERSATION_TTL_HOURS = 24;
const MAX_HISTORY_MESSAGES = 20;

function defineBotTools(): Anthropic.Tool[] {
    return [
        {
            name: 'get_account_info',
            description: 'Get the client\'s account information including name, address, phone numbers, service type, and all household members (dependents) on this account.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
        },
        {
            name: 'get_meal_plan_for_date',
            description: 'Get the client\'s saved meal plan (items and quantities) for a specific delivery date.',
            input_schema: {
                type: 'object' as const,
                properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
                required: ['date'],
            },
        },
        {
            name: 'get_available_menu_for_date',
            description: 'Get all available menu items for a specific delivery date.',
            input_schema: {
                type: 'object' as const,
                properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
                required: ['date'],
            },
        },
        {
            name: 'get_meal_plan_for_month',
            description: 'Get the client\'s meal plan for an entire month.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    year: { type: 'number', description: 'Year' },
                    month: { type: 'number', description: 'Month 1-12' },
                },
                required: ['year', 'month'],
            },
        },
        {
            name: 'save_meal_plan_for_date',
            description: 'Update the meal plan for a specific delivery date. Always confirm with the client before saving.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    date: { type: 'string', description: 'YYYY-MM-DD' },
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                quantity: { type: 'number' },
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

async function executeTool(supabase: any, clientId: string, toolName: string, args: any): Promise<string> {
    switch (toolName) {
        case 'get_account_info': {
            const { data: client } = await supabase
                .from('clients')
                .select('id, full_name, phone_number, secondary_phone_number, address, apt, city, state, zip, service_type, approved_meals_per_week, expiration_date')
                .eq('id', clientId).single();
            if (!client) return JSON.stringify({ error: 'Client not found' });
            const { data: deps } = await supabase.from('clients').select('full_name').eq('parent_client_id', clientId).order('full_name');
            return JSON.stringify({
                name: client.full_name, phone: client.phone_number, secondary_phone: client.secondary_phone_number,
                address: [client.address, client.apt, client.city, client.state, client.zip].filter(Boolean).join(', ') || 'Not on file',
                service_type: client.service_type, approved_meals_per_week: client.approved_meals_per_week,
                expiration_date: client.expiration_date, household_members: (deps ?? []).map((d: any) => d.full_name),
            });
        }
        case 'get_meal_plan_for_date': {
            const dateOnly = mealPlannerDateOnly(args.date);
            const [y, m] = dateOnly.split('-').map(Number);
            const { getMealPlanForMonth } = await import('@/lib/actions');
            const plans = await getMealPlanForMonth(clientId, y, m);
            const day = plans.find(p => mealPlannerDateOnly(p.scheduledDeliveryDate) === dateOnly);
            if (!day) return JSON.stringify({ date: dateOnly, message: 'No delivery scheduled', items: [] });
            return JSON.stringify({ date: dateOnly, total_items: day.totalItems, expected_total: day.expectedTotalMeals, items: day.items.map(i => ({ name: i.name, quantity: i.quantity })) });
        }
        case 'get_available_menu_for_date': {
            const dateOnly = mealPlannerDateOnly(args.date);
            const { getCombinedMenuItemsForDate } = await import('@/lib/actions');
            const items = await getCombinedMenuItemsForDate(dateOnly, clientId);
            return JSON.stringify({ date: dateOnly, available_items: items.map(i => ({ name: i.name, default_quantity: i.quantity })) });
        }
        case 'get_meal_plan_for_month': {
            const { getMealPlanForMonth } = await import('@/lib/actions');
            const plans = await getMealPlanForMonth(clientId, args.year, args.month);
            return JSON.stringify({ year: args.year, month: args.month, dates: plans.map(p => ({ date: p.scheduledDeliveryDate, day: p.deliveryDay, items: p.items.map(i => ({ name: i.name, quantity: i.quantity })) })) });
        }
        case 'save_meal_plan_for_date': {
            const dateOnly = mealPlannerDateOnly(args.date);
            const today = getTodayInAppTz();
            if (dateOnly < today) return JSON.stringify({ success: false, error: 'Cannot edit past dates.' });
            const { getCombinedMenuItemsForDate, saveClientMealPlannerData } = await import('@/lib/actions');
            const available = await getCombinedMenuItemsForDate(dateOnly, clientId);
            const byName = new Map(available.map(i => [i.name.trim().toLowerCase(), i]));
            const mapped = args.items.map((item: any, idx: number) => {
                const match = byName.get(item.name.trim().toLowerCase());
                return { id: match?.id ?? `sms-${idx}`, name: match?.name ?? item.name, quantity: Math.max(0, item.quantity), value: match?.value ?? null };
            });
            const result = await saveClientMealPlannerData(clientId, dateOnly, mapped);
            if (!result.ok) return JSON.stringify({ success: false, error: result.error });
            return JSON.stringify({ success: true, date: dateOnly, saved_items: mapped.map((i: any) => ({ name: i.name, quantity: i.quantity })) });
        }
        default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
}

export async function POST(request: Request) {
    try {
        const { phone, message } = await request.json();
        if (!phone || !message) {
            return NextResponse.json({ error: 'Missing phone or message' }, { status: 400 });
        }

        const supabase = getSupabaseAdmin();
        const clients = await identifyClientByPhone(supabase, phone);
        const foodClients = clients.filter(c => c.service_type === 'Food');
        const client = foodClients[0] ?? clients[0];

        if (!client) {
            return NextResponse.json({ reply: 'No client found for that phone number.', clientName: null });
        }

        const clientId = client.id;

        const cutoff = new Date(Date.now() - CONVERSATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
        await supabase.from('sms_conversations').delete().eq('phone_number', phone).lt('created_at', cutoff);
        await supabase.from('sms_conversations').insert({ phone_number: phone, client_id: clientId, role: 'user', content: message });

        const { data: historyRows } = await supabase
            .from('sms_conversations')
            .select('role, content')
            .eq('phone_number', phone)
            .gte('created_at', cutoff)
            .order('created_at', { ascending: true })
            .limit(MAX_HISTORY_MESSAGES);

        const history: { role: 'user' | 'assistant'; content: string }[] = (historyRows ?? []).map((r: any) => ({ role: r.role, content: r.content }));

        const { data: deps } = await supabase.from('clients').select('id').eq('parent_client_id', clientId);
        const householdCount = 1 + (deps?.length ?? 0);

        const now = new Date();
        const timestamp = new Intl.DateTimeFormat('en-US', {
            timeZone: APP_TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
        }).format(now);

        const systemPrompt = `You are The Diet Fantasy's SMS assistant. You help clients manage their meal deliveries via text message.

ABOUT THE SERVICE:
The Diet Fantasy is a medically tailored meal delivery service. Clients receive food deliveries on scheduled dates.

CLIENT CONTEXT:
- Name: ${client.full_name}
- Service type: ${client.service_type}
- Approved meals per week: ${client.approved_meals_per_week ?? 'Not set'}
- Account expiration: ${client.expiration_date ?? 'None'}
- Household size: ${householdCount} ${householdCount === 1 ? 'person' : 'people'}
- Current date/time: ${timestamp}

RULES:
1. Be concise. Use line breaks, not long paragraphs.
2. When showing menus or orders, use a simple list format.
3. Before saving changes, always confirm with the client.
4. You can only edit meal plans for today or future dates.
5. When editing, fetch the current plan and available menu first.
6. Be professional and friendly.
7. If the client asks something outside your capabilities, suggest they call (845) 478-6605.
8. Show dates in friendly format like "Monday, April 7".`;

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const tools = defineBotTools();
        const messages: Anthropic.MessageParam[] = history.map(h => ({ role: h.role, content: h.content }));

        let response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, tools, messages,
        });

        let iterations = 0;
        while (response.stop_reason === 'tool_use' && iterations < 10) {
            iterations++;
            const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of toolBlocks) {
                const result = await executeTool(supabase, clientId, block.name, block.input);
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: toolResults });
            response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, tools, messages,
            });
        }

        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
        const reply = textBlocks.map(b => b.text).join('\n').trim() || '(No response)';

        await supabase.from('sms_conversations').insert({ phone_number: phone, client_id: clientId, role: 'assistant', content: reply });

        return NextResponse.json({ reply, clientName: client.full_name, serviceType: client.service_type });
    } catch (err: any) {
        console.error('[SMS Bot Test] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
    }
}
