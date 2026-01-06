
import { hash, compare } from 'bcryptjs';

export async function hashPassword(password: string) {
    return await hash(password, 10);
}

export async function verifyPassword(plain: string, hashed: string) {
    return await compare(plain, hashed);
}
