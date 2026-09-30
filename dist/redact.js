"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REDACTED_VALUE = exports.DEFAULT_REDACT_KEYS = void 0;
exports.redactAttributes = redactAttributes;
// Redacción de datos sensibles en atributos de log (OBSERVABILITY-ENGINEERING.md §3.4,
// OWASP: nunca exponer secretos, credenciales ni PII en telemetría). La comparación es
// por subcadena del nombre de la clave, en minúsculas: mejor redactar de más que filtrar
// un secreto. La redacción es **recursiva** sobre objetos y arreglos planos.
//
// Con pepper (KEEPER_HASH_PEPPER), los identificadores (email/curp/rfc/vin/ssn) se
// reemplazan por hash one-way `h1:<hex>` en lugar de censurar — paridad con keeper-sdk-go.
const hash_1 = require("./hash");
exports.DEFAULT_REDACT_KEYS = [
    // Secretos y credenciales
    'password',
    'passwd',
    'pwd',
    'secret',
    'token',
    'authorization',
    'cookie',
    'api_key',
    'apikey',
    'access_token',
    'refresh_token',
    'credential',
    'private_key',
    // PII (paridad con keeper-sdk-go)
    'email',
    'vin',
    'ssn',
    'curp',
    'rfc',
    'credit_card',
    'card_number',
    'cvv',
];
exports.REDACTED_VALUE = '[REDACTADO]';
/** Profundidad máxima de recursión: cota de seguridad ante estructuras cíclicas o enormes. */
const MAX_DEPTH = 8;
function keyMatches(key, needles) {
    const lower = key.toLowerCase();
    return needles.some((n) => lower.includes(n));
}
/** Solo recursamos en objetos "planos" y arreglos; Date, Error, etc. se dejan intactos. */
function isPlainObject(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}
function censorOrHash(key, value, pepper, hashKeys) {
    // Identificadores hasheables: correlación sin exponer el dato.
    if (pepper && (0, hash_1.keyMatchesHash)(key, hashKeys)) {
        const raw = value === null || value === undefined ? '' : String(value);
        const hashed = (0, hash_1.hashIDWithPepper)(pepper, raw);
        if (hashed) {
            return hashed;
        }
    }
    return exports.REDACTED_VALUE;
}
function redactValue(value, needles, pepper, hashKeys, depth) {
    if (depth >= MAX_DEPTH) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, needles, pepper, hashKeys, depth + 1));
    }
    if (isPlainObject(value)) {
        return redactObject(value, needles, pepper, hashKeys, depth + 1);
    }
    return value;
}
function redactObject(obj, needles, pepper, hashKeys, depth) {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
        if (keyMatches(key, needles)) {
            // Clave sensible: hashea el valor escalar o censura el subárbol completo.
            if (isPlainObject(value) || Array.isArray(value)) {
                // Si la clave misma es hasheable y el valor es objeto, censuramos el subárbol
                // (no tiene sentido hashear un objeto entero como string opaco útil).
                out[key] = exports.REDACTED_VALUE;
            }
            else {
                out[key] = censorOrHash(key, value, pepper, hashKeys);
            }
        }
        else {
            out[key] = redactValue(value, needles, pepper, hashKeys, depth);
        }
    }
    return out;
}
/**
 * Devuelve una copia de `attributes` con valores sensibles censurados o hasheados,
 * de forma recursiva. `extraKeys` añade claves a `DEFAULT_REDACT_KEYS`.
 */
function redactAttributes(attributes, extraKeys = [], options = {}) {
    const needles = [...exports.DEFAULT_REDACT_KEYS, ...extraKeys].map((k) => k.toLowerCase());
    const pepper = options.pepper ?? (0, hash_1.getHashPepper)();
    const hashKeys = options.hashKeys ?? (0, hash_1.getHashKeys)();
    return redactObject(attributes, needles, pepper, hashKeys, 0);
}
