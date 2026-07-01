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
import { getRequestId } from './context';

export { KeeperLogger } from './logger';
export type { KeeperLoggerOptions, KeeperLogLevel } from './logger';
export { keeperRequestContext, getRequestId } from './context';
export { DEFAULT_REDACT_KEYS, redactAttributes } from './redact';

export interface KeeperOptions {
  /** Nombre del servicio (o variable OTEL_SERVICE_NAME). */
  serviceName?: string;
  /** Versión del servicio. */
  serviceVersion?: string;
  /** Base OTLP/HTTP de la plataforma Keeper, p. ej. http://keeper-host:4318
   *  (o variable OTEL_EXPORTER_OTLP_ENDPOINT). */
  endpoint?: string;
  /** Rutas HTTP entrantes que NO generan telemetría (comparadas por sufijo
   *  del pathname, para soportar prefijos globales tipo /dyinspectionws). */
  ignoreIncomingPaths?: string[];
}

/** Health checks y similares: tráfico de plomería que solo mete ruido/costo. */
const DEFAULT_IGNORE_PATHS = ['/health', '/healthz', '/live', '/ready', '/ping', '/metrics'];

let sdk: NodeSDK | undefined;

/**
 * startKeeper inicializa la observabilidad. Llamar **al inicio del proceso**,
 * antes de levantar la app (idealmente como primer import de main.ts).
 */
export function startKeeper(options: KeeperOptions = {}): void {
  if (sdk) {
    return; // ya inicializado
  }
  const serviceName =
    options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'servicio-sin-nombre';
  const endpoint =
    options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
  const ignorePaths = options.ignoreIncomingPaths ?? DEFAULT_IGNORE_PATHS;

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: options.serviceVersion ?? '0.0.0',
  });

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
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
