// Keeper SDK (Node/TypeScript): observabilidad en una línea sobre OpenTelemetry.
// Envoltorio delgado del SDK oficial de OTel (ADR-0011): auto-instrumenta HTTP,
// Express, NestJS, mysql2/pg y loggers, y exporta los 3 pilares —trazas,
// métricas y logs— por OTLP/HTTP a la plataforma Keeper.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SpanProcessor,
  type Span,
} from '@opentelemetry/sdk-trace-base';
import { diag, DiagLogLevel, type DiagLogger } from '@opentelemetry/api';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getRequestId } from './context';
import { DEFAULT_HASH_KEYS, setHashConfig } from './hash';

export { KeeperLogger } from './logger';
export type { KeeperLoggerOptions, KeeperLogLevel } from './logger';
export { keeperRequestContext, getRequestId, getClient } from './context';
export type { KeeperRequestLike } from './context';
export { DEFAULT_REDACT_KEYS, redactAttributes } from './redact';
export type { RedactOptions } from './redact';
export {
  annotateRequest,
  annotateSpan,
  annotateUser,
  annotateTenant,
  annotateOutcome,
} from './annotate';
export { parseClient, clientAttributes } from './client';
export type { Client } from './client';
export { safeUTF8 } from './sanitize';
export {
  DEFAULT_HASH_KEYS,
  HASH_PREFIX,
  hashID,
  hashIDWithPepper,
  isHashed,
  normalizeID,
  setHashConfig,
} from './hash';

/**
 * Logger de diagnóstico OTel: eleva errores internos del pipeline (export fallido,
 * etc.) a stderr con prefijo claro — paridad con otel.SetErrorHandler de Go (JS-9).
 * Función pura de formato para poder testearla sin acoplar a console.
 */
export function formatOtelDiagError(message: string, ...args: unknown[]): string {
  const extra = args.length > 0 ? ` ${args.map(String).join(' ')}` : '';
  return `error interno de OpenTelemetry: ${message}${extra}`;
}

/** DiagLogger mínimo: solo ERROR/WARN llegan a stderr; el resto se silencia. */
export class KeeperDiagLogger implements DiagLogger {
  error(message: string, ...args: unknown[]): void {
    console.error(formatOtelDiagError(message, ...args));
  }
  warn(message: string, ...args: unknown[]): void {
    console.warn(`[otel] ${message}`, ...args);
  }
  info(..._args: unknown[]): void {
    /* silencio: ruido de init */
  }
  debug(..._args: unknown[]): void {
    /* silencio */
  }
  verbose(..._args: unknown[]): void {
    /* silencio */
  }
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
const DEFAULT_IGNORE_PATHS = ['/health', '/healthz', '/live', '/ready', '/ping', '/metrics'];

function firstNonEmpty(...vals: Array<string | undefined>): string | undefined {
  for (const v of vals) {
    if (v !== undefined && v !== '') {
      return v;
    }
  }
  return undefined;
}

/**
 * Construye los atributos del `Resource` OTel a partir de opciones + entorno.
 * Función pura (sin efectos) para poder validarla con unit tests sin arrancar el SDK.
 * Cubre el contexto de deploy del §3.2: servicio, versión, ambiente, host, instancia,
 * build/commit (estos últimos solo si están disponibles).
 */
export function buildResourceAttributes(
  options: KeeperOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const attrs: Record<string, string> = {
    [SemanticResourceAttributes.SERVICE_NAME]:
      firstNonEmpty(options.serviceName, env.OTEL_SERVICE_NAME) ?? 'servicio-sin-nombre',
    [SemanticResourceAttributes.SERVICE_VERSION]:
      firstNonEmpty(options.serviceVersion, env.KEEPER_SERVICE_VERSION, env.APP_VERSION) ?? '0.0.0',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
      firstNonEmpty(options.environment, env.KEEPER_ENV, env.NODE_ENV) ?? 'development',
    [SemanticResourceAttributes.HOST_NAME]: hostname(),
    [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: randomUUID(),
  };

  const buildId = firstNonEmpty(options.buildId, env.KEEPER_BUILD_ID);
  if (buildId) {
    attrs['build_id'] = buildId;
  }
  const commitHash = firstNonEmpty(
    options.commitHash,
    env.KEEPER_COMMIT_HASH,
    env.GIT_COMMIT,
    env.COMMIT_SHA,
  );
  if (commitHash) {
    attrs['commit_hash'] = commitHash;
  }
  return attrs;
}

function clampRatio(r: number): number {
  if (Number.isNaN(r) || r < 0) {
    return 0;
  }
  return r > 1 ? 1 : r;
}

/**
 * Decide la proporción de muestreo con precedencia:
 * opción `samplingRatio` > `OTEL_TRACES_SAMPLER`(+`_ARG`) del entorno > 1.0 (sin muestreo).
 * Función pura para poder validarla con unit tests.
 */
export function resolveSampleRatio(
  options: KeeperOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (options.samplingRatio !== undefined) {
    return clampRatio(options.samplingRatio);
  }
  const sampler = (env.OTEL_TRACES_SAMPLER ?? '').trim().toLowerCase();
  const arg = (env.OTEL_TRACES_SAMPLER_ARG ?? '').trim();
  switch (sampler) {
    case 'always_off':
    case 'parentbased_always_off':
      return 0;
    case 'traceidratio':
    case 'parentbased_traceidratio': {
      const r = Number.parseFloat(arg);
      return Number.isNaN(r) ? 1 : clampRatio(r);
    }
    default:
      return 1; // '', always_on, parentbased_always_on o desconocido
  }
}

/** sample_rate = cuántos eventos representa cada evento conservado (1/ratio). */
export function sampleRateForRatio(ratio: number): number {
  if (ratio <= 0) {
    return 0;
  }
  if (ratio >= 1) {
    return 1;
  }
  return Math.round(1 / ratio);
}

export function buildSampler(ratio: number): Sampler {
  if (ratio <= 0) {
    return new AlwaysOffSampler();
  }
  if (ratio >= 1) {
    return new AlwaysOnSampler();
  }
  return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) });
}

/**
 * SpanProcessor que estampa `sample_rate` en cada span al iniciarse, para que el evento
 * lleve dentro cuántos representa (§7.2) y el análisis pueda reponderar.
 */
export class SampleRateSpanProcessor implements SpanProcessor {
  constructor(private readonly rate: number) {}
  onStart(span: Span): void {
    span.setAttribute('sample_rate', this.rate);
  }
  onEnd(): void {
    /* no-op */
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

let sdk: NodeSDK | undefined;

/**
 * startKeeper inicializa la observabilidad. Llamar **al inicio del proceso**,
 * antes de levantar la app (idealmente como primer import de main.ts).
 */
export function startKeeper(options: KeeperOptions = {}): void {
  if (sdk) {
    return; // ya inicializado
  }
  const endpoint =
    options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
  const ignorePaths = options.ignoreIncomingPaths ?? DEFAULT_IGNORE_PATHS;

  // Hash one-way de PII (§3.4): mismo pepper organizacional → mismo digest entre SDKs.
  setHashConfig(
    options.hashPepper ?? process.env.KEEPER_HASH_PEPPER ?? '',
    options.hashKeys ?? DEFAULT_HASH_KEYS,
  );

  const resource = new Resource(buildResourceAttributes(options));

  const ratio = resolveSampleRatio(options);
  const sampleRate = sampleRateForRatio(ratio);
  const traceExporter = new OTLPTraceExporter({ url: `${endpoint}/v1/traces` });

  // Errores internos del pipeline OTel (lote rechazado, etc.) → stderr con nivel claro.
  diag.setLogger(new KeeperDiagLogger(), DiagLogLevel.ERROR);

  sdk = new NodeSDK({
    resource,
    sampler: buildSampler(ratio),
    // Exporta las trazas (BatchSpanProcessor) y estampa sample_rate en cada span.
    spanProcessors: [new BatchSpanProcessor(traceExporter), new SampleRateSpanProcessor(sampleRate)],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
    }),
    // Logs: KeeperLogger y las instrumentaciones de pino/winston emiten log
    // records que este procesador exporta por OTLP (tercer pilar).
    logRecordProcessor: new BatchLogRecordProcessor(
      new OTLPLogExporter({ url: `${endpoint}/v1/logs` }),
    ),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs genera cientos de spans por request sin valor de negocio
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) => {
            const path = (request.url ?? '').split('?')[0];
            // Sufijo (ignore paths empiezan con /): /api/v1/health matchea /health;
            // /unhealthy no, porque no termina en "/health".
            return ignorePaths.some((p) => path === p || path.endsWith(p));
          },
          // Además del traceparent W3C (que la instrumentación propaga sola),
          // reenvía el x-request-id legible a los servicios downstream.
          requestHook: (_span, request) => {
            const requestId = getRequestId();
            if (
              requestId &&
              'setHeader' in request &&
              typeof request.setHeader === 'function' &&
              !request.getHeader('x-request-id')
            ) {
              request.setHeader('x-request-id', requestId);
            }
          },
        },
      }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    sdk
      ?.shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
