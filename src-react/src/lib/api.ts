import type {
  Project, ProjectContext, Stats,
  Scenario, Analysis,
  Session, SessionResult,
  Campaign,
  CoverageMatrixRow,
  ClickUpConfig, ClickUpList,
  ComepReport,
  User, AuthState,
  Notification,
} from '../types';

const BASE_URL = '';
const PROJECT_KEY = 'testpilot_current_project';
const AUTH_KEY    = 'testpilot_auth';

// ── Helpers projet ────────────────────────────────────
function getCurrentProjectId(): number | null {
  const stored = localStorage.getItem(PROJECT_KEY);
  return stored ? parseInt(stored, 10) : null;
}

function setCurrentProjectId(id: number): void {
  localStorage.setItem(PROJECT_KEY, String(id));
  window.dispatchEvent(new CustomEvent('projectChanged', { detail: { projectId: id } }));
}

// ── Helpers auth ──────────────────────────────────────
function getAuthState(): AuthState {
  const stored = localStorage.getItem(AUTH_KEY);
  return stored ? JSON.parse(stored) : { user: null, token: null };
}

function setAuthState(state: AuthState): void {
  localStorage.setItem(AUTH_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('authChanged', { detail: state }));
}

function clearAuthState(): void {
  localStorage.removeItem(AUTH_KEY);
  window.dispatchEvent(new CustomEvent('authChanged', { detail: { user: null, token: null } }));
}

// ── Requête générique ─────────────────────────────────
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = getAuthState();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

  const options: RequestInit = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(BASE_URL + path, options);

  if (response.status === 401) {
    clearAuthState();
    window.location.href = '/login';
    throw new Error('Session expirée — veuillez vous reconnecter.');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Erreur API');
  }

  return response.json();
}

export const api = {
  get:    <T>(path: string)                => request<T>('GET',    path),
  post:   <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:    <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  patch:  <T>(path: string, body?: unknown)=> request<T>('PATCH',  path, body),
  delete: <T>(path: string)                => request<T>('DELETE', path),
};

// ══════════════════════════════════════════════════════
// Projets
// ══════════════════════════════════════════════════════
export const projectsApi = {
  list:          ()                                     => api.get<Project[]>('/api/projects'),
  get:           (id: number)                           => api.get<Project>(`/api/projects/${id}`),
  create:        (data: Partial<Project>)               => api.post<Project>('/api/projects', data),
  update:        (id: number, data: Partial<Project>)   => api.put<Project>(`/api/projects/${id}`, data),
  delete:        (id: number)                           => api.delete<void>(`/api/projects/${id}`),
  getContext:    (id: number)                           => api.get<ProjectContext>(`/api/projects/${id}/context`),
  updateContext: (id: number, data: Partial<ProjectContext>) =>
    api.put<ProjectContext>(`/api/projects/${id}/context`, data),
  getStats:      (id: number)                           => api.get<Stats>(`/api/projects/${id}/stats`),
};

// ══════════════════════════════════════════════════════
// Scénarios
// ══════════════════════════════════════════════════════
export const scenariosApi = {
  list:          (projectId: number) => api.get<Scenario[]>(`/api/projects/${projectId}/scenarios`),
  create:        (projectId: number, scenarios: Partial<Scenario>[]) =>
    api.post<Scenario[]>(`/api/projects/${projectId}/scenarios`, scenarios),
  update:        (id: number, data: Partial<Scenario>) => api.put<Scenario>(`/api/scenarios/${id}`, data),
  delete:        (id: number)        => api.delete<void>(`/api/scenarios/${id}`),
  deleteAll:     (projectId: number) => api.delete<void>(`/api/projects/${projectId}/scenarios`),
  toggleAccept:  (id: number)        => api.patch<void>(`/api/scenarios/${id}/accept`),
  toggleTNR:     (id: number)        => api.patch<void>(`/api/scenarios/${id}/tnr`),
  acceptAll:     (projectId: number) => api.post<void>(`/api/projects/${projectId}/scenarios/accept-all`, {}),
  updateReference: (id: number, ref: string) =>
    api.put<void>(`/api/scenarios/${id}/reference`, { source_reference: ref }),
  // P3.2 workflow
  submit:   (id: number) => api.patch<Scenario>(`/api/scenarios/${id}/submit`),
  validate: (id: number) => api.patch<Scenario>(`/api/scenarios/${id}/validate`),
  reject:   (id: number, reason: string) =>
    api.patch<Scenario>(`/api/scenarios/${id}/reject`, { reason }),
  // P3.3 assignation
  assign:   (id: number, userId: number | null) =>
    api.patch<Scenario>(`/api/scenarios/${id}/assign`, { user_id: userId }),
};

// ══════════════════════════════════════════════════════
// Analyses
// ══════════════════════════════════════════════════════
export const analysesApi = {
  get:  (projectId: number)                            => api.get<Analysis>(`/api/projects/${projectId}/analysis`),
  save: (projectId: number, data: Omit<Analysis, 'id'>) =>
    api.post<Analysis>(`/api/projects/${projectId}/analysis`, data),
};

// ══════════════════════════════════════════════════════
// Sessions de campagne
// ══════════════════════════════════════════════════════
export const sessionsApi = {
  list:      (projectId: number) => api.get<Session[]>(`/api/projects/${projectId}/sessions`),
  get:       (id: number)        => api.get<Session>(`/api/sessions/${id}`),
  create:    (projectId: number, data: { name: string }) =>
    api.post<Session>(`/api/projects/${projectId}/sessions`, {
      session_name: data.name,
      scenario_count: 0,
    }),
  finish:    (id: number)        => api.put<Session>(`/api/sessions/${id}/finish`, {}),
  addResult: (sessionId: number, data: { scenario_id: number; status: string; notes?: string }) =>
    api.post<SessionResult>(`/api/sessions/${sessionId}/results`, {
      scenario_id: data.scenario_id,
      status:      data.status.toUpperCase().replace('BLOCKED', 'BLOQUE'),
      comment:     data.notes ?? '',
    }),
};

// ══════════════════════════════════════════════════════
// P1.1 Import Excel
// ══════════════════════════════════════════════════════
export const importApi = {
  uploadExcel: (projectId: number, fileBuffer: ArrayBuffer, options: {
    markTNR?: boolean;
    autoAccept?: boolean;
    useAI?: boolean;
    apiKey?: string;
  }) => {
    // Envoie le binaire XLSX + options en JSON dans le header custom
    const opts = encodeURIComponent(JSON.stringify(options));
    return fetch(`/api/projects/${projectId}/import-excel?opts=${opts}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
      },
      body: fileBuffer,
    }).then(async (res) => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Erreur import');
      }
      return res.json() as Promise<{ imported: number; scenarios: Partial<Scenario>[] }>;
    });
  },
};

// ══════════════════════════════════════════════════════
// P1.2 Historique campagnes
// ══════════════════════════════════════════════════════
export const campaignsApi = {
  list:    (projectId: number) => api.get<Campaign[]>(`/api/projects/${projectId}/campaigns`),
  get:     (id: number)        => api.get<Campaign>(`/api/campaigns/${id}`),
  archive: (projectId: number, data: Partial<Campaign> & { results?: unknown[] }) =>
    api.post<{ id: number }>(`/api/projects/${projectId}/campaigns`, data),
  delete:  (id: number) => api.delete<void>(`/api/campaigns/${id}`),
  getKpis: (projectId: number) => api.get<{
    campaigns: { id: number; name: string; type: string; finished_at: string; total: number; pass: number; fail: number; blocked: number; success_rate: number; leak_rate: number }[];
    aggregates: { total_campaigns: number; avg_success_rate: number; avg_leak_rate: number; avg_duration_sec: number; trend_vs_previous: number | null } | null;
  }>(`/api/projects/${projectId}/campaigns/kpis`),
};

// ══════════════════════════════════════════════════════
// P1.3 Traçabilité
// ══════════════════════════════════════════════════════
export const traceabilityApi = {
  getCoverageMatrix: (projectId: number) =>
    api.get<{ matrix: CoverageMatrixRow[]; stats: Record<string, number> }>(
      `/api/projects/${projectId}/coverage-matrix`
    ),
};

// ══════════════════════════════════════════════════════
// P2.1 ClickUp
// ══════════════════════════════════════════════════════
export const clickupApi = {
  /** Charge la config — mappe api_token → token pour usage front */
  getConfig: async (projectId: number): Promise<ClickUpConfig> => {
    const raw = await api.get<ClickUpConfig & { api_token?: string }>(
      `/api/projects/${projectId}/clickup-config`
    );
    return { ...raw, token: raw.token ?? raw.api_token ?? '' };
  },

  /** Sauvegarde — renomme token → api_token pour le backend */
  saveConfig: (projectId: number, data: ClickUpConfig) =>
    api.put<{ saved: boolean }>(`/api/projects/${projectId}/clickup-config`, {
      api_token:        data.token ?? data.api_token,
      list_id:          data.list_id,
      tag_prefix:       data.tag_prefix,
      default_priority: data.default_priority,
      enabled:          data.enabled ?? true,
      workspace_id:     data.workspace_id,
    }),

  /** GET /api/clickup/lists?token=... — le backend attend un GET, pas un POST */
  getLists: (token: string): Promise<ClickUpList[]> =>
    fetch(`/api/clickup/lists?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${(JSON.parse(localStorage.getItem('testpilot_auth') || '{}') as { token?: string }).token ?? ''}` },
    }).then(async res => {
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as { error?: string }).error || 'Erreur ClickUp');
      }
      const data = await res.json() as { lists?: ClickUpList[] };
      // Le backend retourne { lists: [...] }
      return data.lists ?? (data as unknown as ClickUpList[]);
    }),

  /** Crée les tickets en lot depuis une campagne — construit les items[] attendus par le backend */
  createBatch: async (payload: {
    projectId: number;
    campaignId: number;
    listId: string;
    token: string;
    tagPrefix?: string;
    defaultPriority?: number;
  }): Promise<{ created: number; errors: number; results: unknown[] }> => {
    // Récupérer les détails de la campagne pour extraire les résultats FAIL/BLOQUÉ
    const campaign = await api.get<Campaign & { results?: { id?: string; title?: string; feature?: string; status?: string; comment?: string; priority?: string; given?: string; when?: string; then?: string; source_reference?: string }[] }>(
      `/api/campaigns/${payload.campaignId}`
    );
    const failedItems = (campaign.results ?? [])
      .filter(r => r.status === 'fail' || r.status === 'blocked')
      .map(r => ({
        scenario: {
          id:               r.id,
          title:            r.title ?? '(sans titre)',
          feature:          r.feature,
          priority:         r.priority ?? 'medium',
          source_reference: r.source_reference,
          given:            r.given,
          when:             r.when,
          then:             r.then,
        },
        status:  r.status,
        comment: r.comment ?? null,
      }));

    if (failedItems.length === 0) {
      throw new Error('Aucun résultat FAIL ou BLOQUÉ dans cette campagne.');
    }

    return api.post<{ created: number; errors: number; results: unknown[] }>('/api/clickup/create-batch', {
      api_token:     payload.token,
      list_id:       payload.listId,
      campaign_name: (campaign.name ?? campaign.campaign_name) ?? 'Campagne',
      tag_prefix:    payload.tagPrefix,
      items:         failedItems,
    });
  },
};

// ══════════════════════════════════════════════════════
// P2.2 Rapport COMEP
// ══════════════════════════════════════════════════════
export const comepApi = {
  getReport: (projectId: number) =>
    api.get<ComepReport>(`/api/projects/${projectId}/comep-report`),
};

// ══════════════════════════════════════════════════════
// P3.1 Utilisateurs / Auth
// ══════════════════════════════════════════════════════
export const authApi = {
  login:    (username: string, password: string) =>
    api.post<{ token: string; user: User }>('/api/auth/login', { username, password }),
  logout:   () => api.post<void>('/api/auth/logout', {}),
  me:       () => api.get<User>('/api/auth/me'),
  register: (data: { username: string; password: string; display_name: string; role: string; email?: string }) =>
    api.post<User>('/api/auth/register', data),
};

export const usersApi = {
  list:   ()                          => api.get<User[]>('/api/users'),
  get:    (id: number)                => api.get<User>(`/api/users/${id}`),
  update: (id: number, data: Partial<User> & { password?: string }) =>
    api.put<User>(`/api/users/${id}`, data),
  delete: (id: number)                => api.delete<void>(`/api/users/${id}`),
};

// ══════════════════════════════════════════════════════
// P3.3 Notifications
// ══════════════════════════════════════════════════════
export const notificationsApi = {
  list:    ()           => api.get<Notification[]>('/api/notifications'),
  markRead:(id: number) => api.patch<void>(`/api/notifications/${id}/read`),
  markAllRead: ()       => api.post<void>('/api/notifications/read-all', {}),
};

// ══════════════════════════════════════════════════════
// Stores partagés
// ══════════════════════════════════════════════════════
export const projectStore = {
  getCurrentProjectId,
  setCurrentProjectId,
};

export const authStore = {
  getAuthState,
  setAuthState,
  clearAuthState,
};
