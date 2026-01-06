
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const secretKey = process.env.JWT_SECRET || 'default-secret-change-me';
const key = new TextEncoder().encode(secretKey);

export async function encrypt(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h') // Session duration
        .sign(key);
}

export async function decrypt(input: string): Promise<any> {
    try {
        const { payload } = await jwtVerify(input, key, {
            algorithms: ['HS256'],
        });
        return payload;
    } catch (error) {
        return null;
    }
}

export async function getSession() {
    const cookieStore = await cookies();
    const session = cookieStore.get('session')?.value;
    if (!session) return null;
    return await decrypt(session);
}

export async function createSession(userId: string, name: string = 'Admin', role: string = 'admin') {
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    const session = await encrypt({ userId, name, role, expires });
    const cookieStore = await cookies();

    // Use secure cookies only in production (HTTPS), allow HTTP in development
    const isProduction = process.env.NODE_ENV === 'production';
    
    cookieStore.set('session', session, {
        httpOnly: true,
        secure: isProduction,
        expires: expires,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/',
    });
}

export async function deleteSession() {
    const cookieStore = await cookies();
    const isProduction = process.env.NODE_ENV === 'production';
    
    cookieStore.set('session', '', {
        httpOnly: true,
        secure: isProduction,
        expires: new Date(0),
        sameSite: isProduction ? 'none' : 'lax',
        path: '/',
    });
}

export async function verifySession() {
    const cookieStore = await cookies();
    const cookie = cookieStore.get('session')?.value;
    const session = await decrypt(cookie || '');

    if (!session?.userId) {
        redirect('/login');
    }

    return { isAuth: true, userId: session.userId, name: session.name, role: session.role };
}
