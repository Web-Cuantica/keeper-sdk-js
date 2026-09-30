// Saneo de strings de origen no confiable (rutas, User-Agent) antes de emitirlos
// como atributos OTel. Paridad con SafeUTF8 de keeper-sdk-go: evita que un valor
// malformado tumbe el lote de export.
//
// En Node los strings son UTF-16; aquí eliminamos surrogates huérfanos (pares
// incompletos) que suelen aparecer al decodificar bytes inválidos.

/**
 * Devuelve `s` sin surrogates UTF-16 huérfanos. Idempotente sobre texto válido.
 */
export function safeUTF8(s: string): string {
  if (!s) {
    return s;
  }
  // High surrogate sin low, o low sin high.
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}
