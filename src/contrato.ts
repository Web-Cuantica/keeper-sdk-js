// Contrato de telemetría (paridad con WithContrato de keeper-sdk-go): una lista blanca de
// claves de atributo. Lo que no está declarado no sale del proceso; lo declarado como
// identificador sale con hash (o censurado, sin pepper). Se aplica justo antes de exportar,
// así cubre también los spans que abren las librerías y el framework.
import type { Attributes, AttributeValue } from '@opentelemetry/api';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { LogRecordExporter, ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { getHashPepper, hashIDWithPepper } from './hash';
import { REDACTED_VALUE } from './redact';

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

/** Tope de claves distintas que se recuerdan: una clave dinámica no puede crecer sin límite. */
const MAX_VIOLACIONES = 500;

export class ContratoActivo {
  private readonly modo: ModoDeContrato;
  private readonly atributos: Map<string, ClasificacionDeClave>;
  private readonly vistas = new Map<string, Violacion>();

  constructor(contrato: KeeperContrato) {
    this.modo = contrato.modo ?? 'descartar';
    this.atributos = new Map(Object.entries(contrato.atributos));
  }

  /** Devuelve los atributos que el contrato admite, con los identificadores protegidos. */
  filtrar(attrs: Attributes | undefined, senal: SenalDeContrato): Attributes {
    const out: Attributes = {};
    if (!attrs) {
      return out;
    }
    for (const [clave, valor] of Object.entries(attrs)) {
      const clasificacion = this.atributos.get(clave);
      if (clasificacion === undefined) {
        this.registrar(clave, senal);
        if (this.modo === 'descartar') {
          continue;
        }
        out[clave] = valor;
        continue;
      }
      out[clave] = clasificacion === 'identificador' ? protegerIdentificador(valor) : valor;
    }
    return out;
  }

  violaciones(): Violacion[] {
    return [...this.vistas.values()].map((v) => ({ ...v }));
  }

  reiniciar(): void {
    this.vistas.clear();
  }

  private registrar(clave: string, senal: SenalDeContrato): void {
    const id = `${senal}:${clave}`;
    const previa = this.vistas.get(id);
    if (previa) {
      previa.veces += 1;
      return;
    }
    if (this.vistas.size >= MAX_VIOLACIONES) {
      return;
    }
    this.vistas.set(id, { clave, senal, veces: 1 });
    // Una sola advertencia por clave: el nombre queda en el log del proceso, nunca en la telemetría.
    const accion = this.modo === 'descartar' ? 'se descarta' : 'se deja pasar';
    console.warn(`[keeper] atributo fuera del contrato (${senal}): ${clave}; ${accion}`);
  }
}

function protegerIdentificador(valor: AttributeValue | undefined): AttributeValue {
  if (valor === undefined || valor === null || valor === '') {
    return '';
  }
  return hashIDWithPepper(getHashPepper(), String(valor)) || REDACTED_VALUE;
}

let activo: ContratoActivo | undefined;

/** Fija el contrato del proceso. Lo llaman `startKeeper` y `registerKeeper`. */
export function setContrato(contrato: KeeperContrato | undefined): ContratoActivo | undefined {
  activo = contrato ? new ContratoActivo(contrato) : undefined;
  return activo;
}

/** Atributos que el contrato descartó o dejó pasar sin estar declarados, con su conteo. */
export function violaciones(): Violacion[] {
  return activo ? activo.violaciones() : [];
}

export function reiniciarViolaciones(): void {
  activo?.reiniciar();
}

/** Copia de un objeto de solo lectura con algunas propiedades sustituidas. */
function conCampos<T extends object>(base: T, campos: Partial<Record<keyof T, unknown>>): T {
  const descriptores: PropertyDescriptorMap = {};
  for (const [nombre, valor] of Object.entries(campos)) {
    descriptores[nombre] = { value: valor, enumerable: true };
  }
  return Object.create(base, descriptores) as T;
}

export interface OpcionesDeExportador {
  /** Spans que no se exportan nunca (por ejemplo, los que llevan una URL en el nombre). */
  descartarSpan?: (span: ReadableSpan) => boolean;
  /** Nombre con el que sale cada span, para sanearlo. */
  nombre?: (span: ReadableSpan) => string;
}

/** Envuelve un exportador de spans y aplica el contrato a sus atributos y a los de sus eventos. */
export class ExportadorDeSpansConContrato implements SpanExporter {
  constructor(
    private readonly siguiente: SpanExporter,
    private readonly contrato: ContratoActivo | undefined,
    private readonly opciones: OpcionesDeExportador = {},
  ) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const descartar = this.opciones.descartarSpan;
    const admitidos = descartar ? spans.filter((s) => !descartar(s)) : spans;
    const { contrato } = this;
    const { nombre } = this.opciones;
    const filtrados = admitidos.map((s) => {
      const campos: Partial<Record<keyof ReadableSpan, unknown>> = {};
      if (contrato) {
        campos.attributes = contrato.filtrar(s.attributes, 'span');
        campos.events = s.events.map((e) => ({ ...e, attributes: contrato.filtrar(e.attributes, 'evento') }));
      }
      if (nombre) {
        campos.name = nombre(s);
      }
      return Object.keys(campos).length > 0 ? conCampos(s, campos) : s;
    });
    this.siguiente.export(filtrados, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.siguiente.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.siguiente.forceFlush?.() ?? Promise.resolve();
  }
}

/** Envuelve un exportador de logs y aplica el contrato a los atributos de cada registro. */
export class ExportadorDeLogsConContrato implements LogRecordExporter {
  constructor(
    private readonly siguiente: LogRecordExporter,
    private readonly contrato: ContratoActivo | undefined,
  ) {}

  export(logs: ReadableLogRecord[], resultCallback: (result: ExportResult) => void): void {
    const contrato = this.contrato;
    const filtrados = contrato
      ? logs.map((l) => conCampos(l, { attributes: contrato.filtrar(l.attributes as Attributes, 'log') }))
      : logs;
    this.siguiente.export(filtrados, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.siguiente.shutdown();
  }
}
