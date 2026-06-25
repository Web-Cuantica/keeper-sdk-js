// Keeper SDK (Node/TypeScript): observabilidad en una línea sobre OpenTelemetry.
// Envoltorio delgado del SDK oficial de OTel (ADR-0011): auto-instrumenta HTTP,
// Express, NestJS y pg, y exporta por OTLP/HTTP a la plataforma Keeper.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

export interface KeeperOptions {
  /** Nombre del servicio (o variable OTEL_SERVICE_NAME). */
  serviceName?: string;
  /** Versión del servicio. */
  serviceVersion?: string;
  /** Base OTLP/HTTP de la plataforma Keeper, p. ej. http://keeper-host:4318
   *  (o variable OTEL_EXPORTER_OTLP_ENDPOINT). */
  endpoint?: string;
}

let sdk: NodeSDK | undefined;

/**
 * startKeeper inicializa la observabilidad. Llamar **al inicio del proceso**,
 * antes de levantar la app (idealmente vía `node -r` o como primer import).
 */
export function startKeeper(options: KeeperOptions = {}): void {
  if (sdk) {
    return; // ya inicializado
  }
  const serviceName =
    options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'servicio-sin-nombre';
  const endpoint =
    options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

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
    instrumentations: [getNodeAutoInstrumentations()],
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
