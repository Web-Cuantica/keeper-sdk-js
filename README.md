# @web-cuantica/keeper-sdk

Observabilidad en **una línea** para servicios Node/NestJS, sobre OpenTelemetry (ADR-0011).
Auto-instrumenta HTTP, Express, NestJS y `pg`, y exporta por OTLP/HTTP a la plataforma Keeper.
Sin lock-in: por debajo es OpenTelemetry estándar.

## Instalación

```bash
npm install @web-cuantica/keeper-sdk
```

## Uso en NestJS

Llama a `startKeeper` **antes** de levantar la app (lo más arriba posible de `main.ts`):

```ts
import { startKeeper } from '@web-cuantica/keeper-sdk';

startKeeper({
  serviceName: 'dyinspectionws',
  endpoint: 'http://keeper-host:4318', // OTLP/HTTP de tu plataforma Keeper
});

// ...recién después, el bootstrap normal de Nest:
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

Alternativa sin tocar `main.ts` (preload):

```bash
node -r @web-cuantica/keeper-sdk/register dist/main.js   # (registro a futuro)
```

## Configuración

Por opciones o por variables de entorno estándar de OpenTelemetry:

| Variable | Descripción | Default |
|---|---|---|
| `OTEL_SERVICE_NAME` | Nombre del servicio | `servicio-sin-nombre` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP/HTTP de Keeper | `http://localhost:4318` |

## Build (en tu máquina)

```bash
npm install
npm run build   # genera dist/
```

> Estado: scaffold inicial (ADR-0011). Pinéa/valida versiones con `npm install && npm run build`
> antes de publicar. Objetivo de adopción: los servicios NestJS de `C:\dy`.
