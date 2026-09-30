import { Resource } from '@opentelemetry/resources';
import { type Sampler, type SpanProcessor, type Span } from '@opentelemetry/sdk-trace-base';
import { type DiagLogger } from '@opentelemetry/api';
/**
 * Logger de diagnóstico OTel: eleva errores internos del pipeline (export fallido,
 * etc.) a stderr con prefijo claro — paridad con otel.SetErrorHandler de Go (JS-9).
 * Función pura de formato para poder testearla sin acoplar a console.
 */
export declare function formatOtelDiagError(message: string, ...args: unknown[]): string;
/** DiagLogger mínimo: solo ERROR/WARN llegan a stderr; el resto se silencia. */
export declare class KeeperDiagLogger implements DiagLogger {
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    info(..._args: unknown[]): void;
    debug(..._args: unknown[]): void;
    verbose(..._args: unknown[]): void;
}
export interface KeeperOptions {
    /** Nombre del servicio (o variable OTEL_SERVICE_NAME). */
    serviceName?: string;
    /** Versión del servicio. */
    serviceVersion?: string;
    /** Ambiente de despliegue (o variable KEEPER_ENV / NODE_ENV). */
    environment?: string;
    /** Id de build/artefacto (o variable KEEPER_BUILD_ID). */
    buildId?: string;
    /** Hash del commit desplegado (o variable KEEPER_COMMIT_HASH / GIT_COMMIT / COMMIT_SHA). */
    commitHash?: string;
    /** Base OTLP/HTTP de la plataforma Keeper, p. ej. http://keeper-host:4318
     *  (o variable OTEL_EXPORTER_OTLP_ENDPOINT). */
    endpoint?: string;
    /** Rutas HTTP entrantes que NO generan telemetría (comparadas por sufijo
     *  del pathname, para soportar prefijos globales tipo /dyinspectionws). */
    ignoreIncomingPaths?: string[];
    /** Proporción de muestreo de trazas en [0,1] (1 = sin muestreo, 0.1 = 1 de cada 10).
     *  Tiene prioridad sobre OTEL_TRACES_SAMPLER del entorno. El `sample_rate` (1/ratio)
     *  se estampa en cada span para poder reponderar en el análisis (§7). */
    samplingRatio?: number;
    /** Pepper HMAC para hashes one-way de identificadores (§3.4; o KEEPER_HASH_PEPPER).
     *  Debe ser el mismo en todos los servicios. Sin pepper, PII se censura. */
    hashPepper?: string;
    /** Claves hasheables (reemplazan el default email/curp/rfc/vin/ssn). Nunca secretos. */
    hashKeys?: string[];
}
/** Health checks y similares: tráfico de plomería que solo mete ruido/costo. */
export declare const DEFAULT_IGNORE_PATHS: string[];
export declare function firstNonEmpty(...vals: Array<string | undefined>): string | undefined;
/**
 * Construye los atributos del `Resource` OTel a partir de opciones + entorno.
 * Función pura (sin efectos) para poder validarla con unit tests sin arrancar el SDK.
 * Cubre el contexto de deploy del §3.2: servicio, versión, ambiente, host, instancia,
 * build/commit (estos últimos solo si están disponibles).
 */
export declare function buildResourceAttributes(options?: KeeperOptions, env?: NodeJS.ProcessEnv): Record<string, string>;
/** Recurso OTel del proceso, con el contexto de despliegue. */
export declare function buildResource(options?: KeeperOptions): Resource;
/**
 * Decide la proporción de muestreo con precedencia:
 * opción `samplingRatio` > `OTEL_TRACES_SAMPLER`(+`_ARG`) del entorno > 1.0 (sin muestreo).
 * Función pura para poder validarla con unit tests.
 */
export declare function resolveSampleRatio(options?: KeeperOptions, env?: NodeJS.ProcessEnv): number;
/** sample_rate = cuántos eventos representa cada evento conservado (1/ratio). */
export declare function sampleRateForRatio(ratio: number): number;
export declare function buildSampler(ratio: number): Sampler;
/**
 * SpanProcessor que estampa `sample_rate` en cada span al iniciarse, para que el evento
 * lleve dentro cuántos representa (§7.2) y el análisis pueda reponderar.
 */
export declare class SampleRateSpanProcessor implements SpanProcessor {
    private readonly rate;
    constructor(rate: number);
    onStart(span: Span): void;
    onEnd(): void;
    shutdown(): Promise<void>;
    forceFlush(): Promise<void>;
}
