import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { identifyClientByPhone } from '@/lib/sms-bot';
import { getTodayInAppTz, APP_TIMEZONE } from '@/lib/timezone';
import { mealPlannerDateOnly, mealPlannerCutoffDate } from '@/lib/meal-planner-utils';
import Anthropic from '@anthropic-ai/sdk';

function getSupabaseAdmin() {
    return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);
}

const CONVERSATION_TTL_HOURS = 24;
const MAX_HISTORY_MESSAGES = 20;

function defineBotTools(): Anthropic.Tool[] {
    return [
        { name: 'get_account_info', description: 'Get full account details.', input_schema: { type: 'object' as const, properties: {}, required: [] } },
        {
            name: 'get_delivery_dates_overview', description: 'Get all delivery dates for a month with editable/customized flags.',
            input_schema: { type: 'object' as const, properties: { year: { type: 'number' }, month: { type: 'number' } }, required: ['year', 'month'] },
        },
        {
            name: 'get_day_details', description: 'Get default order, current order, and alternative items for a date.',
            input_schema: { type: 'object' as const, properties: { date: { type: 'string' } }, required: ['date'] },
        },
        {
            name: 'save_meal_plan_for_date', description: 'Save complete meal plan for a date. Confirm first.',
            input_schema: {
                type: 'object' as const, properties: {
                    date: { type: 'string' },
                    items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' } }, required: ['name', 'quantity'] } },
                }, required: ['date', 'items'],
            },
        },
        {
            name: 'get_delivery_history', description: 'Get recent delivery history with proof of delivery links.',
            input_schema: { type: 'object' as const, properties: { limit: { type: 'number' } }, required: [] },
        },
    ];
}

async function executeTool(supabase: any, clientId: string, toolName: string, args: any): Promise<string> {
    const today = getTodayInAppTz();
    switch (toolName) {
        case 'get_account_info': {
            const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
            if (!client) return JSON.stringify({ error: 'Client not found' });
            const { data: deps } = await supabase.from('clients').select('id, full_name, email, phone_number, service_type, dob').eq('parent_client_id', clientId).order('full_name');
            return JSON.stringify({
                name: client.full_name, first_name: client.first_name, last_name: client.last_name, email: client.email,
                phone: client.phone_number, secondary_phone: client.secondary_phone_number,
                address: [client.address, client.apt, client.city, client.state, client.zip].filter(Boolean).join(', ') || 'Not on file',
                city: client.city, state: client.state, zip: client.zip, county: client.county,
                service_type: client.service_type, expiration_date: client.expiration_date,
                dob: client.dob, cin: client.cin,
                dislikes: client.dislikes, notes: client.notes,
                household_members: (deps ?? []).map((d: any) => ({ name: d.full_name, email: d.email, phone: d.phone_number, service_type: d.service_type, dob: d.dob })),
            });
        }
        case 'get_delivery_dates_overview': {
            const { getMealPlanForMonth, getClientMealPlannerData } = await import('@/lib/actions');
            const [plans, clientData] = await Promise.all([
                getMealPlanForMonth(clientId, args.year, args.month),
                getClientMealPlannerData(clientId, {
                    startDate: `${args.year}-${String(args.month).padStart(2, '0')}-01`,
                    endDate: `${args.year}-${String(args.month).padStart(2, '0')}-${new Date(args.year, args.month, 0).getDate()}`,
                }),
            ]);
            const clientDatesSet = new Set(clientData.map((d: any) => mealPlannerDateOnly(d.scheduledDeliveryDate)));
            return JSON.stringify({
                year: args.year, month: args.month,
                dates: plans.map((p: any) => {
                    const d = mealPlannerDateOnly(p.scheduledDeliveryDate);
                    const expired = p.expirationDate != null && p.expirationDate !== '' && p.expirationDate < today;
                    const isPast = d < today;
                    return { date: d, day: p.deliveryDay, editable: !expired && !isPast, locked_reason: isPast ? 'past' : expired ? 'expired' : null, customized: clientDatesSet.has(d), total_items: p.totalItems };
                }),
            });
        }
        case 'get_day_details': {
            const dateOnly = mealPlannerDateOnly(args.date);
            const [y, m] = dateOnly.split('-').map(Number);
            const { getMealPlanForMonth, getCombinedMenuItemsForDate, getClientMealPlannerData } = await import('@/lib/actions');
            const [plans, allMenuItems, clientData] = await Promise.all([
                getMealPlanForMonth(clientId, y, m),
                getCombinedMenuItemsForDate(dateOnly, clientId),
                getClientMealPlannerData(clientId, { startDate: dateOnly, endDate: dateOnly }),
            ]);
            const { data: dayDeps } = await supabase.from('clients').select('id, service_type').eq('parent_client_id', clientId);
            const dayFoodDeps = (dayDeps ?? []).filter((d: any) => d.service_type === 'Food');
            const dayHouseholdSize = 1 + dayFoodDeps.length;
            const dayPlan = plans.find((p: any) => mealPlannerDateOnly(p.scheduledDeliveryDate) === dateOnly);
            if (!dayPlan) return JSON.stringify({ date: dateOnly, error: 'No delivery on this date.' });
            const expired = dayPlan.expirationDate != null && dayPlan.expirationDate !== '' && dayPlan.expirationDate < today;
            const isPast = dateOnly < today;
            const currentOrder = dayPlan.items.map((i: any) => ({ name: i.name, quantity: i.quantity, value: i.value ?? 1 }));
            const currentByName = new Map(currentOrder.map((i: any) => [i.name.trim().toLowerCase(), i.quantity]));
            const perDateLimit = (dayPlan.expectedTotalMeals ?? 0) * dayHouseholdSize;
            const currentTotal = currentOrder.reduce((sum: number, i: any) => sum + ((i.value ?? 1) * Math.max(0, i.quantity)), 0);
            return JSON.stringify({
                date: dateOnly, editable: !expired && !isPast,
                locked_reason: isPast ? 'past' : expired ? `expired on ${dayPlan.expirationDate}` : null,
                customized: !!clientData.find((d: any) => mealPlannerDateOnly(d.scheduledDeliveryDate) === dateOnly),
                meal_limit_for_day: perDateLimit,
                current_meal_total: currentTotal,
                household_size: dayHouseholdSize,
                note: perDateLimit > 0 ? `This household has ${dayHouseholdSize} Food member(s). The limit for this day is ${perDateLimit} meals.` : undefined,
                default_order: allMenuItems.map((i: any) => ({ name: i.name, default_quantity: i.quantity })),
                current_order: currentOrder,
                alternative_items: allMenuItems.filter((i: any) => { const q = currentByName.get(i.name.trim().toLowerCase()); return q === undefined || q === 0; }).map((i: any) => ({ name: i.name, default_quantity: i.quantity })),
            });
        }
        case 'save_meal_plan_for_date': {
            const dateOnly = mealPlannerDateOnly(args.date);
            if (dateOnly < today) return JSON.stringify({ success: false, error: 'Cannot edit past dates.' });
            const { getCombinedMenuItemsForDate, getMealPlannerCustomItems, saveClientMealPlannerData, getMealPlanForMonth: getSaveMPM } = await import('@/lib/actions');
            const { expirationDate } = await getMealPlannerCustomItems(dateOnly, null);
            if (expirationDate && expirationDate < today) return JSON.stringify({ success: false, error: `Expired on ${expirationDate}.` });
            const available = await getCombinedMenuItemsForDate(dateOnly, clientId);
            const byName = new Map(available.map((i: any) => [i.name.trim().toLowerCase(), i]));
            const unmatched = args.items.filter((i: any) => !byName.has(i.name.trim().toLowerCase()));
            if (unmatched.length > 0) return JSON.stringify({ success: false, error: `Not on menu: ${unmatched.map((i: any) => i.name).join(', ')}` });
            const mapped = args.items.map((item: any, idx: number) => { const match = byName.get(item.name.trim().toLowerCase()); return { id: match?.id ?? `sms-${idx}`, name: match?.name ?? item.name, quantity: Math.max(0, item.quantity), value: match?.value ?? null }; });

            // Enforce meal limit
            const { data: saveDeps } = await supabase.from('clients').select('id, service_type').eq('parent_client_id', clientId);
            const saveFoodDeps = (saveDeps ?? []).filter((d: any) => d.service_type === 'Food');
            const saveHouseholdSize = 1 + saveFoodDeps.length;
            const [sy, sm] = dateOnly.split('-').map(Number);
            const savePlans = await getSaveMPM(clientId, sy, sm);
            const saveDayPlan = savePlans.find((p: any) => mealPlannerDateOnly(p.scheduledDeliveryDate) === dateOnly);
            const savePerDateLimit = ((saveDayPlan?.expectedTotalMeals ?? 0) * saveHouseholdSize);
            const saveNewTotal = mapped.reduce((sum: number, i: any) => sum + ((i.value ?? 1) * Math.max(0, i.quantity)), 0);
            if (savePerDateLimit > 0 && saveNewTotal !== savePerDateLimit) {
                const diff = saveNewTotal - savePerDateLimit;
                const direction = diff > 0 ? `over by ${diff}` : `under by ${Math.abs(diff)}`;
                return JSON.stringify({ success: false, error: `Order total is ${saveNewTotal} but must be exactly ${savePerDateLimit} (${saveHouseholdSize} people x ${saveDayPlan?.expectedTotalMeals ?? 0} per day). Currently ${direction}. Please adjust quantities.` });
            }

            const result = await saveClientMealPlannerData(clientId, dateOnly, mapped);
            if (!result.ok) return JSON.stringify({ success: false, error: result.error });
            return JSON.stringify({ success: true, date: dateOnly, saved_items: mapped.map((i: any) => ({ name: i.name, quantity: i.quantity })), meal_total: saveNewTotal, meal_limit: savePerDateLimit });
        }
        case 'get_delivery_history': {
            const count = Math.min(Math.max(args.limit ?? 5, 1), 10);
            const { data: histDeps } = await supabase.from('clients').select('id').eq('parent_client_id', clientId);
            const allIds = [clientId, ...(histDeps ?? []).map((d: any) => d.id)];
            const { data: orders, error: ordErr } = await supabase
                .from('orders')
                .select('id, client_id, scheduled_delivery_date, actual_delivery_date, proof_of_delivery_url, status, order_number')
                .in('client_id', allIds)
                .lte('scheduled_delivery_date', today + 'T23:59:59')
                .order('scheduled_delivery_date', { ascending: false })
                .limit(count * 3);
            if (ordErr) return JSON.stringify({ error: ordErr.message });
            if (!orders || orders.length === 0) return JSON.stringify({ deliveries: [], message: 'No delivery history found.' });
            // Group by date — household orders on same date = one delivery
            const byDate = new Map<string, any>();
            for (const o of orders) {
                const dateKey = o.scheduled_delivery_date?.slice(0, 10) ?? '';
                if (!dateKey) continue;
                const existing = byDate.get(dateKey);
                if (!existing) byDate.set(dateKey, o);
                else if (!existing.proof_of_delivery_url && o.proof_of_delivery_url) byDate.set(dateKey, o);
            }
            const deliveries = Array.from(byDate.values()).slice(0, count).map((o: any) => {
                const deliveredAt = o.actual_delivery_date ? new Date(o.actual_delivery_date) : null;
                const scheduledDate = o.scheduled_delivery_date ? new Date(o.scheduled_delivery_date + (o.scheduled_delivery_date.includes('T') ? '' : 'T12:00:00')) : null;
                const deliveryTime = deliveredAt ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(deliveredAt) : null;
                const scheduledFormatted = scheduledDate ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }).format(scheduledDate) : o.scheduled_delivery_date?.slice(0, 10) ?? 'Unknown';
                return { scheduled_date: scheduledFormatted, delivered_at: deliveryTime, proof_url: o.proof_of_delivery_url || null };
            });
            return JSON.stringify({ deliveries });
        }
        default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
}

export async function POST(request: Request) {
    try {
        const { phone, message } = await request.json();
        if (!phone || !message) return NextResponse.json({ error: 'Missing phone or message' }, { status: 400 });

        const supabase = getSupabaseAdmin();
        const clients = await identifyClientByPhone(supabase, phone);
        console.log('[SMS Bot Test] Phone lookup for:', phone, '→ found', clients.length, 'clients');
        const foodClients = clients.filter((c: any) => c.service_type === 'Food');
        const client = foodClients[0] ?? clients[0];
        if (!client) return NextResponse.json({ reply: 'No client found for that phone number.', clientName: null });

        const clientId = client.id;
        const cutoff = new Date(Date.now() - CONVERSATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
        await supabase.from('sms_conversations').delete().eq('phone_number', phone).lt('created_at', cutoff);
        await supabase.from('sms_conversations').insert({ phone_number: phone, client_id: clientId, role: 'user', content: message });

        const { data: historyRows } = await supabase
            .from('sms_conversations').select('role, content').eq('phone_number', phone)
            .gte('created_at', cutoff).order('created_at', { ascending: true }).limit(MAX_HISTORY_MESSAGES);

        // Ensure strict alternation (Claude API requires user/assistant/user/assistant)
        // Merge consecutive same-role messages and filter out broken entries
        const rawHistory = (historyRows ?? [])
            .filter((r: any) => r.content && r.content !== '(No response)' && !r.content.startsWith('Something went wrong'));
        const history: { role: string; content: string }[] = [];
        for (const row of rawHistory) {
            if (history.length > 0 && history[history.length - 1].role === row.role) {
                history[history.length - 1].content += '\n' + row.content;
            } else {
                history.push({ role: row.role, content: row.content });
            }
        }
        // Must start with user and end with user
        while (history.length > 0 && history[0].role !== 'user') history.shift();
        while (history.length > 0 && history[history.length - 1].role !== 'user') history.pop();
        console.log('[SMS Bot Test] History messages:', history.length, 'roles:', history.map(h => h.role));

        const { data: deps } = await supabase.from('clients').select('id, service_type').eq('parent_client_id', clientId);
        const foodDeps = (deps ?? []).filter((d: any) => d.service_type === 'Food');
        const householdCount = 1 + foodDeps.length;
        const now = new Date();
        const ts = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);

        const mealsPerPerson = client.approved_meals_per_week != null ? Math.floor(client.approved_meals_per_week / householdCount) : null;

        const systemPrompt = `You are The Diet Fantasy's SMS assistant. Keep all responses SHORT — this is SMS and costs money per message.

CLIENT: ${client.full_name} | ${client.service_type} | Household: ${householdCount} people | ${ts}
MEAL LIMITS: ${client.approved_meals_per_week ?? '?'} meals/week total for the household (${householdCount} Food member(s))${mealsPerPerson ? ` — about ${mealsPerPerson} per person per week` : ''}.
The get_day_details tool returns meal_limit_for_day which is the EXACT daily limit for the household. This accounts for household size already.

YOU OFFER THREE THINGS:
1. Account Info — view account details (read-only)
2. Meal Plan — view and edit meal orders for delivery dates
3. Delivery History — view recent deliveries with proof of delivery photos

DELIVERY HISTORY FLOW:
- When the client asks about deliveries or proof of delivery, call get_delivery_history.
- Show each delivery on its own line with: scheduled date, delivery time (if available), and proof link.
- If delivered_at is available: "Wed, Mar 19 — Delivered at 5:32 PM — Proof: [link]"
- If delivered_at is null but proof exists: "Wed, Mar 19 — Proof: [link]"
- If no proof and no delivery time: "Wed, Mar 19 — Delivered (no proof photo on file — this can happen due to poor internet connection at the delivery location)"
- Only mention the internet connection reason once, not for every entry.

MEAL PLAN FLOW:
1. Greet and ask: account info, meal plan, or delivery history?
2. For meal plans, call get_delivery_dates_overview for the relevant month.
3. Present dates. For each show ONLY: friendly date, EDITABLE or LOCKED, "edited" if customized (nothing extra if not). Do NOT show item counts.
4. When client picks a date, call get_day_details ONCE. Show:
   a) CURRENT ORDER (items with qty > 0). If not customized, label "Default order".
   b) MEAL LIMIT for the day from meal_limit_for_day. Say "Your household can order up to X items for this day (Y people x Z per person)."
   c) Their current total from current_meal_total vs the limit.
   d) AVAILABLE ALTERNATIVES separately under "Other available items:" with each item on its own line.
   e) Say: to change, give item name + quantity (e.g. "pizza pita 2, acai 0").
5. When they give changes, calculate the new total BEFORE presenting. Each item's cost toward the limit is its "value" (most items = 1).
   - The total MUST EXACTLY EQUAL meal_limit_for_day. Not over, not under.
   - If the new total DOES NOT equal meal_limit_for_day: DO NOT offer to save. Instead:
     a) Say the total is X but needs to be exactly Y (over by Z / under by Z).
     b) Show the FULL updated order (all items with quantities) so they can see everything.
     c) Explain they can change the quantity of ANY item to hit the target. Give an example like: "To adjust, change an item quantity, e.g. 'tuna wrap 0' or 'cheesecake 3'. Just tell me which items to change."
   - If the new total EXACTLY equals the limit: show the updated order and ask to confirm.
6. Only after the total is within the limit AND the client confirms, call save_meal_plan_for_date with the COMPLETE item list.
   - The backend will also enforce the limit and reject saves that exceed it.

RULES:
- NEVER use emojis. Plain text only.
- Extremely concise. No filler. Short lists.
- Dates as "Thu, Apr 16" not "2026-04-16".
- Only listed dates are valid delivery days. Only editable dates can be changed.
- NEVER allow saving an order unless the total EXACTLY matches meal_limit_for_day. Always check totals first.
- Confirm once before saving. When the client says "yes", "confirm", "save", or similar affirmative — IMMEDIATELY call save_meal_plan_for_date. Do NOT ask again.
- Outside capabilities: "Please call (845) 478-6605."
- First message only: sign off "— The Diet Fantasy"
- At the end of every conversation (after saving, or when done helping), remind them: "You can also make these changes yourself at http://customer.thedietfantasy.com/ — log in with your email (${client.email ?? 'on file'})."`;

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const tools = defineBotTools();
        const messages: Anthropic.MessageParam[] = history.map((h: any) => ({ role: h.role, content: h.content }));

        let response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, tools, messages });
        let iterations = 0;
        console.log('[SMS Bot Test] Initial stop_reason:', response.stop_reason, 'content types:', response.content.map(b => b.type));
        while (response.stop_reason === 'tool_use' && iterations < 10) {
            iterations++;
            const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of toolBlocks) {
                console.log('[SMS Bot Test] Tool call #' + iterations + ':', block.name, JSON.stringify(block.input).slice(0, 200));
                const result = await executeTool(supabase, clientId, block.name, block.input);
                console.log('[SMS Bot Test] Tool result:', result.slice(0, 300));
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: toolResults });
            response = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, tools, messages });
            console.log('[SMS Bot Test] Iteration', iterations, 'stop_reason:', response.stop_reason, 'content types:', response.content.map(b => b.type));
        }

        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
        let reply = textBlocks.map(b => b.text).join('\n').trim();

        if (!reply && response.stop_reason === 'tool_use') {
            console.log('[SMS Bot Test] Loop ended at max iterations with pending tool_use, forcing text response');
            const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of toolBlocks) {
                const result = await executeTool(supabase, clientId, block.name, block.input);
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: toolResults });
            const finalResponse = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, messages });
            const finalText = finalResponse.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
            reply = finalText.map(b => b.text).join('\n').trim();
        }

        if (!reply) {
            console.log('[SMS Bot Test] No reply generated. stop_reason:', response.stop_reason, 'content:', JSON.stringify(response.content));
            reply = 'Something went wrong processing your request. Please try again.';
        }
        // Only save good replies to history
        if (reply !== 'Something went wrong processing your request. Please try again.') {
            await supabase.from('sms_conversations').insert({ phone_number: phone, client_id: clientId, role: 'assistant', content: reply });
        }

        return NextResponse.json({ reply, clientName: client.full_name, serviceType: client.service_type });
    } catch (err: any) {
        console.error('[SMS Bot Test] Error:', err);
        return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
    }
}
