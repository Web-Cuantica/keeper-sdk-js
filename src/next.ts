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
import {
  context,
  diag,
  DiagLogLevel,
  isSpanContextValid,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type Context,
  type Link,
  type Span as ApiSpan,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
} from '@opentelemetry/sdk-logs';
import {
  BatchSpanProcessor,
  SamplingDecision,
  type ReadableSpan,
  type Sampler,
  type SamplingResult,
  type Span,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { annotateSpan } from './annotate';
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
  type KeeperOptions,
} from './core';
import { DEFAULT_HASH_KEYS, setHashConfig } from './hash';
import type { KeeperLogger } from './logger';

export { KeeperLogger } from './logger';
export type { KeeperLoggerOptions, KeeperLogLevel } from './logger';
export { reiniciarViolaciones, violaciones } from './contrato';
export type {
  ClasificacionDeClave,
  KeeperContrato,
  ModoDeContrato,
  SenalDeContrato,
  Violacion,
} from './contrato';
export { hashID, isHashed } from './hash';
export { redactAttributes } from './redact';

/** Estáticos de Next: cada página pide decenas y ninguno explica nada. */
export const DEFAULT_IGNORE_PREFIXES = ['/_next/'];

/** Tipo de span con el que Next marca su traza de `fetch`. Lleva la URL completa en el nombre. */
const SPAN_DE_FETCH_DE_NEXT = 'AppRender.fetch';

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

/** Exportador que no envía nada: sin endpoint el contrato se aplica igual y nada sale. */
const exportadorNulo = {
  export(_items: unknown[], resultCallback: (result: ExportResult) => void): void {
    resultCallback({ code: ExportResultCode.SUCCESS });
  },
  shutdown(): Promise<void> {
    return Promise.resolve();
  },
};

function rutaDe(objetivo: unknown): string | undefined {
  return typeof objetivo === 'string' ? objetivo.split('?')[0] : undefined;
}

/**
 * Muestreo que descarta el ruido antes de que exista: una petición entrante a un estático o a
 * un health check no abre traza, y todo lo que cuelga de ella tampoco.
 */
export class MuestreoSinRuido implements Sampler {
  constructor(
    private readonly base: Sampler,
    private readonly rutasIgnoradas: string[],
    private readonly prefijosIgnorados: string[],
  ) {}

  shouldSample(
    ctx: Context,
    traceId: string,
    name: string,
    kind: SpanKind,
    attributes: Attributes,
    links: Link[],
  ): SamplingResult {
    const padre = trace.getSpanContext(ctx);
    if (padre && isSpanContextValid(padre)) {
      const muestreado = (padre.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
      return {
        decision: muestreado ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD,
      };
    }
    const ruta = rutaDe(attributes['http.target']) ?? rutaDe(attributes['url.path']);
    if (kind === SpanKind.SERVER && ruta !== undefined && this.ignorada(ruta)) {
      return { decision: SamplingDecision.NOT_RECORD };
    }
    return this.base.shouldSample(ctx, traceId, name, kind, attributes, links);
  }

  toString(): string {
    return `MuestreoSinRuido{${this.base.toString()}}`;
  }

  private ignorada(ruta: string): boolean {
    return (
      this.rutasIgnoradas.some((p) => ruta === p || ruta.endsWith(p)) ||
      this.prefijosIgnorados.some((p) => ruta.startsWith(p))
    );
  }
}

/** Tope de peticiones en curso que se recuerdan; una que nunca cierra no puede acumularse. */
const MAX_RAICES = 10_000;

/**
 * Recuerda el span raíz de cada petición en curso, para que el código de la app pueda anotar
 * el evento de la petición aunque en ese momento el span activo sea uno interno de Next.
 */
export class RaizDePeticion implements SpanProcessor {
  private readonly raices = new Map<string, Span>();

  onStart(span: Span, parentContext: Context): void {
    const padre = trace.getSpanContext(parentContext);
    if (padre && isSpanContextValid(padre) && !padre.isRemote) {
      return;
    }
    if (this.raices.size < MAX_RAICES) {
      this.raices.set(span.spanContext().traceId, span);
    }
  }

  onEnd(span: ReadableSpan): void {
    const { traceId, spanId } = span.spanContext();
    if (this.raices.get(traceId)?.spanContext().spanId === spanId) {
      this.raices.delete(traceId);
    }
  }

  /** Span raíz de la petición a la que pertenece el span activo. */
  activa(): ApiSpan | undefined {
    const activo = trace.getActiveSpan();
    if (!activo) {
      return undefined;
    }
    return this.raices.get(activo.spanContext().traceId) ?? activo;
  }

  shutdown(): Promise<void> {
    this.raices.clear();
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

let raices: RaizDePeticion | undefined;
let registro: KeeperNextHandle | undefined;

/**
 * Anota el evento ancho de la petición en curso: los atributos van al span raíz (el que Next
 * abre por cada petición entrante), censurados como cualquier otro. Fuera de una petición no
 * hace nada.
 */
export function annotateRequest(attributes: Record<string, unknown>, extraRedactKeys: string[] = []): void {
  const raiz = raices?.activa() ?? trace.getActiveSpan();
  if (raiz) {
    annotateSpan(raiz, attributes, extraRedactKeys);
  }
}

/** El nombre de un span entrante sin su query: Next lo deja con la URL cruda si no hay ruta. */
function nombreSinQuery(span: ReadableSpan): string {
  const corte = span.name.indexOf('?');
  return span.kind === SpanKind.SERVER && corte >= 0 ? span.name.slice(0, corte) : span.name;
}

/**
 * registerKeeper inicializa la observabilidad de una app Next.js. Se llama una vez, desde
 * `register()` de `instrumentation.ts`, solo en el runtime de Node. Sin endpoint
 * (OTEL_EXPORTER_OTLP_ENDPOINT) no exporta nada, pero propaga el contexto y aplica el contrato.
 */
export function registerKeeper(options: KeeperNextOptions = {}): KeeperNextHandle {
  if (registro) {
    return registro;
  }
  const endpoint = options.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';

  setHashConfig(
    options.hashPepper ?? process.env.KEEPER_HASH_PEPPER ?? '',
    options.hashKeys ?? DEFAULT_HASH_KEYS,
  );
  diag.setLogger(new KeeperDiagLogger(), DiagLogLevel.ERROR);

  const contrato = setContrato(options.contrato);
  const resource = buildResource(options);
  const ratio = resolveSampleRatio(options);

  const exportadorDeSpans =
    options.spanExporter ??
    (endpoint ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) : exportadorNulo);
  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: new MuestreoSinRuido(
      buildSampler(ratio),
      options.ignoreIncomingPaths ?? DEFAULT_IGNORE_PATHS,
      options.ignoreIncomingPrefixes ?? DEFAULT_IGNORE_PREFIXES,
    ),
  });
  raices = new RaizDePeticion();
  tracerProvider.addSpanProcessor(raices);
  tracerProvider.addSpanProcessor(new SampleRateSpanProcessor(sampleRateForRatio(ratio)));
  tracerProvider.addSpanProcessor(
    new BatchSpanProcessor(
      new ExportadorDeSpansConContrato(exportadorDeSpans, contrato, {
        // El span de fetch de Next lleva la URL completa, con su query, en el nombre y en
        // http.url: nunca sale. Las llamadas salientes se trazan con keeperFetchMiddleware.
        descartarSpan: (s) => s.attributes['next.span_type'] === SPAN_DE_FETCH_DE_NEXT,
        nombre: nombreSinQuery,
      }),
      { scheduledDelayMillis: 2000 },
    ),
  );
  // Registra el proveedor global, el contexto por AsyncLocalStorage y la propagación W3C.
  tracerProvider.register();

  const exportadorDeLogs =
    options.logExporter ??
    (endpoint ? new OTLPLogExporter({ url: `${endpoint}/v1/logs` }) : exportadorNulo);
  const loggerProvider = new LoggerProvider({ resource });
  loggerProvider.addLogRecordProcessor(
    new BatchLogRecordProcessor(new ExportadorDeLogsConContrato(exportadorDeLogs, contrato), {
      scheduledDelayMillis: 2000,
    }),
  );
  logs.setGlobalLoggerProvider(loggerProvider);

  const handle: KeeperNextHandle = {
    async forceFlush(): Promise<void> {
      await Promise.allSettled([tracerProvider.forceFlush(), loggerProvider.forceFlush()]);
    },
    async shutdown(): Promise<void> {
      await Promise.allSettled([tracerProvider.shutdown(), loggerProvider.shutdown()]);
      trace.disable();
      context.disable();
      propagation.disable();
      logs.disable();
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
  onResponse(call: LlamadaSaliente & { response: Response }): undefined;
  onError(call: LlamadaSaliente & { error: unknown }): undefined;
}

function puertoDe(url: URL): number {
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }
  return url.protocol === 'http:' ? 80 : 443;
}

/** Clasifica un error de red sin repetir su mensaje, que puede traer la dirección. */
function tipoDeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const causa = (error as { cause?: { code?: unknown } }).cause;
    if (causa && typeof causa.code === 'string') {
      return causa.code;
    }
    const nombre = (error as { name?: unknown }).name;
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
export function keeperFetchMiddleware(options: KeeperFetchMiddlewareOptions = {}): KeeperFetchMiddleware {
  const porId = new Map<string, ApiSpan>();
  const porPeticion = new WeakMap<Request, ApiSpan>();

  const tomar = (call: LlamadaSaliente): ApiSpan | undefined => {
    if (call.id !== undefined) {
      const span = porId.get(call.id);
      porId.delete(call.id);
      return span;
    }
    return porPeticion.get(call.request);
  };

  const avisar = (span: ApiSpan, mensaje: string, attrs: Record<string, unknown>): void => {
    if (!options.logger) {
      return;
    }
    // Con el span como contexto activo, el log queda ligado a la llamada que falló.
    context.with(trace.setSpan(context.active(), span), () => options.logger?.error(mensaje, attrs));
  };

  return {
    onRequest(call: LlamadaSaliente): Request {
      const url = new URL(call.request.url);
      const metodo = call.request.method.toUpperCase();
      const attrs: Attributes = {
        'http.request.method': metodo,
        'server.address': url.hostname,
        'server.port': puertoDe(url),
      };
      if (call.schemaPath) {
        attrs['url.template'] = call.schemaPath;
      }
      const span = trace
        .getTracer('@web-cuantica/keeper-sdk')
        .startSpan(`${metodo} ${call.schemaPath ?? url.hostname}`, { kind: SpanKind.CLIENT, attributes: attrs });
      propagation.inject(trace.setSpan(context.active(), span), call.request.headers, {
        set: (headers, key, value) => headers.set(key, value),
      });
      if (call.id !== undefined) {
        porId.set(call.id, span);
      } else {
        porPeticion.set(call.request, span);
      }
      return call.request;
    },

    onResponse(call: LlamadaSaliente & { response: Response }): undefined {
      const span = tomar(call);
      if (!span) {
        return undefined;
      }
      const status = call.response.status;
      span.setAttribute('http.response.status_code', status);
      if (status >= 400) {
        span.setAttribute('error.type', String(status));
        span.setStatus({ code: SpanStatusCode.ERROR });
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

    onError(call: LlamadaSaliente & { error: unknown }): undefined {
      const span = tomar(call);
      if (!span) {
        return undefined;
      }
      const tipo = tipoDeError(call.error);
      span.setAttribute('error.type', tipo);
      span.setStatus({ code: SpanStatusCode.ERROR, message: tipo });
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
