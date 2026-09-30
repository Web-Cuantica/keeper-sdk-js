import { type Span } from '@opentelemetry/api';
/**
 * Aplica atributos de negocio (redactados y aplanados) a un span concreto.
 * Expuesta aparte de `annotateRequest` para poder validarla con unit tests sin
 * depender del span activo del contexto.
 */
export declare function annotateSpan(span: Span, attributes: Record<string, unknown>, extraRedactKeys?: string[]): void;
/**
 * Enriquecer el span activo del request (evento ancho canónico) con contexto de negocio.
 * No-op seguro si no hay span activo (fuera de un request instrumentado).
 */
export declare function annotateRequest(attributes: Record<string, unknown>, extraRedactKeys?: string[]): void;
/** Anota `enduser.id` en el span activo (§3.2/§4.1). */
export declare function annotateUser(userId: string): void;
/** Anota `tenant.id` en el span activo (§3.2). */
export declare function annotateTenant(tenantId: string): void;
/**
 * Registra éxito/fallo de negocio (no solo HTTP) en el span activo (§3.2).
 * Un 200 con business.success=false es un evento malo para SLIs.
 */
export declare function annotateOutcome(success: boolean, errKind?: string, errMsg?: string): void;
