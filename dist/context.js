"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequestId = getRequestId;
exports.getClient = getClient;
exports.keeperRequestContext = keeperRequestContext;
// Contexto de request por AsyncLocalStorage: expone request_id y origen del
// cliente (client.*) que viajan implícitos durante todo el request.
// La correlación principal entre servicios es el trace context W3C (lo
// propaga la auto-instrumentación HTTP); x-request-id se mantiene como
// correlación legible y compatible con proxies/gateways.
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const client_1 = require("./client");
const storage = new node_async_hooks_1.AsyncLocalStorage();
function getRequestId() {
    return storage.getStore()?.requestId;
}
/** Origen del request (IP + UA parseado) si el middleware lo capturó. */
function getClient() {
    return storage.getStore()?.client;
}
function headerValue(headers, name) {
    const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
    if (Array.isArray(raw)) {
        return raw[0] ?? '';
    }
    return raw ?? '';
}
function resolveClientIp(req) {
    const xff = headerValue(req.headers, 'x-forwarded-for');
    if (xff) {
        return xff.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || '';
}
/**
 * Middleware Express/NestJS: reutiliza el header `x-request-id` entrante o
 * genera uno (UUID v4), captura origen del cliente (client.*) y lo deja
 * disponible vía getRequestId()/getClient(). Registrar con
 * `app.use(keeperRequestContext())`.
 */
function keeperRequestContext() {
    return (req, res, next) => {
        const incoming = headerValue(req.headers, 'x-request-id');
        const requestId = incoming || (0, node_crypto_1.randomUUID)();
        res.setHeader?.('x-request-id', requestId);
        const ua = headerValue(req.headers, 'user-agent');
        const client = (0, client_1.parseClient)(resolveClientIp(req), ua);
        storage.run({ requestId, client }, next);
    };
}
