// KeeperLogger: logger estándar Keeper para Node/NestJS sobre OTel Logs.
// Implementa estructuralmente la interfaz LoggerService de NestJS (log/error/
// warn/debug/verbose/fatal) sin depender de @nestjs/common: al registrarlo con
// `app.useLogger(new KeeperLogger())` captura también todos los `new Logger()`
// existentes en el código y los exporta por OTLP, además de imprimirlos a
// stdout. El estándar: `message` para humanos, datos de negocio como atributos
// planos snake_case, errores en `exception.*`.
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { getRequestId } from './context';
import { redactAttributes } from './redact';

export type KeeperLogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<KeeperLogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const SEVERITY: Record<KeeperLogLevel, { num: SeverityNumber; text: string }> = {
  verbose: { num: SeverityNumber.TRACE, text: 'TRACE' },
  debug: { num: SeverityNumber.DEBUG, text: 'DEBUG' },
  log: { num: SeverityNumber.INFO, text: 'INFO' },
  warn: { num: SeverityNumber.WARN, text: 'WARN' },
  error: { num: SeverityNumber.ERROR, text: 'ERROR' },
  fatal: { num: SeverityNumber.FATAL, text: 'FATAL' },
};

const STACK_PATTERN = /\n\s+at\s/;

export interface KeeperLoggerOptions {
  /** Nivel mínimo emitido; acepta 'info' como alias de 'log'.
   *  Default: KEEPER_LOG_LEVEL o 'log'. */
  level?: KeeperLogLevel | 'info';
  /** Espejo a stdout/stderr (default true). */
  stdout?: boolean;
  /** Claves adicionales a redactar además de DEFAULT_REDACT_KEYS. */
  redactKeys?: string[];
}

export class KeeperLogger {
  private readonly minLevel: number;
  private readonly stdout: boolean;
  private readonly redactKeys: string[];

  constructor(options: KeeperLoggerOptions = {}) {
    const raw = options.level ?? process.env.KEEPER_LOG_LEVEL ?? 'log';
    const level = (raw === 'info' ? 'log' : raw) as KeeperLogLevel;
    this.minLevel = LEVEL_ORDER[level] ?? LEVEL_ORDER.log;
    this.stdout = options.stdout ?? true;
    this.redactKeys = options.redactKeys ?? [];
  }

  log(message: unknown, ...params: unknown[]): void {
    this.emit('log', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('fatal', message, params);
  }

  private emit(level: KeeperLogLevel, message: unknown, params: unknown[]): void {
    if (LEVEL_ORDER[level] < this.minLevel) {
      return;
    }
    const { body, context, stack, attributes } = this.parse(message, params);

    const otelAttributes: Record<string, unknown> = { ...attributes };
    if (context) {
      otelAttributes['logger.name'] = context;
    }
    const requestId = getRequestId();
    if (requestId) {
      otelAttributes['request_id'] = requestId;
    }
    if (stack) {
      otelAttributes['exception.stacktrace'] = stack;
    }

    const severity = SEVERITY[level];
    // El SDK asocia el trace/span activo automáticamente (correlación logs↔trazas).
    logs.getLogger('@web-cuantica/keeper-sdk').emit({
      severityNumber: severity.num,
      severityText: severity.text,
      body,
      attributes: otelAttributes as never,
    });

    if (this.stdout) {
      this.print(level, severity.text, context, body, attributes, stack);
    }
  }

  /**
   * Interpreta los parámetros con las convenciones de NestJS: el último string
   * es el contexto (nombre del logger), un string con pinta de stack trace es
   * el stack de error(), un Error aporta exception.* y los objetos planos se
   * vuelven atributos filtrables.
   */
  private parse(
    message: unknown,
    params: unknown[],
  ): {
    body: string;
    context?: string;
    stack?: string;
    attributes: Record<string, unknown>;
  } {
    let body: string;
    let context: string | undefined;
    let stack: string | undefined;
    let attributes: Record<string, unknown> = {};

    if (message instanceof Error) {
      body = message.message;
      attributes['exception.type'] = message.name;
      attributes['exception.message'] = message.message;
      stack = message.stack;
    } else if (typeof message === 'object' && message !== null) {
      body = JSON.stringify(message);
    } else {
      body = String(message);
    }

    for (const param of params) {
      if (typeof param === 'string') {
        if (STACK_PATTERN.test(param)) {
          stack = param;
        } else {
          context = param;
        }
      } else if (param instanceof Error) {
        attributes['exception.type'] = param.name;
        attributes['exception.message'] = param.message;
        stack = param.stack;
      } else if (typeof param === 'object' && param !== null) {
        for (const [key, value] of Object.entries(param)) {
          attributes[key] = this.coerce(value);
        }
      }
    }

    attributes = redactAttributes(attributes, this.redactKeys);
    return { body, context, stack, attributes };
  }

  private coerce(value: unknown): unknown {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private print(
    level: KeeperLogLevel,
    severityText: string,
    context: string | undefined,
    body: string,
    attributes: Record<string, unknown>,
    stack?: string,
  ): void {
    let line = `${new Date().toISOString()} ${severityText.padEnd(5)} [${context ?? '-'}] ${body}`;
    if (Object.keys(attributes).length > 0) {
      line += ` ${JSON.stringify(attributes)}`;
    }
    if (stack) {
      line += `\n${stack}`;
    }
    if (level === 'error' || level === 'fatal') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
