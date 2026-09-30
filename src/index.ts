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
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { diag, DiagLogLevel } from '@opentelemetry/api';
import { getRequestId } from './context';
import {
  ExportadorDeLogsConContrato,
  ExportadorDeSpansConContrato,
  setContrato,
  type KeeperContrato,
} from './contrato';
import {
  buildResource,
  buildSampler,
  DEFAULT_IGNORE_PATHS,
  KeeperDiagLogger,
  resolveSampleRatio,
  sampleRateForRatio,
  SampleRateSpanProcessor,
  type KeeperOptions as KeeperBaseOptions,
} from './core';
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
export {
  buildResourceAttributes,
  buildSampler,
  formatOtelDiagError,
  KeeperDiagLogger,
  resolveSampleRatio,
  sampleRateForRatio,
  SampleRateSpanProcessor,
} from './core';
export { reiniciarViolaciones, violaciones } from './contrato';
export type {
  ClasificacionDeClave,
  KeeperContrato,
  ModoDeContrato,
  SenalDeContrato,
  Violacion,
} from './contrato';

export interface KeeperOptions extends KeeperBaseOptions {
  /** Contrato de telemetría: lista blanca de claves de atributo. Sin él, sale todo. */
  contrato?: KeeperContrato;
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

  const ratio = resolveSampleRatio(options);
  const sampleRate = sampleRateForRatio(ratio);
  const contrato = setContrato(options.contrato);
  const traceExporter = new ExportadorDeSpansConContrato(
    new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    contrato,
  );

  // Errores internos del pipeline OTel (lote rechazado, etc.) → stderr con nivel claro.
  diag.setLogger(new KeeperDiagLogger(), DiagLogLevel.ERROR);

  sdk = new NodeSDK({
    resource: buildResource(options),
    sampler: buildSampler(ratio),
    // Exporta las trazas (BatchSpanProcessor) y estampa sample_rate en cada span.
    spanProcessors: [new BatchSpanProcessor(traceExporter), new SampleRateSpanProcessor(sampleRate)],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
    }),
    // Logs: KeeperLogger y las instrumentaciones de pino/winston emiten log
    // records que este procesador exporta por OTLP (tercer pilar).
    logRecordProcessor: new BatchLogRecordProcessor(
      new ExportadorDeLogsConContrato(new OTLPLogExporter({ url: `${endpoint}/v1/logs` }), contrato),
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
