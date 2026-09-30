export type KeeperLogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';
export interface KeeperLoggerOptions {
    /** Nivel mínimo emitido; acepta 'info' como alias de 'log'.
     *  Default: KEEPER_LOG_LEVEL o 'log'. */
    level?: KeeperLogLevel | 'info';
    /** Espejo a stdout/stderr (default true). */
    stdout?: boolean;
    /** Claves adicionales a redactar además de DEFAULT_REDACT_KEYS. */
    redactKeys?: string[];
}
export declare class KeeperLogger {
    private readonly minLevel;
    private readonly stdout;
    private readonly redactKeys;
    constructor(options?: KeeperLoggerOptions);
    log(message: unknown, ...params: unknown[]): void;
    error(message: unknown, ...params: unknown[]): void;
    warn(message: unknown, ...params: unknown[]): void;
    debug(message: unknown, ...params: unknown[]): void;
    verbose(message: unknown, ...params: unknown[]): void;
    fatal(message: unknown, ...params: unknown[]): void;
    private emit;
    /**
     * Interpreta los parámetros con las convenciones de NestJS: el último string
     * es el contexto (nombre del logger), un string con pinta de stack trace es
     * el stack de error(), un Error aporta exception.* y los objetos planos se
     * vuelven atributos filtrables.
     */
    private parse;
    private coerce;
    private print;
}
