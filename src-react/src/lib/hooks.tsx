import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { projectsApi, projectStore, authStore, authApi, notificationsApi } from './api';
import type { Project, ProjectContext, User, AuthState, Notification } from '../types';

// ══════════════════════════════════════════════════════
// Project context
// ══════════════════════════════════════════════════════
interface ProjectContextType {
  projectId: number | null;
  project: Project | null;
  context: ProjectContext | null;
  loading: boolean;
  setProjectId: (id: number | null) => void;
  refetch: () => Promise<void>;
}

const ProjectCtx = createContext<ProjectContextType | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectId, setProjectIdState] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [loading, setLoading] = useState(false);

  const setProjectId = useCallback((id: number | null) => {
    if (id) projectStore.setCurrentProjectId(id);
    setProjectIdState(id);
  }, []);

  const refetch = useCallback(async () => {
    if (!projectId) { setProject(null); setContext(null); return; }
    setLoading(true);
    try {
      const [p, ctx] = await Promise.all([
        projectsApi.get(projectId),
        projectsApi.getContext(projectId).catch(() => null),
      ]);
      setProject(p);
      setContext(ctx);
    } catch (err) {
      console.error('Error loading project:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const id = projectStore.getCurrentProjectId();
    if (id && id !== projectId) setProjectIdState(id);
  }, []);

  useEffect(() => {
    if (projectId) refetch();
  }, [projectId, refetch]);

  return (
    <ProjectCtx.Provider value={{ projectId, project, context, loading, setProjectId, refetch }}>
      {children}
    </ProjectCtx.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}

// ══════════════════════════════════════════════════════
// Auth context
// ══════════════════════════════════════════════════════
interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthCtx = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthStateLocal] = useState<AuthState>(authStore.getAuthState);
  const [loading, setLoading] = useState(false);

  const login = useCallback(async (username: string, password: string) => {
    setLoading(true);
    try {
      const res = await authApi.login(username, password);
      const state: AuthState = { user: res.user, token: res.token };
      authStore.setAuthState(state);
      setAuthStateLocal(state);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    authStore.clearAuthState();
    setAuthStateLocal({ user: null, token: null });
  }, []);

  return (
    <AuthCtx.Provider value={{ user: authState.user, token: authState.token, login, logout, loading }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ══════════════════════════════════════════════════════
// Notifications hook
// ══════════════════════════════════════════════════════
const POLL_BASE_MS  = 30_000;
const POLL_MAX_MS   = 5 * 60_000; // back-off cap: 5 min

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // useRef — valeurs mutables stables sans déclencher de re-render
  const failCountRef = useRef(0);
  const timerIdRef   = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    if (!user || document.hidden) return;
    try {
      const data = await notificationsApi.list();
      setNotifications(data);
      setUnreadCount(data.filter(n => !n.read).length);
      failCountRef.current = 0; // reset back-off on success
    } catch {
      failCountRef.current += 1;
    }
  }, [user]);

  const schedule = useCallback(() => {
    const backoff = Math.min(POLL_BASE_MS * 2 ** failCountRef.current, POLL_MAX_MS);
    timerIdRef.current = setTimeout(async () => {
      await load();
      schedule();
    }, backoff);
  }, [load]);

  useEffect(() => {
    if (!user) return; // ne pas démarrer le polling sans utilisateur connecté
    load();
    schedule();

    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timerIdRef.current);
    };
  }, [user, load, schedule]);

  const markRead = async (id: number) => {
    await notificationsApi.markRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  };

  const markAllRead = async () => {
    await notificationsApi.markAllRead();
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  return { notifications, unreadCount, markRead, markAllRead, reload: load };
}
