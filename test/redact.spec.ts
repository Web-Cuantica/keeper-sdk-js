import { redactAttributes, REDACTED_VALUE, DEFAULT_REDACT_KEYS } from '../src/redact';

describe('redactAttributes', () => {
  it('redacta claves sensibles por subcadena, sin importar mayúsculas', () => {
    const out = redactAttributes({
      password: 'hunter2',
      userToken: 'abc',
      Authorization: 'Bearer xyz',
      api_key: 'k',
      inspection_id: 97125,
    });
    expect(out.password).toBe(REDACTED_VALUE);
    expect(out.userToken).toBe(REDACTED_VALUE);
    expect(out.Authorization).toBe(REDACTED_VALUE);
    expect(out.api_key).toBe(REDACTED_VALUE);
    expect(out.inspection_id).toBe(97125);
  });

  it('acepta claves adicionales a redactar', () => {
    const out = redactAttributes({ negocio_x: 'XXXX', eco: '12346A4' }, ['negocio_x']);
    expect(out.negocio_x).toBe(REDACTED_VALUE);
    expect(out.eco).toBe('12346A4');
  });

  it('redacta PII del dominio por defecto (email/curp/rfc/vin/ssn/tarjeta)', () => {
    const out = redactAttributes({
      email: 'a@b.com',
      curp: 'XEXX010101HNEXXXA4',
      rfc: 'XAXX010101000',
      vin: '1HGCM82633A004352',
      ssn: '123-45-6789',
      credit_card: '4111111111111111',
      card_number: '4111111111111111',
      cvv: '123',
      eco: '12346A4',
    });
    expect(out.email).toBe(REDACTED_VALUE);
    expect(out.curp).toBe(REDACTED_VALUE);
    expect(out.rfc).toBe(REDACTED_VALUE);
    expect(out.vin).toBe(REDACTED_VALUE);
    expect(out.ssn).toBe(REDACTED_VALUE);
    expect(out.credit_card).toBe(REDACTED_VALUE);
    expect(out.card_number).toBe(REDACTED_VALUE);
    expect(out.cvv).toBe(REDACTED_VALUE);
    expect(out.eco).toBe('12346A4');
  });

  it('redacta secretos anidados en objetos (recursivo)', () => {
    const out = redactAttributes({
      user: { name: 'jorge', password: 'hunter2' },
      order: { id: 5, meta: { authorization: 'Bearer z' } },
    });
    expect((out.user as Record<string, unknown>).name).toBe('jorge');
    expect((out.user as Record<string, unknown>).password).toBe(REDACTED_VALUE);
    const meta = (out.order as Record<string, unknown>).meta as Record<string, unknown>;
    expect(meta.authorization).toBe(REDACTED_VALUE);
    expect((out.order as Record<string, unknown>).id).toBe(5);
  });

  it('redacta secretos dentro de arreglos de objetos', () => {
    const out = redactAttributes({
      items: [
        { id: 1, token: 't1' },
        { id: 2, token: 't2' },
      ],
    });
    const items = out.items as Array<Record<string, unknown>>;
    expect(items[0].id).toBe(1);
    expect(items[0].token).toBe(REDACTED_VALUE);
    expect(items[1].token).toBe(REDACTED_VALUE);
  });

  it('censura el subárbol completo cuando la clave es sensible', () => {
    const out = redactAttributes({ authorization: { scheme: 'Bearer', value: 'x' } });
    expect(out.authorization).toBe(REDACTED_VALUE);
  });

  it('no altera tipos no-planos (Date se conserva para el aplanado posterior)', () => {
    const d = new Date('2026-07-20T00:00:00.000Z');
    const out = redactAttributes({ when: d, n: 3, ok: true, nada: null });
    expect(out.when).toBe(d);
    expect(out.n).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.nada).toBeNull();
  });

  it('DEFAULT_REDACT_KEYS incluye tanto secretos como PII', () => {
    for (const k of ['password', 'token', 'authorization', 'email', 'curp', 'rfc']) {
      expect(DEFAULT_REDACT_KEYS).toContain(k);
    }
  });
});
