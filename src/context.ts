// Contexto de request por AsyncLocalStorage: expone un request_id que viaja
// implícito durante todo el request y que KeeperLogger agrega a cada log.
// La correlación principal entre servicios es el trace context W3C (lo
// propaga la auto-instrumentación HTTP); x-request-id se mantiene como
// correlación legible y compatible con proxies/gateways.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface KeeperRequestStore {
  requestId: string;
}

const storage = new AsyncLocalStorage<KeeperRequestStore>();

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Middleware Express/NestJS: reutiliza el header `x-request-id` entrante o
 * genera uno (UUID v4), lo devuelve en la respuesta y lo deja disponible vía
 * getRequestId() para los logs. Registrar con `app.use(keeperRequestContext())`.
 */
export function keeperRequestContext() {
  return (
    req: { headers?: Record<string, string | string[] | undefined> },
    res: { setHeader?: (name: string, value: string) => void },
    next: () => void,
  ): void => {
    const incoming = req.headers?.['x-request-id'];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader?.('x-request-id', requestId);
    storage.run({ requestId }, next);
  };
}
