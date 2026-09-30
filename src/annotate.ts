// Evento ancho canónico (§3.1/§4.1): el código de negocio anota atributos sobre el span
// activo del request para que el evento lleve su contexto (ids, resultados) y sea
// consultable, en vez de quedar disperso en logs sueltos. Los atributos se redactan
// (recursivo) antes de tocar el span, porque el span no pasa por el handler de logs.
import { trace, type Span, type AttributeValue } from '@opentelemetry/api';
import { redactAttributes } from './redact';
import { safeUTF8 } from './sanitize';

/** Aplana un valor a un tipo aceptado como atributo de span OTel. */
function coerce(value: unknown): AttributeValue {
  if (typeof value === 'string') {
    return safeUTF8(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Aplica atributos de negocio (redactados y aplanados) a un span concreto.
 * Expuesta aparte de `annotateRequest` para poder validarla con unit tests sin
 * depender del span activo del contexto.
 */
export function annotateSpan(
  span: Span,
  attributes: Record<string, unknown>,
  extraRedactKeys: string[] = [],
): void {
  const redacted = redactAttributes(attributes, extraRedactKeys);
  for (const [key, value] of Object.entries(redacted)) {
    span.setAttribute(key, coerce(value));
  }
}

/**
 * Enriquecer el span activo del request (evento ancho canónico) con contexto de negocio.
 * No-op seguro si no hay span activo (fuera de un request instrumentado).
 */
export function annotateRequest(
  attributes: Record<string, unknown>,
  extraRedactKeys: string[] = [],
): void {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }
  annotateSpan(span, attributes, extraRedactKeys);
}

/** Anota `enduser.id` en el span activo (§3.2/§4.1). */
export function annotateUser(userId: string): void {
  if (!userId) {
    return;
  }
  annotateRequest({ 'enduser.id': userId });
}

/** Anota `tenant.id` en el span activo (§3.2). */
export function annotateTenant(tenantId: string): void {
  if (!tenantId) {
    return;
  }
  annotateRequest({ 'tenant.id': tenantId });
}

/**
 * Registra éxito/fallo de negocio (no solo HTTP) en el span activo (§3.2).
 * Un 200 con business.success=false es un evento malo para SLIs.
 */
export function annotateOutcome(
  success: boolean,
  errKind = '',
  errMsg = '',
): void {
  const attrs: Record<string, unknown> = { 'business.success': success };
  if (errKind) {
    attrs['error.kind'] = errKind;
  }
  if (errMsg) {
    attrs['error.message'] = errMsg;
  }
  annotateRequest(attrs);
}
