"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeeperLogger = void 0;
// KeeperLogger: logger estándar Keeper para Node/NestJS sobre OTel Logs.
// Implementa estructuralmente la interfaz LoggerService de NestJS (log/error/
// warn/debug/verbose/fatal) sin depender de @nestjs/common: al registrarlo con
// `app.useLogger(new KeeperLogger())` captura también todos los `new Logger()`
// existentes en el código y los exporta por OTLP, además de imprimirlos a
// stdout. El estándar: `message` para humanos, datos de negocio como atributos
// planos snake_case, errores en `exception.*`.
const api_logs_1 = require("@opentelemetry/api-logs");
const client_1 = require("./client");
const context_1 = require("./context");
const redact_1 = require("./redact");
const sanitize_1 = require("./sanitize");
const LEVEL_ORDER = {
    verbose: 0,
    debug: 1,
    log: 2,
    warn: 3,
    error: 4,
    fatal: 5,
};
const SEVERITY = {
    verbose: { num: api_logs_1.SeverityNumber.TRACE, text: 'TRACE' },
    debug: { num: api_logs_1.SeverityNumber.DEBUG, text: 'DEBUG' },
    log: { num: api_logs_1.SeverityNumber.INFO, text: 'INFO' },
    warn: { num: api_logs_1.SeverityNumber.WARN, text: 'WARN' },
    error: { num: api_logs_1.SeverityNumber.ERROR, text: 'ERROR' },
    fatal: { num: api_logs_1.SeverityNumber.FATAL, text: 'FATAL' },
};
const STACK_PATTERN = /\n\s+at\s/;
class KeeperLogger {
    constructor(options = {}) {
        const raw = options.level ?? process.env.KEEPER_LOG_LEVEL ?? 'log';
        const level = (raw === 'info' ? 'log' : raw);
        this.minLevel = LEVEL_ORDER[level] ?? LEVEL_ORDER.log;
        this.stdout = options.stdout ?? true;
        this.redactKeys = options.redactKeys ?? [];
    }
    log(message, ...params) {
        this.emit('log', message, params);
    }
    error(message, ...params) {
        this.emit('error', message, params);
    }
    warn(message, ...params) {
        this.emit('warn', message, params);
    }
    debug(message, ...params) {
        this.emit('debug', message, params);
    }
    verbose(message, ...params) {
        this.emit('verbose', message, params);
    }
    fatal(message, ...params) {
        this.emit('fatal', message, params);
    }
    emit(level, message, params) {
        if (LEVEL_ORDER[level] < this.minLevel) {
            return;
        }
        const { body, context, stack, attributes } = this.parse(message, params);
        const otelAttributes = { ...attributes };
        if (context) {
            otelAttributes['logger.name'] = context;
        }
        const requestId = (0, context_1.getRequestId)();
        if (requestId) {
            otelAttributes['request_id'] = requestId;
        }
        const client = (0, context_1.getClient)();
        if (client) {
            Object.assign(otelAttributes, (0, client_1.clientAttributes)(client));
        }
        if (stack) {
            otelAttributes['exception.stacktrace'] = stack;
        }
        // Sanea strings de origen no confiable antes de exportar (§ paridad SafeUTF8).
        for (const [key, value] of Object.entries(otelAttributes)) {
            if (typeof value === 'string') {
                otelAttributes[key] = (0, sanitize_1.safeUTF8)(value);
            }
        }
        const severity = SEVERITY[level];
        // El SDK asocia el trace/span activo automáticamente (correlación logs↔trazas).
        api_logs_1.logs.getLogger('@web-cuantica/keeper-sdk').emit({
            severityNumber: severity.num,
            severityText: severity.text,
            body: typeof body === 'string' ? (0, sanitize_1.safeUTF8)(body) : body,
            attributes: otelAttributes,
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
    parse(message, params) {
        let body;
        let context;
        let stack;
        let attributes = {};
        if (message instanceof Error) {
            body = message.message;
            attributes['exception.type'] = message.name;
            attributes['exception.message'] = message.message;
            stack = message.stack;
        }
        else if (typeof message === 'object' && message !== null) {
            body = JSON.stringify(message);
        }
        else {
            body = String(message);
        }
        for (const param of params) {
            if (typeof param === 'string') {
                if (STACK_PATTERN.test(param)) {
                    stack = param;
                }
                else {
                    context = param;
                }
            }
            else if (param instanceof Error) {
                attributes['exception.type'] = param.name;
                attributes['exception.message'] = param.message;
                stack = param.stack;
            }
            else if (typeof param === 'object' && param !== null) {
                for (const [key, value] of Object.entries(param)) {
                    // Se guarda el valor crudo; la redacción (recursiva) corre ANTES de
                    // aplanarlo, para no serializar secretos anidados (§3.4).
                    attributes[key] = value;
                }
            }
        }
        // Orden crítico: redactar (recursivo sobre objetos/arreglos) y DESPUÉS aplanar
        // a valores compatibles con OTel. Invertir el orden filtra secretos anidados.
        const redacted = (0, redact_1.redactAttributes)(attributes, this.redactKeys);
        const coerced = {};
        for (const [key, value] of Object.entries(redacted)) {
            coerced[key] = this.coerce(value);
        }
        return { body, context, stack, attributes: coerced };
    }
    coerce(value) {
        if (value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean') {
            return value;
        }
        try {
            return JSON.stringify(value);
        }
        catch {
            return String(value);
        }
    }
    print(level, severityText, context, body, attributes, stack) {
        let line = `${new Date().toISOString()} ${severityText.padEnd(5)} [${context ?? '-'}] ${body}`;
        if (Object.keys(attributes).length > 0) {
            line += ` ${JSON.stringify(attributes)}`;
        }
        if (stack) {
            line += `\n${stack}`;
        }
        if (level === 'error' || level === 'fatal') {
            console.error(line);
        }
        else if (level === 'warn') {
            console.warn(line);
        }
        else {
            console.log(line);
        }
    }
}
exports.KeeperLogger = KeeperLogger;
