export interface Client {
    address: string;
    userAgent: string;
    browser?: string;
    os?: string;
    deviceType?: 'desktop' | 'mobile' | 'tablet' | 'bot' | '';
}
/**
 * Parseo ligero del User-Agent (sin dependencia externa). Suficiente para
 * client.browser/os/device.type; el UA crudo siempre se conserva.
 */
export declare function parseClient(ip: string, ua: string): Client;
/** Atributos client.* listos para log/span (omite vacíos). */
export declare function clientAttributes(c: Client): Record<string, string>;
