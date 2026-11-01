import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { shrinkImage } from '../lib/image';
import { PageHeader } from '../ui';
import { KIND_LABEL, KIND_SHORT, shortDate, today, type AbsenceKind } from '../lib/schedules';

interface AbsenceFile {
  id: number;
  fileName: string;
  mime: string;
}

interface Absence {
  id: number;
  employeeId: number | null;
  kind: AbsenceKind;
  dateFrom: string;
  dateTo: string;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
  files: AbsenceFile[];
}

interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  active: boolean;
}

/** Vacaciones, francos, licencias, feriados y permisos, con sus comprobantes. */
export function AbsencesPage() {
  const [params, setParams] = useSearchParams();
  const [absences, setAbsences] = useState<Absence[] | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [editing, setEditing] = useState<Absence | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api<Absence[]>('/absences'), api<Employee[]>('/employees')])
      .then(([a, e]) => {
        setAbsences(a);
        setEmployees(e);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
    if (params.get('empleado')) setEditing('nuevo'); // viene de "Justificar" en Asistencia
  }, []);

  const name = (id: number | null) => {
    if (id === null) return 'Todos';
    const e = employees.find((x) => x.id === id);
    return e ? `${e.lastName}, ${e.firstName}` : `#${id}`;
  };

  if (editing) {
    const prefill = editing === 'nuevo' ? { employeeId: params.get('empleado'), date: params.get('fecha') } : null;
    return (
      <AbsenceForm
        absence={editing === 'nuevo' ? null : editing}
        prefill={prefill}
        employees={employees.filter((e) => e.active || (editing !== 'nuevo' && e.id === editing.employeeId))}
        onDone={() => {
          setEditing(null);
          setParams({});
          load();
        }}
      />
    );
  }

  const t = today();
  const current = absences?.filter((a) => a.dateTo >= t) ?? [];
  const past = (absences?.filter((a) => a.dateTo < t) ?? []).reverse();

  const table = (rows: Absence[]) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Persona</th>
            <th>Tipo</th>
            <th>Desde</th>
            <th>Hasta</th>
            <th>Nota</th>
            <th>Comprobantes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="clickable" onClick={() => setEditing(a)}>
              <td>
                <strong>{name(a.employeeId)}</strong>
              </td>
              <td>
                <span className={`badge kind-${a.kind}`}>{KIND_SHORT[a.kind]}</span>
                {a.kind === 'horario_especial' && <span className="muted small"> {a.startTime} a {a.endTime}</span>}
              </td>
              <td className="nowrap">{shortDate(a.dateFrom)}</td>
              <td className="nowrap">{a.dateTo === a.dateFrom ? '' : shortDate(a.dateTo)}</td>
              <td className="muted">{a.note}</td>
              <td>{a.files.length > 0 && `📎 ${a.files.length}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Novedades' }]}>
        <button onClick={() => setEditing('nuevo')}>Agregar</button>
      </PageHeader>
      <p className="muted small">Vacaciones, francos, licencias, feriados, permisos y horarios especiales.</p>
      {error && <p className="error">{error}</p>}
      {absences?.length === 0 && <p className="muted">No hay novedades cargadas.</p>}
      {current.length > 0 && (
        <>
          <h2>Vigentes y próximas</h2>
          {table(current)}
        </>
      )}
      {past.length > 0 && (
        <>
          <h2>Últimos 30 días</h2>
          {table(past)}
        </>
      )}
    </section>
  );
}

function AbsenceForm({
  absence,
  prefill,
  employees,
  onDone,
}: {
  absence: Absence | null;
  prefill: { employeeId: string | null; date: string | null } | null;
  employees: Employee[];
  onDone(): void;
}) {
  const [f, setF] = useState({
    employeeId: String(absence?.employeeId ?? prefill?.employeeId ?? ''),
    kind: absence?.kind ?? ('vacaciones' as AbsenceKind),
    dateFrom: absence?.dateFrom ?? prefill?.date ?? today(),
    dateTo: absence?.dateTo ?? prefill?.date ?? today(),
    startTime: absence?.startTime ?? '09:00',
    endTime: absence?.endTime ?? '18:00',
    note: absence?.note ?? '',
  });
  const [files, setFiles] = useState<AbsenceFile[]>(absence?.files ?? []);
  const [pending, setPending] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    const v = e.target.value;
    // "Hasta" sigue a "desde" mientras sea un solo día.
    if (k === 'dateFrom' && f.dateTo === f.dateFrom) setF({ ...f, dateFrom: v, dateTo: v });
    else setF({ ...f, [k]: v });
  };
  const forAll = f.kind === 'feriado';

  async function upload(absenceId: number, file: File) {
    const isImage = file.type.startsWith('image/');
    const body = isImage ? await shrinkImage(file) : file;
    const fileName = isImage ? file.name.replace(/\.\w+$/, '') + '.jpg' : file.name;
    return api<AbsenceFile>(`/absences/${absenceId}/files?name=${encodeURIComponent(fileName)}`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': isImage ? 'image/jpeg' : file.type || 'application/pdf' },
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = JSON.stringify({
      employeeId: forAll ? null : Number(f.employeeId),
      kind: f.kind,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      ...(f.kind === 'horario_especial' ? { startTime: f.startTime, endTime: f.endTime } : {}),
      note: f.note || null,
    });
    try {
      const saved = absence
        ? await api<Absence>(`/absences/${absence.id}`, { method: 'PUT', body })
        : await api<Absence>('/absences', { method: 'POST', body });
      for (const file of pending) await upload(saved.id, file);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      setBusy(false);
    }
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    if (!absence) return setPending([...pending, ...list]); // se suben al guardar
    setBusy(true);
    setError(null);
    try {
      for (const file of list) {
        const saved = await upload(absence.id, file);
        setFiles((prev) => [...prev, saved]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir');
    }
    setBusy(false);
  }

  async function removeFile(file: AbsenceFile) {
    if (!confirm(`¿Borrar «${file.fileName}»?`)) return;
    await api(`/absence-files/${file.id}`, { method: 'DELETE' }).catch((e: Error) => setError(e.message));
    setFiles(files.filter((x) => x.id !== file.id));
  }

  async function remove() {
    if (!absence || !confirm('¿Borrar esta novedad y sus comprobantes?')) return;
    setBusy(true);
    await api(`/absences/${absence.id}`, { method: 'DELETE' }).catch((e: Error) => setError(e.message));
    onDone();
  }

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Novedades', to: '/novedades' }, { label: absence ? 'Novedad' : 'Nueva novedad' }]} />
      <form className="panel form wide" onSubmit={submit} style={{ maxWidth: 640 }}>
        <label>
          Tipo
          <select value={f.kind} onChange={set('kind')}>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!forAll && (
          <label>
            Empleado
            <select value={f.employeeId} onChange={set('employeeId')} required>
              <option value="">Elegí…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.lastName}, {e.firstName}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="two">
          <label>
            Desde
            <input type="date" value={f.dateFrom} onChange={set('dateFrom')} required />
          </label>
          <label>
            Hasta
            <input type="date" value={f.dateTo} min={f.dateFrom} onChange={set('dateTo')} required />
          </label>
        </div>
        {f.kind === 'horario_especial' && (
          <div className="two">
            <label>
              Entra
              <input type="time" value={f.startTime} onChange={set('startTime')} required />
            </label>
            <label>
              Sale
              <input type="time" value={f.endTime} onChange={set('endTime')} required />
            </label>
          </div>
        )}
        <label>
          Nota
          <input value={f.note} onChange={set('note')} placeholder="Ej.: turno médico, llega 10:30" maxLength={500} />
        </label>

        <div className="files">
          <span className="muted small">Comprobantes</span>
          {files.map((file) => (
            <div key={file.id} className="file">
              <a href={`/api/absence-files/${file.id}`} target="_blank" rel="noreferrer">
                {file.mime === 'application/pdf' ? '📄' : '🖼️'} {file.fileName}
              </a>
              <button type="button" className="link danger small" onClick={() => removeFile(file)}>
                Borrar
              </button>
            </div>
          ))}
          {pending.map((file, i) => (
            <div key={i} className="file muted">
              ⏳ {file.name}
            </div>
          ))}
          <label className="button secondary">
            Adjuntar foto o PDF
            <input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          </label>
        </div>

        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="link" onClick={onDone}>
            Cancelar
          </button>
          {absence && (
            <button type="button" className="link danger" onClick={remove} disabled={busy}>
              Borrar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
