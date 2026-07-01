import { keeperRequestContext, getRequestId } from '../src/context';

describe('keeperRequestContext', () => {
  it('reutiliza el x-request-id entrante y lo expone dentro del request', (done) => {
    const middleware = keeperRequestContext();
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    };
    middleware({ headers: { 'x-request-id': 'rid-123' } }, res, () => {
      expect(getRequestId()).toBe('rid-123');
      expect(headers['x-request-id']).toBe('rid-123');
      done();
    });
  });

  it('genera un UUID cuando no viene header', (done) => {
    const middleware = keeperRequestContext();
    middleware({ headers: {} }, { setHeader: () => undefined }, () => {
      expect(getRequestId()).toMatch(/^[0-9a-f-]{36}$/);
      done();
    });
  });

  it('fuera de un request no hay request_id', () => {
    expect(getRequestId()).toBeUndefined();
  });
});
