import { keeperRequestContext, getRequestId, getClient } from '../src/context';

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

  it('captura client.* desde IP y User-Agent', (done) => {
    const middleware = keeperRequestContext();
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    middleware(
      {
        headers: {
          'user-agent': ua,
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
        },
      },
      { setHeader: () => undefined },
      () => {
        const c = getClient();
        expect(c?.address).toBe('203.0.113.9');
        expect(c?.browser).toBe('Chrome');
        expect(c?.os).toBe('Windows');
        expect(c?.deviceType).toBe('desktop');
        done();
      },
    );
  });

  it('fuera de un request no hay request_id ni client', () => {
    expect(getRequestId()).toBeUndefined();
    expect(getClient()).toBeUndefined();
  });
});
