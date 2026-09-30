import { safeUTF8 } from '../src/sanitize';

describe('safeUTF8', () => {
  it('deja intacto ASCII y UTF-8 válido', () => {
    expect(safeUTF8('ok')).toBe('ok');
    expect(safeUTF8('/api/v1/fleet')).toBe('/api/v1/fleet');
    expect(safeUTF8('café ñandú')).toBe('café ñandú');
    expect(safeUTF8('')).toBe('');
  });

  it('elimina surrogates huérfanos (high sin low / low sin high)', () => {
    const highAlone = 'a\uD800b';
    const lowAlone = 'a\uDCFFb';
    expect(safeUTF8(highAlone)).toBe('ab');
    expect(safeUTF8(lowAlone)).toBe('ab');
  });

  it('conserva pares surrogate válidos (emoji)', () => {
    expect(safeUTF8('hola 😀')).toBe('hola 😀');
  });
});
