'use server';

import { createSession, deleteSession, verifySession } from './session';
import { hashPassword, verifyPassword } from './password';
import { redirect } from 'next/navigation';
import { supabase } from './supabase';
import { randomUUID } from 'crypto';

import { getSettings } from './actions';
import { sendEmail } from './email';
import { isProduceServiceType } from './isProduceServiceType';
import { householdHasFoodOrMealPortalMember } from './meal-dependant-portal-login';
import { signAccountPickToken, verifyAccountPickToken } from './login-account-pick-token';
import { getAllClientNumbers, normalizePhone } from './phone-utils';
import { sendSms } from './telnyx';

export type LoginAccountChoice = {
    type: 'admin' | 'vendor' | 'navigator' | 'client';
    id: string;
    title: string;
    subtitle?: string;
};

type IdentityMatch = {
    type: 'admin' | 'vendor' | 'navigator' | 'client';
    id?: string;
    isActive?: boolean;
    serviceType?: string;
};

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtp(identifier: string) {
    const trimmed = identifier.trim();
    if (!trimmed) return { success: false, message: 'Email or phone number is required.' };

    try {
        const idn = await checkLoginIdentity(trimmed);
        if (!idn.exists || !idn.otpStorageKey) {
            return { success: false, message: 'No account found with that email or phone number.' };
        }

        const code = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        const otpKey = idn.otpStorageKey;

        await supabase.from('passwordless_codes').delete().eq('email', otpKey);

        const codeId = randomUUID();
        const { error: insertError } = await supabase
            .from('passwordless_codes')
            .insert([{ id: codeId, email: otpKey, code, expires_at: expiresAt }]);
        if (insertError) throw insertError;

        if (idn.otpChannel === 'sms') {
            const e164 = otpKey.startsWith('sms:') ? otpKey.slice(4) : otpKey;
            const smsResult = await sendSms(e164, `Your Diet Fantasy login code: ${code}`, {
                messageType: 'passwordless_login',
            });
            if (!smsResult.success) {
                console.error('[sendOtp] SMS failed:', smsResult.error);
                await supabase.from('passwordless_codes').delete().eq('id', codeId);
                return { success: false, message: smsResult.error || 'Failed to send text message.' };
            }
            return { success: true, message: 'Code sent to your phone.' };
        }

        const emailResult = await sendEmail({
            to: trimmed,
            subject: 'Your Login Code',
            html: `
                <div style="font-family: sans-serif; padding: 20px;">
                    <h2>Your Login Code</h2>
                    <p>Enter the following code to log in:</p>
                    <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
                        ${code}
                    </div>
                    <p>This code will expire in 10 minutes.</p>
                </div>
            `,
        });

        if (!emailResult.success) {
            console.error('Error sending passwordless login email:', emailResult.error);
            await supabase.from('passwordless_codes').delete().eq('id', codeId);
            return { success: false, message: emailResult.error || 'Failed to send email.' };
        }

        return { success: true, message: 'Code sent to your email.' };
    } catch (error) {
        console.error('Send OTP Error:', error);
        return { success: false, message: 'An unexpected error occurred.' };
    }
}

export async function verifyOtp(identifier: string, code: string) {
    const trimmed = identifier.trim();
    if (!trimmed || !code) return { success: false, message: 'Login and code are required.' };

    try {
        const otpKey = toOtpStorageKey(trimmed);
        if (!otpKey) {
            return { success: false, message: 'Enter a valid email or phone number.' };
        }

        const { data: record, error: fetchError } = await supabase
            .from('passwordless_codes')
            .select('*')
            .eq('email', otpKey)
            .eq('code', code)
            .single();

        if (fetchError || !record) {
            return { success: false, message: 'Invalid code.' };
        }

        if (new Date(record.expires_at) < new Date()) {
            return { success: false, message: 'Code has expired.' };
        }

        // Code valid! Delete it.
        await supabase.from('passwordless_codes').delete().eq('id', record.id);

        const { matches, normalizedInput } = await collectIdentityMatches(trimmed);
        if (matches.length === 0) {
            return { success: false, message: 'User not found.' };
        }

        if (matches.length > 1) {
            const adminMatch = matches.find((m) => m.type === 'admin');
            if (adminMatch) {
                try {
                    await completeLoginFromMatch(adminMatch, trimmed);
                } catch (e) {
                    if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
                    console.error('Verify OTP (admin):', e);
                    return { success: false, message: 'An error occurred during verification.' };
                }
                return { success: false, message: 'Could not resolve user session.' };
            }
        }

        const eligible = await buildEligibleLoginChoices(matches);
        if (eligible.length === 0) {
            return { success: false, message: 'No eligible account found for this email.' };
        }

        if (eligible.length === 1) {
            const only = eligible[0]!;
            const m = matches.find((x) => x.id === only.id && x.type === only.type);
            if (!m?.id) {
                return { success: false, message: 'Could not resolve user session.' };
            }
            try {
                await completeLoginFromMatch(m, trimmed);
            } catch (e) {
                if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
                if (e instanceof Error && e.message === 'PRODUCE_PORTAL_BLOCKED') {
                    return {
                        success: false,
                        message: 'Produce account holders cannot sign in here. Please contact support.',
                    };
                }
                console.error('Verify OTP:', e);
                return { success: false, message: 'An error occurred during verification.' };
            }
            return { success: false, message: 'Could not resolve user session.' };
        }

        const keys = eligible.map((c) => choiceKey(c.type, c.id));
        const pickToken = signAccountPickToken(normalizedInput, keys);
        if (!pickToken) {
            return {
                success: false,
                message:
                    'Shared-email login is not configured (set LOGIN_ACCOUNT_PICK_SECRET or ensure a Supabase server secret is available).',
            };
        }

        return {
            success: true,
            needsAccountChoice: true as const,
            accountChoices: eligible,
            pickToken,
        };

    } catch (error) {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
            throw error;
        }
        if (error instanceof Error && error.message === 'PRODUCE_PORTAL_BLOCKED') {
            return { success: false, message: 'Produce account holders cannot sign in here. Please contact support.' };
        }
        console.error('Verify OTP Error:', error);
        return { success: false, message: 'An error occurred during verification.' };
    }
}

export async function login(prevState: any, formData: FormData) {
    const loginInput = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (!loginInput || !password) {
        return { message: 'Please enter a username/email and password.' };
    }

    try {
        // 1. Check Env Super Admin
        const envUser = process.env.ADMIN_USERNAME;
        const envPass = process.env.ADMIN_PASSWORD;

        if (envUser && envPass && loginInput === envUser && password === envPass) {
            await createSession('super-admin', 'Admin', 'super-admin');
            redirect('/');
        }

        // 2. Check Database Admins
        const { data: admin } = await supabase
            .from('admins')
            .select('id, username, password, name, role')
            .eq('username', loginInput)
            .maybeSingle();

        if (admin) {
            const isMatch = await verifyPassword(password, admin.password);
            if (!isMatch) {
                return { message: 'Invalid credentials.' };
            }
            const role = (admin.role && admin.role !== 'admin') ? admin.role : 'admin';
            await createSession(admin.id, admin.name || 'Admin', role);
            redirect(role === 'brooklyn_admin' ? '/clients' : '/');
        }

        // 3. Check Vendors (by Email) - normalize email for matching (ignore spaces and case)
        const normalizedEmail = normalizeEmail(loginInput);
        const { data: vendors } = await supabase
            .from('vendors')
            .select('*')
            .not('email', 'is', null);

        const vendor = vendors?.find(v => v.email && normalizeEmail(v.email) === normalizedEmail);

        if (vendor) {
            if (!vendor.is_active) {
                return { message: 'Account inactive. Contact administrator.' };
            }
            if (!vendor.password) {
                return { message: 'No password set. Contact administrator.' };
            }
            // Trim password input and stored hash before verifying
            const isMatch = await verifyPassword(password.trim(), vendor.password.trim());
            if (!isMatch) {
                return { message: 'Invalid credentials.' };
            }
            await createSession(vendor.id, vendor.name || 'Vendor', 'vendor');
            redirect('/vendor');
        }

        // 4. Check Navigators (by Email) - normalize email for matching (ignore spaces and case)
        const { data: navigators } = await supabase
            .from('navigators')
            .select('*')
            .not('email', 'is', null);

        const navigator = navigators?.find(n => n.email && normalizeEmail(n.email) === normalizedEmail);

        if (navigator) {
            if (!navigator.is_active) {
                return { message: 'Account inactive. Contact administrator.' };
            }
            // If no password set, we can't login (unless we allow setting it here, but typically admin sets it)
            if (!navigator.password) {
                return { message: 'No password set. Contact administrator.' };
            }
            const isMatch = await verifyPassword(password.trim(), navigator.password.trim());
            if (!isMatch) {
                return { message: 'Invalid credentials.' };
            }
            await createSession(navigator.id, navigator.name || 'Navigator', 'navigator');
            redirect('/clients');
        }

        return { message: 'Invalid credentials.' };

    } catch (error) {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
            throw error;
        }
        console.error('Login error:', error);
        return { message: 'An unexpected error occurred.' };
    }
}


export async function logout() {
    await deleteSession();
    redirect('/login');
}


// Helper function to normalize email addresses (remove all spaces, lowercase)
function normalizeEmail(email: string): string {
    if (!email) return '';
    return email.replace(/\s+/g, '').toLowerCase();
}

/** DB lookup key for passwordless_codes.email (normalized email or `sms:+E164`). */
function toOtpStorageKey(raw: string): string | null {
    const t = raw.trim();
    if (t.startsWith('sms:')) {
        const inner = t.slice(4);
        const e164 = normalizePhone(inner) ?? (inner.startsWith('+') ? inner : null);
        return e164 ? `sms:${e164}` : null;
    }
    const e164 = normalizePhone(t);
    if (e164 && !t.includes('@')) {
        return `sms:${e164}`;
    }
    const e = normalizeEmail(t);
    return e || null;
}

async function collectClientMatchesByPhone(e164: string): Promise<IdentityMatch[]> {
    const { data, error } = await supabase
        .from('clients')
        .select('id, service_type, phone_number, secondary_phone_number')
        .or('phone_number.not.is.null,secondary_phone_number.not.is.null');
    if (error) {
        console.error('[collectClientMatchesByPhone]', error);
        return [];
    }
    const seen = new Set<string>();
    const matches: IdentityMatch[] = [];
    for (const row of data || []) {
        const r = row as {
            id: string;
            service_type?: string | null;
            phone_number?: string | null;
            secondary_phone_number?: string | null;
        };
        const nums = getAllClientNumbers({
            phone_number: r.phone_number,
            secondary_phone_number: r.secondary_phone_number,
        });
        for (const num of nums) {
            if (normalizePhone(num) === e164) {
                const id = String(r.id);
                if (!seen.has(id)) {
                    seen.add(id);
                    matches.push({ type: 'client', id, serviceType: r.service_type ?? undefined });
                }
                break;
            }
        }
    }
    return matches;
}

async function collectIdentityMatches(identifier: string): Promise<{
    normalizedInput: string;
    originalTrimmed: string;
    matches: IdentityMatch[];
}> {
    const originalTrimmed = identifier.trim();

    if (originalTrimmed.startsWith('sms:')) {
        const inner = originalTrimmed.slice(4);
        const e164 = normalizePhone(inner) ?? (inner.startsWith('+') ? inner : null);
        if (!e164) {
            return { normalizedInput: originalTrimmed, originalTrimmed, matches: [] };
        }
        const matches = await collectClientMatchesByPhone(e164);
        return { normalizedInput: `sms:${e164}`, originalTrimmed, matches };
    }

    const phoneE164 = normalizePhone(originalTrimmed);
    if (phoneE164 && !originalTrimmed.includes('@')) {
        const matches = await collectClientMatchesByPhone(phoneE164);
        return { normalizedInput: `sms:${phoneE164}`, originalTrimmed, matches };
    }

    const normalizedInput = normalizeEmail(identifier);
    const matches: IdentityMatch[] = [];

    const envUser = process.env.ADMIN_USERNAME;
    if (envUser && originalTrimmed === envUser) {
        matches.push({ type: 'admin' });
    }

    const { data: admins, error: adminsError } = await supabase.from('admins').select('id').eq('username', originalTrimmed);
    if (adminsError) {
        console.error('[collectIdentityMatches] Error querying admins:', adminsError);
    } else if (admins && admins.length > 0) {
        matches.push(...admins.map((a) => ({ type: 'admin' as const, id: a.id })));
    }

    const { data: vendorsData, error: vendorsError } = await supabase
        .from('vendors')
        .select('id, email, is_active')
        .not('email', 'is', null);
    if (vendorsError) {
        console.error('[collectIdentityMatches] Error querying vendors:', vendorsError);
    } else if (vendorsData && vendorsData.length > 0) {
        const exactMatches = vendorsData.filter((v) => v.email && normalizeEmail(v.email) === normalizedInput);
        if (exactMatches.length > 0) {
            matches.push(
                ...exactMatches.map((v) => ({
                    type: 'vendor' as const,
                    id: v.id,
                    isActive: v.is_active,
                }))
            );
        }
    }

    const { data: navigatorsData, error: navigatorsError } = await supabase
        .from('navigators')
        .select('id, email')
        .not('email', 'is', null);
    if (navigatorsError) {
        console.error('[collectIdentityMatches] Error querying navigators:', navigatorsError);
    } else if (navigatorsData && navigatorsData.length > 0) {
        const exactMatches = navigatorsData.filter((n) => n.email && normalizeEmail(n.email) === normalizedInput);
        if (exactMatches.length > 0) {
            matches.push(...exactMatches.map((n) => ({ type: 'navigator' as const, id: n.id })));
        }
    }

    const { data: clientsData, error: clientsError } = await supabase
        .from('clients')
        .select('id, email, service_type')
        .not('email', 'is', null);
    if (clientsError) {
        console.error('[collectIdentityMatches] Error querying clients:', clientsError);
    } else if (clientsData && clientsData.length > 0) {
        const exactMatches = clientsData.filter((c) => c.email && normalizeEmail(c.email) === normalizedInput);
        if (exactMatches.length > 0) {
            matches.push(
                ...exactMatches.map((c) => ({
                    type: 'client' as const,
                    id: c.id,
                    serviceType: (c as { service_type?: string }).service_type,
                }))
            );
        }
    }

    return { normalizedInput, originalTrimmed, matches };
}

function choiceKey(type: string, id: string) {
    return `${type}:${id}`;
}

/** Login targets with id only; filters inactive vendors and Produce-without-portal clients. */
async function buildEligibleLoginChoices(matches: IdentityMatch[]): Promise<LoginAccountChoice[]> {
    const withIds = matches.filter((m): m is IdentityMatch & { id: string } => Boolean(m.id));
    const out: LoginAccountChoice[] = [];

    const clientMatches = withIds.filter((m) => m.type === 'client');
    const vendorMatches = withIds.filter((m) => m.type === 'vendor');
    const navMatches = withIds.filter((m) => m.type === 'navigator');
    const adminMatches = withIds.filter((m) => m.type === 'admin');

    let clientRows: { id: string; full_name: string | null; service_type: string | null }[] = [];
    if (clientMatches.length > 0) {
        const ids = clientMatches.map((c) => c.id);
        const { data } = await supabase.from('clients').select('id, full_name, service_type').in('id', ids);
        clientRows = (data || []) as typeof clientRows;
    }
    const clientById = new Map(clientRows.map((r) => [r.id, r]));

    for (const m of clientMatches) {
        const row = clientById.get(m.id);
        const st = row?.service_type ?? m.serviceType;
        if (isProduceServiceType(st) && !(await householdHasFoodOrMealPortalMember(supabase, m.id))) {
            continue;
        }
        const name = row?.full_name?.trim() || 'Client';
        out.push({
            type: 'client',
            id: m.id,
            title: name,
            subtitle: st ? `Client · ${st}` : 'Client',
        });
    }

    for (const m of vendorMatches) {
        if (m.isActive === false) continue;
        const { data: v } = await supabase.from('vendors').select('name').eq('id', m.id).maybeSingle();
        out.push({
            type: 'vendor',
            id: m.id,
            title: (v?.name || 'Vendor').trim() || 'Vendor',
            subtitle: 'Vendor portal',
        });
    }

    for (const m of navMatches) {
        const { data: n } = await supabase.from('navigators').select('name').eq('id', m.id).maybeSingle();
        out.push({
            type: 'navigator',
            id: m.id,
            title: (n?.name || 'Navigator').trim() || 'Navigator',
            subtitle: 'Navigator',
        });
    }

    for (const m of adminMatches) {
        const { data: a } = await supabase.from('admins').select('name, username').eq('id', m.id).maybeSingle();
        out.push({
            type: 'admin',
            id: m.id,
            title: (a?.name || a?.username || 'Admin').trim() || 'Admin',
            subtitle: 'Admin',
        });
    }

    out.sort((a, b) => {
        const order = (t: string) =>
            ({ client: 0, vendor: 1, navigator: 2, admin: 3 }[t] ?? 9);
        const d = order(a.type) - order(b.type);
        if (d !== 0) return d;
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    });

    return out;
}

async function completeLoginFromMatch(match: IdentityMatch & { id?: string }, emailForEnvCheck: string) {
    const envUser = process.env.ADMIN_USERNAME;
    const trimmedEmail = emailForEnvCheck.trim();

    if (match.type === 'admin') {
        if (!match.id && envUser && trimmedEmail === envUser) {
            await createSession('super-admin', 'Admin', 'super-admin');
            redirect('/');
        } else if (match.id) {
            const { data: admin } = await supabase.from('admins').select('name, role').eq('id', match.id).single();
            const role = admin?.role && admin.role !== 'admin' ? admin.role : 'admin';
            await createSession(match.id, admin?.name || 'Admin', role);
            redirect(role === 'brooklyn_admin' ? '/clients' : '/');
        }
        return;
    }
    if (match.type === 'vendor' && match.id) {
        const { data: vendor } = await supabase.from('vendors').select('name').eq('id', match.id).single();
        await createSession(match.id, vendor?.name || 'Vendor', 'vendor');
        redirect('/vendor');
    }
    if (match.type === 'navigator' && match.id) {
        const { data: nav } = await supabase.from('navigators').select('name').eq('id', match.id).single();
        await createSession(match.id, nav?.name || 'Navigator', 'navigator');
        redirect('/clients');
    }
    if (match.type === 'client' && match.id) {
        const { data: clientRow } = await supabase
            .from('clients')
            .select('service_type, full_name')
            .eq('id', match.id)
            .single();
        if (isProduceServiceType(clientRow?.service_type) && !(await householdHasFoodOrMealPortalMember(supabase, match.id))) {
            throw new Error('PRODUCE_PORTAL_BLOCKED');
        }
        await createSession(match.id, clientRow?.full_name || 'Client', 'client');
        redirect(`/client-portal/${match.id}`);
    }
}

// Helper to check identity AND return global passwordless setting
export async function checkEmailIdentity(identifier: string) {
    if (!identifier) return { exists: false, type: null, enablePasswordless: false };

    const settings = await getSettings();
    const enablePasswordless = settings.enablePasswordlessLogin || false;

    const { matches } = await collectIdentityMatches(identifier);

    if (matches.length === 0) {
        return { exists: false, type: null, enablePasswordless: false };
    }

    if (matches.length > 1) {
        const adminMatch = matches.find((m) => m.type === 'admin');
        if (adminMatch) {
            return {
                exists: true,
                type: 'admin' as const,
                id: adminMatch.id,
                enablePasswordless: false,
            };
        }
    }

    const eligible = await buildEligibleLoginChoices(matches);
    if (eligible.length === 0) {
        return { exists: false, type: null, enablePasswordless: false };
    }
    if (eligible.length > 1) {
        return {
            exists: true,
            needsAccountChoice: true as const,
            accountChoices: eligible,
            enablePasswordless,
        };
    }

    const only = eligible[0]!;
    if (only.type === 'admin') {
        return { exists: true, type: 'admin' as const, id: only.id, enablePasswordless: false };
    }
    if (only.type === 'vendor') {
        return { exists: true, type: 'vendor' as const, id: only.id, enablePasswordless: false };
    }
    if (only.type === 'navigator') {
        return { exists: true, type: 'navigator' as const, id: only.id, enablePasswordless: false };
    }
    const row = matches.find((m) => m.type === 'client' && m.id === only.id);
    let produceNotAllowed = isProduceServiceType(row?.serviceType);
    if (produceNotAllowed && only.id && (await householdHasFoodOrMealPortalMember(supabase, only.id))) {
        produceNotAllowed = false;
    }
    return {
        exists: true,
        type: 'client' as const,
        id: only.id,
        enablePasswordless,
        produceNotAllowed: produceNotAllowed || false,
    };
}

async function checkPhoneLoginIdentity(e164: string) {
    const settings = await getSettings();
    const enablePasswordless = settings.enablePasswordlessLogin || false;
    const matches = await collectClientMatchesByPhone(e164);
    if (matches.length === 0) {
        return {
            exists: false as const,
            type: null,
            enablePasswordless: false,
            otpStorageKey: undefined,
            otpChannel: 'sms' as const,
        };
    }

    const eligible = await buildEligibleLoginChoices(matches);
    if (eligible.length === 0) {
        return {
            exists: false as const,
            type: null,
            enablePasswordless: false,
            otpStorageKey: undefined,
            otpChannel: 'sms' as const,
        };
    }

    const otpStorageKey = `sms:${e164}`;
    if (eligible.length > 1) {
        return {
            exists: true as const,
            needsAccountChoice: true as const,
            accountChoices: eligible,
            enablePasswordless,
            otpStorageKey,
            otpChannel: 'sms' as const,
        };
    }

    const only = eligible[0]!;
    const row = matches.find((m) => m.type === 'client' && m.id === only.id);
    let produceNotAllowed = isProduceServiceType(row?.serviceType);
    if (produceNotAllowed && only.id && (await householdHasFoodOrMealPortalMember(supabase, only.id))) {
        produceNotAllowed = false;
    }
    return {
        exists: true as const,
        type: 'client' as const,
        id: only.id,
        enablePasswordless,
        produceNotAllowed: produceNotAllowed || false,
        otpStorageKey,
        otpChannel: 'sms' as const,
    };
}

export type LoginIdentityResult = Awaited<ReturnType<typeof checkEmailIdentity>> & {
    otpStorageKey?: string;
    otpChannel?: 'sms' | 'email';
};

/** Resolves username / email / phone for passwordless OTP (email or SMS). */
export async function checkLoginIdentity(identifier: string): Promise<LoginIdentityResult> {
    const t = identifier.trim();
    if (!t) {
        return { exists: false, type: null, enablePasswordless: false, otpStorageKey: undefined, otpChannel: undefined };
    }
    const e164 = normalizePhone(t);
    if (e164 && !t.includes('@')) {
        return checkPhoneLoginIdentity(e164);
    }
    const r = await checkEmailIdentity(identifier);
    if (!r.exists) {
        return { ...r, otpStorageKey: undefined, otpChannel: undefined };
    }
    return {
        ...r,
        otpStorageKey: normalizeEmail(identifier) || undefined,
        otpChannel: 'email',
    };
}

export async function confirmLoginWithPick(pickToken: string, choice: { type: LoginAccountChoice['type']; id: string }) {
    try {
        const payload = verifyAccountPickToken(pickToken);
        if (!payload) {
            return { success: false, message: 'This link has expired. Please sign in again.' };
        }
        const key = choiceKey(choice.type, choice.id);
        if (!payload.keys.includes(key)) {
            return { success: false, message: 'Invalid account selection.' };
        }

        const emailNorm = payload.email;
        const { matches } = await collectIdentityMatches(emailNorm);
        const currentKeys = new Set(
            matches.filter((m) => m.id).map((m) => choiceKey(m.type, m.id!))
        );
        if (!currentKeys.has(key)) {
            return { success: false, message: 'That account is no longer available for this sign-in.' };
        }

        const match = matches.find((m) => m.id === choice.id && m.type === choice.type);
        if (!match?.id) {
            return { success: false, message: 'Account not found.' };
        }

        if (match.type === 'vendor' && match.isActive === false) {
            return { success: false, message: 'That vendor account is inactive.' };
        }

        await completeLoginFromMatch(match, emailNorm);
        return { success: false, message: 'Could not resolve user session.' };
    } catch (error) {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
            throw error;
        }
        if (error instanceof Error && error.message === 'PRODUCE_PORTAL_BLOCKED') {
            return { success: false, message: 'Produce account holders cannot sign in here. Please contact support.' };
        }
        console.error('confirmLoginWithPick:', error);
        return { success: false, message: 'Something went wrong. Please try again.' };
    }
}



// --- Admin Management Actions ---

export async function getAdmins() {
    await verifySession();
    try {
        const { data, error } = await supabase
            .from('admins')
            .select('id, username, created_at, name, role')
            .order('created_at', { ascending: true });
        if (error) return [];
        return data || [];
    } catch (error) {
        console.error('Error fetching admins:', error);
        return [];
    }
}

export async function getBrooklynAdmins() {
    await verifySession();
    try {
        const { data, error } = await supabase
            .from('admins')
            .select('id, username, created_at, name')
            .eq('role', 'brooklyn_admin')
            .order('created_at', { ascending: true });
        if (error) return [];
        return data || [];
    } catch (error) {
        console.error('Error fetching Brooklyn admins:', error);
        return [];
    }
}

export async function addAdmin(prevState: any, formData: FormData) {
    await verifySession();
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const name = (formData.get('name') as string) || 'Admin';
    const role = (formData.get('role') as string) || 'admin';

    if (!username || !password) {
        return { message: 'Username and password are required.' };
    }

    // Check availability
    const { data: existing } = await supabase
        .from('admins')
        .select('id')
        .eq('username', username)
        .maybeSingle();
    if (existing) {
        return { message: 'Username already exists.' };
    }

    const hashedPassword = await hashPassword(password);
    const id = randomUUID();

    try {
        const { error } = await supabase
            .from('admins')
            .insert([{ id, username, password: hashedPassword, name, role: role === 'brooklyn_admin' ? 'brooklyn_admin' : 'admin' }]);
        if (error) throw error;
    } catch (error) {
        console.error('Error adding admin:', error);
        return { message: 'Failed to add admin.' };
    }

    return { message: 'Admin added successfully.', success: true };
}

export async function deleteAdmin(id: string) {
    await verifySession();
    // Prevent deleting self? Ideally yes, but maybe UI handles it or we assume Super Admin can fix.
    // Also, don't delete the last admin if relying on DB. But we have Env admin.

    try {
        const { error } = await supabase.from('admins').delete().eq('id', id);
        if (error) throw error;
    } catch (error) {
        console.error('Error deleting admin:', error);
        throw new Error('Failed to delete admin');
    }
}

export async function updateAdmin(prevState: any, formData: FormData) {
    await verifySession();
    const id = formData.get('id') as string;
    const name = formData.get('name') as string;
    const password = formData.get('password') as string;

    if (!id) {
        return { message: 'Admin ID is missing.', success: false };
    }

    const payload: any = {};
    
    if (name) {
        payload.name = name;
    }
    if (password) {
        payload.password = await hashPassword(password);
    }

    if (Object.keys(payload).length === 0) {
        return { message: 'No changes made.', success: true };
    }
    
    try {
        const { error } = await supabase
            .from('admins')
            .update(payload)
            .eq('id', id);
        if (error) throw error;
    } catch (error) {
        console.error('Error updating admin:', error);
        return { message: 'Failed to update admin.', success: false };
    }

    return { message: 'Admin updated successfully.', success: true };
}

