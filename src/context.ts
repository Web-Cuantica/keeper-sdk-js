// Contexto de request por AsyncLocalStorage: expone request_id y origen del
// cliente (client.*) que viajan implícitos durante todo el request.
// La correlación principal entre servicios es el trace context W3C (lo
// propaga la auto-instrumentación HTTP); x-request-id se mantiene como
// correlación legible y compatible con proxies/gateways.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { parseClient, type Client } from './client';

interface KeeperRequestStore {
  requestId: string;
  client?: Client;
}

const storage = new AsyncLocalStorage<KeeperRequestStore>();

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Origen del request (IP + UA parseado) si el middleware lo capturó. */
export function getClient(): Client | undefined {
  return storage.getStore()?.client;
}

export interface KeeperRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  /** Express/Nest suelen exponer la IP aquí. */
  ip?: string;
  socket?: { remoteAddress?: string };
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string {
  const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) {
    return raw[0] ?? '';
  }
  return raw ?? '';
}

function resolveClientIp(req: KeeperRequestLike): string {
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
export function keeperRequestContext() {
  return (
    req: KeeperRequestLike,
    res: { setHeader?: (name: string, value: string) => void },
    next: () => void,
  ): void => {
    const incoming = headerValue(req.headers, 'x-request-id');
    const requestId = incoming || randomUUID();
    res.setHeader?.('x-request-id', requestId);
    const ua = headerValue(req.headers, 'user-agent');
    const client = parseClient(resolveClientIp(req), ua);
    storage.run({ requestId, client }, next);
  };
}
