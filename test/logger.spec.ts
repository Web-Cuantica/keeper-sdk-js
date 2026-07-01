import { logs } from '@opentelemetry/api-logs';
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  InMemoryLogRecordExporter,
} from '@opentelemetry/sdk-logs';
import { KeeperLogger } from '../src/logger';
import { keeperRequestContext } from '../src/context';
import { REDACTED_VALUE } from '../src/redact';

describe('KeeperLogger', () => {
  let exporter: InMemoryLogRecordExporter;

  beforeEach(() => {
    exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider();
    provider.addLogRecordProcessor(new SimpleLogRecordProcessor(exporter));
    logs.setGlobalLoggerProvider(provider);
  });

  afterEach(() => {
    logs.disable();
  });

  function records() {
    return exporter.getFinishedLogRecords();
  }

  it('emite INFO con contexto y atributos de negocio (convención Nest)', () => {
    const logger = new KeeperLogger({ stdout: false });
    logger.log('Inspección iniciada', { inspection_id: 97125, eco: '12346A4' }, 'InspectionService');

    expect(records()).toHaveLength(1);
    const record = records()[0];
    expect(record.severityText).toBe('INFO');
    expect(record.body).toBe('Inspección iniciada');
    expect(record.attributes['logger.name']).toBe('InspectionService');
    expect(record.attributes['inspection_id']).toBe(97125);
    expect(record.attributes['eco']).toBe('12346A4');
  });

  it('mapea error(msg, stack, contexto) al estándar exception.*', () => {
    const logger = new KeeperLogger({ stdout: false });
    const stack = 'Error: boom\n    at fn (file.ts:1:1)';
    logger.error('Fallo al guardar daño', stack, 'InspectionService');

    const record = records()[0];
    expect(record.severityText).toBe('ERROR');
    expect(record.attributes['exception.stacktrace']).toBe(stack);
    expect(record.attributes['logger.name']).toBe('InspectionService');
  });

  it('extrae exception.type/message de un Error', () => {
    const logger = new KeeperLogger({ stdout: false });
    logger.error('Fallo al clonar pre-inspección', new Error('lock timeout'));

    const record = records()[0];
    expect(record.attributes['exception.type']).toBe('Error');
    expect(record.attributes['exception.message']).toBe('lock timeout');
    expect(record.attributes['exception.stacktrace']).toBeDefined();
  });

  it('redacta atributos sensibles', () => {
    const logger = new KeeperLogger({ stdout: false });
    logger.log('Login', { user: 'jorge', password: 'hunter2' });

    expect(records()[0].attributes['password']).toBe(REDACTED_VALUE);
    expect(records()[0].attributes['user']).toBe('jorge');
  });

  it('respeta el nivel mínimo (debug no se emite con nivel info)', () => {
    const logger = new KeeperLogger({ stdout: false, level: 'info' });
    logger.debug('detalle interno');
    logger.verbose('más detalle');
    expect(records()).toHaveLength(0);
    logger.warn('esto sí');
    expect(records()).toHaveLength(1);
    expect(records()[0].severityText).toBe('WARN');
  });

  it('agrega request_id cuando hay contexto de request activo', (done) => {
    const logger = new KeeperLogger({ stdout: false });
    const middleware = keeperRequestContext();
    middleware({ headers: { 'x-request-id': 'rid-777' } }, { setHeader: () => undefined }, () => {
      logger.log('dentro del request');
      expect(records()[0].attributes['request_id']).toBe('rid-777');
      done();
    });
  });
});
