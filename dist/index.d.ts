import { type KeeperContrato } from './contrato';
import { type KeeperOptions as KeeperBaseOptions } from './core';
export { KeeperLogger } from './logger';
export type { KeeperLoggerOptions, KeeperLogLevel } from './logger';
export { keeperRequestContext, getRequestId, getClient } from './context';
export type { KeeperRequestLike } from './context';
export { DEFAULT_REDACT_KEYS, redactAttributes } from './redact';
export type { RedactOptions } from './redact';
export { annotateRequest, annotateSpan, annotateUser, annotateTenant, annotateOutcome, } from './annotate';
export { parseClient, clientAttributes } from './client';
export type { Client } from './client';
export { safeUTF8 } from './sanitize';
export { DEFAULT_HASH_KEYS, HASH_PREFIX, hashID, hashIDWithPepper, isHashed, normalizeID, setHashConfig, } from './hash';
export { buildResourceAttributes, buildSampler, formatOtelDiagError, KeeperDiagLogger, resolveSampleRatio, sampleRateForRatio, SampleRateSpanProcessor, } from './core';
export { reiniciarViolaciones, violaciones } from './contrato';
export type { ClasificacionDeClave, KeeperContrato, ModoDeContrato, SenalDeContrato, Violacion, } from './contrato';
export interface KeeperOptions extends KeeperBaseOptions {
    /** Contrato de telemetría: lista blanca de claves de atributo. Sin él, sale todo. */
    contrato?: KeeperContrato;
}
/**
 * startKeeper inicializa la observabilidad. Llamar **al inicio del proceso**,
 * antes de levantar la app (idealmente como primer import de main.ts).
 */
export declare function startKeeper(options?: KeeperOptions): void;
