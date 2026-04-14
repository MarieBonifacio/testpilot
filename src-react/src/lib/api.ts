const BASE_URL = '';
const PROJECT_KEY = 'testpilot_current_project';

function getCurrentProjectId(): number | null {
  const stored = localStorage.getItem(PROJECT_KEY);
  return stored ? parseInt(stored, 10) : null;
}

function setCurrentProjectId(id: number): void {
  localStorage.setItem(PROJECT_KEY, String(id));
  window.dispatchEvent(new CustomEvent('projectChanged', { detail: { projectId: id } }));
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(BASE_URL + path, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Erreur API');
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export const projectsApi = {
  list: () => api.get<import('../types').Project[]>('/api/projects'),
  get: (id: number) => api.get<import('../types').Project>(`/api/projects/${id}`),
  create: (data: Partial<import('../types').Project>) =>
    api.post<import('../types').Project>('/api/projects', data),
  update: (id: number, data: Partial<import('../types').Project>) =>
    api.put<import('../types').Project>(`/api/projects/${id}`, data),
  delete: (id: number) => api.delete<void>(`/api/projects/${id}`),
  getContext: (id: number) =>
    api.get<import('../types').ProjectContext>(`/api/projects/${id}/context`),
  updateContext: (id: number, data: Partial<import('../types').ProjectContext>) =>
    api.put<import('../types').ProjectContext>(`/api/projects/${id}/context`, data),
  getStats: (id: number) => api.get<import('../types').Stats>(`/api/projects/${id}/stats`),
};

export const scenariosApi = {
  list: (projectId: number) => api.get<import('../types').Scenario[]>(`/api/projects/${projectId}/scenarios`),
  create: (projectId: number, scenarios: import('../types').Scenario[]) =>
    api.post<import('../types').Scenario[]>(`/api/projects/${projectId}/scenarios`, scenarios),
  update: (id: number, data: Partial<import('../types').Scenario>) =>
    api.put<import('../types').Scenario>(`/api/scenarios/${id}`, data),
  delete: (id: number) => api.delete<void>(`/api/scenarios/${id}`),
  deleteAll: (projectId: number) => api.delete<void>(`/api/projects/${projectId}/scenarios`),
  toggleAccept: (id: number) => api.patch<void>(`/api/scenarios/${id}/accept`),
  toggleTNR: (id: number) => api.patch<void>(`/api/scenarios/${id}/tnr`),
  acceptAll: (projectId: number) => api.post<void>(`/api/projects/${projectId}/scenarios/accept-all`, {}),
};

export const analysesApi = {
  get: (projectId: number) => api.get<import('../types').Analysis>(`/api/projects/${projectId}/analysis`),
  save: (projectId: number, data: Omit<import('../types').Analysis, 'id'>) =>
    api.post<import('../types').Analysis>(`/api/projects/${projectId}/analysis`, data),
};

export const sessionsApi = {
  list: (projectId: number) => api.get<import('../types').Session[]>(`/api/projects/${projectId}/sessions`),
  get: (id: number) => api.get<import('../types').Session>(`/api/sessions/${id}`),
  create: (projectId: number, data: { name: string }) =>
    api.post<import('../types').Session>(`/api/projects/${projectId}/sessions`, { session_name: data.name, scenario_count: 0 }),
  finish: (id: number) => api.put<import('../types').Session>(`/api/sessions/${id}/finish`, {}),
  addResult: (sessionId: number, data: { scenario_id: number; status: string; notes?: string }) =>
    api.post<import('../types').SessionResult>(`/api/sessions/${sessionId}/results`, {
      scenario_id: data.scenario_id,
      status: data.status.toUpperCase().replace('BLOCKED', 'BLOQUE'),
      comment: data.notes ?? '',
    }),
};

export const projectStore = {
  getCurrentProjectId,
  setCurrentProjectId,
};