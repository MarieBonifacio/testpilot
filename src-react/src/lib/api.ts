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
  ProductionBug, LeakRateKPI, ProductionBugListResponse,
  TnrDurationKPI, FlakinessKPI, FlakinessHistory,
  ApiToken, ApiTokenCreated, TriggerHistory,
  ProjectDocConfig,
  AuditLog,
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

// ── Gestion centralisée des headers et réponses 401/tokenExpiresSoon ─────────
async function handleResponse(response: Response): Promise<void> {
  if (response.status === 401) {
    clearAuthState();
    window.location.href = '/login';
    throw new Error('Session expirée — veuillez vous reconnecter.');
  }
  const expiresSoon = response.headers.get('X-Token-Expires-Soon');
  if (expiresSoon) {
    window.dispatchEvent(new CustomEvent('tokenExpiresSoon', { detail: { expires_at: expiresSoon } }));
  }
}

function buildAuthHeaders(): Record<string, string> {
  const auth = getAuthState();
  const headers: Record<string, string> = {};
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
  return headers;
}

// ── Requête générique JSON ────────────────────────────
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(),
  };

  const options: RequestInit = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(BASE_URL + path, options);
  await handleResponse(response);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Erreur API');
  }

  return response.json();
}

// ── Requête binaire (téléchargements DOCX, etc.) ──────
async function requestBlob(path: string): Promise<Blob> {
  const headers: Record<string, string> = buildAuthHeaders();
  const response = await fetch(BASE_URL + path, { method: 'GET', headers });
  await handleResponse(response);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Erreur téléchargement');
  }

  return response.blob();
}

export const api = {
  get:         <T>(path: string)                => request<T>('GET',    path),
  getBlob:     (path: string)                   => requestBlob(path),
  post:        <T>(path: string, body: unknown) => request<T>('POST',   path, body),
  put:         <T>(path: string, body: unknown) => request<T>('PUT',    path, body),
  patch:       <T>(path: string, body?: unknown)=> request<T>('PATCH',  path, body),
  delete:      <T>(path: string)                => request<T>('DELETE', path),
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
  create:    (projectId: number, data: { name: string; is_tnr?: boolean }) =>
    api.post<Session>(`/api/projects/${projectId}/sessions`, {
      session_name:   data.name,
      scenario_count: 0,
      is_tnr:         data.is_tnr ? 1 : 0,
    }),
  finish:    (id: number)        => api.put<{ finished: boolean; duration_seconds: number | null }>(`/api/sessions/${id}/finish`, {}),
  setTNR:    (id: number, is_tnr: boolean) => api.patch<{ updated: boolean }>(`/api/sessions/${id}/is-tnr`, { is_tnr }),
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
    // buildAuthHeaders() garantit que le token Bearer est toujours présent
    const opts = encodeURIComponent(JSON.stringify(options));
    return fetch(`/api/projects/${projectId}/import-excel?opts=${opts}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...buildAuthHeaders(),
        ...(options.apiKey ? { 'x-api-key': options.apiKey } : {}),
      },
      body: fileBuffer,
    }).then(async (res) => {
      if (res.status === 401) {
        clearAuthState();
        window.location.href = '/login';
        throw new Error('Session expirée — veuillez vous reconnecter.');
      }
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
  /** Charge la config depuis le backend */
  getConfig: (projectId: number): Promise<ClickUpConfig> =>
    api.get<ClickUpConfig>(`/api/projects/${projectId}/clickup-config`),

  /** Sauvegarde la config */
  saveConfig: (projectId: number, data: ClickUpConfig) =>
    api.put<{ saved: boolean }>(`/api/projects/${projectId}/clickup-config`, {
      api_token:        data.api_token,
      list_id:          data.list_id,
      tag_prefix:       data.tag_prefix,
      default_priority: data.default_priority,
      enabled:          data.enabled ?? true,
      workspace_id:     data.workspace_id,
    }),

  /** GET /api/clickup/lists?token=... */
  getLists: (token: string | undefined): Promise<ClickUpList[]> =>
    fetch(`/api/clickup/lists?token=${encodeURIComponent(token ?? '')}`, {
      headers: buildAuthHeaders(),
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
      campaign_name: campaign.name ?? 'Campagne',
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

// ═══════════════════════════════
// LLM / Ollama
// ════════════════════════════════════════════════════

/**
 * Shared LLM API for React pages.
 * Ollama always goes via the backend proxy — never a direct browser call.
 */
export const llmApi = {
  /** Check Ollama health via the backend proxy. */
  checkOllamaHealth: async (host = 'http://localhost:11434'): Promise<{ ok: boolean; error?: string }> => {
    const auth = getAuthState();
    const headers: Record<string, string> = {};
    if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
    try {
      const res = await fetch(`/api/ollama/health?host=${encodeURIComponent(host)}`, { headers });
      return res.json() as Promise<{ ok: boolean; error?: string }>;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  /** Fetch the list of installed Ollama models via the backend proxy. */
  getOllamaModels: async (host = 'http://localhost:11434'): Promise<string[]> => {
    const auth = getAuthState();
    const headers: Record<string, string> = {};
    if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
    const res = await fetch(`/api/ollama/models?host=${encodeURIComponent(host)}`, { headers });
    if (!res.ok) throw new Error(`Impossible de lister les modèles Ollama (HTTP ${res.status})`);
    const data = await res.json() as { models: string[] };
    return data.models ?? [];
  },

  /**
   * Call an LLM using the provider settings.
   * - Si `opts.providerOverride` est fourni, il est utilisé directement (ex: depuis Redaction.tsx).
   * - Sinon, les settings sont lus depuis localStorage (testpilot_provider).
   * Ollama est proxifié via /api/ollama/chat; Anthropic via /api/messages.
   * OpenAI et Mistral sont appelés directement depuis le navigateur.
   */
  call: async (prompt: string, opts: {
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    providerOverride?: { provider: string; key?: string; model?: string; endpoint?: string; host?: string };
  } = {}): Promise<string> => {
    let provider: string;
    let s: { key?: string; model?: string; endpoint?: string; host?: string; modelCustom?: string };

    if (opts.providerOverride) {
      provider = opts.providerOverride.provider;
      s = opts.providerOverride;
    } else {
      const stored = localStorage.getItem('testpilot_provider');
      const all = stored ? JSON.parse(stored) as Record<string, { key?: string; model?: string; endpoint?: string; host?: string; modelCustom?: string }> : {};
      provider = (all._current as string | undefined) ?? 'anthropic';
      s = all[provider] ?? {};
    }
    const model = (s.model === '__custom__' ? (s.modelCustom ?? '') : (s.model ?? '')).trim();
    const auth = getAuthState();
    const bearerHeader = auth.token ? { Authorization: `Bearer ${auth.token}` } : {} as Record<string, string>;
    const temperature = opts.temperature ?? 0.2;
    const maxTokens = opts.maxTokens ?? 2000;

    if (!model) throw new Error(`Aucun modèle sélectionné pour le provider "${provider}".`);

    if (provider === 'anthropic') {
      if (!s.key) throw new Error('Clé API Anthropic manquante. Configurez-la dans la page Rédaction.');
      const res = await fetch('/api/messages', {
        signal: opts.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': s.key, 'anthropic-version': '2023-06-01', ...bearerHeader },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(e.error?.message ?? `Erreur Anthropic ${res.status}`);
      }
      const data = await res.json() as { content: { type: string; text: string }[] };
      return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    }

    if (provider === 'ollama') {
      const res = await fetch('/api/ollama/chat', {
        signal: opts.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...bearerHeader },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature,
          host: s.host ?? 'http://localhost:11434',
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as { error?: string; hint?: string };
        const hint = e.hint ? `\n${e.hint}` : '';
        throw new Error((e.error ?? `Erreur Ollama ${res.status}`) + hint);
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content ?? '';
    }

    // OpenAI / Mistral — direct call from browser (API key required)
    if (!s.key) throw new Error(`Clé API manquante pour le provider "${provider}". Configurez-la dans la page Rédaction.`);
    const endpoint = s.endpoint ?? '';
    const res = await fetch(endpoint, {
      signal: opts.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(e.error?.message ?? `Erreur ${provider} ${res.status}`);
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  },

  /** Returns the display label of the currently active provider. */
  getActiveProviderLabel: (): string => {
    const stored = localStorage.getItem('testpilot_provider');
    const all = stored ? JSON.parse(stored) as Record<string, unknown> : {};
    const p = (all._current as string | undefined) ?? 'anthropic';
    const labels: Record<string, string> = {
      anthropic: 'Anthropic Claude', openai: 'OpenAI', mistral: 'Mistral AI', ollama: 'Ollama (local)',
    };
    return labels[p] ?? p;
  },
};


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

// ══════════════════════════════════════════════════════
// P4.1 — Production bugs / Taux de fuite
// ══════════════════════════════════════════════════════
export const productionBugsApi = {
  list: (projectId: number, params?: {
    page?: number; limit?: number; severity?: string;
    has_scenario?: 'true' | 'false'; feature?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.page)         qs.set('page',         String(params.page));
    if (params?.limit)        qs.set('limit',        String(params.limit));
    if (params?.severity)     qs.set('severity',     params.severity);
    if (params?.has_scenario) qs.set('has_scenario', params.has_scenario);
    if (params?.feature)      qs.set('feature',      params.feature);
    const q = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<ProductionBugListResponse>(`/api/projects/${projectId}/production-bugs${q}`);
  },
  create: (projectId: number, data: Omit<ProductionBug, 'id' | 'project_id' | 'created_at' | 'scenario_title' | 'scenario_ref'>) =>
    api.post<{ id: number }>(`/api/projects/${projectId}/production-bugs`, data),
  update: (id: number, data: Partial<Omit<ProductionBug, 'id' | 'project_id' | 'created_at' | 'scenario_title' | 'scenario_ref'>>) =>
    api.put<{ updated: boolean }>(`/api/production-bugs/${id}`, data),
  delete: (id: number) =>
    api.delete<{ deleted: boolean }>(`/api/production-bugs/${id}`),
  getLeakRate: (projectId: number) =>
    api.get<LeakRateKPI>(`/api/projects/${projectId}/kpis/leak-rate`),
};

// ══════════════════════════════════════════════════════
// P4.2 — KPIs Durée TNR + Flakiness
// ══════════════════════════════════════════════════════
export const kpisApi = {
  getTnrDuration: (projectId: number) =>
    api.get<TnrDurationKPI>(`/api/projects/${projectId}/kpis/tnr-duration`),
  setTnrTarget: (projectId: number, targetMinutes: number) =>
    api.post<{ saved: boolean; target_duration_minutes: number }>(
      `/api/projects/${projectId}/settings/tnr-target`,
      { target_duration_minutes: targetMinutes }
    ),
  getFlakiness: (projectId: number) =>
    api.get<FlakinessKPI>(`/api/projects/${projectId}/kpis/flakiness`),
  getFlakinessHistory: (scenarioId: number) =>
    api.get<FlakinessHistory>(`/api/scenarios/${scenarioId}/flakiness-history`),
};

// ══════════════════════════════════════════════════════
// P6 — Export documentaire
// ══════════════════════════════════════════════════════
export const exportApi = {
  // api.getBlob() utilisé pour les binaires DOCX — response.json() sur un binaire corrompait les fichiers
  downloadCahierRecette:   (projectId: number) =>
    api.getBlob(`/api/projects/${projectId}/export/cahier-recette`),
  downloadPlanTest:        (projectId: number) =>
    api.getBlob(`/api/projects/${projectId}/export/plan-test`),
  downloadRapportCampagne: (sessionId: number) =>
    api.getBlob(`/api/sessions/${sessionId}/export/rapport`),
  getDocConfig: (projectId: number) =>
    api.get<ProjectDocConfig>(`/api/projects/${projectId}/doc-config`),
  saveDocConfig: (projectId: number, data: Partial<ProjectDocConfig>) =>
    api.put<{ updated: boolean }>(`/api/projects/${projectId}/doc-config`, data),
};

// ══════════════════════════════════════════════════════
// P5.1 — CI/CD API Tokens
// ══════════════════════════════════════════════════════
export const apiTokensApi = {
  list: () =>
    api.get<ApiToken[]>('/api/user/api-tokens'),
  create: (data: { name: string; scopes?: string[]; project_ids?: number[] | null; expires_in_days?: number | null }) =>
    api.post<ApiTokenCreated>('/api/user/api-tokens', data),
  rotate: (id: number) =>
    api.post<ApiTokenCreated>(`/api/user/api-tokens/${id}/rotate`, {}),
  delete: (id: number) =>
    api.delete<{ deleted: boolean }>(`/api/user/api-tokens/${id}`),
  triggerHistory: (limit = 50) =>
    api.get<TriggerHistory[]>(`/api/trigger/history?limit=${limit}`),
};

// ══════════════════════════════════════════════════════
// Admin — Audit Logs
// ══════════════════════════════════════════════════════
export const auditApi = {
  list: (params?: { action?: string; user_id?: number; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.action)  qs.set('action',  params.action);
    if (params?.user_id) qs.set('user_id', String(params.user_id));
    if (params?.limit)   qs.set('limit',   String(params.limit));
    if (params?.offset)  qs.set('offset',  String(params.offset));
    const q = qs.toString() ? `?${qs.toString()}` : '';
    return api.get<{ logs: AuditLog[]; total: number }>(`/api/admin/audit-logs${q}`);
  },
};
