import { parseClient, clientAttributes } from '../src/client';

describe('parseClient', () => {
  it('sin UA solo conserva la IP', () => {
    expect(parseClient('1.2.3.4', '')).toEqual({
      address: '1.2.3.4',
      userAgent: '',
    });
  });

  it('detecta Chrome/Windows/desktop', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const c = parseClient('10.0.0.1', ua);
    expect(c.browser).toBe('Chrome');
    expect(c.os).toBe('Windows');
    expect(c.deviceType).toBe('desktop');
    expect(c.userAgent).toBe(ua);
  });

  it('detecta bot', () => {
    const c = parseClient('1.1.1.1', 'Googlebot/2.1 (+http://www.google.com/bot.html)');
    expect(c.deviceType).toBe('bot');
  });

  it('detecta mobile iOS', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const c = parseClient('::1', ua);
    expect(c.deviceType).toBe('mobile');
    expect(c.os).toBe('iOS');
    expect(c.browser).toBe('Safari');
  });
});

describe('clientAttributes', () => {
  it('omite campos vacíos y usa nombres semconv', () => {
    expect(
      clientAttributes({
        address: '1.2.3.4',
        userAgent: 'UA',
        browser: 'Chrome',
        os: 'Windows',
        deviceType: 'desktop',
      }),
    ).toEqual({
      'client.address': '1.2.3.4',
      'client.browser': 'Chrome',
      'client.os': 'Windows',
      'client.device.type': 'desktop',
      'user_agent.original': 'UA',
    });
  });

  it('no emite claves vacías', () => {
    expect(clientAttributes({ address: '', userAgent: '' })).toEqual({});
  });
});
