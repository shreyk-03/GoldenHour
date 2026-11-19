export type AuthRole = 'admin' | 'dispatcher' | 'hospital';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  hospital_id?: string | null;
};

export const TOKEN_KEY = 'goldenhour.token';

const envApi = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
export const API_BASE = envApi ? envApi.replace(/\/$/, '') : '';

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setToken = (token: string) => {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode) — session stays in memory only
  }
};

export const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // no-op
  }
};

export const authFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('goldenhour:unauthorized'));
  }
  return response;
};
