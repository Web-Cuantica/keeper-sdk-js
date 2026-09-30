"use strict";
// Origen del request (IP + dispositivo) para enriquecer logs/spans con client.*
// — paridad de vocabulario con keeper-sdk-go (§5.1: mismo concepto = mismo nombre).
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClient = parseClient;
exports.clientAttributes = clientAttributes;
/**
 * Parseo ligero del User-Agent (sin dependencia externa). Suficiente para
 * client.browser/os/device.type; el UA crudo siempre se conserva.
 */
function parseClient(ip, ua) {
    const c = { address: ip || '', userAgent: ua || '' };
    if (!ua) {
        return c;
    }
    const lower = ua.toLowerCase();
    if (/bot|crawler|spider|slurp|bingpreview/.test(lower)) {
        c.deviceType = 'bot';
    }
    else if (/ipad|tablet|playbook|silk/.test(lower)) {
        c.deviceType = 'tablet';
    }
    else if (/mobi|iphone|android.*mobile|windows phone/.test(lower)) {
        c.deviceType = 'mobile';
    }
    else {
        c.deviceType = 'desktop';
    }
    if (/edg\//.test(lower)) {
        c.browser = 'Edge';
    }
    else if (/chrome\//.test(lower) && !/edg\//.test(lower)) {
        c.browser = 'Chrome';
    }
    else if (/firefox\//.test(lower)) {
        c.browser = 'Firefox';
    }
    else if (/safari\//.test(lower) && !/chrome\//.test(lower)) {
        c.browser = 'Safari';
    }
    // iPhone UA incluye "like Mac OS X": detectar iOS antes que macOS.
    if (/iphone|ipad|ipod/.test(lower)) {
        c.os = 'iOS';
    }
    else if (/android/.test(lower)) {
        c.os = 'Android';
    }
    else if (/windows nt/.test(lower)) {
        c.os = 'Windows';
    }
    else if (/mac os x|macintosh/.test(lower)) {
        c.os = 'macOS';
    }
    else if (/linux/.test(lower)) {
        c.os = 'Linux';
    }
    return c;
}
/** Atributos client.* listos para log/span (omite vacíos). */
function clientAttributes(c) {
    const out = {};
    if (c.address) {
        out['client.address'] = c.address;
    }
    if (c.browser) {
        out['client.browser'] = c.browser;
    }
    if (c.os) {
        out['client.os'] = c.os;
    }
    if (c.deviceType) {
        out['client.device.type'] = c.deviceType;
    }
    if (c.userAgent) {
        out['user_agent.original'] = c.userAgent;
    }
    return out;
}
