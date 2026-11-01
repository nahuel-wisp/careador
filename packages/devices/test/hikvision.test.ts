import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HikvisionDriver } from '../src';
import { buildDigestAuthorization, parseDigestChallenge } from '../src/hikvision/digest';
import { classifyEvent, normalizeEvent } from '../src/hikvision/events';
import { fromDevice, toDeviceLocal } from '../src/hikvision/time';

describe('digest', () => {
  it('calcula la respuesta del ejemplo de RFC 2617', () => {
    const challenge = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", ' +
        'nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    )!;
    const header = buildDigestAuthorization({
      method: 'GET',
      uri: '/dir/index.html',
      username: 'Mufasa',
      password: 'Circle Of Life',
      challenge,
      nc: 1,
      cnonce: '0a4f113b',
    });
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain('qop=auth');
  });
});

describe('time', () => {
  it('convierte a hora local del equipo y vuelve', () => {
    const d = new Date('2025-03-01T11:00:00Z');
    expect(toDeviceLocal(d, '-03:00')).toBe('2025-03-01T08:00:00');
    expect(fromDevice('2025-03-01T08:00:00', '-03:00').toISOString()).toBe(d.toISOString());
    expect(fromDevice('2025-03-01T08:00:00-03:00', '+00:00').toISOString()).toBe(d.toISOString());
  });
});

describe('events', () => {
  it('clasifica reconocimiento facial como marcación válida', () => {
    expect(classifyEvent(5, 0x4b)).toBe('access_granted');
    expect(classifyEvent(5, 0x4c)).toBe('access_denied');
    const ev = normalizeEvent(
      { major: 5, minor: 75, time: '2025-03-01T08:01:00-03:00', employeeNoString: '12', serialNo: 99 },
      '-03:00',
    );
    expect(ev).toMatchObject({ kind: 'access_granted', personId: '12', verifyMode: 'face', deviceEventId: 'sn:99' });
  });
});

// ---------------------------------------------------------------------------
// Equipo simulado: exige Digest y responde ISAPI paginado.

const USER = 'admin';
const PASS = 'secreto';
const REALM = 'DS-K1T321';
const NONCE = 'abc123';

function checkDigest(req: IncomingMessage): boolean {
  const auth = req.headers.authorization ?? '';
  const p = Object.fromEntries(
    [...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)].map((m) => [m[1], m[2] ?? m[3]]),
  );
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${USER}:${REALM}:${PASS}`);
  const ha2 = md5(`${req.method}:${p.uri}`);
  return p.response === md5(`${ha1}:${NONCE}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`) && p.uri === req.url;
}

const users = Array.from({ length: 45 }, (_, i) => ({
  employeeNo: String(i + 1),
  name: `Empleado ${i + 1}`,
  Valid: { enable: true, beginTime: '2025-01-01T00:00:00', endTime: '2037-12-31T23:59:59' },
}));

let server: Server;
let host: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!checkDigest(req)) {
      res.writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${REALM}", nonce="${NONCE}"` });
      return res.end();
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/ISAPI/AccessControl/UserInfo/Search?format=json') {
        const cond = JSON.parse(body).UserInfoSearchCond;
        const slice = users.slice(cond.searchResultPosition, cond.searchResultPosition + cond.maxResults);
        const more = cond.searchResultPosition + slice.length < users.length;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(
          JSON.stringify({
            UserInfoSearch: {
              responseStatusStrg: more ? 'MORE' : 'OK',
              numOfMatches: slice.length,
              totalMatches: users.length,
              UserInfo: slice,
            },
          }),
        );
      }
      if (req.url === '/ISAPI/Intelligent/FDLib/FDSearch?format=json') {
        const { FPID } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Como el equipo real: la URL apunta a su IP de LAN, no a la que usamos para llegar.
        const MatchList = FPID === '7' ? [{ FPID, faceURL: 'http://192.168.1.64/LOCALS/pic/enrlFace/0/0000000007.jpg@WEB000000000020' }] : [];
        return res.end(JSON.stringify({ responseStatusStrg: 'OK', numOfMatches: MatchList.length, MatchList }));
      }
      if (req.url === '/LOCALS/pic/enrlFace/0/0000000007.jpg@WEB000000000020') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ statusCode: 4, statusString: 'Invalid Operation', subStatusCode: 'notSupport' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('HikvisionDriver contra equipo simulado', () => {
  it('autentica con Digest y recorre todas las páginas de personas', async () => {
    const driver = new HikvisionDriver({ host, username: USER, password: PASS });
    const persons = [];
    for await (const p of driver.listPersons()) persons.push(p);
    expect(persons).toHaveLength(45);
    expect(persons[44]).toMatchObject({ id: '45', name: 'Empleado 45', enabled: true });
  });

  it('baja la foto de una persona por el host configurado', async () => {
    const driver = new HikvisionDriver({ host, username: USER, password: PASS });
    expect([...(await driver.getFace('7'))!]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect(await driver.getFace('8')).toBeNull();
  });

  it('informa credenciales inválidas', async () => {
    const driver = new HikvisionDriver({ host, username: USER, password: 'mal' });
    await expect(driver.listPersons()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});
