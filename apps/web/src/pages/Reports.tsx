import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useEntorno } from '../entorno';
import { KIND_SHORT, shortDate, type AbsenceKind } from '../lib/schedules';

interface ReportRow {
  date: string;
  weekday: string;
  employeeId: number;
  code: string;
  firstName: string;
  lastName: string;
  site: string;
  in: string | null;
  out: string | null;
  workedMin: number;
  expected: string | null;
  status: 'presente' | 'ausente' | 'novedad' | 'libre';
  lateMin: number;
  earlyMin: number;
  missingOut: boolean;
  missingIn: boolean;
  review: boolean;
  manualNotes: string[];
  otherMarks: string[];
  absences: AbsenceKind[];
}

interface Summary {
  employeeId: number;
  code: string;
  name: string;
  site: string;
  expectedDays: number;
  workedDays: number;
  absentDays: number;
  justifiedDays: number;
  byKind: Partial<Record<AbsenceKind, number>>;
  lateCount: number;
  lateMin: number;
  earlyCount: number;
  earlyMin: number;
  review: number;
  manualDays: number;
  workedMin: number;
}

interface Report {
  from: string;
  to: string;
  site: string | null;
  records: ReportRow[];
  summary: Summary[];
}

type Preset = 'hoy' | 'ayer' | 'semana' | 'semana_ant' | 'mes' | 'mes_ant' | 'rango';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'semana_ant', label: 'Semana pasada' },
  { id: 'mes', label: 'Este mes' },
  { id: 'mes_ant', label: 'Mes anterior' },
  { id: 'rango', label: 'Entre fechas' },
];

const ymd = (d: Date) => d.toLocaleDateString('sv');

/** Rango de fechas de cada atajo (la semana empieza el lunes). */
function presetRange(p: Preset, now = new Date()): [string, string] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const monday = d - ((now.getDay() + 6) % 7);
  switch (p) {
    case 'ayer':
      return [ymd(new Date(y, m, d - 1)), ymd(new Date(y, m, d - 1))];
    case 'semana':
      return [ymd(new Date(y, m, monday)), ymd(now)];
    case 'semana_ant':
      return [ymd(new Date(y, m, monday - 7)), ymd(new Date(y, m, monday - 1))];
    case 'mes':
      return [ymd(new Date(y, m, 1)), ymd(now)];
    case 'mes_ant':
      return [ymd(new Date(y, m - 1, 1)), ymd(new Date(y, m, 0))];
    default:
      return [ymd(now), ymd(now)];
  }
}

const hours = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/** Observaciones de un día, igual que en el Excel. */
function remarks(r: ReportRow) {
  return [
    r.status === 'ausente' ? 'Ausente' : null,
    r.lateMin ? `Tarde ${r.lateMin} min` : null,
    r.earlyMin ? `Salió ${r.earlyMin} min antes` : null,
    r.review ? `A revisar: ${r.in ? 'sin salida' : 'sin entrada'}` : r.missingOut ? 'Sin salida' : r.missingIn ? 'Sin entrada' : null,
    r.manualNotes.length ? `Corregido a mano: ${r.manualNotes.join('; ')}` : null,
    ...r.absences.map((k) => KIND_SHORT[k]),
    r.otherMarks.length ? `Otras marcas: ${r.otherMarks.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** CSV del detalle día por día (separado por «;» para que Excel en español lo abra en columnas). */
function downloadCsv(report: Report) {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    ['Legajo', 'Nombre', 'Apellido', 'Sucursal', 'Fecha', 'Día', 'Entrada', 'Salida', 'Minutos trabajados', 'Horario', 'Observaciones'],
    ...report.records.map((r) => [r.code, r.firstName, r.lastName, r.site, r.date, r.weekday, r.in ?? '', r.out ?? '', r.workedMin, r.expected ?? '', remarks(r)]),
  ];
  // BOM para que Excel reconozca UTF-8 (acentos).
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `asistencia_${report.from}_${report.to}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Reportes por período, sucursal y persona: resumen y detalle día por día, para ver, imprimir/PDF o Excel. */
export function ReportsPage() {
  const empresa = useEntorno()?.empresa;
  const [preset, setPreset] = useState<Preset>('mes');
  const [range, setRange] = useState(presetRange('mes'));
  const [siteId, setSiteId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [view, setView] = useState<'resumen' | 'detalle'>('resumen');
  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);
  const [people, setPeople] = useState<{ id: number; firstName: string; lastName: string; active: boolean }[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<typeof sites>('/sites').then(setSites).catch(() => {});
    api<typeof people>('/employees').then(setPeople).catch(() => {});
  }, []);

  const query = useMemo(() => {
    const q = new URLSearchParams({ from: range[0], to: range[1] });
    if (siteId) q.set('siteId', siteId);
    if (employeeId) q.set('employeeId', employeeId);
    return q.toString();
  }, [range, siteId, employeeId]);

  useEffect(() => {
    if (!range[0] || !range[1]) return;
    setBusy(true);
    api<Report>(`/reports?${query}`)
      .then((r) => {
        setReport(r);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, [query]);

  function choose(p: Preset) {
    setPreset(p);
    if (p !== 'rango') setRange(presetRange(p));
  }

  const person = people.find((p) => String(p.id) === employeeId);
  const period = report ? (report.from === report.to ? shortDate(report.from) : `${shortDate(report.from)} al ${shortDate(report.to)}`) : '';
  const scope = [report?.site ?? 'Todas las sucursales', person ? `${person.lastName}, ${person.firstName}` : 'Todo el personal'].join(' · ');
  const totals = report?.summary.reduce(
    (t, s) => ({
      worked: t.worked + s.workedDays,
      min: t.min + s.workedMin,
      late: t.late + s.lateCount,
      absent: t.absent + s.absentDays,
      justified: t.justified + s.justifiedDays,
      review: t.review + s.review,
    }),
    { worked: 0, min: 0, late: 0, absent: 0, justified: 0, review: 0 },
  );
  // Detalle: por empleado y fecha.
  const records = [...(report?.records ?? [])].sort(
    (a, b) => a.lastName.localeCompare(b.lastName, 'es') || a.firstName.localeCompare(b.firstName, 'es') || a.date.localeCompare(b.date),
  );

  return (
    <section className="report">
      <div className="row no-print">
        <h1>Reportes</h1>
      </div>

      <div className="filters no-print">
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.id} className={preset === p.id ? 'chip active' : 'chip'} onClick={() => choose(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'rango' && (
          <div className="two">
            <label>
              Desde
              <input type="date" value={range[0]} max={range[1]} onChange={(e) => setRange([e.target.value, range[1]])} />
            </label>
            <label>
              Hasta
              <input type="date" value={range[1]} min={range[0]} onChange={(e) => setRange([range[0], e.target.value])} />
            </label>
          </div>
        )}
        <div className="two">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Sucursal">
            <option value="">Todas las sucursales</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-label="Persona">
            <option value="">Todo el personal</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName}, {p.firstName}
                {p.active ? '' : ' (baja)'}
              </option>
            ))}
          </select>
        </div>
        <div className="segmented">
          <button className={view === 'resumen' ? 'active' : ''} onClick={() => setView('resumen')}>
            Resumen
          </button>
          <button className={view === 'detalle' ? 'active' : ''} onClick={() => setView('detalle')}>
            Día por día
          </button>
        </div>
        <div className="actions export">
          <button className="secondary" onClick={() => window.print()} disabled={!report} title="Imprimir o guardar como PDF">
            Imprimir
          </button>
          <a className="button secondary" href={`/api/reports.xlsx?${query}`} download>
            Excel
          </a>
          <button className="secondary" onClick={() => report && downloadCsv(report)} disabled={!report}>
            CSV
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {report && (
        <div className={busy ? 'printable loading' : 'printable'}>
          <header className="report-head">
            <strong>
              {view === 'resumen' ? 'Resumen de asistencia' : 'Registros de entradas y salidas'}
              {empresa ? ` · ${empresa}` : ''}
            </strong>
            <div className="muted small">
              {period} · {scope}
            </div>
          </header>

          {report.records.length === 0 ? (
            <p className="muted">No hay registros en este período.</p>
          ) : view === 'resumen' ? (
            <>
              {totals && (
                <div className="kpis">
                  <div>
                    <b>{totals.worked}</b>
                    <span>días trabajados</span>
                  </div>
                  <div>
                    <b>{hours(totals.min)}</b>
                    <span>horas</span>
                  </div>
                  <div className={totals.late ? 'bad' : ''}>
                    <b>{totals.late}</b>
                    <span>llegadas tarde</span>
                  </div>
                  <div className={totals.absent ? 'bad' : ''}>
                    <b>{totals.absent}</b>
                    <span>ausencias</span>
                  </div>
                  <div>
                    <b>{totals.justified}</b>
                    <span>justificadas</span>
                  </div>
                  <div className={totals.review ? 'warn' : ''}>
                    <b>{totals.review}</b>
                    <span>a revisar</span>
                  </div>
                </div>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empleado</th>
                      <th>Días</th>
                      <th>Horas</th>
                      <th>Tarde</th>
                      <th>Salió antes</th>
                      <th>Ausente</th>
                      <th>A revisar</th>
                      <th>Novedades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.summary.map((s) => (
                      <tr key={s.employeeId}>
                        <td>
                          {s.name}
                          <div className="muted small">{s.site}</div>
                        </td>
                        <td>
                          {s.workedDays}
                          {s.expectedDays ? <span className="muted">/{s.expectedDays}</span> : null}
                        </td>
                        <td>{hours(s.workedMin)}</td>
                        <td className={s.lateCount ? 'bad' : ''}>{s.lateCount ? `${s.lateCount} (${s.lateMin}′)` : '–'}</td>
                        <td className={s.earlyCount ? 'bad' : ''}>{s.earlyCount ? `${s.earlyCount} (${s.earlyMin}′)` : '–'}</td>
                        <td className={s.absentDays ? 'bad' : ''}>{s.absentDays || '–'}</td>
                        <td className={s.review ? 'warn' : ''}>{s.review || '–'}</td>
                        <td className="small">
                          {Object.entries(s.byKind)
                            .map(([k, n]) => `${KIND_SHORT[k as AbsenceKind]} ${n}`)
                            .join(' · ') || '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Días: trabajados / esperados según el horario. Tarde y salió antes: cantidad de veces (minutos en total,
                fuera de la tolerancia).
              </p>
            </>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Fecha</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Duración</th>
                    <th>Horario</th>
                    <th>Observaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => {
                    const first = i === 0 || records[i - 1]!.employeeId !== r.employeeId;
                    // La sucursal sólo cuando cambia: así se ve cuándo rotó.
                    const siteChanged = first || records[i - 1]!.site !== r.site;
                    return (
                      <tr key={`${r.employeeId}-${r.date}`} className={first ? 'group-start' : ''}>
                        <td>
                          {first ? (
                            <>
                              {r.lastName}, {r.firstName}
                            </>
                          ) : (
                            ''
                          )}
                          {siteChanged && <div className="muted small">{r.site}</div>}
                        </td>
                        <td className="nowrap">
                          {r.weekday.slice(0, 3)} {shortDate(r.date)}
                        </td>
                        <td className={r.review && r.in ? 'guess' : ''}>{r.in ?? '–'}</td>
                        <td className={r.review && r.out ? 'guess' : ''}>{r.out ?? '–'}</td>
                        <td>{r.workedMin ? hours(r.workedMin) : '–'}</td>
                        <td className="muted small nowrap">{r.expected ?? 'libre'}</td>
                        <td className={r.status === 'ausente' || r.lateMin || r.earlyMin ? 'bad small' : r.review || r.manualNotes.length ? 'warn small' : 'small'}>
                          {remarks(r)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small print-only">Generado con Control Horario el {new Date().toLocaleString('es-AR', { hour12: false })}</p>
        </div>
      )}
    </section>
  );
}
