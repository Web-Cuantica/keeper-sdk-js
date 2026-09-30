"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportadorDeLogsConContrato = exports.ExportadorDeSpansConContrato = exports.ContratoActivo = void 0;
exports.setContrato = setContrato;
exports.violaciones = violaciones;
exports.reiniciarViolaciones = reiniciarViolaciones;
const hash_1 = require("./hash");
const redact_1 = require("./redact");
/** Tope de claves distintas que se recuerdan: una clave dinámica no puede crecer sin límite. */
const MAX_VIOLACIONES = 500;
class ContratoActivo {
    constructor(contrato) {
        this.vistas = new Map();
        this.modo = contrato.modo ?? 'descartar';
        this.atributos = new Map(Object.entries(contrato.atributos));
    }
    /** Devuelve los atributos que el contrato admite, con los identificadores protegidos. */
    filtrar(attrs, senal) {
        const out = {};
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
    violaciones() {
        return [...this.vistas.values()].map((v) => ({ ...v }));
    }
    reiniciar() {
        this.vistas.clear();
    }
    registrar(clave, senal) {
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
exports.ContratoActivo = ContratoActivo;
function protegerIdentificador(valor) {
    if (valor === undefined || valor === null || valor === '') {
        return '';
    }
    return (0, hash_1.hashIDWithPepper)((0, hash_1.getHashPepper)(), String(valor)) || redact_1.REDACTED_VALUE;
}
let activo;
/** Fija el contrato del proceso. Lo llaman `startKeeper` y `registerKeeper`. */
function setContrato(contrato) {
    activo = contrato ? new ContratoActivo(contrato) : undefined;
    return activo;
}
/** Atributos que el contrato descartó o dejó pasar sin estar declarados, con su conteo. */
function violaciones() {
    return activo ? activo.violaciones() : [];
}
function reiniciarViolaciones() {
    activo?.reiniciar();
}
/** Copia de un objeto de solo lectura con algunas propiedades sustituidas. */
function conCampos(base, campos) {
    const descriptores = {};
    for (const [nombre, valor] of Object.entries(campos)) {
        descriptores[nombre] = { value: valor, enumerable: true };
    }
    return Object.create(base, descriptores);
}
/** Envuelve un exportador de spans y aplica el contrato a sus atributos y a los de sus eventos. */
class ExportadorDeSpansConContrato {
    constructor(siguiente, contrato, opciones = {}) {
        this.siguiente = siguiente;
        this.contrato = contrato;
        this.opciones = opciones;
    }
    export(spans, resultCallback) {
        const descartar = this.opciones.descartarSpan;
        const admitidos = descartar ? spans.filter((s) => !descartar(s)) : spans;
        const { contrato } = this;
        const { nombre } = this.opciones;
        const filtrados = admitidos.map((s) => {
            const campos = {};
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
    shutdown() {
        return this.siguiente.shutdown();
    }
    forceFlush() {
        return this.siguiente.forceFlush?.() ?? Promise.resolve();
    }
}
exports.ExportadorDeSpansConContrato = ExportadorDeSpansConContrato;
/** Envuelve un exportador de logs y aplica el contrato a los atributos de cada registro. */
class ExportadorDeLogsConContrato {
    constructor(siguiente, contrato) {
        this.siguiente = siguiente;
        this.contrato = contrato;
    }
    export(logs, resultCallback) {
        const contrato = this.contrato;
        const filtrados = contrato
            ? logs.map((l) => conCampos(l, { attributes: contrato.filtrar(l.attributes, 'log') }))
            : logs;
        this.siguiente.export(filtrados, resultCallback);
    }
    shutdown() {
        return this.siguiente.shutdown();
    }
}
exports.ExportadorDeLogsConContrato = ExportadorDeLogsConContrato;
