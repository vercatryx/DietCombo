import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from './supabase-env';
import { sendSms } from './telnyx';
import { normalizePhone } from './phone-utils';
import { getTodayInAppTz, APP_TIMEZONE } from './timezone';
import { mealPlannerDateOnly, mealPlannerCutoffDate } from './meal-planner-utils';

const CONVERSATION_TTL_HOURS = 2;
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
): Promise<any[]> {
    const digits = phone.replace(/\D/g, '');
    const last10 = digits.slice(-10);
    console.log('[identifyClientByPhone] input:', phone, '→ digits:', digits, '→ last10:', last10);
    if (last10.length < 7) {
        console.log('[identifyClientByPhone] Too few digits, returning empty');
        return [];
    }

    const fuzzy = '%' + last10.split('').join('%') + '%';
    console.log('[identifyClientByPhone] fuzzy pattern:', fuzzy);

    const { data, error } = await supabase
        .from('clients')
        .select('id, full_name, email, service_type, phone_number, secondary_phone_number, address, apt, city, state, zip, parent_client_id, expiration_date, approved_meals_per_week, do_not_text, do_not_text_numbers')
        .or(`phone_number.ilike.${fuzzy},secondary_phone_number.ilike.${fuzzy}`);

    console.log('[identifyClientByPhone] results:', data?.length ?? 0, 'error:', error?.message ?? 'none');
    return data ?? [];
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

    // Filter out broken/empty entries
    const raw = (data ?? []).filter((r: any) =>
        r.content &&
        r.role !== 'system' &&
        r.content !== '(No response)' &&
        !r.content.startsWith('[processed:') &&
        !r.content.startsWith('Something went wrong') &&
        !r.content.startsWith('Sorry, we hit a temporary issue') &&
        !r.content.startsWith('Thank you for your message. This number is not able to receive replies')
    );

    // Ensure strict user/assistant alternation (Claude API requirement)
    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const row of raw) {
        if (history.length > 0 && history[history.length - 1].role === row.role) {
            history[history.length - 1].content += '\n' + row.content;
        } else {
            history.push({ role: row.role, content: row.content });
        }
    }
    // Must start with user and end with user
    while (history.length > 0 && history[0].role !== 'user') history.shift();
    while (history.length > 0 && history[history.length - 1].role !== 'user') history.pop();

    console.log('[SMS Bot] History:', history.length, 'messages, roles:', history.map(h => h.role).join(','));
    return history;
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

// ── Tool definitions ────────────────────────────────────────────────

function defineBotTools(): Anthropic.Tool[] {
    return [
        {
            name: 'get_account_info',
            description: 'Get full account details: name, email, phones, address, service type, household members, dislikes, notes, etc.',
            input_schema: { type: 'object' as const, properties: {}, required: [] },
        },
        {
            name: 'get_delivery_dates_overview',
            description: 'Get all delivery dates for a month. For each date shows: editable status, whether the client has customized it (differs from default), and total items. Call this first when discussing meal plans.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    year: { type: 'number', description: 'Year (e.g. 2026)' },
                    month: { type: 'number', description: 'Month 1-12' },
                },
                required: ['year', 'month'],
            },
        },
        {
            name: 'get_day_details',
            description: 'Get full details for a specific delivery date in one call. Returns: (1) the default order (what they get if unchanged), (2) the client\'s current order (if customized), (3) alternative items available that are not in the current order. Use this when the client picks a date to view or edit.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    date: { type: 'string', description: 'YYYY-MM-DD' },
                },
                required: ['date'],
            },
        },
        {
            name: 'save_meal_plan_for_date',
            description: 'Save the meal plan for a date. Provide the COMPLETE list of items and quantities (items not listed will be set to 0). Always confirm with the client before calling this.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    date: { type: 'string', description: 'YYYY-MM-DD' },
                    items: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                name: { type: 'string', description: 'Exact item name from the menu' },
                                quantity: { type: 'number', description: 'Quantity (0 to remove)' },
                            },
                            required: ['name', 'quantity'],
                        },
                    },
                },
                required: ['date', 'items'],
            },
        },
        {
            name: 'set_email',
            description: 'Set or update the client\'s email address. Confirm the email with the client before calling this. This email is used to log into the client portal.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    email: { type: 'string', description: 'The email address to set' },
                },
                required: ['email'],
            },
        },
        {
            name: 'get_delivery_history',
            description: 'Get recent delivery history for the client (includes all household members). Shows delivery dates, times, and proof of delivery photo links.',
            input_schema: {
                type: 'object' as const,
                properties: {
                    limit: { type: 'number', description: 'Number of recent deliveries to return (default 5, max 10)' },
                },
                required: [],
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
        case 'get_delivery_dates_overview':
            return executeGetDeliveryDatesOverview(supabase, clientId, args.year, args.month);
        case 'get_day_details':
            return executeGetDayDetails(supabase, clientId, args.date);
        case 'save_meal_plan_for_date':
            return executeSaveMealPlan(supabase, clientId, args.date, args.items);
        case 'set_email':
            return executeSetEmail(supabase, clientId, args.email);
        case 'get_delivery_history':
            return executeGetDeliveryHistory(supabase, clientId, args.limit);
        default:
            return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
}

async function executeGetAccountInfo(supabase: SupabaseClient, clientId: string): Promise<string> {
    const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
    if (!client) return JSON.stringify({ error: 'Client not found' });

    const { data: dependents } = await supabase
        .from('clients')
        .select('id, full_name, email, phone_number, service_type, dob')
        .eq('parent_client_id', clientId)
        .order('full_name');

    const fullAddress = [client.address, client.apt, client.city, client.state, client.zip].filter(Boolean).join(', ');

    return JSON.stringify({
        name: client.full_name, first_name: client.first_name, last_name: client.last_name,
        email: client.email, phone: client.phone_number, secondary_phone: client.secondary_phone_number,
        address: fullAddress || 'Not on file', city: client.city, state: client.state, zip: client.zip, county: client.county,
        service_type: client.service_type, expiration_date: client.expiration_date,
        dob: client.dob, cin: client.cin,
        dislikes: client.dislikes, notes: client.notes,
        household_members: (dependents ?? []).map((d: any) => ({
            name: d.full_name, email: d.email, phone: d.phone_number, service_type: d.service_type, dob: d.dob,
        })),
    });
}

async function executeGetDeliveryDatesOverview(supabase: SupabaseClient, clientId: string, year: number, month: number): Promise<string> {
    const today = getTodayInAppTz();
    const { getMealPlanForMonth, getClientMealPlannerData } = await import('./actions');

    const [plans, clientData] = await Promise.all([
        getMealPlanForMonth(clientId, year, month),
        getClientMealPlannerData(clientId, {
            startDate: `${year}-${String(month).padStart(2, '0')}-01`,
            endDate: `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`,
        }),
    ]);

    const clientDatesSet = new Set(clientData.map(d => mealPlannerDateOnly(d.scheduledDeliveryDate)));

    if (plans.length === 0) {
        return JSON.stringify({ year, month, message: 'No deliveries scheduled this month.', dates: [] });
    }

    return JSON.stringify({
        year, month,
        dates: plans.map(p => {
            const d = mealPlannerDateOnly(p.scheduledDeliveryDate);
            const expired = p.expirationDate != null && p.expirationDate !== '' && p.expirationDate < today;
            const isPast = d < today;
            return {
                date: d,
                day: p.deliveryDay,
                editable: !expired && !isPast,
                locked_reason: isPast ? 'past' : expired ? 'expired' : null,
                customized: clientDatesSet.has(d),
                total_items: p.totalItems,
            };
        }),
    });
}

async function executeGetDayDetails(supabase: SupabaseClient, clientId: string, date: string): Promise<string> {
    const dateOnly = mealPlannerDateOnly(date);
    const today = getTodayInAppTz();
    const [yearStr, monthStr] = dateOnly.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);

    const { getMealPlanForMonth, getCombinedMenuItemsForDate, getClientMealPlannerData } = await import('./actions');

    const [plans, allMenuItems, clientData] = await Promise.all([
        getMealPlanForMonth(clientId, year, month),
        getCombinedMenuItemsForDate(dateOnly, clientId),
        getClientMealPlannerData(clientId, { startDate: dateOnly, endDate: dateOnly }),
    ]);

    // Get household size for meal limit calculation
    const { data: deps } = await supabase.from('clients').select('id, service_type').eq('parent_client_id', clientId);
    const foodDeps = (deps ?? []).filter((d: any) => d.service_type === 'Food');
    const householdSize = 1 + foodDeps.length;

    const dayPlan = plans.find(p => mealPlannerDateOnly(p.scheduledDeliveryDate) === dateOnly);

    if (!dayPlan) {
        return JSON.stringify({ date: dateOnly, error: 'No delivery scheduled for this date.' });
    }

    const expired = dayPlan.expirationDate != null && dayPlan.expirationDate !== '' && dayPlan.expirationDate < today;
    const isPast = dateOnly < today;
    const editable = !expired && !isPast;

    const defaultOrder = allMenuItems.map(i => ({ name: i.name, default_quantity: i.quantity }));
    const currentOrder = dayPlan.items.map(i => ({ name: i.name, quantity: i.quantity, value: i.value ?? 1 }));

    const clientSaved = clientData.find(d => mealPlannerDateOnly(d.scheduledDeliveryDate) === dateOnly);
    const customized = !!clientSaved;

    const currentByName = new Map(currentOrder.map(i => [i.name.trim().toLowerCase(), i.quantity]));
    const alternatives = allMenuItems
        .filter(i => {
            const qty = currentByName.get(i.name.trim().toLowerCase());
            return qty === undefined || qty === 0;
        })
        .map(i => ({ name: i.name, default_quantity: i.quantity }));

    const perDateLimit = (dayPlan.expectedTotalMeals ?? 0) * householdSize;
    const currentTotal = currentOrder.reduce((sum, i) => sum + (i.value ?? 1) * Math.max(0, i.quantity), 0);

    return JSON.stringify({
        date: dateOnly,
        editable,
        locked_reason: isPast ? 'past' : expired ? `expired on ${dayPlan.expirationDate}` : null,
        customized,
        meal_limit_for_day: perDateLimit,
        current_meal_total: currentTotal,
        household_size: householdSize,
        note: perDateLimit > 0 ? `This household has ${householdSize} Food member(s). The limit for this day is ${perDateLimit} meals. Each item counts as its "value" toward the total (most items = 1).` : undefined,
        default_order: defaultOrder,
        current_order: currentOrder,
        alternative_items: alternatives,
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

    if (dateOnly < today) return JSON.stringify({ success: false, error: 'Cannot edit past dates.' });
    if (dateOnly < cutoff) return JSON.stringify({ success: false, error: 'Past the editing cutoff.' });

    const { getCombinedMenuItemsForDate, getMealPlannerCustomItems, saveClientMealPlannerData } = await import('./actions');

    const { expirationDate } = await getMealPlannerCustomItems(dateOnly, null);
    if (expirationDate && expirationDate < today) {
        return JSON.stringify({ success: false, error: `Editing expired on ${expirationDate}.` });
    }

    const availableItems = await getCombinedMenuItemsForDate(dateOnly, clientId);
    const availableByName = new Map(availableItems.map(i => [i.name.trim().toLowerCase(), i]));

    const unmatched = items.filter(i => !availableByName.has(i.name.trim().toLowerCase()));
    if (unmatched.length > 0) {
        return JSON.stringify({ success: false, error: `Not on the menu: ${unmatched.map(i => i.name).join(', ')}` });
    }

    const mappedItems = items.map((item, idx) => {
        const match = availableByName.get(item.name.trim().toLowerCase());
        return { id: match?.id ?? `sms-${idx}`, name: match?.name ?? item.name, quantity: Math.max(0, item.quantity), value: match?.value ?? null };
    });

    // Enforce meal limit
    const { data: deps } = await supabase.from('clients').select('id, service_type').eq('parent_client_id', clientId);
    const foodDeps = (deps ?? []).filter((d: any) => d.service_type === 'Food');
    const householdSize = 1 + foodDeps.length;

    const { getMealPlanForMonth: getMPM } = await import('./actions');
    const [y, m] = dateOnly.split('-').map(Number);
    const plans = await getMPM(clientId, y, m);
    const dayPlan = plans.find(p => mealPlannerDateOnly(p.scheduledDeliveryDate) === dateOnly);
    const perDateLimit = ((dayPlan?.expectedTotalMeals ?? 0) * householdSize);
    const newTotal = mappedItems.reduce((sum, i) => sum + ((i.value ?? 1) * Math.max(0, i.quantity)), 0);

    if (perDateLimit > 0 && newTotal !== perDateLimit) {
        const diff = newTotal - perDateLimit;
        const direction = diff > 0 ? `over by ${diff}` : `under by ${Math.abs(diff)}`;
        return JSON.stringify({
            success: false,
            error: `Order total is ${newTotal} but must be exactly ${perDateLimit} (${householdSize} people x ${dayPlan?.expectedTotalMeals ?? 0} per day). Currently ${direction}. Please adjust quantities.`,
        });
    }

    const result = await saveClientMealPlannerData(clientId, dateOnly, mappedItems);
    if (!result.ok) return JSON.stringify({ success: false, error: result.error || 'Failed to save.' });

    return JSON.stringify({ success: true, date: dateOnly, saved_items: mappedItems.map(i => ({ name: i.name, quantity: i.quantity })), meal_total: newTotal, meal_limit: perDateLimit });
}

async function executeSetEmail(supabase: SupabaseClient, clientId: string, email: string): Promise<string> {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return JSON.stringify({ success: false, error: 'Invalid email format.' });
    }

    const { error } = await supabase.from('clients').update({ email: trimmed }).eq('id', clientId);
    if (error) return JSON.stringify({ success: false, error: error.message });

    return JSON.stringify({ success: true, email: trimmed, message: `Email set to ${trimmed}. You can now log in at http://customer.thedietfantasy.com/ with this email.` });
}

async function executeGetDeliveryHistory(supabase: SupabaseClient, clientId: string, limit?: number): Promise<string> {
    const count = Math.min(Math.max(limit ?? 5, 1), 10);
    const today = getTodayInAppTz();

    const { data: deps } = await supabase.from('clients').select('id').eq('parent_client_id', clientId);
    const allIds = [clientId, ...(deps ?? []).map((d: any) => d.id)];

    // Get orders with scheduled dates in the past (delivered) — group by scheduled date to avoid duplicates from household members
    const { data: orders, error } = await supabase
        .from('orders')
        .select('id, client_id, scheduled_delivery_date, actual_delivery_date, proof_of_delivery_url, status, order_number')
        .in('client_id', allIds)
        .lte('scheduled_delivery_date', today + 'T23:59:59')
        .order('scheduled_delivery_date', { ascending: false })
        .limit(count * 3); // fetch extra since multiple household members create separate orders per date

    if (error) return JSON.stringify({ error: error.message });
    if (!orders || orders.length === 0) return JSON.stringify({ deliveries: [], message: 'No delivery history found.' });

    // Group by scheduled date — household orders on the same date = one delivery
    const byDate = new Map<string, any>();
    for (const o of orders) {
        const dateKey = o.scheduled_delivery_date?.slice(0, 10) ?? '';
        if (!dateKey) continue;
        const existing = byDate.get(dateKey);
        if (!existing) {
            byDate.set(dateKey, o);
        } else if (!existing.proof_of_delivery_url && o.proof_of_delivery_url) {
            byDate.set(dateKey, o);
        }
    }

    const deliveries = Array.from(byDate.values()).slice(0, count).map((o: any) => {
        const deliveredAt = o.actual_delivery_date ? new Date(o.actual_delivery_date) : null;
        const scheduledDate = o.scheduled_delivery_date ? new Date(o.scheduled_delivery_date + (o.scheduled_delivery_date.includes('T') ? '' : 'T12:00:00')) : null;

        const deliveryTime = deliveredAt
            ? new Intl.DateTimeFormat('en-US', {
                timeZone: APP_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', hour12: true,
            }).format(deliveredAt)
            : null;

        const scheduledFormatted = scheduledDate
            ? new Intl.DateTimeFormat('en-US', {
                timeZone: APP_TIMEZONE, weekday: 'short', month: 'short', day: 'numeric',
            }).format(scheduledDate)
            : o.scheduled_delivery_date?.slice(0, 10) ?? 'Unknown';

        return {
            scheduled_date: scheduledFormatted,
            delivered_at: deliveryTime,
            proof_url: o.proof_of_delivery_url || null,
        };
    });

    return JSON.stringify({ deliveries });
}

// ── System prompt ───────────────────────────────────────────────────

function buildSystemPrompt(
    client: { full_name: string; email: string | null; service_type: string; approved_meals_per_week: number | null; expiration_date: string | null },
    householdCount: number,
): string {
    const now = new Date();
    const timestamp = new Intl.DateTimeFormat('en-US', {
        timeZone: APP_TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(now);

    const mealsPerPerson = client.approved_meals_per_week != null ? Math.floor(client.approved_meals_per_week / householdCount) : null;

    return `You are The Diet Fantasy's SMS assistant. Keep all responses SHORT — this is SMS and costs money per message.

CLIENT: ${client.full_name} | ${client.service_type} | Household: ${householdCount} people | ${timestamp}
MEAL LIMITS: ${client.approved_meals_per_week ?? '?'} meals/week total for the household (${householdCount} Food member(s))${mealsPerPerson ? ` — about ${mealsPerPerson} per person per week` : ''}.
The get_day_details tool returns meal_limit_for_day which is the EXACT daily limit for the household. This accounts for household size already.

YOU OFFER THESE SERVICES:
1. Account Info — view account details (read-only)
2. Meal Plan — view and edit meal orders for delivery dates
3. Delivery History — view recent deliveries with proof of delivery photos
4. Set Email — set or update their email for portal login${client.email ? '' : '\n\nIMPORTANT: This client has NO EMAIL on file. After greeting, recommend they set one so they can log into the portal. Say something like: "I notice you don\'t have an email on file yet. Would you like to set one? It lets you manage your orders online at customer.thedietfantasy.com."'}

SET EMAIL FLOW:
- When the client wants to set or change their email, ask them for the email address.
- Confirm the email back to them before saving (e.g. "Set your email to john@example.com?").
- Once confirmed, call set_email. Tell them they can now log in at http://customer.thedietfantasy.com/ with that email.

DELIVERY HISTORY FLOW:
- When the client asks about deliveries or proof of delivery, call get_delivery_history.
- Show each delivery on its own line with: scheduled date, delivery time (if available), and proof link.
- If delivered_at is available: "Wed, Mar 19 — Delivered at 5:32 PM — Proof: [link]"
- If delivered_at is null but proof exists: "Wed, Mar 19 — Proof: [link]"
- If no proof and no delivery time: "Wed, Mar 19 — Delivered (no proof photo on file — this can happen due to poor internet connection at the delivery location)"
- Only mention the internet connection reason once, not for every entry.

MEAL PLAN FLOW:
1. Greet the client and ask: account info, meal plan, or delivery history?
2. For meal plans, call get_delivery_dates_overview for the relevant month.
3. Present dates. For each date show ONLY:
   - The date in friendly format (e.g. "Thu, Apr 16")
   - EDITABLE or LOCKED
   - "edited" if they customized it, nothing extra if not
   - Do NOT show item counts in the date list
4. When the client picks a date, call get_day_details ONCE. Show them:
   a) Their CURRENT ORDER (items with qty > 0). If not customized, label it "Default order".
   b) The MEAL LIMIT for the day from meal_limit_for_day. Explain: "Your household can order up to X items for this day (Y people x Z per person)."
   c) Their current total from current_meal_total vs the limit.
   d) AVAILABLE ALTERNATIVES — other items they can swap in (from alternative_items). List these separately under "Other available items:" with each item on its own line.
   e) Tell them: to change, say the item name and new quantity (e.g. "pizza pita 2, acai 0").
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
- Be extremely concise. No filler text. Use short lists.
- Show dates as "Thu, Apr 16" not "2026-04-16".
- Only dates from get_delivery_dates_overview are valid delivery days.
- Only dates marked editable can be changed. If locked, say so briefly.
- NEVER allow saving an order unless the total EXACTLY matches meal_limit_for_day. Always check totals first.
- Confirm once before saving. When the client says "yes", "confirm", "save", or similar affirmative — IMMEDIATELY call save_meal_plan_for_date. Do NOT ask again.
- For anything outside your capabilities: "Please call (845) 478-6605."
- First message only: sign off with "— The Diet Fantasy"
- At the end of every conversation (after saving, or when done helping), remind them: "You can also make these changes yourself at http://customer.thedietfantasy.com/ — log in with your email (${client.email ?? 'on file'})."`;
}

// ── Main conversation handler ───────────────────────────────────────

export async function handleInboundSms(phone: string, messageText: string): Promise<void> {
    const FALLBACK_MSG = 'Sorry, we hit a temporary issue. Please try again or call (845) 478-6605 for help. — The Diet Fantasy';

    try {
        const supabase = getSupabaseAdmin();
        const clients = await identifyClientByPhone(supabase, phone);

        if (clients.length === 0) {
            await sendSms(
                phone,
                'Thank you for your message. This number is not able to receive replies. ' +
                'For any questions or support, please call us at (845) 478-6605. — The Diet Fantasy',
                { messageType: 'bot_reply' },
            );
            return;
        }

        const foodClients = clients.filter((c: any) => c.service_type === 'Food');
        const client = foodClients[0] ?? clients[0];
        if (!client) {
            await sendSms(phone, 'We couldn\'t find your account. Please call (845) 478-6605 for assistance.', { messageType: 'bot_reply' });
            return;
        }

        const clientId = client.id;

        // Client is actively texting us, so this number works.
        // If it was previously flagged, clear the flag for this number.
        const e164Phone = normalizePhone(phone);
        const flaggedMap: Record<string, string> = client.do_not_text_numbers || {};
        if (e164Phone && flaggedMap[e164Phone]) {
            delete flaggedMap[e164Phone];
            await supabase.from('clients').update({
                do_not_text_numbers: flaggedMap,
                do_not_text: false,
            }).eq('id', clientId);
            console.log(`[SMS Bot] Cleared do_not_text for ${e164Phone} (client ${clientId}) — they texted us`);
        }
        await pruneOldMessages(supabase, phone);
        await saveMessage(supabase, phone, clientId, 'user', messageText);

        const history = await loadHistory(supabase, phone);

        const { data: dependents } = await supabase.from('clients').select('id, service_type').eq('parent_client_id', clientId);
        const foodDependents = (dependents ?? []).filter((d: any) => d.service_type === 'Food');
        const householdCount = 1 + foodDependents.length;

        const systemPrompt = buildSystemPrompt(
            { full_name: client.full_name, email: client.email, service_type: client.service_type, approved_meals_per_week: client.approved_meals_per_week, expiration_date: client.expiration_date },
            householdCount,
        );

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
                console.log(`[SMS Bot] Tool: ${block.name}`, JSON.stringify(block.input).slice(0, 200));
                const result = await executeTool(supabase, clientId, block.name, block.input);
                console.log(`[SMS Bot] Result (${block.name}):`, result.slice(0, 300));
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
            }
            messages.push({ role: 'assistant', content: response.content });
            messages.push({ role: 'user', content: toolResults });
            response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: systemPrompt, tools, messages,
            });
        }

        const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
        let replyText = textBlocks.map(b => b.text).join('\n').trim();

        if (!replyText) {
            console.warn('[SMS Bot] Empty response from Claude, sending fallback');
            // Clear bad history so next message starts fresh
            await supabase.from('sms_conversations').delete().eq('phone_number', phone);
            replyText = FALLBACK_MSG;
        }

        const truncated = replyText.length > MAX_SMS_LENGTH ? replyText.slice(0, MAX_SMS_LENGTH - 3) + '...' : replyText;
        if (replyText !== FALLBACK_MSG) {
            await saveMessage(supabase, phone, clientId, 'assistant', truncated);
        }
        await sendSms(phone, truncated, { clientId, clientName: client.full_name, messageType: 'bot_reply' });
        console.log(`[SMS Bot] Replied to ${phone} (${client.full_name}): ${truncated.slice(0, 100)}...`);

    } catch (err: any) {
        console.error('[SMS Bot] Fatal error:', err);
        await sendSms(phone, FALLBACK_MSG, { messageType: 'bot_reply' }).catch(() => {});
    }
}
