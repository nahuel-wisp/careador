import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';

export interface User {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'manager';
  /** Contraseña provisoria: la app sólo muestra el cambio de contraseña. */
  mustChangePassword: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** Actualiza el usuario después de cambiar la contraseña. */
  setUser(u: User): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<User | null>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setUser(await api<User>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }));
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
