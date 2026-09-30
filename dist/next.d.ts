import { SpanKind, type Attributes, type Context, type Link, type Span as ApiSpan } from '@opentelemetry/api';
import { type LogRecordExporter } from '@opentelemetry/sdk-logs';
import { type ReadableSpan, type Sampler, type SamplingResult, type Span, type SpanExporter, type SpanProcessor } from '@opentelemetry/sdk-trace-base';
import { type KeeperContrato } from './contrato';
import { type KeeperOptions } from './core';
import type { KeeperLogger } from './logger';
export { KeeperLogger } from './logger';
export type { KeeperLoggerOptions, KeeperLogLevel } from './logger';
export { reiniciarViolaciones, violaciones } from './contrato';
export type { ClasificacionDeClave, KeeperContrato, ModoDeContrato, SenalDeContrato, Violacion, } from './contrato';
export { hashID, isHashed } from './hash';
export { redactAttributes } from './redact';
/** Estáticos de Next: cada página pide decenas y ninguno explica nada. */
export declare const DEFAULT_IGNORE_PREFIXES: string[];
export interface KeeperNextOptions extends KeeperOptions {
    /** Contrato de telemetría: lista blanca de claves de atributo. Sin él, sale todo. */
    contrato?: KeeperContrato;
    /** Prefijos de ruta entrante que no generan telemetría. Por defecto, los estáticos de Next. */
    ignoreIncomingPrefixes?: string[];
    /**
     * Vaciar la telemetría y terminar el proceso al recibir SIGTERM o SIGINT. Next termina el
     * proceso por su cuenta en cuanto llega la señal; para que alcance a vaciarse hay que
     * arrancarlo con NEXT_MANUAL_SIG_HANDLE=true y activar esta opción.
     */
    handleSignals?: boolean;
    /** Exportador de spans alterno (pruebas). */
    spanExporter?: SpanExporter;
    /** Exportador de logs alterno (pruebas). */
    logExporter?: LogRecordExporter;
}
export interface KeeperNextHandle {
    forceFlush(): Promise<void>;
    shutdown(): Promise<void>;
}
/**
 * Muestreo que descarta el ruido antes de que exista: una petición entrante a un estático o a
 * un health check no abre traza, y todo lo que cuelga de ella tampoco.
 */
export declare class MuestreoSinRuido implements Sampler {
    private readonly base;
    private readonly rutasIgnoradas;
    private readonly prefijosIgnorados;
    constructor(base: Sampler, rutasIgnoradas: string[], prefijosIgnorados: string[]);
    shouldSample(ctx: Context, traceId: string, name: string, kind: SpanKind, attributes: Attributes, links: Link[]): SamplingResult;
    toString(): string;
    private ignorada;
}
/**
 * Recuerda el span raíz de cada petición en curso, para que el código de la app pueda anotar
 * el evento de la petición aunque en ese momento el span activo sea uno interno de Next.
 */
export declare class RaizDePeticion implements SpanProcessor {
    private readonly raices;
    onStart(span: Span, parentContext: Context): void;
    onEnd(span: ReadableSpan): void;
    /** Span raíz de la petición a la que pertenece el span activo. */
    activa(): ApiSpan | undefined;
    shutdown(): Promise<void>;
    forceFlush(): Promise<void>;
}
/**
 * Anota el evento ancho de la petición en curso: los atributos van al span raíz (el que Next
 * abre por cada petición entrante), censurados como cualquier otro. Fuera de una petición no
 * hace nada.
 */
export declare function annotateRequest(attributes: Record<string, unknown>, extraRedactKeys?: string[]): void;
/**
 * registerKeeper inicializa la observabilidad de una app Next.js. Se llama una vez, desde
 * `register()` de `instrumentation.ts`, solo en el runtime de Node. Sin endpoint
 * (OTEL_EXPORTER_OTLP_ENDPOINT) no exporta nada, pero propaga el contexto y aplica el contrato.
 */
export declare function registerKeeper(options?: KeeperNextOptions): KeeperNextHandle;
/** Lo que el middleware necesita de cada llamada; es la forma que entrega openapi-fetch. */
export interface LlamadaSaliente {
    request: Request;
    /** Ruta del contrato OpenAPI, con sus llaves: `/clients/{clientId}`. */
    schemaPath?: string;
    /** Identificador de la llamada, el mismo en la petición y en su respuesta. */
    id?: string;
}
export interface KeeperFetchMiddlewareOptions {
    /** Logger con el que se deja constancia de las fallas (errores de red y respuestas 5xx). */
    logger?: KeeperLogger;
}
export interface KeeperFetchMiddleware {
    onRequest(call: LlamadaSaliente): Request;
    onResponse(call: LlamadaSaliente & {
        response: Response;
    }): undefined;
    onError(call: LlamadaSaliente & {
        error: unknown;
    }): undefined;
}
/**
 * Middleware para openapi-fetch (o cualquier cliente con la misma forma): un span de cliente
 * por llamada saliente, nombrado con la ruta del contrato y nunca con la URL, y el contexto de
 * traza propagado en `traceparent` para que el servicio llamado continúe la misma traza.
 */
export declare function keeperFetchMiddleware(options?: KeeperFetchMiddlewareOptions): KeeperFetchMiddleware;
