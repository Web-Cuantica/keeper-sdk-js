# @web-cuantica/keeper-sdk

Observabilidad para servicios Node/NestJS y apps Next.js sobre OpenTelemetry (ADR-0011).
En Node auto-instrumenta HTTP, Express, NestJS y las bases de datos comunes (`mysql2`, `pg`),
y exporta los tres pilares —trazas, métricas y logs— por OTLP/HTTP a la plataforma
Keeper. Sin lock-in: por debajo es OpenTelemetry estándar.

## Instalación

```bash
npm install @web-cuantica/keeper-sdk
```

## Uso en NestJS

Son cuatro líneas. `startKeeper` va **antes** de levantar la app (lo más arriba
posible de `main.ts`); el logger y el middleware de contexto se registran en el
bootstrap.

`main.ts`:

```ts
// 1) Primerísima línea: arranca la instrumentación antes que cualquier otro import.
import { startKeeper } from '@web-cuantica/keeper-sdk';
startKeeper(); // lee OTEL_SERVICE_NAME y OTEL_EXPORTER_OTLP_ENDPOINT del entorno

import { NestFactory } from '@nestjs/core';
import { KeeperLogger, keeperRequestContext } from '@web-cuantica/keeper-sdk';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 2) Reemplaza el logger de Nest: captura todos los `new Logger(...)` que ya
  //    existen en el código y los exporta por OTLP, además de imprimir a stdout.
  app.useLogger(new KeeperLogger());

  // 3) Contexto de request: genera/propaga x-request-id y lo agrega a cada log.
  app.use(keeperRequestContext());

  await app.listen(3000);
}
bootstrap();
```

### Logs de negocio

`KeeperLogger` sigue las convenciones de NestJS y del estándar Keeper: el mensaje
es para humanos, los datos de negocio van como atributos planos en `snake_case`,
y el último `string` es el contexto (nombre del logger).

```ts
import { Logger } from '@nestjs/common';

const logger = new Logger('InspectionService');

// Éxito: message legible + atributos filtrables
logger.log('Inspección iniciada', {
  inspection_id: 97125,
  eco: '12346A4',
  serial_number: 'ABC123',
  usr_id: 4471,
}, 'InspectionService');

// Error: se mapea a exception.* automáticamente
logger.error('Fallo al clonar pre-inspección', err.stack, 'InspectionService');
```

Cada log lleva además, de forma automática: `trace_id`/`span_id` del span activo
(correlación con las trazas), `request_id` si hay un request en curso, y la
redacción de claves sensibles (`password`, `token`, `authorization`, …).

## Trazabilidad entre servicios

`keeperRequestContext()` reutiliza el header `x-request-id` entrante o genera uno
(UUID v4). El SDK reenvía ese header —y el `traceparent` de W3C Trace Context— en
**todas las llamadas HTTP salientes** de forma automática, así que la traza cruza
los servicios sin tocar el código de cada llamada. El `x-request-id` puede nacer
en el frontend (interceptor) o en el primer backend que reciba el request.

## Uso en Next.js

La entrada `@web-cuantica/keeper-sdk/next` es ligera: no carga la auto-instrumentación de
Node, porque Next ya abre sus propios spans (petición, render, server actions) en cuanto hay
un proveedor de trazas. `registerKeeper` pone el proveedor, aplica el contrato, propaga el
contexto y exporta logs.

`src/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerKeeper } = await import('@web-cuantica/keeper-sdk/next');
    registerKeeper({ serviceName: 'mi-portal', contrato });
  }
}
```

`next.config.ts` debe dejar el SDK fuera del bundle: `serverExternalPackages:
['@web-cuantica/keeper-sdk']`.

Las llamadas salientes se trazan con `keeperFetchMiddleware()`, pensado para
`openapi-fetch`: un span de cliente por llamada, nombrado con la ruta del contrato
(`GET /api/v1/clients/{clientId}`) y nunca con la URL, y el `traceparent` propagado
para que el servicio llamado continúe la traza.

```ts
import { keeperFetchMiddleware } from '@web-cuantica/keeper-sdk/next';
apiClient.use(keeperFetchMiddleware({ logger }));
```

El span de `fetch` que abre Next lleva la URL completa —con su query— en el nombre; el SDK
nunca lo exporta, y conviene apagarlo con `NEXT_OTEL_FETCH_DISABLED=1`. Los estáticos
(`/_next/`) y los health checks no abren traza. `annotateRequest({...})` anota el span raíz
de la petición aunque el span activo sea uno interno de Next.

## Contrato de telemetría

Con `contrato` (en `startKeeper` o `registerKeeper`) solo salen las claves de atributo
declaradas; las clasificadas como `identificador` salen con hash (o censuradas, sin pepper).
Se aplica al exportar, así que cubre también los spans del framework y de las librerías.

```ts
registerKeeper({
  contrato: {
    modo: 'descartar', // o 'reportar': deja pasar lo no declarado y lo cuenta
    atributos: { 'http.route': 'operativo', 'pld.client_id': 'identificador' },
  },
});
```

`violaciones()` devuelve las claves no declaradas que se vieron, con su conteo; en pruebas
sirve para fallar cuando algo sale del contrato. Cada clave se avisa una sola vez en stderr,
por nombre y nunca por valor.

## Configuración

Por opciones de `startKeeper(...)` o por variables de entorno:

| Variable | Descripción | Default |
|---|---|---|
| `OTEL_SERVICE_NAME` | Nombre del servicio | `servicio-sin-nombre` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP/HTTP de Keeper | `http://localhost:4318` (`startKeeper`); sin exportar (`registerKeeper`) |
| `KEEPER_LOG_LEVEL` | Nivel mínimo del logger (`verbose`/`debug`/`info`/`warn`/`error`/`fatal`) | `info` |
| `KEEPER_HASH_PEPPER` | Pepper HMAC para hashes one-way de IDs (`email`/`curp`/…) | vacío (PII → `[REDACTADO]`) |

Opciones adicionales de `startKeeper`: `serviceVersion`, `endpoint`, `hashPepper`,
`hashKeys`, `ignoreIncomingPaths` (rutas que no generan telemetría; por defecto
`/health`, `/healthz`, `/live`, `/ready`, `/ping`, `/metrics`).

Con el mismo `KEEPER_HASH_PEPPER` que `keeper-sdk-go` / `@dy/logging`, los
identificadores sensibles se emiten como `h1:<hex>` (HMAC-SHA256) para correlacionar
sin exponer PII. Los secretos siguen censurándose.

## Build y tests

```bash
npm install
npm run build   # genera dist/
npm test        # jest
```
