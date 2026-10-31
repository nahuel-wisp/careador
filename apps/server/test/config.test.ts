import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const base = { CAREADOR_SECRET: 'x'.repeat(40) };

describe('TRUST_PROXY', () => {
  it('acepta false, true o la IP del proxy', () => {
    expect(loadConfig(base).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.10.70.2' }).TRUST_PROXY).toBe('10.10.70.2');
  });
});
