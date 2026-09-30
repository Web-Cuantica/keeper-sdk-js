"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SampleRateSpanProcessor = exports.DEFAULT_IGNORE_PATHS = exports.KeeperDiagLogger = void 0;
exports.formatOtelDiagError = formatOtelDiagError;
exports.firstNonEmpty = firstNonEmpty;
exports.buildResourceAttributes = buildResourceAttributes;
exports.buildResource = buildResource;
exports.resolveSampleRatio = resolveSampleRatio;
exports.sampleRateForRatio = sampleRateForRatio;
exports.buildSampler = buildSampler;
// Piezas puras que comparten los dos arranques del SDK: `startKeeper` (Node/NestJS, con
// auto-instrumentación) y `registerKeeper` (Next.js, sin ella). Aquí no se importa ninguna
// instrumentación: quien solo usa el arranque ligero no carga el resto.
const resources_1 = require("@opentelemetry/resources");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const node_os_1 = require("node:os");
const node_crypto_1 = require("node:crypto");
/**
 * Logger de diagnóstico OTel: eleva errores internos del pipeline (export fallido,
 * etc.) a stderr con prefijo claro — paridad con otel.SetErrorHandler de Go (JS-9).
 * Función pura de formato para poder testearla sin acoplar a console.
 */
function formatOtelDiagError(message, ...args) {
    const extra = args.length > 0 ? ` ${args.map(String).join(' ')}` : '';
    return `error interno de OpenTelemetry: ${message}${extra}`;
}
/** DiagLogger mínimo: solo ERROR/WARN llegan a stderr; el resto se silencia. */
class KeeperDiagLogger {
    error(message, ...args) {
        console.error(formatOtelDiagError(message, ...args));
    }
    warn(message, ...args) {
        console.warn(`[otel] ${message}`, ...args);
    }
    info(..._args) {
        /* silencio: ruido de init */
    }
    debug(..._args) {
        /* silencio */
    }
    verbose(..._args) {
        /* silencio */
    }
}
exports.KeeperDiagLogger = KeeperDiagLogger;
/** Health checks y similares: tráfico de plomería que solo mete ruido/costo. */
exports.DEFAULT_IGNORE_PATHS = ['/health', '/healthz', '/live', '/ready', '/ping', '/metrics'];
function firstNonEmpty(...vals) {
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
function buildResourceAttributes(options = {}, env = process.env) {
    const attrs = {
        [semantic_conventions_1.SemanticResourceAttributes.SERVICE_NAME]: firstNonEmpty(options.serviceName, env.OTEL_SERVICE_NAME) ?? 'servicio-sin-nombre',
        [semantic_conventions_1.SemanticResourceAttributes.SERVICE_VERSION]: firstNonEmpty(options.serviceVersion, env.KEEPER_SERVICE_VERSION, env.APP_VERSION) ?? '0.0.0',
        [semantic_conventions_1.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: firstNonEmpty(options.environment, env.KEEPER_ENV, env.NODE_ENV) ?? 'development',
        [semantic_conventions_1.SemanticResourceAttributes.HOST_NAME]: (0, node_os_1.hostname)(),
        [semantic_conventions_1.SemanticResourceAttributes.SERVICE_INSTANCE_ID]: (0, node_crypto_1.randomUUID)(),
    };
    const buildId = firstNonEmpty(options.buildId, env.KEEPER_BUILD_ID);
    if (buildId) {
        attrs['build_id'] = buildId;
    }
    const commitHash = firstNonEmpty(options.commitHash, env.KEEPER_COMMIT_HASH, env.GIT_COMMIT, env.COMMIT_SHA);
    if (commitHash) {
        attrs['commit_hash'] = commitHash;
    }
    return attrs;
}
/** Recurso OTel del proceso, con el contexto de despliegue. */
function buildResource(options = {}) {
    return new resources_1.Resource(buildResourceAttributes(options));
}
function clampRatio(r) {
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
function resolveSampleRatio(options = {}, env = process.env) {
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
function sampleRateForRatio(ratio) {
    if (ratio <= 0) {
        return 0;
    }
    if (ratio >= 1) {
        return 1;
    }
    return Math.round(1 / ratio);
}
function buildSampler(ratio) {
    if (ratio <= 0) {
        return new sdk_trace_base_1.AlwaysOffSampler();
    }
    if (ratio >= 1) {
        return new sdk_trace_base_1.AlwaysOnSampler();
    }
    return new sdk_trace_base_1.ParentBasedSampler({ root: new sdk_trace_base_1.TraceIdRatioBasedSampler(ratio) });
}
/**
 * SpanProcessor que estampa `sample_rate` en cada span al iniciarse, para que el evento
 * lleve dentro cuántos representa (§7.2) y el análisis pueda reponderar.
 */
class SampleRateSpanProcessor {
    constructor(rate) {
        this.rate = rate;
    }
    onStart(span) {
        span.setAttribute('sample_rate', this.rate);
    }
    onEnd() {
        /* no-op */
    }
    shutdown() {
        return Promise.resolve();
    }
    forceFlush() {
        return Promise.resolve();
    }
}
exports.SampleRateSpanProcessor = SampleRateSpanProcessor;
