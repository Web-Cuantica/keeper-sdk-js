"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.violaciones = exports.reiniciarViolaciones = exports.SampleRateSpanProcessor = exports.sampleRateForRatio = exports.resolveSampleRatio = exports.KeeperDiagLogger = exports.formatOtelDiagError = exports.buildSampler = exports.buildResourceAttributes = exports.setHashConfig = exports.normalizeID = exports.isHashed = exports.hashIDWithPepper = exports.hashID = exports.HASH_PREFIX = exports.DEFAULT_HASH_KEYS = exports.safeUTF8 = exports.clientAttributes = exports.parseClient = exports.annotateOutcome = exports.annotateTenant = exports.annotateUser = exports.annotateSpan = exports.annotateRequest = exports.redactAttributes = exports.DEFAULT_REDACT_KEYS = exports.getClient = exports.getRequestId = exports.keeperRequestContext = exports.KeeperLogger = void 0;
exports.startKeeper = startKeeper;
// Keeper SDK (Node/TypeScript): observabilidad en una línea sobre OpenTelemetry.
// Envoltorio delgado del SDK oficial de OTel (ADR-0011): auto-instrumenta HTTP,
// Express, NestJS, mysql2/pg y loggers, y exporta los 3 pilares —trazas,
// métricas y logs— por OTLP/HTTP a la plataforma Keeper.
const sdk_node_1 = require("@opentelemetry/sdk-node");
const auto_instrumentations_node_1 = require("@opentelemetry/auto-instrumentations-node");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const exporter_metrics_otlp_http_1 = require("@opentelemetry/exporter-metrics-otlp-http");
const exporter_logs_otlp_http_1 = require("@opentelemetry/exporter-logs-otlp-http");
const sdk_metrics_1 = require("@opentelemetry/sdk-metrics");
const sdk_logs_1 = require("@opentelemetry/sdk-logs");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const api_1 = require("@opentelemetry/api");
const context_1 = require("./context");
const contrato_1 = require("./contrato");
const core_1 = require("./core");
const hash_1 = require("./hash");
var logger_1 = require("./logger");
Object.defineProperty(exports, "KeeperLogger", { enumerable: true, get: function () { return logger_1.KeeperLogger; } });
var context_2 = require("./context");
Object.defineProperty(exports, "keeperRequestContext", { enumerable: true, get: function () { return context_2.keeperRequestContext; } });
Object.defineProperty(exports, "getRequestId", { enumerable: true, get: function () { return context_2.getRequestId; } });
Object.defineProperty(exports, "getClient", { enumerable: true, get: function () { return context_2.getClient; } });
var redact_1 = require("./redact");
Object.defineProperty(exports, "DEFAULT_REDACT_KEYS", { enumerable: true, get: function () { return redact_1.DEFAULT_REDACT_KEYS; } });
Object.defineProperty(exports, "redactAttributes", { enumerable: true, get: function () { return redact_1.redactAttributes; } });
var annotate_1 = require("./annotate");
Object.defineProperty(exports, "annotateRequest", { enumerable: true, get: function () { return annotate_1.annotateRequest; } });
Object.defineProperty(exports, "annotateSpan", { enumerable: true, get: function () { return annotate_1.annotateSpan; } });
Object.defineProperty(exports, "annotateUser", { enumerable: true, get: function () { return annotate_1.annotateUser; } });
Object.defineProperty(exports, "annotateTenant", { enumerable: true, get: function () { return annotate_1.annotateTenant; } });
Object.defineProperty(exports, "annotateOutcome", { enumerable: true, get: function () { return annotate_1.annotateOutcome; } });
var client_1 = require("./client");
Object.defineProperty(exports, "parseClient", { enumerable: true, get: function () { return client_1.parseClient; } });
Object.defineProperty(exports, "clientAttributes", { enumerable: true, get: function () { return client_1.clientAttributes; } });
var sanitize_1 = require("./sanitize");
Object.defineProperty(exports, "safeUTF8", { enumerable: true, get: function () { return sanitize_1.safeUTF8; } });
var hash_2 = require("./hash");
Object.defineProperty(exports, "DEFAULT_HASH_KEYS", { enumerable: true, get: function () { return hash_2.DEFAULT_HASH_KEYS; } });
Object.defineProperty(exports, "HASH_PREFIX", { enumerable: true, get: function () { return hash_2.HASH_PREFIX; } });
Object.defineProperty(exports, "hashID", { enumerable: true, get: function () { return hash_2.hashID; } });
Object.defineProperty(exports, "hashIDWithPepper", { enumerable: true, get: function () { return hash_2.hashIDWithPepper; } });
Object.defineProperty(exports, "isHashed", { enumerable: true, get: function () { return hash_2.isHashed; } });
Object.defineProperty(exports, "normalizeID", { enumerable: true, get: function () { return hash_2.normalizeID; } });
Object.defineProperty(exports, "setHashConfig", { enumerable: true, get: function () { return hash_2.setHashConfig; } });
var core_2 = require("./core");
Object.defineProperty(exports, "buildResourceAttributes", { enumerable: true, get: function () { return core_2.buildResourceAttributes; } });
Object.defineProperty(exports, "buildSampler", { enumerable: true, get: function () { return core_2.buildSampler; } });
Object.defineProperty(exports, "formatOtelDiagError", { enumerable: true, get: function () { return core_2.formatOtelDiagError; } });
Object.defineProperty(exports, "KeeperDiagLogger", { enumerable: true, get: function () { return core_2.KeeperDiagLogger; } });
Object.defineProperty(exports, "resolveSampleRatio", { enumerable: true, get: function () { return core_2.resolveSampleRatio; } });
Object.defineProperty(exports, "sampleRateForRatio", { enumerable: true, get: function () { return core_2.sampleRateForRatio; } });
Object.defineProperty(exports, "SampleRateSpanProcessor", { enumerable: true, get: function () { return core_2.SampleRateSpanProcessor; } });
var contrato_2 = require("./contrato");
Object.defineProperty(exports, "reiniciarViolaciones", { enumerable: true, get: function () { return contrato_2.reiniciarViolaciones; } });
Object.defineProperty(exports, "violaciones", { enumerable: true, get: function () { return contrato_2.violaciones; } });
let sdk;
/**
 * startKeeper inicializa la observabilidad. Llamar **al inicio del proceso**,
 * antes de levantar la app (idealmente como primer import de main.ts).
 */
function startKeeper(options = {}) {
    if (sdk) {
        return; // ya inicializado
    }
    const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
    const ignorePaths = options.ignoreIncomingPaths ?? core_1.DEFAULT_IGNORE_PATHS;
    // Hash one-way de PII (§3.4): mismo pepper organizacional → mismo digest entre SDKs.
    (0, hash_1.setHashConfig)(options.hashPepper ?? process.env.KEEPER_HASH_PEPPER ?? '', options.hashKeys ?? hash_1.DEFAULT_HASH_KEYS);
    const ratio = (0, core_1.resolveSampleRatio)(options);
    const sampleRate = (0, core_1.sampleRateForRatio)(ratio);
    const contrato = (0, contrato_1.setContrato)(options.contrato);
    const traceExporter = new contrato_1.ExportadorDeSpansConContrato(new exporter_trace_otlp_http_1.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }), contrato);
    // Errores internos del pipeline OTel (lote rechazado, etc.) → stderr con nivel claro.
    api_1.diag.setLogger(new core_1.KeeperDiagLogger(), api_1.DiagLogLevel.ERROR);
    sdk = new sdk_node_1.NodeSDK({
        resource: (0, core_1.buildResource)(options),
        sampler: (0, core_1.buildSampler)(ratio),
        // Exporta las trazas (BatchSpanProcessor) y estampa sample_rate en cada span.
        spanProcessors: [new sdk_trace_base_1.BatchSpanProcessor(traceExporter), new core_1.SampleRateSpanProcessor(sampleRate)],
        metricReader: new sdk_metrics_1.PeriodicExportingMetricReader({
            exporter: new exporter_metrics_otlp_http_1.OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        }),
        // Logs: KeeperLogger y las instrumentaciones de pino/winston emiten log
        // records que este procesador exporta por OTLP (tercer pilar).
        logRecordProcessor: new sdk_logs_1.BatchLogRecordProcessor(new contrato_1.ExportadorDeLogsConContrato(new exporter_logs_otlp_http_1.OTLPLogExporter({ url: `${endpoint}/v1/logs` }), contrato)),
        instrumentations: [
            (0, auto_instrumentations_node_1.getNodeAutoInstrumentations)({
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
                        const requestId = (0, context_1.getRequestId)();
                        if (requestId &&
                            'setHeader' in request &&
                            typeof request.setHeader === 'function' &&
                            !request.getHeader('x-request-id')) {
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
