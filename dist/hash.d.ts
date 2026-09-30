export declare const HASH_PREFIX = "h1:";
/** Identificadores hasheables (nunca password/token/…). Paridad con Go. */
export declare const DEFAULT_HASH_KEYS: string[];
/** Configura pepper y (opcional) claves hasheables. Lo llama startKeeper. */
export declare function setHashConfig(pepper: string, keys?: string[]): void;
export declare function getHashPepper(): string;
export declare function getHashKeys(): string[];
/** trim + minúsculas: misma identidad ⇒ mismo digest entre servicios. */
export declare function normalizeID(value: string): string;
/**
 * HMAC-SHA256 one-way. Devuelve `h1:<hex>` o `''` si no hay pepper/valor.
 * Puro y testeable pasando pepper explícito.
 */
export declare function hashIDWithPepper(pepper: string, value: string): string;
/** Usa el pepper global (tras startKeeper / setHashConfig). */
export declare function hashID(value: string): string;
export declare function isHashed(s: string): boolean;
export declare function keyMatchesHash(key: string, hashKeys?: string[]): boolean;
