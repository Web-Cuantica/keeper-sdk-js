import { redactAttributes, REDACTED_VALUE } from '../src/redact';

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
    const out = redactAttributes({ curp: 'XXXX', eco: '12346A4' }, ['curp']);
    expect(out.curp).toBe(REDACTED_VALUE);
    expect(out.eco).toBe('12346A4');
  });
});
