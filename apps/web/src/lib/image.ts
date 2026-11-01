/**
 * Prepara una foto para los lectores faciales: recorta a 3:4 centrado, achica y comprime a JPEG.
 * Los terminales Hikvision aceptan JPEG chico (orden de 200 KB); apuntamos a menos que eso.
 */
export async function prepareFaceJpeg(
  file: Blob,
  { width = 480, height = 640, maxBytes = 180_000 } = {},
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const targetRatio = width / height;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (sw / sh > targetRatio) sw = Math.round(sh * targetRatio);
  else sh = Math.round(sw / targetRatio);
  const sx = Math.round((bitmap.width - sw) / 2);
  const sy = Math.round((bitmap.height - sh) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();

  for (let q = 0.9; q >= 0.4; q -= 0.1) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && (blob.size <= maxBytes || q <= 0.45)) return blob;
  }
  throw new Error('No se pudo procesar la imagen');
}

/** Achica una foto (ej. un certificado sacado con el celular) para guardarla: lado mayor ≤ maxSide, JPEG. */
export async function shrinkImage(file: Blob, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  if (!blob) throw new Error('No se pudo procesar la imagen');
  return blob;
}
