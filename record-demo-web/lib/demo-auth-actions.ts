'use server';

/**
 * Minimal in-memory admins for the Admin Control / Brooklyn Admins tabs (no DB).
 */
import { randomUUID } from 'crypto';

export async function logout() {
  /* no-op */
}

type DemoAdmin = {
  id: string;
  username: string;
  created_at: string;
  name?: string;
  role: 'admin' | 'brooklyn_admin';
};

let demoAdmins: DemoAdmin[] = [
  {
    id: 'demo-admin-primary',
    username: 'operations.admin',
    created_at: new Date().toISOString(),
    name: 'Operations Admin',
    role: 'admin',
  },
  {
    id: 'demo-admin-coordinator',
    username: 'coordinator.demo',
    created_at: new Date().toISOString(),
    name: 'Program Coordinator',
    role: 'admin',
  },
  {
    id: 'demo-admin-brooklyn',
    username: 'brooklyn.ops',
    created_at: new Date().toISOString(),
    name: 'Brooklyn Console',
    role: 'brooklyn_admin',
  },
];

export async function getAdmins() {
  return demoAdmins.filter((a) => a.role !== 'brooklyn_admin').map(({ role: _role, ...rest }) => rest);
}

export async function getBrooklynAdmins() {
  return demoAdmins.filter((a) => a.role === 'brooklyn_admin').map(({ role: _role, ...rest }) => rest);
}

export async function addAdmin(prevState: unknown, formData: FormData) {
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');
  const name = String(formData.get('name') || '').trim() || 'Admin';
  const roleRaw = String(formData.get('role') || '').trim();
  const role: DemoAdmin['role'] = roleRaw === 'brooklyn_admin' ? 'brooklyn_admin' : 'admin';

  if (!username || !password) {
    return { message: 'Username and password are required.' };
  }

  if (demoAdmins.some((a) => a.username === username)) {
    return { message: 'Username already exists.' };
  }

  demoAdmins.push({
    id: randomUUID(),
    username,
    created_at: new Date().toISOString(),
    name,
    role,
  });

  return { message: 'Admin added successfully.', success: true };
}

export async function deleteAdmin(id: string) {
  demoAdmins = demoAdmins.filter((a) => a.id !== id);
}

export async function updateAdmin(prevState: unknown, formData: FormData) {
  const id = String(formData.get('id') || '');
  const name = String(formData.get('name') || '').trim();
  const password = String(formData.get('password') || '').trim();

  if (!id) {
    return { message: 'Admin ID is missing.', success: false };
  }

  const idx = demoAdmins.findIndex((a) => a.id === id);
  if (idx < 0) {
    return { message: 'Admin not found.', success: false };
  }

  if (name) {
    demoAdmins[idx] = { ...demoAdmins[idx], name };
  }

  if (password) {
    void password;
  }

  if (!name && !password) {
    return { message: 'No changes made.', success: true };
  }

  return { message: 'Admin updated successfully.', success: true };
}
