import { buildResourceAttributes } from '../src/index';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const S = SemanticResourceAttributes;

describe('buildResourceAttributes', () => {
  it('incluye el contexto de deploy base (servicio/versión/ambiente/host/instancia)', () => {
    const attrs = buildResourceAttributes(
      { serviceName: 'kinetiq-api', serviceVersion: '1.4.2', environment: 'production' },
      {},
    );
    expect(attrs[S.SERVICE_NAME]).toBe('kinetiq-api');
    expect(attrs[S.SERVICE_VERSION]).toBe('1.4.2');
    expect(attrs[S.DEPLOYMENT_ENVIRONMENT]).toBe('production');
    expect(attrs[S.HOST_NAME]).toBeTruthy();
    expect(attrs[S.SERVICE_INSTANCE_ID]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('deriva deployment.environment de KEEPER_ENV y luego NODE_ENV', () => {
    expect(buildResourceAttributes({}, { KEEPER_ENV: 'staging' })[S.DEPLOYMENT_ENVIRONMENT]).toBe(
      'staging',
    );
    expect(buildResourceAttributes({}, { NODE_ENV: 'production' })[S.DEPLOYMENT_ENVIRONMENT]).toBe(
      'production',
    );
  });

  it('cae a defaults sensatos sin opciones ni entorno', () => {
    const attrs = buildResourceAttributes({}, {});
    expect(attrs[S.SERVICE_NAME]).toBe('servicio-sin-nombre');
    expect(attrs[S.SERVICE_VERSION]).toBe('0.0.0');
    expect(attrs[S.DEPLOYMENT_ENVIRONMENT]).toBe('development');
  });

  it('la opción gana sobre el entorno', () => {
    const attrs = buildResourceAttributes(
      { serviceName: 'de-opcion' },
      { OTEL_SERVICE_NAME: 'de-entorno' },
    );
    expect(attrs[S.SERVICE_NAME]).toBe('de-opcion');
  });

  it('agrega build_id/commit_hash solo cuando están disponibles', () => {
    const sin = buildResourceAttributes({}, {});
    expect(sin.build_id).toBeUndefined();
    expect(sin.commit_hash).toBeUndefined();

    const con = buildResourceAttributes(
      {},
      { KEEPER_BUILD_ID: 'build-123', GIT_COMMIT: 'abc123' },
    );
    expect(con.build_id).toBe('build-123');
    expect(con.commit_hash).toBe('abc123');
  });
});
