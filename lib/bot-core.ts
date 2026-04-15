import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTodayInAppTz, APP_TIMEZONE } from './timezone';
import { mealPlannerDateOnly, mealPlannerCutoffDate } from './meal-planner-utils';

const CONVERSATION_TTL_HOURS = 2;
const MAX_HISTORY_MESSAGES = 20;

export type BotRole = 'user' | 'assistant' | 'system';

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

function cutoffIso(): string {
  return new Date(Date.now() - CONVERSATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export async function pruneOldConversationMessages(
  supabase: SupabaseClient,
  table: string,
  where: Record<string, string>,
): Promise<void> {
  const cutoff = cutoffIso();
  let q: any = supabase.from(table).delete();
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
  await q.lt('created_at', cutoff);
}

export async function saveConversationMessage(
  supabase: SupabaseClient,
  table: string,
  row: {
    phone_number: string;
    client_id: string | null;
    role: BotRole;
    content: string;
    call_control_id?: string;
    telnyx_event_id?: string | null;
    utterance_id?: string | null;
  },
) {
  await supabase.from(table).insert(row);
}

export async function loadConversationHistory(
  supabase: SupabaseClient,
  table: string,
  where: Record<string, string>,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const cutoff = cutoffIso();
  let q: any = supabase.from(table).select('role, content').gte('created_at', cutoff);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
  const { data } = await q.order('created_at', { ascending: true }).limit(MAX_HISTORY_MESSAGES);

  const raw = (data ?? []).filter((r: any) =>
    r.content &&
    r.role !== 'system' &&
    r.content !== '(No response)' &&
    !String(r.content).startsWith('[processed:') &&
    !String(r.content).startsWith('Something went wrong') &&
    !String(r.content).startsWith('Sorry, we hit a temporary issue') &&
    !String(r.content).startsWith('Thank you for your message. This number is not able to receive replies')
  );

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const row of raw) {
    if (history.length > 0 && history[history.length - 1].role === row.role) {
      history[history.length - 1].content += '\n' + row.content;
    } else {
      history.push({ role: row.role, content: row.content });
    }
  }
  while (history.length > 0 && history[0].role !== 'user') history.shift();
  while (history.length > 0 && history[history.length - 1].role !== 'user') history.pop();

  return history;
}

function defineBotTools(hasMultipleAccounts: boolean): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];

  if (hasMultipleAccounts) {
    tools.push({
      name: 'switch_account',
      description: 'Switch to a different client account linked to this phone number. Use the client_id from the accounts list in the system prompt.',
      input_schema: {
        type: 'object' as const,
        properties: {
          client_id: { type: 'string', description: 'The ID of the client account to switch to' },
        },
        required: ['client_id'],
      },
    });
  }

  tools.push(
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
      description: 'Get full details for a specific delivery date in one call. Returns: (1) the default order, (2) the client\'s current order (if customized), (3) alternative items available that are not in the current order.',
      input_schema: { type: 'object' as const, properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'] },
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
            items: { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'number' } }, required: ['name', 'quantity'] },
          },
        },
        required: ['date', 'items'],
      },
    },
    {
      name: 'set_email',
      description: 'Set or update the client\'s email address. Confirm the email with the client before calling this.',
      input_schema: { type: 'object' as const, properties: { email: { type: 'string' } }, required: ['email'] },
    },
    {
      name: 'get_delivery_history',
      description: 'Get recent delivery history for the client (includes all household members). Shows delivery dates, times, and proof of delivery photo links.',
      input_schema: { type: 'object' as const, properties: { limit: { type: 'number' } }, required: [] },
    },
  );

  return tools;
}

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

  console.log(`[Bot] Setting email for client ${clientId} to ${trimmed}`);
  const { data, error } = await supabase.from('clients').update({ email: trimmed }).eq('id', clientId).select('id, email');
  if (error) {
    console.error(`[Bot] Failed to set email for ${clientId}:`, error);
    return JSON.stringify({ success: false, error: error.message });
  }
  console.log('[Bot] Email update result:', data);

  return JSON.stringify({ success: true, email: trimmed, message: `Email set to ${trimmed}. You can now log in at http://customer.thedietfantasy.com/ with this email.` });
}

async function executeGetDeliveryHistory(supabase: SupabaseClient, clientId: string, limit?: number): Promise<string> {
  const count = Math.min(Math.max(limit ?? 5, 1), 10);
  const today = getTodayInAppTz();

  const { data: deps } = await supabase.from('clients').select('id').eq('parent_client_id', clientId);
  const allIds = [clientId, ...(deps ?? []).map((d: any) => d.id)];

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, client_id, scheduled_delivery_date, actual_delivery_date, proof_of_delivery_url, status, order_number')
    .in('client_id', allIds)
    .lte('scheduled_delivery_date', today + 'T23:59:59')
    .order('scheduled_delivery_date', { ascending: false })
    .limit(count * 3);

  if (error) return JSON.stringify({ error: error.message });
  if (!orders || orders.length === 0) return JSON.stringify({ deliveries: [], message: 'No delivery history found.' });

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

function buildSystemPrompt(
  channel: 'sms' | 'voice',
  client: { full_name: string; email: string | null; service_type: string; approved_meals_per_week: number | null; expiration_date: string | null },
  householdCount: number,
  allAccounts?: { id: string; full_name: string; service_type: string }[],
): string {
  const now = new Date();
  const timestamp = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(now);

  const mealsPerPerson = client.approved_meals_per_week != null ? Math.floor(client.approved_meals_per_week / householdCount) : null;

  const multiAccountNote = allAccounts && allAccounts.length > 1
    ? `\n\nMULTIPLE ACCOUNTS: This phone number is linked to ${allAccounts.length} accounts:\n${allAccounts.map(a => `- ${a.full_name} (${a.service_type}) — ID: ${a.id}`).join('\n')}\nYou are currently managing: ${client.full_name}. If the client asks to manage a different account, use the switch_account tool with the appropriate client_id. When greeting, mention which account you are on and that they can switch.`
    : '';

  const medium = channel === 'voice' ? 'phone call' : 'SMS';

  return `You are The Diet Fantasy's ${medium} assistant. Keep all responses SHORT.

CLIENT: ${client.full_name} | ${client.service_type} | Household: ${householdCount} people | ${timestamp}
MEAL LIMITS: ${client.approved_meals_per_week ?? '?'} meals/week total for the household (${householdCount} Food member(s))${mealsPerPerson ? ` — about ${mealsPerPerson} per person per week` : ''}.
The get_day_details tool returns meal_limit_for_day which is the EXACT daily limit for the household. This accounts for household size already.${multiAccountNote}

YOU OFFER THESE SERVICES:
1. Account Info — view account details (read-only)
2. Meal Plan — view and edit meal orders for delivery dates
3. Delivery History — view recent deliveries with proof of delivery photos
4. Set Email — set or update their email for portal login${client.email ? '' : '\n\nIMPORTANT: This client has NO EMAIL on file. After greeting, recommend they set one so they can log into the portal.'}

SET EMAIL FLOW:
- Ask for the email address.
- Confirm it back before saving.
- Once confirmed, call set_email. Then tell them they can log in at http://customer.thedietfantasy.com/ with that email.

DELIVERY HISTORY FLOW:
- When asked about deliveries or proof of delivery, call get_delivery_history.
- Each delivery on its own line with scheduled date, delivery time (if available), and proof link.

MEAL PLAN FLOW:
1. Ask: account info, meal plan, or delivery history?
2. For meal plans, call get_delivery_dates_overview for the relevant month.
3. Present dates: friendly date, EDITABLE or LOCKED, "edited" if customized.
4. When client picks a date, call get_day_details ONCE. Show: current order, meal limit, totals, other available items. Explain how to request changes.
5. Total MUST EXACTLY equal meal_limit_for_day. If not exact, do NOT save; explain over/under.
6. If exact, ask to confirm once. If they say yes/confirm/save, immediately call save_meal_plan_for_date.

RULES:
- NEVER use emojis.
- Be extremely concise. No filler text.
- Outside capabilities: "Please call (845) 478-6605."
- First message only: sign off with "— The Diet Fantasy"
- At the end of every conversation, remind them they can also use http://customer.thedietfantasy.com/ (log in with their email).`;
}

export async function runAssistantTurn(opts: {
  supabase: SupabaseClient;
  channel: 'sms' | 'voice';
  phone: string;
  conversationTable: 'sms_conversations' | 'call_conversations';
  where: Record<string, string>;
  messageText: string;
  restoreActiveClientFromTable?: boolean;
  clientIdRestoreWhere?: Record<string, string>;
}): Promise<{
  replyText: string;
  activeClientId: string | null;
  clientName: string | null;
}> {
  const FALLBACK_MSG = 'Sorry, we hit a temporary issue. Please try again or call (845) 478-6605 for help. — The Diet Fantasy';

  const { supabase, channel, phone, conversationTable, where, messageText } = opts;

  const clients = await identifyClientByPhone(supabase, phone);
  if (clients.length === 0) {
    return {
      replyText: 'Thank you for your message. This number is not able to receive replies. For any questions or support, please call us at (845) 478-6605. — The Diet Fantasy',
      activeClientId: null,
      clientName: null,
    };
  }

  const foodClients = clients.filter((c: any) => c.service_type === 'Food');
  let client = foodClients[0] ?? clients[0];
  if (!client) {
    return { replyText: 'We couldn\'t find your account. Please call (845) 478-6605 for assistance.', activeClientId: null, clientName: null };
  }

  // Restore active account for multi-account phone numbers (optional).
  if (opts.restoreActiveClientFromTable && clients.length > 1) {
    const restoreWhere = opts.clientIdRestoreWhere ?? where;
    let q: any = supabase.from(conversationTable).select('client_id');
    for (const [k, v] of Object.entries(restoreWhere)) q = q.eq(k, v);
    const { data: lastMsg } = await q
      .not('client_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (lastMsg?.client_id) {
      const restored = clients.find((c: any) => c.id === lastMsg.client_id);
      if (restored) client = restored;
    }
  }

  let activeClientId = client.id as string;

  await pruneOldConversationMessages(supabase, conversationTable, where);
  await saveConversationMessage(supabase, conversationTable, {
    ...(conversationTable === 'call_conversations' ? { call_control_id: where.call_control_id } : {}),
    phone_number: phone,
    client_id: activeClientId,
    role: 'user',
    content: messageText,
  });

  const history = await loadConversationHistory(supabase, conversationTable, where);

  const allAccounts = clients
    .filter((c: any) => !c.parent_client_id)
    .map((c: any) => ({ id: c.id, full_name: c.full_name, service_type: c.service_type }));

  async function buildPromptForClient(c: any) {
    const { data: deps } = await supabase.from('clients').select('id, service_type').eq('parent_client_id', c.id);
    const foodDeps2 = (deps ?? []).filter((d: any) => d.service_type === 'Food');
    const householdCount = 1 + foodDeps2.length;
    return {
      prompt: buildSystemPrompt(
        channel,
        { full_name: c.full_name, email: c.email, service_type: c.service_type, approved_meals_per_week: c.approved_meals_per_week, expiration_date: c.expiration_date },
        householdCount,
        allAccounts.length > 1 ? allAccounts : undefined,
      ),
      householdCount,
    };
  }

  let { prompt: systemPrompt } = await buildPromptForClient(client);

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools = defineBotTools(allAccounts.length > 1);
  const messages: Anthropic.MessageParam[] = history.map(h => ({ role: h.role, content: h.content }));

  try {
    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    let iterations = 0;
    while (response.stop_reason === 'tool_use' && iterations < 10) {
      iterations++;
      const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolBlocks) {
        if (block.name === 'switch_account') {
          const targetId = (block.input as any).client_id;
          const target = clients.find((c: any) => c.id === targetId);
          if (target) {
            client = target;
            activeClientId = target.id;
            const rebuilt = await buildPromptForClient(target);
            systemPrompt = rebuilt.prompt;
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Switched to ${target.full_name} (${target.service_type}).` });
          } else {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: account ID "${targetId}" not found for this phone number.` });
          }
          continue;
        }

        const result = await executeTool(supabase, activeClientId, block.name, block.input);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
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

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    let replyText = textBlocks.map(b => b.text).join('\n').trim();
    if (!replyText) replyText = FALLBACK_MSG;

    await saveConversationMessage(supabase, conversationTable, {
      ...(conversationTable === 'call_conversations' ? { call_control_id: where.call_control_id } : {}),
      phone_number: phone,
      client_id: activeClientId,
      role: 'assistant',
      content: replyText,
    });

    return { replyText, activeClientId, clientName: client?.full_name ?? null };
  } catch (err) {
    console.error('[Bot] Assistant error:', err);
    return { replyText: FALLBACK_MSG, activeClientId, clientName: client?.full_name ?? null };
  }
}

