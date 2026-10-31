import { XMLParser } from 'fast-xml-parser';
import { DeviceError } from '../driver';
import type { DeviceConnection } from '../types';
import { buildDigestAuthorization, parseDigestChallenge, type DigestChallenge } from './digest';

type Body = string | FormData | undefined;

export interface IsapiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  /** Objeto a enviar como JSON. */
  json?: unknown;
  /** XML ya serializado. */
  xml?: string;
  form?: FormData;
}

const xmlParser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });

/**
 * Cliente HTTP para ISAPI con autenticación Digest.
 * Reutiliza el último challenge para evitar un 401 por cada request.
 */
export class IsapiClient {
  private challenge: DigestChallenge | null = null;
  private nc = 0;

  constructor(private readonly conn: DeviceConnection) {}

  private get baseUrl(): string {
    return `${this.conn.https ? 'https' : 'http'}://${this.conn.host}`;
  }

  async request(req: IsapiRequest): Promise<Response> {
    let body: Body;
    const headers: Record<string, string> = {};
    if (req.json !== undefined) {
      body = JSON.stringify(req.json);
      headers['Content-Type'] = 'application/json';
    } else if (req.xml !== undefined) {
      body = req.xml;
      headers['Content-Type'] = 'application/xml';
    } else if (req.form) {
      body = req.form;
    }

    let res = await this.send(req, body, headers);
    if (res.status === 401) {
      const header = res.headers.get('www-authenticate') ?? '';
      const challenge = parseDigestChallenge(header);
      await res.body?.cancel();
      if (!challenge) {
        throw new DeviceError('El equipo no ofrece autenticación Digest', 'unauthorized', header);
      }
      this.challenge = challenge;
      this.nc = 0;
      res = await this.send(req, body, headers);
      if (res.status === 401) {
        await res.body?.cancel();
        this.challenge = null;
        throw new DeviceError('Usuario o contraseña incorrectos', 'unauthorized');
      }
    }
    return res;
  }

  private async send(req: IsapiRequest, body: Body, headers: Record<string, string>) {
    const h = { ...headers };
    if (this.challenge) {
      h.Authorization = buildDigestAuthorization({
        method: req.method,
        uri: req.path,
        username: this.conn.username,
        password: this.conn.password,
        challenge: this.challenge,
        nc: ++this.nc,
      });
    }
    try {
      return await fetch(this.baseUrl + req.path, {
        method: req.method,
        headers: h,
        body,
        signal: AbortSignal.timeout(this.conn.timeoutMs ?? 15000),
      });
    } catch (err) {
      throw new DeviceError(`No se pudo conectar con ${this.conn.host}`, 'unreachable', err);
    }
  }

  async json<T>(req: IsapiRequest): Promise<T> {
    const res = await this.request(req);
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) throw isapiError(res.status, data ?? text);
    return data as T;
  }

  async xml<T>(req: IsapiRequest): Promise<T> {
    const res = await this.request(req);
    const text = await res.text();
    const data = text ? xmlParser.parse(text) : undefined;
    if (!res.ok) throw isapiError(res.status, data ?? text);
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return xmlParser.parse(text);
  }
}

/** ISAPI responde errores con { statusCode, statusString, subStatusCode, errorMsg }. */
function isapiError(status: number, data: unknown): DeviceError {
  const d = (data ?? {}) as Record<string, unknown>;
  const inner = (d.ResponseStatus ?? d) as Record<string, unknown>;
  const sub = String(inner.subStatusCode ?? '');
  const msg = String(inner.errorMsg ?? inner.statusString ?? `HTTP ${status}`);
  const code =
    status === 404 || sub === 'notSupport'
      ? 'unsupported'
      : status === 400 || sub.startsWith('bad') || sub.startsWith('invalid')
        ? 'invalid_request'
        : 'device_error';
  return new DeviceError(`ISAPI: ${msg}${sub ? ` (${sub})` : ''}`, code, data);
}
