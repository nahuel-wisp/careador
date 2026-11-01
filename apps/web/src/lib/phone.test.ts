import { describe, expect, it } from 'vitest';
import { whatsappUrl } from './phone';

describe('whatsappUrl', () => {
  it('arma el número internacional desde como lo escriba la gente', () => {
    expect(whatsappUrl('221 555-1234')).toBe('https://wa.me/5492215551234');
    expect(whatsappUrl('(0221) 15-555-1234')).toBe('https://wa.me/5492215551234');
    expect(whatsappUrl('+54 9 221 555 1234')).toBe('https://wa.me/5492215551234');
    expect(whatsappUrl('+54 221 555 1234')).toBe('https://wa.me/5492215551234');
    expect(whatsappUrl('11 1555-1234')).toBe('https://wa.me/5491115551234'); // empieza con 15 pero son 10 dígitos
  });
});
