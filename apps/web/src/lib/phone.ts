/**
 * Enlace de WhatsApp para un teléfono argentino escrito como sea: «221 555-1234», «(0221) 15-555-1234»,
 * «+54 9 221 555 1234». WhatsApp lo quiere como 549 + característica + número, sin 0 ni 15.
 */
export function whatsappUrl(phone: string) {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('549')) return `https://wa.me/${d}`;
  if (d.startsWith('54')) return `https://wa.me/549${d.slice(2)}`;
  if (d.startsWith('0')) d = d.slice(1);
  // 12 dígitos = característica (2 a 4) + 15 + número: se saca el 15.
  if (d.length === 12) {
    const at = [2, 3, 4].find((i) => d.slice(i, i + 2) === '15');
    if (at !== undefined) d = d.slice(0, at) + d.slice(at + 2);
  }
  return `https://wa.me/549${d}`;
}
