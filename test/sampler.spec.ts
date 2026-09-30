import {
  resolveSampleRatio,
  sampleRateForRatio,
  SampleRateSpanProcessor,
  buildSampler,
} from '../src/index';
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  ParentBasedSampler,
} from '@opentelemetry/sdk-trace-base';

describe('resolveSampleRatio', () => {
  it('la opción gana sobre el entorno y se acota a [0,1]', () => {
    expect(resolveSampleRatio({ samplingRatio: 0.25 }, { OTEL_TRACES_SAMPLER: 'always_off' })).toBe(
      0.25,
    );
    expect(resolveSampleRatio({ samplingRatio: 5 }, {})).toBe(1);
    expect(resolveSampleRatio({ samplingRatio: -1 }, {})).toBe(0);
  });

  it('deriva la proporción del entorno OTEL_TRACES_SAMPLER(+_ARG)', () => {
    expect(resolveSampleRatio({}, {})).toBe(1);
    expect(resolveSampleRatio({}, { OTEL_TRACES_SAMPLER: 'always_on' })).toBe(1);
    expect(resolveSampleRatio({}, { OTEL_TRACES_SAMPLER: 'always_off' })).toBe(0);
    expect(
      resolveSampleRatio({}, { OTEL_TRACES_SAMPLER: 'traceidratio', OTEL_TRACES_SAMPLER_ARG: '0.2' }),
    ).toBe(0.2);
    expect(
      resolveSampleRatio(
        {},
        { OTEL_TRACES_SAMPLER: 'parentbased_traceidratio', OTEL_TRACES_SAMPLER_ARG: '0.05' },
      ),
    ).toBe(0.05);
  });

  it('arg inválido o sampler desconocido => sin muestreo (1)', () => {
    expect(
      resolveSampleRatio({}, { OTEL_TRACES_SAMPLER: 'traceidratio', OTEL_TRACES_SAMPLER_ARG: 'x' }),
    ).toBe(1);
    expect(resolveSampleRatio({}, { OTEL_TRACES_SAMPLER: 'raro' })).toBe(1);
  });
});

describe('sampleRateForRatio', () => {
  it('calcula cuántos eventos representa cada uno', () => {
    expect(sampleRateForRatio(1)).toBe(1);
    expect(sampleRateForRatio(0.5)).toBe(2);
    expect(sampleRateForRatio(0.1)).toBe(10);
    expect(sampleRateForRatio(0)).toBe(0);
    expect(sampleRateForRatio(2)).toBe(1);
  });
});

describe('buildSampler', () => {
  it('elige el sampler según la proporción', () => {
    expect(buildSampler(0)).toBeInstanceOf(AlwaysOffSampler);
    expect(buildSampler(1)).toBeInstanceOf(AlwaysOnSampler);
    expect(buildSampler(0.1)).toBeInstanceOf(ParentBasedSampler);
  });
});

describe('SampleRateSpanProcessor', () => {
  it('estampa sample_rate en el span al iniciarse', () => {
    const attrs: Record<string, unknown> = {};
    const fakeSpan = {
      setAttribute: (k: string, v: unknown) => {
        attrs[k] = v;
      },
    } as unknown as Parameters<SampleRateSpanProcessor['onStart']>[0];

    new SampleRateSpanProcessor(10).onStart(fakeSpan);
    expect(attrs['sample_rate']).toBe(10);
  });
});
