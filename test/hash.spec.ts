import {
  DEFAULT_HASH_KEYS,
  hashID,
  hashIDWithPepper,
  isHashed,
  normalizeID,
  setHashConfig,
} from '../src/hash';
import { redactAttributes, REDACTED_VALUE } from '../src/redact';

describe('normalizeID / hashIDWithPepper', () => {
  it('normaliza trim + minúsculas', () => {
    expect(normalizeID('  A@B.COM  ')).toBe('a@b.com');
  });

  it('es consistente ante normalización', () => {
    const pepper = 'org-pepper';
    const a = hashIDWithPepper(pepper, 'a@b.com');
    const b = hashIDWithPepper(pepper, '  A@B.COM ');
    expect(isHashed(a)).toBe(true);
    expect(a).toBe(b);
    expect(hashIDWithPepper('otro', 'a@b.com')).not.toBe(a);
  });

  it('sin pepper o valor vacío devuelve vacío', () => {
    expect(hashIDWithPepper('', 'a@b.com')).toBe('');
    expect(hashIDWithPepper('p', '')).toBe('');
  });
});

describe('hashID global', () => {
  afterEach(() => setHashConfig('', DEFAULT_HASH_KEYS));

  it('usa el pepper global', () => {
    setHashConfig('pepper-test', DEFAULT_HASH_KEYS);
    expect(hashID('curp-demo')).toBe(hashIDWithPepper('pepper-test', 'curp-demo'));
    setHashConfig('', DEFAULT_HASH_KEYS);
    expect(hashID('curp-demo')).toBe('');
  });
});

describe('redactAttributes + hash', () => {
  afterEach(() => setHashConfig('', DEFAULT_HASH_KEYS));

  it('hashea email/curp con pepper y censura password', () => {
    const pepper = 'p-org';
    const out = redactAttributes(
      {
        email: 'a@b.com',
        curp: 'XEXX010101HNEXXXA4',
        password: 'hunter2',
        usr_id: 4471,
      },
      [],
      { pepper, hashKeys: DEFAULT_HASH_KEYS },
    );
    expect(out.email).toBe(hashIDWithPepper(pepper, 'a@b.com'));
    expect(isHashed(String(out.curp))).toBe(true);
    expect(out.password).toBe(REDACTED_VALUE);
    expect(out.usr_id).toBe(4471);
  });

  it('sin pepper censura PII con [REDACTADO]', () => {
    const out = redactAttributes({ email: 'a@b.com' }, [], { pepper: '', hashKeys: DEFAULT_HASH_KEYS });
    expect(out.email).toBe(REDACTED_VALUE);
  });

  it('hashea email anidado y censura token anidado', () => {
    const pepper = 'p';
    const out = redactAttributes(
      { user: { email: 'a@b.com', token: 'secreto' } },
      [],
      { pepper, hashKeys: DEFAULT_HASH_KEYS },
    );
    const user = out.user as Record<string, unknown>;
    expect(user.email).toBe(hashIDWithPepper(pepper, 'a@b.com'));
    expect(user.token).toBe(REDACTED_VALUE);
  });
});

describe('DEFAULT_HASH_KEYS', () => {
  it('incluye identificadores y no secretos', () => {
    for (const k of ['email', 'curp', 'rfc', 'vin', 'ssn']) {
      expect(DEFAULT_HASH_KEYS).toContain(k);
    }
    for (const k of ['password', 'token', 'authorization']) {
      expect(DEFAULT_HASH_KEYS).not.toContain(k);
    }
  });
});
