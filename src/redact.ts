// Redacción de datos sensibles en atributos de log (OWASP: nunca exponer
// secretos ni credenciales en telemetría). La comparación es por subcadena
// del nombre de la clave, en minúsculas: mejor redactar de más que filtrar
// un secreto.
export const DEFAULT_REDACT_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'api_key',
  'apikey',
  'credential',
  'private_key',
];

export const REDACTED_VALUE = '[REDACTADO]';

export function redactAttributes<T extends Record<string, unknown>>(
  attributes: T,
  extraKeys: string[] = [],
): Record<string, unknown> {
  const needles = [...DEFAULT_REDACT_KEYS, ...extraKeys].map((k) => k.toLowerCase());
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    const lower = key.toLowerCase();
    out[key] = needles.some((n) => lower.includes(n)) ? REDACTED_VALUE : value;
  }
  return out;
}
