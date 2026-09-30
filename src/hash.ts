// Hash one-way de identificadores sensibles (§3.4 SHOULD / paridad keeper-sdk-go).
// Con pepper (KEEPER_HASH_PEPPER) se correlaciona sin exponer el dato.
// Formato: h1:<hex HMAC-SHA256>. Secretos NUNCA se hashean — solo se censuran.

import { createHmac } from 'node:crypto';

export const HASH_PREFIX = 'h1:';

/** Identificadores hasheables (nunca password/token/…). Paridad con Go. */
export const DEFAULT_HASH_KEYS = ['email', 'curp', 'rfc', 'vin', 'ssn'];

let pepperGlobal = '';
let hashKeysGlobal: string[] = [...DEFAULT_HASH_KEYS];

/** Configura pepper y (opcional) claves hasheables. Lo llama startKeeper. */
export function setHashConfig(pepper: string, keys?: string[]): void {
  pepperGlobal = pepper ?? '';
  if (keys) {
    hashKeysGlobal = keys.map((k) => k.toLowerCase()).filter(Boolean);
  }
}

export function getHashPepper(): string {
  return pepperGlobal;
}

export function getHashKeys(): string[] {
  return hashKeysGlobal;
}

/** trim + minúsculas: misma identidad ⇒ mismo digest entre servicios. */
export function normalizeID(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * HMAC-SHA256 one-way. Devuelve `h1:<hex>` o `''` si no hay pepper/valor.
 * Puro y testeable pasando pepper explícito.
 */
export function hashIDWithPepper(pepper: string, value: string): string {
  if (!pepper || !value) {
    return '';
  }
  const digest = createHmac('sha256', pepper).update(normalizeID(value), 'utf8').digest('hex');
  return `${HASH_PREFIX}${digest}`;
}

/** Usa el pepper global (tras startKeeper / setHashConfig). */
export function hashID(value: string): string {
  return hashIDWithPepper(pepperGlobal, value);
}

export function isHashed(s: string): boolean {
  return s.startsWith(HASH_PREFIX) && s.length > HASH_PREFIX.length;
}

export function keyMatchesHash(key: string, hashKeys: string[] = hashKeysGlobal): boolean {
  const lower = key.toLowerCase();
  return hashKeys.some((n) => lower.includes(n));
}
