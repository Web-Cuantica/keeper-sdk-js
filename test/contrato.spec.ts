import { SpanKind } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  ContratoActivo,
  ExportadorDeLogsConContrato,
  ExportadorDeSpansConContrato,
  reiniciarViolaciones,
  setContrato,
  violaciones,
  type KeeperContrato,
} from '../src/contrato';
import { setHashConfig } from '../src/hash';

const contrato: KeeperContrato = {
  atributos: {
    'pld.canal': 'operativo',
    'pld.client_id': 'identificador',
    'http.response.status_code': 'operativo',
  },
};

describe('ContratoActivo', () => {
  let aviso: jest.SpyInstance;

  beforeEach(() => {
    aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setHashConfig('');
  });

  afterEach(() => {
    aviso.mockRestore();
    setContrato(undefined);
  });

  it('descarta lo no declarado, lo cuenta y avisa una sola vez por clave', () => {
    const activo = new ContratoActivo(contrato);
    for (let i = 0; i < 3; i += 1) {
      expect(activo.filtrar({ 'pld.canal': 'alta_portal', nombre: 'Mariana' }, 'span')).toEqual({
        'pld.canal': 'alta_portal',
      });
    }
    expect(activo.violaciones()).toEqual([{ clave: 'nombre', senal: 'span', veces: 3 }]);
    expect(aviso).toHaveBeenCalledTimes(1);
    // El aviso nombra la clave, nunca su valor.
    expect(String(aviso.mock.calls[0][0])).toContain('nombre');
    expect(String(aviso.mock.calls[0][0])).not.toContain('Mariana');
  });

  it('en modo reportar deja pasar lo no declarado, pero lo cuenta', () => {
    const activo = new ContratoActivo({ ...contrato, modo: 'reportar' });
    expect(activo.filtrar({ extra: 1 }, 'log')).toEqual({ extra: 1 });
    expect(activo.violaciones()).toEqual([{ clave: 'extra', senal: 'log', veces: 1 }]);
  });

  it('un identificador sale con hash si hay pepper y censurado si no', () => {
    const activo = new ContratoActivo(contrato);
    expect(activo.filtrar({ 'pld.client_id': 'CLI-1' }, 'span')).toEqual({
      'pld.client_id': '[REDACTADO]',
    });
    setHashConfig('pepper-de-prueba');
    const conHash = activo.filtrar({ 'pld.client_id': 'CLI-1' }, 'span')['pld.client_id'];
    expect(String(conHash)).toMatch(/^h1:[0-9a-f]{64}$/);
    expect(activo.filtrar({ 'pld.client_id': '' }, 'span')).toEqual({ 'pld.client_id': '' });
  });

  it('sin atributos devuelve un objeto vacío', () => {
    expect(new ContratoActivo(contrato).filtrar(undefined, 'span')).toEqual({});
  });

  it('las violaciones del contrato del proceso se consultan y se reinician', () => {
    expect(violaciones()).toEqual([]);
    const activo = setContrato(contrato);
    activo?.filtrar({ suelto: true }, 'evento');
    expect(violaciones()).toEqual([{ clave: 'suelto', senal: 'evento', veces: 1 }]);
    reiniciarViolaciones();
    expect(violaciones()).toEqual([]);
  });
});

describe('ExportadorDeSpansConContrato', () => {
  let aviso: jest.SpyInstance;

  beforeEach(() => {
    aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    setHashConfig('');
  });

  afterEach(() => aviso.mockRestore());

  function proveedor(exportador: ExportadorDeSpansConContrato): BasicTracerProvider {
    const tp = new BasicTracerProvider();
    tp.addSpanProcessor(new SimpleSpanProcessor(exportador));
    return tp;
  }

  it('filtra los atributos del span y los de sus eventos, y conserva lo demás', async () => {
    const memoria = new InMemorySpanExporter();
    const tp = proveedor(new ExportadorDeSpansConContrato(memoria, new ContratoActivo(contrato)));
    const span = tp.getTracer('prueba').startSpan('evaluar', {
      kind: SpanKind.SERVER,
      attributes: { 'pld.canal': 'alta_api', curp: 'TEQM900215MDFLRR09' },
    });
    span.addEvent('coincidencia', { 'pld.canal': 'lpb', nombre: 'Mariana Itzel' });
    span.end();
    await tp.forceFlush();

    const [exportado] = memoria.getFinishedSpans();
    expect(exportado.name).toBe('evaluar');
    expect(exportado.kind).toBe(SpanKind.SERVER);
    expect(exportado.spanContext().traceId).toBe(span.spanContext().traceId);
    expect(exportado.attributes).toEqual({ 'pld.canal': 'alta_api' });
    expect(exportado.events).toHaveLength(1);
    expect(exportado.events[0].name).toBe('coincidencia');
    expect(exportado.events[0].attributes).toEqual({ 'pld.canal': 'lpb' });
  });

  it('descarta los spans vetados y sanea el nombre', async () => {
    const memoria = new InMemorySpanExporter();
    const tp = proveedor(
      new ExportadorDeSpansConContrato(memoria, undefined, {
        descartarSpan: (s) => s.attributes['next.span_type'] === 'AppRender.fetch',
        nombre: (s) => s.name.split('?')[0],
      }),
    );
    const tracer = tp.getTracer('prueba');
    tracer
      .startSpan('fetch GET http://motor/api?search=Mariana', {
        attributes: { 'next.span_type': 'AppRender.fetch' },
      })
      .end();
    tracer.startSpan('GET /clientes?tab=2', { attributes: { libre: 'sin contrato sale todo' } }).end();
    await tp.forceFlush();

    const exportados = memoria.getFinishedSpans();
    expect(exportados.map((s) => s.name)).toEqual(['GET /clientes']);
    expect(exportados[0].attributes).toEqual({ libre: 'sin contrato sale todo' });
  });

  it('sin contrato ni opciones entrega los spans intactos y cierra el exportador', async () => {
    const memoria = new InMemorySpanExporter();
    const exportador = new ExportadorDeSpansConContrato(memoria, undefined);
    const tp = proveedor(exportador);
    tp.getTracer('prueba').startSpan('intacto', { attributes: { a: 1 } }).end();
    await exportador.forceFlush();
    expect(memoria.getFinishedSpans()[0].attributes).toEqual({ a: 1 });
    await exportador.shutdown();
  });
});

describe('ExportadorDeLogsConContrato', () => {
  it('filtra los atributos de cada registro y conserva el cuerpo', async () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const memoria = new InMemoryLogRecordExporter();
    const exportador = new ExportadorDeLogsConContrato(memoria, new ContratoActivo(contrato));
    const lp = new LoggerProvider();
    lp.addLogRecordProcessor(new SimpleLogRecordProcessor(exportador));
    lp.getLogger('prueba').emit({
      severityNumber: SeverityNumber.INFO,
      body: 'Solicitud evaluada',
      attributes: { 'pld.canal': 'alta_portal', rfc: 'TEQM900215AB1' },
    });
    await lp.forceFlush();

    const [registro] = memoria.getFinishedLogRecords();
    expect(registro.body).toBe('Solicitud evaluada');
    expect(registro.attributes).toEqual({ 'pld.canal': 'alta_portal' });
    await exportador.shutdown();
    aviso.mockRestore();
  });

  it('sin contrato entrega los registros intactos', async () => {
    const memoria = new InMemoryLogRecordExporter();
    const lp = new LoggerProvider();
    lp.addLogRecordProcessor(
      new SimpleLogRecordProcessor(new ExportadorDeLogsConContrato(memoria, undefined)),
    );
    lp.getLogger('prueba').emit({ body: 'libre', attributes: { a: 1 } });
    await lp.forceFlush();
    expect(memoria.getFinishedLogRecords()[0].attributes).toEqual({ a: 1 });
  });
});
