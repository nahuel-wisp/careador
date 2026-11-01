import { useEffect, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import manual from '../../../../docs/manual.md?raw';
import { Markdown, slug } from '../lib/markdown';
import { CURRENT, RELEASES, type Release } from '../lib/version';
import { PageHeader } from '../ui';

/** Las secciones del manual, para el índice. */
const SECTIONS = [...manual.matchAll(/^## (.+?)\r?$/gm)].map((m) => m[1]!);

/** Ayuda: el manual completo y las versiones con sus cambios. */
export function HelpPage() {
  const versiones = useParams().tab === 'versiones';
  return (
    <section>
      <PageHeader crumbs={[{ label: 'Ayuda', to: '/ayuda' }, { label: versiones ? 'Versiones' : 'Manual' }]}>
        <span className="muted small">Versión {CURRENT.version}</span>
      </PageHeader>
      <nav className="subtabs">
        <NavLink to="/ayuda" end>
          Manual
        </NavLink>
        <NavLink to="/ayuda/versiones">Versiones</NavLink>
      </nav>
      {versiones ? (
        <div className="help-text">
          {RELEASES.map((r) => (
            <ReleaseNotes key={r.version} release={r} />
          ))}
        </div>
      ) : (
        <div className="help">
          <nav className="help-index" aria-label="Índice">
            {SECTIONS.map((s) => (
              <a key={s} href={`#${slug(s)}`}>
                {s}
              </a>
            ))}
          </nav>
          <div className="help-text">
            <Markdown text={manual.replace(/^# .*\r?\n/, '')} />
          </div>
        </div>
      )}
    </section>
  );
}

function ReleaseNotes({ release }: { release: Release }) {
  return (
    <article className="release">
      <h2>
        Versión {release.version} <span className="muted small">{release.date.split('-').reverse().join('/')}</span>
      </h2>
      <Markdown text={release.notes} />
    </article>
  );
}

const SEEN = 'version-vista';

/** Al entrar después de una actualización: aviso con la versión y sus notas, una vez por dispositivo. */
export function VersionNotice() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(SEEN) !== CURRENT.version;
    } catch {
      return false; // sin almacenamiento aparecería siempre: mejor no molestar
    }
  });
  const close = () => {
    try {
      localStorage.setItem(SEEN, CURRENT.version);
    } catch {
      // no se recuerda
    }
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Versión ${CURRENT.version}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-body">
          <p className="muted small">Hay una versión nueva de Control Horario</p>
          <ReleaseNotes release={CURRENT} />
        </div>
        <div className="actions">
          <button onClick={close} autoFocus>
            Entendido
          </button>
          <Link className="button secondary" to="/ayuda/versiones" onClick={close}>
            Ver todas las versiones
          </Link>
        </div>
      </div>
    </div>
  );
}
