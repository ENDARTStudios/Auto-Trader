// src/lib/auth/password.ts — Password hashing (bcryptjs cost 12)
import * as bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Sync variants for seed scripts
export function hashPasswordSync(plain: string): string {
  return bcrypt.hashSync(plain, ROUNDS);
}

export function verifyPasswordSync(hash: string, plain: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
