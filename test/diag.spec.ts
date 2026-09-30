import { formatOtelDiagError, KeeperDiagLogger } from '../src/index';

describe('formatOtelDiagError', () => {
  it('prefija el mensaje para que sea accionable', () => {
    expect(formatOtelDiagError('traces export failed')).toBe(
      'error interno de OpenTelemetry: traces export failed',
    );
  });

  it('incluye args extra', () => {
    expect(formatOtelDiagError('boom', 500, 'timeout')).toBe(
      'error interno de OpenTelemetry: boom 500 timeout',
    );
  });
});

describe('KeeperDiagLogger', () => {
  it('error escribe a console.error con el formato Keeper', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      new KeeperDiagLogger().error('lote rechazado');
      expect(spy).toHaveBeenCalledWith('error interno de OpenTelemetry: lote rechazado');
    } finally {
      spy.mockRestore();
    }
  });

  it('info/debug/verbose son silenciosos', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const d = new KeeperDiagLogger();
      d.info('x');
      d.debug('y');
      d.verbose('z');
      expect(log).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});
