"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RaizDePeticion = exports.MuestreoSinRuido = exports.DEFAULT_IGNORE_PREFIXES = exports.redactAttributes = exports.isHashed = exports.hashID = exports.violaciones = exports.reiniciarViolaciones = exports.KeeperLogger = void 0;
exports.annotateRequest = annotateRequest;
exports.registerKeeper = registerKeeper;
exports.keeperFetchMiddleware = keeperFetchMiddleware;
// Keeper SDK para Next.js (App Router, runtime de Node). Arranque ligero: no carga la
// auto-instrumentación de Node, porque Next ya abre sus propios spans (petición, render,
// server actions) en cuanto hay un proveedor de trazas registrado. Este módulo pone el
// proveedor, el contrato de telemetría, la propagación hacia los servicios a los que llama la
// app y los logs por OTLP.
//
// Uso, en `instrumentation.ts` de la app:
//
//   export async function register() {
//     if (process.env.NEXT_RUNTIME === 'nodejs') {
//       const { registerKeeper } = await import('@web-cuantica/keeper-sdk/next');
//       registerKeeper({ serviceName: 'mi-portal' });
//     }
//   }
const api_1 = require("@opentelemetry/api");
const api_logs_1 = require("@opentelemetry/api-logs");
const core_1 = require("@opentelemetry/core");
const exporter_logs_otlp_http_1 = require("@opentelemetry/exporter-logs-otlp-http");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
const sdk_logs_1 = require("@opentelemetry/sdk-logs");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const annotate_1 = require("./annotate");
const contrato_1 = require("./contrato");
const core_2 = require("./core");
const hash_1 = require("./hash");
var logger_1 = require("./logger");
Object.defineProperty(exports, "KeeperLogger", { enumerable: true, get: function () { return logger_1.KeeperLogger; } });
var contrato_2 = require("./contrato");
Object.defineProperty(exports, "reiniciarViolaciones", { enumerable: true, get: function () { return contrato_2.reiniciarViolaciones; } });
Object.defineProperty(exports, "violaciones", { enumerable: true, get: function () { return contrato_2.violaciones; } });
var hash_2 = require("./hash");
Object.defineProperty(exports, "hashID", { enumerable: true, get: function () { return hash_2.hashID; } });
Object.defineProperty(exports, "isHashed", { enumerable: true, get: function () { return hash_2.isHashed; } });
var redact_1 = require("./redact");
Object.defineProperty(exports, "redactAttributes", { enumerable: true, get: function () { return redact_1.redactAttributes; } });
/** Estáticos de Next: cada página pide decenas y ninguno explica nada. */
exports.DEFAULT_IGNORE_PREFIXES = ['/_next/'];
/** Tipo de span con el que Next marca su traza de `fetch`. Lleva la URL completa en el nombre. */
const SPAN_DE_FETCH_DE_NEXT = 'AppRender.fetch';
/** Exportador que no envía nada: sin endpoint el contrato se aplica igual y nada sale. */
const exportadorNulo = {
    export(_items, resultCallback) {
        resultCallback({ code: core_1.ExportResultCode.SUCCESS });
    },
    shutdown() {
        return Promise.resolve();
    },
};
function rutaDe(objetivo) {
    return typeof objetivo === 'string' ? objetivo.split('?')[0] : undefined;
}
/**
 * Muestreo que descarta el ruido antes de que exista: una petición entrante a un estático o a
 * un health check no abre traza, y todo lo que cuelga de ella tampoco.
 */
class MuestreoSinRuido {
    constructor(base, rutasIgnoradas, prefijosIgnorados) {
        this.base = base;
        this.rutasIgnoradas = rutasIgnoradas;
        this.prefijosIgnorados = prefijosIgnorados;
    }
    shouldSample(ctx, traceId, name, kind, attributes, links) {
        const padre = api_1.trace.getSpanContext(ctx);
        if (padre && (0, api_1.isSpanContextValid)(padre)) {
            const muestreado = (padre.traceFlags & api_1.TraceFlags.SAMPLED) === api_1.TraceFlags.SAMPLED;
            return {
                decision: muestreado ? sdk_trace_base_1.SamplingDecision.RECORD_AND_SAMPLED : sdk_trace_base_1.SamplingDecision.NOT_RECORD,
            };
        }
        const ruta = rutaDe(attributes['http.target']) ?? rutaDe(attributes['url.path']);
        if (kind === api_1.SpanKind.SERVER && ruta !== undefined && this.ignorada(ruta)) {
            return { decision: sdk_trace_base_1.SamplingDecision.NOT_RECORD };
        }
        return this.base.shouldSample(ctx, traceId, name, kind, attributes, links);
    }
    toString() {
        return `MuestreoSinRuido{${this.base.toString()}}`;
    }
    ignorada(ruta) {
        return (this.rutasIgnoradas.some((p) => ruta === p || ruta.endsWith(p)) ||
            this.prefijosIgnorados.some((p) => ruta.startsWith(p)));
    }
}
exports.MuestreoSinRuido = MuestreoSinRuido;
/** Tope de peticiones en curso que se recuerdan; una que nunca cierra no puede acumularse. */
const MAX_RAICES = 10_000;
/**
 * Recuerda el span raíz de cada petición en curso, para que el código de la app pueda anotar
 * el evento de la petición aunque en ese momento el span activo sea uno interno de Next.
 */
class RaizDePeticion {
    constructor() {
        this.raices = new Map();
    }
    onStart(span, parentContext) {
        const padre = api_1.trace.getSpanContext(parentContext);
        if (padre && (0, api_1.isSpanContextValid)(padre) && !padre.isRemote) {
            return;
        }
        if (this.raices.size < MAX_RAICES) {
            this.raices.set(span.spanContext().traceId, span);
        }
    }
    onEnd(span) {
        const { traceId, spanId } = span.spanContext();
        if (this.raices.get(traceId)?.spanContext().spanId === spanId) {
            this.raices.delete(traceId);
        }
    }
    /** Span raíz de la petición a la que pertenece el span activo. */
    activa() {
        const activo = api_1.trace.getActiveSpan();
        if (!activo) {
            return undefined;
        }
        return this.raices.get(activo.spanContext().traceId) ?? activo;
    }
    shutdown() {
        this.raices.clear();
        return Promise.resolve();
    }
    forceFlush() {
        return Promise.resolve();
    }
}
exports.RaizDePeticion = RaizDePeticion;
let raices;
let registro;
/**
 * Anota el evento ancho de la petición en curso: los atributos van al span raíz (el que Next
 * abre por cada petición entrante), censurados como cualquier otro. Fuera de una petición no
 * hace nada.
 */
function annotateRequest(attributes, extraRedactKeys = []) {
    const raiz = raices?.activa() ?? api_1.trace.getActiveSpan();
    if (raiz) {
        (0, annotate_1.annotateSpan)(raiz, attributes, extraRedactKeys);
    }
}
/** El nombre de un span entrante sin su query: Next lo deja con la URL cruda si no hay ruta. */
function nombreSinQuery(span) {
    const corte = span.name.indexOf('?');
    return span.kind === api_1.SpanKind.SERVER && corte >= 0 ? span.name.slice(0, corte) : span.name;
}
/**
 * registerKeeper inicializa la observabilidad de una app Next.js. Se llama una vez, desde
 * `register()` de `instrumentation.ts`, solo en el runtime de Node. Sin endpoint
 * (OTEL_EXPORTER_OTLP_ENDPOINT) no exporta nada, pero propaga el contexto y aplica el contrato.
 */
function registerKeeper(options = {}) {
    if (registro) {
        return registro;
    }
    const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
    (0, hash_1.setHashConfig)(options.hashPepper ?? process.env.KEEPER_HASH_PEPPER ?? '', options.hashKeys ?? hash_1.DEFAULT_HASH_KEYS);
    api_1.diag.setLogger(new core_2.KeeperDiagLogger(), api_1.DiagLogLevel.ERROR);
    const contrato = (0, contrato_1.setContrato)(options.contrato);
    const resource = (0, core_2.buildResource)(options);
    const ratio = (0, core_2.resolveSampleRatio)(options);
    const exportadorDeSpans = options.spanExporter ??
        (endpoint ? new exporter_trace_otlp_http_1.OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) : exportadorNulo);
    const tracerProvider = new sdk_trace_node_1.NodeTracerProvider({
        resource,
        sampler: new MuestreoSinRuido((0, core_2.buildSampler)(ratio), options.ignoreIncomingPaths ?? core_2.DEFAULT_IGNORE_PATHS, options.ignoreIncomingPrefixes ?? exports.DEFAULT_IGNORE_PREFIXES),
    });
    raices = new RaizDePeticion();
    tracerProvider.addSpanProcessor(raices);
    tracerProvider.addSpanProcessor(new core_2.SampleRateSpanProcessor((0, core_2.sampleRateForRatio)(ratio)));
    tracerProvider.addSpanProcessor(new sdk_trace_base_1.BatchSpanProcessor(new contrato_1.ExportadorDeSpansConContrato(exportadorDeSpans, contrato, {
        // El span de fetch de Next lleva la URL completa, con su query, en el nombre y en
        // http.url: nunca sale. Las llamadas salientes se trazan con keeperFetchMiddleware.
        descartarSpan: (s) => s.attributes['next.span_type'] === SPAN_DE_FETCH_DE_NEXT,
        nombre: nombreSinQuery,
    }), { scheduledDelayMillis: 2000 }));
    // Registra el proveedor global, el contexto por AsyncLocalStorage y la propagación W3C.
    tracerProvider.register();
    const exportadorDeLogs = options.logExporter ??
        (endpoint ? new exporter_logs_otlp_http_1.OTLPLogExporter({ url: `${endpoint}/v1/logs` }) : exportadorNulo);
    const loggerProvider = new sdk_logs_1.LoggerProvider({ resource });
    loggerProvider.addLogRecordProcessor(new sdk_logs_1.BatchLogRecordProcessor(new contrato_1.ExportadorDeLogsConContrato(exportadorDeLogs, contrato), {
        scheduledDelayMillis: 2000,
    }));
    api_logs_1.logs.setGlobalLoggerProvider(loggerProvider);
    const handle = {
        async forceFlush() {
            await Promise.allSettled([tracerProvider.forceFlush(), loggerProvider.forceFlush()]);
        },
        async shutdown() {
            await Promise.allSettled([tracerProvider.shutdown(), loggerProvider.shutdown()]);
            api_1.trace.disable();
            api_1.context.disable();
            api_1.propagation.disable();
            api_logs_1.logs.disable();
            raices = undefined;
            registro = undefined;
        },
    };
    registro = handle;
    if (options.handleSignals) {
        const terminar = () => {
            void handle.shutdown().finally(() => process.exit(0));
        };
        process.once('SIGTERM', terminar);
        process.once('SIGINT', terminar);
    }
    return handle;
}
function puertoDe(url) {
    if (url.port) {
        return Number.parseInt(url.port, 10);
    }
    return url.protocol === 'http:' ? 80 : 443;
}
/** Clasifica un error de red sin repetir su mensaje, que puede traer la dirección. */
function tipoDeError(error) {
    if (error && typeof error === 'object') {
        const causa = error.cause;
        if (causa && typeof causa.code === 'string') {
            return causa.code;
        }
        const nombre = error.name;
        if (typeof nombre === 'string' && nombre) {
            return nombre;
        }
    }
    return 'error';
}
/**
 * Middleware para openapi-fetch (o cualquier cliente con la misma forma): un span de cliente
 * por llamada saliente, nombrado con la ruta del contrato y nunca con la URL, y el contexto de
 * traza propagado en `traceparent` para que el servicio llamado continúe la misma traza.
 */
function keeperFetchMiddleware(options = {}) {
    const porId = new Map();
    const porPeticion = new WeakMap();
    const tomar = (call) => {
        if (call.id !== undefined) {
            const span = porId.get(call.id);
            porId.delete(call.id);
            return span;
        }
        return porPeticion.get(call.request);
    };
    const avisar = (span, mensaje, attrs) => {
        if (!options.logger) {
            return;
        }
        // Con el span como contexto activo, el log queda ligado a la llamada que falló.
        api_1.context.with(api_1.trace.setSpan(api_1.context.active(), span), () => options.logger?.error(mensaje, attrs));
    };
    return {
        onRequest(call) {
            const url = new URL(call.request.url);
            const metodo = call.request.method.toUpperCase();
            const attrs = {
                'http.request.method': metodo,
                'server.address': url.hostname,
                'server.port': puertoDe(url),
            };
            if (call.schemaPath) {
                attrs['url.template'] = call.schemaPath;
            }
            const span = api_1.trace
                .getTracer('@web-cuantica/keeper-sdk')
                .startSpan(`${metodo} ${call.schemaPath ?? url.hostname}`, { kind: api_1.SpanKind.CLIENT, attributes: attrs });
            api_1.propagation.inject(api_1.trace.setSpan(api_1.context.active(), span), call.request.headers, {
                set: (headers, key, value) => headers.set(key, value),
            });
            if (call.id !== undefined) {
                porId.set(call.id, span);
            }
            else {
                porPeticion.set(call.request, span);
            }
            return call.request;
        },
        onResponse(call) {
            const span = tomar(call);
            if (!span) {
                return undefined;
            }
            const status = call.response.status;
            span.setAttribute('http.response.status_code', status);
            if (status >= 400) {
                span.setAttribute('error.type', String(status));
                span.setStatus({ code: api_1.SpanStatusCode.ERROR });
            }
            if (status >= 500) {
                avisar(span, 'El servicio llamado respondió con error', {
                    'http.request.method': call.request.method.toUpperCase(),
                    'url.template': call.schemaPath ?? '',
                    'http.response.status_code': status,
                });
            }
            span.end();
            return undefined;
        },
        onError(call) {
            const span = tomar(call);
            if (!span) {
                return undefined;
            }
            const tipo = tipoDeError(call.error);
            span.setAttribute('error.type', tipo);
            span.setStatus({ code: api_1.SpanStatusCode.ERROR, message: tipo });
            avisar(span, 'No se pudo llamar al servicio', {
                'http.request.method': call.request.method.toUpperCase(),
                'url.template': call.schemaPath ?? '',
                'error.type': tipo,
            });
            span.end();
            return undefined;
        },
    };
}
