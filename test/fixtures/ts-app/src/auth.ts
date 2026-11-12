import hash from './hash';
import { findUser, saveUser, type User } from './db';
import * as crypto from 'node:crypto';

export interface Claims {
  sub: string;
  exp: number;
}

/**
 * Checks a password against the stored hash.
 * Returns false for unknown users.
 */
export async function authenticateUser(id: string, password: string): Promise<boolean> {
  // Compares in constant time.
  function verify(expected: string, actual: string): boolean {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  }

  const user = findUser(id);
  if (!user) return false;
  return verify(user.passwordHash, hash(password));
}

export function parseToken(token: string): Claims;
export function parseToken(token: string, strict: boolean): Claims | null;
export function parseToken(token: string, strict = true): Claims | null {
  const [sub, exp] = token.split('.');
  if (!sub || !exp) {
    if (strict) throw new Error('malformed token');
    return null;
  }
  return { sub, exp: Number(exp) };
}

export const resetPassword = async (user: User, next: string): Promise<void> => {
  user.passwordHash = hash(next);
  saveUser(user);
};
