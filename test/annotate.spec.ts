import {
  annotateSpan,
  annotateRequest,
  annotateUser,
  annotateTenant,
  annotateOutcome,
} from '../src/annotate';
import { REDACTED_VALUE } from '../src/redact';
import type { Span } from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';

function fakeSpan(): { span: Span; attrs: Record<string, unknown> } {
  const attrs: Record<string, unknown> = {};
  const span = {
    setAttribute(key: string, value: unknown) {
      attrs[key] = value;
      return span;
    },
  } as unknown as Span;
  return { span, attrs };
}

describe('annotateSpan', () => {
  it('agrega atributos de negocio al span', () => {
    const { span, attrs } = fakeSpan();
    annotateSpan(span, { inspection_id: 97125, eco: '12346A4', activo: true });
    expect(attrs.inspection_id).toBe(97125);
    expect(attrs.eco).toBe('12346A4');
    expect(attrs.activo).toBe(true);
  });

  it('redacta secretos y PII antes de tocar el span', () => {
    const { span, attrs } = fakeSpan();
    annotateSpan(span, { order_id: 5, password: 'x', email: 'a@b.com' });
    expect(attrs.order_id).toBe(5);
    expect(attrs.password).toBe(REDACTED_VALUE);
    expect(attrs.email).toBe(REDACTED_VALUE);
  });

  it('aplana objetos anidados a JSON (redactados)', () => {
    const { span, attrs } = fakeSpan();
    annotateSpan(span, { meta: { ok: true, token: 'secreto' } });
    const serialized = String(attrs.meta);
    expect(serialized).toContain(REDACTED_VALUE);
    expect(serialized).not.toContain('secreto');
  });

  it('acepta claves extra de redacción', () => {
    const { span, attrs } = fakeSpan();
    annotateSpan(span, { folio_interno: 'X' }, ['folio_interno']);
    expect(attrs.folio_interno).toBe(REDACTED_VALUE);
  });
});

describe('annotateRequest', () => {
  it('es no-op seguro cuando no hay span activo', () => {
    expect(() => annotateRequest({ order_id: 1 })).not.toThrow();
  });
});

describe('annotateUser / annotateTenant / annotateOutcome', () => {
  it('anotan enduser.id, tenant.id y business.success en el span activo', () => {
    const { span, attrs } = fakeSpan();
    const prev = trace.getActiveSpan;
    (trace as { getActiveSpan: () => Span | undefined }).getActiveSpan = () => span;
    try {
      annotateUser('u-4471');
      annotateTenant('t-9');
      annotateOutcome(false, 'validation', 'folio inválido');
      annotateUser('');
      annotateTenant('');
    } finally {
      (trace as { getActiveSpan: typeof prev }).getActiveSpan = prev;
    }
    expect(attrs['enduser.id']).toBe('u-4471');
    expect(attrs['tenant.id']).toBe('t-9');
    expect(attrs['business.success']).toBe(false);
    expect(attrs['error.kind']).toBe('validation');
    expect(attrs['error.message']).toBe('folio inválido');
  });

  it('annotateOutcome en éxito solo marca business.success', () => {
    const { span, attrs } = fakeSpan();
    const prev = trace.getActiveSpan;
    (trace as { getActiveSpan: () => Span | undefined }).getActiveSpan = () => span;
    try {
      annotateOutcome(true);
    } finally {
      (trace as { getActiveSpan: typeof prev }).getActiveSpan = prev;
    }
    expect(attrs['business.success']).toBe(true);
    expect(attrs['error.kind']).toBeUndefined();
  });
});
