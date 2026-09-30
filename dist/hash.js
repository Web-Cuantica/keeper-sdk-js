"use strict";
// Hash one-way de identificadores sensibles (§3.4 SHOULD / paridad keeper-sdk-go).
// Con pepper (KEEPER_HASH_PEPPER) se correlaciona sin exponer el dato.
// Formato: h1:<hex HMAC-SHA256>. Secretos NUNCA se hashean — solo se censuran.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HASH_KEYS = exports.HASH_PREFIX = void 0;
exports.setHashConfig = setHashConfig;
exports.getHashPepper = getHashPepper;
exports.getHashKeys = getHashKeys;
exports.normalizeID = normalizeID;
exports.hashIDWithPepper = hashIDWithPepper;
exports.hashID = hashID;
exports.isHashed = isHashed;
exports.keyMatchesHash = keyMatchesHash;
const node_crypto_1 = require("node:crypto");
exports.HASH_PREFIX = 'h1:';
/** Identificadores hasheables (nunca password/token/…). Paridad con Go. */
exports.DEFAULT_HASH_KEYS = ['email', 'curp', 'rfc', 'vin', 'ssn'];
let pepperGlobal = '';
let hashKeysGlobal = [...exports.DEFAULT_HASH_KEYS];
/** Configura pepper y (opcional) claves hasheables. Lo llama startKeeper. */
function setHashConfig(pepper, keys) {
    pepperGlobal = pepper ?? '';
    if (keys) {
        hashKeysGlobal = keys.map((k) => k.toLowerCase()).filter(Boolean);
    }
}
function getHashPepper() {
    return pepperGlobal;
}
function getHashKeys() {
    return hashKeysGlobal;
}
/** trim + minúsculas: misma identidad ⇒ mismo digest entre servicios. */
function normalizeID(value) {
    return value.trim().toLowerCase();
}
/**
 * HMAC-SHA256 one-way. Devuelve `h1:<hex>` o `''` si no hay pepper/valor.
 * Puro y testeable pasando pepper explícito.
 */
function hashIDWithPepper(pepper, value) {
    if (!pepper || !value) {
        return '';
    }
    const digest = (0, node_crypto_1.createHmac)('sha256', pepper).update(normalizeID(value), 'utf8').digest('hex');
    return `${exports.HASH_PREFIX}${digest}`;
}
/** Usa el pepper global (tras startKeeper / setHashConfig). */
function hashID(value) {
    return hashIDWithPepper(pepperGlobal, value);
}
function isHashed(s) {
    return s.startsWith(exports.HASH_PREFIX) && s.length > exports.HASH_PREFIX.length;
}
function keyMatchesHash(key, hashKeys = hashKeysGlobal) {
    const lower = key.toLowerCase();
    return hashKeys.some((n) => lower.includes(n));
}
