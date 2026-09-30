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

  it('no filtra secretos anidados al aplanar el objeto', () => {
    const logger = new KeeperLogger({ stdout: false });
    logger.log('Alta', { profile: { name: 'jorge', password: 'hunter2' } });

    const serialized = String(records()[0].attributes['profile']);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain(REDACTED_VALUE);
    expect(serialized).toContain('jorge');
  });

  it('redacta PII de dominio (email/curp) end-to-end', () => {
    const logger = new KeeperLogger({ stdout: false });
    logger.log('Registro', { email: 'a@b.com', curp: 'XEXX010101HNEXXXA4', usr_id: 4471 });

    const attrs = records()[0].attributes;
    expect(attrs['email']).toBe(REDACTED_VALUE);
    expect(attrs['curp']).toBe(REDACTED_VALUE);
    expect(attrs['usr_id']).toBe(4471);
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

  it('acepta un Error como mensaje y lo mapea a exception.*', () => {
    const logger = new KeeperLogger({ stdout: false });
    logger.error(new Error('boom'));
    const record = records()[0];
    expect(record.body).toBe('boom');
    expect(record.attributes['exception.type']).toBe('Error');
    expect(record.attributes['exception.message']).toBe('boom');
  });

  it('serializa un objeto como body cuando el mensaje es objeto', () => {
    const logger = new KeeperLogger({ stdout: false });
    logger.log({ evento: 'x' });
    expect(records()[0].body).toBe(JSON.stringify({ evento: 'x' }));
  });

  it('espeja a stdout cuando stdout=true', () => {
    const spyLog = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const spyErr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const spyWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const logger = new KeeperLogger({ stdout: true });
      logger.log('info a stdout', { inspection_id: 1 }, 'Ctx');
      logger.warn('ojo');
      logger.error('feo', new Error('x'));
      expect(spyLog).toHaveBeenCalled();
      expect(spyWarn).toHaveBeenCalled();
      expect(spyErr).toHaveBeenCalled();
    } finally {
      spyLog.mockRestore();
      spyErr.mockRestore();
      spyWarn.mockRestore();
    }
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

  it('inyecta client.* desde el contexto del request', (done) => {
    const logger = new KeeperLogger({ stdout: false });
    const middleware = keeperRequestContext();
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    middleware(
      {
        ip: '198.51.100.2',
        headers: { 'user-agent': ua, 'x-request-id': 'rid-client' },
      },
      { setHeader: () => undefined },
      () => {
        logger.log('con origen');
        const attrs = records()[0].attributes;
        expect(attrs['client.address']).toBe('198.51.100.2');
        expect(attrs['client.browser']).toBe('Chrome');
        expect(attrs['client.os']).toBe('Windows');
        expect(attrs['client.device.type']).toBe('desktop');
        expect(attrs['user_agent.original']).toBe(ua);
        done();
      },
    );
  });
});
