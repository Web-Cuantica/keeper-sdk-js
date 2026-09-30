import type { Attributes } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
export type ClasificacionDeClave = 'operativo' | 'identificador';
export type ModoDeContrato = 'descartar' | 'reportar';
export type SenalDeContrato = 'span' | 'evento' | 'log';
export interface KeeperContrato {
    /** `descartar` (por defecto) quita lo no declarado; `reportar` lo deja pasar y lo cuenta. */
    modo?: ModoDeContrato;
    /** Claves admitidas con su clasificación. */
    atributos: Record<string, ClasificacionDeClave>;
}
export interface Violacion {
    clave: string;
    senal: SenalDeContrato;
    veces: number;
}
export declare class ContratoActivo {
    private readonly modo;
    private readonly atributos;
    private readonly vistas;
    constructor(contrato: KeeperContrato);
    /** Devuelve los atributos que el contrato admite, con los identificadores protegidos. */
    filtrar(attrs: Attributes | undefined, senal: SenalDeContrato): Attributes;
    violaciones(): Violacion[];
    reiniciar(): void;
    private registrar;
}
/** Fija el contrato del proceso. Lo llaman `startKeeper` y `registerKeeper`. */
export declare function setContrato(contrato: KeeperContrato | undefined): ContratoActivo | undefined;
/** Atributos que el contrato descartó o dejó pasar sin estar declarados, con su conteo. */
export declare function violaciones(): Violacion[];
export declare function reiniciarViolaciones(): void;
export interface OpcionesDeExportador {
    /** Spans que no se exportan nunca (por ejemplo, los que llevan una URL en el nombre). */
    descartarSpan?: (span: ReadableSpan) => boolean;
    /** Nombre con el que sale cada span, para sanearlo. */
    nombre?: (span: ReadableSpan) => string;
}
/** Envuelve un exportador de spans y aplica el contrato a sus atributos y a los de sus eventos. */
export declare class ExportadorDeSpansConContrato implements SpanExporter {
    private readonly siguiente;
    private readonly contrato;
    private readonly opciones;
    constructor(siguiente: SpanExporter, contrato: ContratoActivo | undefined, opciones?: OpcionesDeExportador);
    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void;
    shutdown(): Promise<void>;
    forceFlush(): Promise<void>;
}
/** Envuelve un exportador de logs y aplica el contrato a los atributos de cada registro. */
export declare class ExportadorDeLogsConContrato implements LogRecordExporter {
    private readonly siguiente;
    private readonly contrato;
    constructor(siguiente: LogRecordExporter, contrato: ContratoActivo | undefined);
    export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void;
    shutdown(): Promise<void>;
}
