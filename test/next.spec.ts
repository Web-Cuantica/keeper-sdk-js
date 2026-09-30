import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  annotateRequest,
  keeperFetchMiddleware,
  KeeperLogger,
  registerKeeper,
  violaciones,
  type KeeperContrato,
  type KeeperNextHandle,
} from '../src/next';

// El contrato de un portal: lo que Next y el SDK emiten, más el rol de la persona.
const contrato: KeeperContrato = {
  atributos: {
    'http.method': 'operativo',
    'http.route': 'operativo',
    'next.route': 'operativo',
    'next.span_type': 'operativo',
    'http.request.method': 'operativo',
    'http.response.status_code': 'operativo',
    'server.address': 'operativo',
    'server.port': 'operativo',
    'url.template': 'operativo',
    'error.type': 'operativo',
    'user.roles': 'operativo',
    sample_rate: 'operativo',
  },
};

describe('registerKeeper (Next.js)', () => {
  let spans: InMemorySpanExporter;
  let registros: InMemoryLogRecordExporter;
  let keeper: KeeperNextHandle;
  let aviso: jest.SpyInstance;

  beforeEach(() => {
    aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    spans = new InMemorySpanExporter();
    registros = new InMemoryLogRecordExporter();
    keeper = registerKeeper({
      serviceName: 'portal-de-prueba',
      contrato,
      spanExporter: spans,
      logExporter: registros,
    });
  });

  afterEach(async () => {
    await keeper.shutdown();
    aviso.mockRestore();
  });

  // Así abre Next su span raíz: con el método y la URL cruda, query incluida.
  function peticion<T>(url: string, cuerpo: () => T): T {
    const metodo = 'GET';
    return trace.getTracer('next.js').startActiveSpan(
      `${metodo} ${url}`,
      { kind: SpanKind.SERVER, attributes: { 'http.method': metodo, 'http.target': url } },
      (raiz) => {
        try {
          return cuerpo();
        } finally {
          raiz.end();
        }
      },
    );
  }

  function exportado(nombre: string) {
    return spans.getFinishedSpans().find((s) => s.name === nombre);
  }

  it('registrar dos veces devuelve el mismo registro', () => {
    expect(registerKeeper({ serviceName: 'otro' })).toBe(keeper);
  });

  it('la petición sale con su ruta y sin query; lo que no está en el contrato no sale', async () => {
    peticion('/clients/CLI-1?tab=operaciones', () => undefined);
    await keeper.forceFlush();

    const raiz = exportado('GET /clients/CLI-1');
    expect(raiz).toBeDefined();
    expect(raiz?.attributes).toEqual({ 'http.method': 'GET', sample_rate: 1 });
    expect(violaciones()).toEqual([{ clave: 'http.target', senal: 'span', veces: 1 }]);
    expect(raiz?.resource.attributes['service.name']).toBe('portal-de-prueba');
  });

  it('los estáticos y los health checks no abren traza, ni lo que cuelga de ellos', async () => {
    for (const url of ['/_next/static/chunks/app.js', '/api/health', '/favicon.ico?v=2']) {
      peticion(url, () => trace.getTracer('next.js').startSpan('render').end());
    }
    await keeper.forceFlush();
    // El favicon no está en la lista por defecto: es la única que queda.
    expect(spans.getFinishedSpans().map((s) => s.name)).toEqual(['render', 'GET /favicon.ico']);
  });

  it('el span de fetch de Next, que lleva la URL completa, nunca sale', async () => {
    peticion('/buscar', () => {
      trace
        .getTracer('next.js')
        .startSpan('fetch GET http://motor:8080/api/v1/evaluations?search=Mariana Itzel', {
          attributes: {
            'next.span_type': 'AppRender.fetch',
            'http.url': 'http://motor:8080/api/v1/evaluations?search=Mariana Itzel',
          },
        })
        .end();
    });
    await keeper.forceFlush();

    expect(spans.getFinishedSpans().map((s) => s.name)).toEqual(['GET /buscar']);
    expect(JSON.stringify(spans.getFinishedSpans())).not.toContain('Mariana');
  });

  it('annotateRequest anota la petición aunque el span activo sea uno interno', async () => {
    peticion('/pending', () => {
      trace.getTracer('next.js').startActiveSpan('render route (app) /pending', (interno) => {
        annotateRequest({ 'user.roles': 'oficial', password: 'no-debe-salir' });
        interno.end();
      });
    });
    annotateRequest({ 'user.roles': 'fuera de una petición no hace nada' });
    await keeper.forceFlush();

    expect(exportado('GET /pending')?.attributes['user.roles']).toBe('oficial');
    expect(exportado('render route (app) /pending')?.attributes['user.roles']).toBeUndefined();
    expect(JSON.stringify(spans.getFinishedSpans())).not.toContain('no-debe-salir');
  });

  describe('keeperFetchMiddleware', () => {
    function llamada(url: string, schemaPath?: string, id?: string) {
      return { request: new Request(url, { method: 'get' }), schemaPath, id };
    }

    it('abre un span de cliente con la ruta del contrato y propaga el contexto', async () => {
      const middleware = keeperFetchMiddleware();
      let raizId = '';
      peticion('/clients/CLI-1', () => {
        raizId = trace.getActiveSpan()?.spanContext().spanId ?? '';
        const call = llamada('http://motor:8080/api/v1/clients/CLI-1?search=Mariana', '/api/v1/clients/{clientId}', 'a1');
        const saliente = middleware.onRequest(call);
        expect(saliente.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
        middleware.onResponse({ ...call, response: new Response(null, { status: 200 }) });
      });
      await keeper.forceFlush();

      const cliente = exportado('GET /api/v1/clients/{clientId}');
      expect(cliente?.kind).toBe(SpanKind.CLIENT);
      expect(cliente?.parentSpanId).toBe(raizId);
      expect(cliente?.attributes).toEqual({
        'http.request.method': 'GET',
        'server.address': 'motor',
        'server.port': 8080,
        'url.template': '/api/v1/clients/{clientId}',
        'http.response.status_code': 200,
        sample_rate: 1,
      });
      expect(JSON.stringify(spans.getFinishedSpans())).not.toContain('Mariana');
    });

    it('el traceparent lleva el span de la llamada, para que el servicio cuelgue de ella', async () => {
      const middleware = keeperFetchMiddleware();
      const call = llamada('https://motor.ejemplo.mx/api/v1/alerts', '/api/v1/alerts');
      const saliente = middleware.onRequest(call);
      middleware.onResponse({ ...call, response: new Response(null, { status: 404 }) });
      await keeper.forceFlush();

      const cliente = exportado('GET /api/v1/alerts');
      expect(saliente.headers.get('traceparent')).toContain(cliente?.spanContext().spanId);
      expect(cliente?.attributes['server.port']).toBe(443);
      expect(cliente?.attributes['error.type']).toBe('404');
      expect(cliente?.status.code).toBe(SpanStatusCode.ERROR);
      // Un 4xx es asunto de quien llama: no deja log.
      expect(registros.getFinishedLogRecords()).toHaveLength(0);
    });

    it('una respuesta 5xx deja un log ligado a la llamada', async () => {
      const middleware = keeperFetchMiddleware({ logger: new KeeperLogger({ stdout: false }) });
      const call = llamada('http://motor/api/v1/evaluations', '/api/v1/evaluations', 'b2');
      middleware.onRequest(call);
      middleware.onResponse({ ...call, response: new Response(null, { status: 503 }) });
      await keeper.forceFlush();

      const [registro] = registros.getFinishedLogRecords();
      const cliente = exportado('GET /api/v1/evaluations');
      expect(cliente?.attributes['server.port']).toBe(80);
      expect(registro.body).toBe('El servicio llamado respondió con error');
      expect(registro.spanContext?.spanId).toBe(cliente?.spanContext().spanId);
      expect(registro.attributes).toEqual({
        'http.request.method': 'GET',
        'url.template': '/api/v1/evaluations',
        'http.response.status_code': 503,
      });
    });

    it('un error de red se clasifica sin repetir su mensaje', async () => {
      const middleware = keeperFetchMiddleware({ logger: new KeeperLogger({ stdout: false }) });
      const call = llamada('http://motor:8080/api/v1/alerts');
      middleware.onRequest(call);
      const error = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 10.0.0.7:8080' },
      });
      middleware.onError({ ...call, error });
      await keeper.forceFlush();

      const cliente = exportado('GET motor');
      expect(cliente?.attributes['error.type']).toBe('ECONNREFUSED');
      expect(cliente?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'ECONNREFUSED' });
      expect(registros.getFinishedLogRecords()[0].body).toBe('No se pudo llamar al servicio');
      expect(JSON.stringify(spans.getFinishedSpans())).not.toContain('10.0.0.7');
    });

    it('sin logger no avisa, y un error sin causa toma su nombre', async () => {
      const middleware = keeperFetchMiddleware();
      const call = llamada('http://motor/api/v1/alerts', '/api/v1/alerts', 'c3');
      middleware.onRequest(call);
      middleware.onError({ ...call, error: new RangeError('x') });
      const otra = llamada('http://motor/api/v1/lists', '/api/v1/lists', 'c4');
      middleware.onRequest(otra);
      middleware.onError({ ...otra, error: 'cadena suelta' });
      await keeper.forceFlush();

      expect(exportado('GET /api/v1/alerts')?.attributes['error.type']).toBe('RangeError');
      expect(exportado('GET /api/v1/lists')?.attributes['error.type']).toBe('error');
      expect(registros.getFinishedLogRecords()).toHaveLength(0);
    });

    it('una respuesta o un error sin llamada previa no rompen', () => {
      const middleware = keeperFetchMiddleware();
      const call = llamada('http://motor/api/v1/alerts', '/api/v1/alerts', 'z9');
      expect(middleware.onResponse({ ...call, response: new Response(null) })).toBeUndefined();
      expect(middleware.onError({ ...call, error: new Error('x') })).toBeUndefined();
    });
  });

  it('shutdown deja el proceso sin proveedor: se puede registrar otra vez', async () => {
    await keeper.shutdown();
    expect(context.active()).toBeDefined();
    // Los exportadores en memoria no reciben nada después de cerrarse: se estrenan otros.
    spans = new InMemorySpanExporter();
    registros = new InMemoryLogRecordExporter();
    keeper = registerKeeper({ spanExporter: spans, logExporter: registros });
    peticion('/otra', () => undefined);
    await keeper.forceFlush();
    // Sin contrato sale todo, incluido lo que antes se descartaba.
    expect(exportado('GET /otra')?.attributes['http.target']).toBe('/otra');
  });
});

describe('registerKeeper sin endpoint', () => {
  it('no exporta, pero propaga el contexto y aplica el contrato', async () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const previo = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const keeper = registerKeeper({ contrato: { atributos: {} }, samplingRatio: 1 });
    const middleware = keeperFetchMiddleware();
    const call = { request: new Request('http://motor/api/v1/alerts'), schemaPath: '/api/v1/alerts', id: 'n1' };
    expect(middleware.onRequest(call).headers.get('traceparent')).toBeTruthy();
    middleware.onResponse({ ...call, response: new Response(null) });
    await keeper.forceFlush();
    expect(violaciones().length).toBeGreaterThan(0);
    await keeper.shutdown();
    if (previo !== undefined) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = previo;
    }
    aviso.mockRestore();
  });
});
