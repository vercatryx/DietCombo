'use server';

import { createSession, deleteSession, verifySession } from './session';
import { hashPassword, verifyPassword } from './password';
import { redirect } from 'next/navigation';
import { query, queryOne, insert, execute, generateUUID } from './mysql';

import { getSettings } from './actions';
import { sendEmail } from './email';

function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendOtp(email: string) {
    if (!email) return { success: false, message: 'Email is required.' };

    try {
        const { exists, type } = await checkEmailIdentity(email);
        if (!exists) {
            return { success: false, message: 'No account found with that email.' };
        }

        // Generate Code
        const code = generateOtp();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

        // Store in DB (delete old codes first)
        // Normalize email for storage to ensure consistent matching
        const normalizedEmail = normalizeEmail(email);

        // Delete old codes
        await execute('DELETE FROM passwordless_codes WHERE email = ?', [normalizedEmail]);
        
        // Insert new code
        const codeId = generateUUID();
        await insert(
            'INSERT INTO passwordless_codes (id, email, code, expires_at) VALUES (?, ?, ?, ?)',
            [codeId, normalizedEmail, code, expiresAt]
        );

        // Send Email (using same pattern as nutritionist screening form)
        // Use original email for sending (not normalized)
        const emailResult = await sendEmail({
            to: email,
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
            `
        });

        if (!emailResult.success) {
            console.error('Error sending passwordless login email:', emailResult.error);
            return { success: false, message: emailResult.error || 'Failed to send email.' };
        }

        return { success: true, message: 'Code sent to your email.' };

    } catch (error) {
        console.error('Send OTP Error:', error);
        return { success: false, message: 'An unexpected error occurred.' };
    }
}

export async function verifyOtp(email: string, code: string) {
    if (!email || !code) return { success: false, message: 'Email and code are required.' };

    try {
        // Normalize email for lookup (consistent with sendOtp)
        const normalizedEmail = normalizeEmail(email);

        const record = await queryOne<any>(
            'SELECT * FROM passwordless_codes WHERE email = ? AND code = ?',
            [normalizedEmail, code]
        );

        if (!record) {
            return { success: false, message: 'Invalid code.' };
        }

        if (new Date(record.expires_at) < new Date()) {
            return { success: false, message: 'Code has expired.' };
        }

        // Code valid! Delete it.
        await execute('DELETE FROM passwordless_codes WHERE id = ?', [record.id]);

        // Perform Login (Create Session)
        const { exists, type, id } = await checkEmailIdentity(email);

        if (!exists) {
            return { success: false, message: 'User not found.' };
        }

        if (type === 'admin') {
            if (!id && process.env.ADMIN_USERNAME === email) {
                await createSession('super-admin', 'Admin', 'super-admin');
                redirect('/');
            } else if (id) {
                const admin = await queryOne<any>('SELECT name FROM admins WHERE id = ?', [id]);
                await createSession(id, admin?.name || 'Admin', 'admin');
                redirect('/');
            }
        } else if (type === 'vendor' && id) {
            const vendor = await queryOne<any>('SELECT name FROM vendors WHERE id = ?', [id]);
            await createSession(id, vendor?.name || 'Vendor', 'vendor');
            redirect('/vendor');
        } else if (type === 'navigator' && id) {
            const nav = await queryOne<any>('SELECT name FROM navigators WHERE id = ?', [id]);
            await createSession(id, nav?.name || 'Navigator', 'navigator');
            redirect('/clients');
        } else if (type === 'client' && id) {
            redirect(`/client-portal/${id}`);
        }

        return { success: false, message: 'Could not resolve user session.' };

    } catch (error) {
        if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
            throw error;
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
        const admin = await queryOne<any>('SELECT * FROM admins WHERE username = ?', [loginInput]);

        if (admin) {
            const isMatch = await verifyPassword(password, admin.password);
            if (!isMatch) {
                return { message: 'Invalid credentials.' };
            }
            await createSession(admin.id, admin.name || 'Admin', 'admin');
            redirect('/');
        }

        // 3. Check Vendors (by Email) - normalize email for matching (ignore spaces and case)
        const normalizedEmail = normalizeEmail(loginInput);
        const vendors = await query<any>('SELECT * FROM vendors WHERE email IS NOT NULL');

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
        const navigators = await query<any>('SELECT * FROM navigators WHERE email IS NOT NULL');

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

// Helper to check identity AND return global passwordless setting
export async function checkEmailIdentity(identifier: string) {
    if (!identifier) return { exists: false, type: null, enablePasswordless: false };

    // Check global settings
    const settings = await getSettings();
    const enablePasswordless = settings.enablePasswordlessLogin || false;

    // Normalize input: remove all spaces and convert to lowercase
    const normalizedInput = normalizeEmail(identifier);
    const trimmedInput = identifier.trim().toLowerCase();

    // Collect all matches to determine if there are multiple accounts
    // Priority order: admin > vendor > navigator > client
    const matches: Array<{ type: 'admin' | 'vendor' | 'navigator' | 'client', id?: string, isActive?: boolean }> = [];

    // 1. Check Env Super Admin (match by username)
    const envUser = process.env.ADMIN_USERNAME;
    const originalTrimmed = identifier.trim();
    if (envUser && originalTrimmed === envUser) {
        matches.push({ type: 'admin' });
    }

    // 2. Check Database Admins (by username - case sensitive)
    const admins = await query<any>('SELECT id FROM admins WHERE username = ?', [originalTrimmed]);
    
    if (admins && admins.length > 0) {
        matches.push(...admins.map(a => ({ type: 'admin' as const, id: a.id })));
    }

    // 3. Check Vendors (by Email) - fetch all and normalize for comparison
    // This ensures we match emails regardless of spaces or case
    const vendorsData = await query<any>('SELECT id, email, is_active FROM vendors WHERE email IS NOT NULL');
    
    if (vendorsData && vendorsData.length > 0) {
        // Normalize both input and database emails (remove all spaces, lowercase)
        const exactMatches = vendorsData.filter(v => 
            v.email && normalizeEmail(v.email) === normalizedInput
        );
        if (exactMatches.length > 0) {
            matches.push(...exactMatches.map(v => ({ 
                type: 'vendor' as const, 
                id: v.id, 
                isActive: v.is_active 
            })));
        }
    }

    // 4. Check Navigators (by Email)
    const navigatorsData = await query<any>('SELECT id, email FROM navigators WHERE email IS NOT NULL');
    
    if (navigatorsData && navigatorsData.length > 0) {
        const exactMatches = navigatorsData.filter(n => 
            n.email && normalizeEmail(n.email) === normalizedInput
        );
        if (exactMatches.length > 0) {
            matches.push(...exactMatches.map(n => ({ 
                type: 'navigator' as const, 
                id: n.id 
            })));
        }
    }

    // 5. Check Clients (by Email)
    const clientsData = await query<any>('SELECT id, email FROM clients WHERE email IS NOT NULL');
    
    if (clientsData && clientsData.length > 0) {
        const exactMatches = clientsData.filter(c => 
            c.email && normalizeEmail(c.email) === normalizedInput
        );
        if (exactMatches.length > 0) {
            matches.push(...exactMatches.map(c => ({ 
                type: 'client' as const, 
                id: c.id 
            })));
        }
    }

    // If no matches found
    if (matches.length === 0) {
        return { exists: false, type: null };
    }

    // If multiple accounts found, prefer admin account
    if (matches.length > 1) {
        const adminMatch = matches.find(m => m.type === 'admin');
        if (adminMatch) {
            // Prefer admin account when multiple accounts exist
            return { 
                exists: true, 
                type: 'admin', 
                id: adminMatch.id,
                enablePasswordless: false 
            };
        }
        // If no admin but multiple accounts, return error
        return { exists: false, type: null, enablePasswordless: false, multipleAccounts: true };
    }

    // Single match found
    const match = matches[0];
    
    if (match.type === 'admin') {
        return { 
            exists: true, 
            type: 'admin', 
            id: match.id,
            enablePasswordless: false 
        };
    } else if (match.type === 'vendor') {
        return { 
            exists: true, 
            type: 'vendor', 
            id: match.id,
            enablePasswordless: false 
        };
    } else if (match.type === 'navigator') {
        return { 
            exists: true, 
            type: 'navigator', 
            id: match.id,
            enablePasswordless: false 
        };
    } else if (match.type === 'client') {
        return { 
            exists: true, 
            type: 'client', 
            id: match.id, 
            enablePasswordless 
        };
    }

    return { exists: false, type: null };
}



// --- Admin Management Actions ---

export async function getAdmins() {
    await verifySession();
    try {
        const data = await query<any>('SELECT id, username, created_at, name FROM admins ORDER BY created_at ASC');
        return data;
    } catch (error) {
        console.error('Error fetching admins:', error);
        return [];
    }
}

export async function addAdmin(prevState: any, formData: FormData) {
    await verifySession();
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const name = (formData.get('name') as string) || 'Admin';

    if (!username || !password) {
        return { message: 'Username and password are required.' };
    }

    // Check availability
    const existing = await queryOne<any>('SELECT id FROM admins WHERE username = ?', [username]);
    if (existing) {
        return { message: 'Username already exists.' };
    }

    const hashedPassword = await hashPassword(password);
    const id = generateUUID();

    try {
        await insert(
            'INSERT INTO admins (id, username, password, name) VALUES (?, ?, ?, ?)',
            [id, username, hashedPassword, name]
        );
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
        await execute('DELETE FROM admins WHERE id = ?', [id]);
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

    const updates: string[] = [];
    const params: any[] = [];
    
    if (name) {
        updates.push('name = ?');
        params.push(name);
    }
    if (password) {
        updates.push('password = ?');
        params.push(await hashPassword(password));
    }

    if (updates.length === 0) {
        return { message: 'No changes made.', success: true };
    }

    params.push(id);
    
    try {
        await execute(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`, params);
    } catch (error) {
        console.error('Error updating admin:', error);
        return { message: 'Failed to update admin.', success: false };
    }

    return { message: 'Admin updated successfully.', success: true };
}

