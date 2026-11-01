import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

export interface Crumb {
  label: string;
  to?: string;
}

/** Encabezado de cada pantalla: dónde estoy («Personal › Gómez, Ana», con vuelta) y sus acciones. */
export function PageHeader({ crumbs, children }: { crumbs: Crumb[]; children?: ReactNode }) {
  return (
    <div className="pagehead no-print">
      <nav className="crumbs" aria-label="Ubicación">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep">›</span>}
            {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
          </Fragment>
        ))}
      </nav>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

/** Versión de la app: «pc» (completa) o «celular» (reducida, para cargar personal y fotos). */
export type Vista = 'pc' | 'celular';
const KEY = 'vista';

export function useVista(): [Vista, (v: Vista) => void] {
  const [vista, setVista] = useState<Vista>(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'pc' || saved === 'celular') return saved;
    } catch {
      // sin almacenamiento: se decide por el ancho
    }
    return window.matchMedia('(max-width: 720px)').matches ? 'celular' : 'pc';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('celular', vista === 'celular');
  }, [vista]);
  const change = (v: Vista) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // no se recuerda, pero se cambia igual
    }
    setVista(v);
  };
  return [vista, change];
}

/**
 * Cámara de la computadora (o del celular) para sacar la foto de la cara.
 * Sólo anda en https o localhost; si no hay cámara, avisa.
 */
export function Camera({ onPhoto, onClose }: { onPhoto(b: Blob): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 1280 } } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setError('No se pudo usar la cámara: revisá que esté conectada y que el navegador tenga permiso.'));
    if (!navigator.mediaDevices) setError('Este navegador no permite usar la cámara.');
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    // Como un espejo, igual que se ve en pantalla.
    g.translate(c.width, 0);
    g.scale(-1, 1);
    g.drawImage(v, 0, 0);
    c.toBlob((b) => b && onPhoto(b), 'image/jpeg', 0.92);
  }

  return (
    <div className="camera">
      {error ? <p className="error small">{error}</p> : <video ref={video} autoPlay playsInline muted />}
      <div className="actions">
        {!error && (
          <button type="button" onClick={shoot}>
            Sacar foto
          </button>
        )}
        <button type="button" className="link" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
