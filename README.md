# @web-cuantica/keeper-sdk

Observabilidad para servicios Node/NestJS sobre OpenTelemetry (ADR-0011).
Auto-instrumenta HTTP, Express, NestJS y las bases de datos comunes (`mysql2`, `pg`),
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

## Configuración

Por opciones de `startKeeper(...)` o por variables de entorno:

| Variable | Descripción | Default |
|---|---|---|
| `OTEL_SERVICE_NAME` | Nombre del servicio | `servicio-sin-nombre` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP/HTTP de Keeper | `http://localhost:4318` |
| `KEEPER_LOG_LEVEL` | Nivel mínimo del logger (`verbose`/`debug`/`info`/`warn`/`error`/`fatal`) | `info` |

Opciones adicionales de `startKeeper`: `serviceVersion`, `endpoint`,
`ignoreIncomingPaths` (rutas que no generan telemetría; por defecto
`/health`, `/healthz`, `/live`, `/ready`, `/ping`, `/metrics`).

## Build y tests

```bash
npm install
npm run build   # genera dist/
npm test        # jest
```
