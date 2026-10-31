import { createHash, randomBytes } from 'node:crypto';

/** Autenticación HTTP Digest (RFC 2617 / 7616), la que usan los equipos Hikvision por ISAPI. */

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

export function parseDigestChallenge(header: string): DigestChallenge | null {
  if (!/^\s*digest\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
  for (const m of header.matchAll(re)) {
    params[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? '';
  }
  if (!params.realm || !params.nonce) return null;
  return {
    realm: params.realm,
    nonce: params.nonce,
    qop: params.qop,
    opaque: params.opaque,
    algorithm: params.algorithm,
  };
}

function hash(algorithm: string, value: string): string {
  const algo = algorithm.toUpperCase().startsWith('SHA-256') ? 'sha256' : 'md5';
  return createHash(algo).update(value).digest('hex');
}

export interface DigestInput {
  method: string;
  uri: string;
  username: string;
  password: string;
  challenge: DigestChallenge;
  nc: number;
  cnonce?: string;
}

export function buildDigestAuthorization(input: DigestInput): string {
  const { method, uri, username, password, challenge } = input;
  const algorithm = challenge.algorithm ?? 'MD5';
  const cnonce = input.cnonce ?? randomBytes(8).toString('hex');
  const nc = input.nc.toString(16).padStart(8, '0');
  // Si el servidor ofrece varias qop ("auth,auth-int") usamos "auth".
  const qop = challenge.qop
    ?.split(',')
    .map((s) => s.trim())
    .includes('auth')
    ? 'auth'
    : undefined;

  let ha1 = hash(algorithm, `${username}:${challenge.realm}:${password}`);
  if (algorithm.toLowerCase().endsWith('-sess')) {
    ha1 = hash(algorithm, `${ha1}:${challenge.nonce}:${cnonce}`);
  }
  const ha2 = hash(algorithm, `${method}:${uri}`);
  const response = qop
    ? hash(algorithm, `${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(algorithm, `${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}
