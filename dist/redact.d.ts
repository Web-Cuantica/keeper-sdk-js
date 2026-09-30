export declare const DEFAULT_REDACT_KEYS: string[];
export declare const REDACTED_VALUE = "[REDACTADO]";
export interface RedactOptions {
    /** Pepper HMAC; default = global de setHashConfig / startKeeper. */
    pepper?: string;
    /** Claves hasheables; default = globales. */
    hashKeys?: string[];
}
/**
 * Devuelve una copia de `attributes` con valores sensibles censurados o hasheados,
 * de forma recursiva. `extraKeys` añade claves a `DEFAULT_REDACT_KEYS`.
 */
export declare function redactAttributes<T extends Record<string, unknown>>(attributes: T, extraKeys?: string[], options?: RedactOptions): Record<string, unknown>;
