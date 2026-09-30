import { type Client } from './client';
export declare function getRequestId(): string | undefined;
/** Origen del request (IP + UA parseado) si el middleware lo capturó. */
export declare function getClient(): Client | undefined;
export interface KeeperRequestLike {
    headers?: Record<string, string | string[] | undefined>;
    /** Express/Nest suelen exponer la IP aquí. */
    ip?: string;
    socket?: {
        remoteAddress?: string;
    };
}
/**
 * Middleware Express/NestJS: reutiliza el header `x-request-id` entrante o
 * genera uno (UUID v4), captura origen del cliente (client.*) y lo deja
 * disponible vía getRequestId()/getClient(). Registrar con
 * `app.use(keeperRequestContext())`.
 */
export declare function keeperRequestContext(): (req: KeeperRequestLike, res: {
    setHeader?: (name: string, value: string) => void;
}, next: () => void) => void;
