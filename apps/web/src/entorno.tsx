import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Entorno {
  nombre: string;
  empresa: string;
  equiposSoloLectura: boolean;
  simulador: boolean;
  drivers: Array<{ brand: string; label: string; simulated: boolean }>;
}

const EntornoContext = createContext<Entorno | null>(null);

export function EntornoProvider({ children }: { children: ReactNode }) {
  const [entorno, setEntorno] = useState<Entorno | null>(null);
  useEffect(() => {
    api<Entorno>('/entorno').then(setEntorno).catch(() => {});
  }, []);
  return <EntornoContext.Provider value={entorno}>{children}</EntornoContext.Provider>;
}

export const useEntorno = () => useContext(EntornoContext);

/** Franja visible cuando no es producción, para no confundir entornos. */
export function EntornoBanner() {
  const e = useEntorno();
  if (!e || e.nombre === 'produccion') return null;
  return (
    <div className="banner">
      Entorno: <strong>{e.nombre}</strong>
      {e.equiposSoloLectura && ' · equipos reales en sólo lectura'}
    </div>
  );
}
