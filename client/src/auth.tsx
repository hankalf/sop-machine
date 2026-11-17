import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { PublicBranding, Role, User } from '@shared/types';
import { api, ApiError } from './api';

interface AuthState {
  user: User | null;
  branding: PublicBranding | null;
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, branding: null, loading: true, refresh: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.auth.me();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  const branding = useQuery({ queryKey: ['branding'], queryFn: api.branding, staleTime: 60 * 1000 });

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(['me'], null);
    window.addEventListener('sop:unauthorized', onUnauthorized);
    return () => window.removeEventListener('sop:unauthorized', onUnauthorized);
  }, [qc]);

  useEffect(() => {
    const color = branding.data?.appColor ?? '#1e3a8a';
    document.documentElement.style.setProperty('--brand', color);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    if (branding.data?.siteName) document.title = branding.data.siteName;
  }, [branding.data]);

  return (
    <AuthContext.Provider
      value={{
        user: me.data ?? null,
        branding: branding.data ?? null,
        loading: me.isLoading,
        refresh: () => {
          void qc.invalidateQueries({ queryKey: ['me'] });
          void qc.invalidateQueries({ queryKey: ['branding'] });
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

const rank: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
export function useCan(role: Role) {
  const { user } = useAuth();
  return !!user && rank[user.role] >= rank[role];
}
