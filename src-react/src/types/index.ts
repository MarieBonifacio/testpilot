export interface Project {
  id: number;
  name: string;
  tech_stack?: string;
  business_domain?: string;
  description?: string;
  scenario_count?: number;
  accepted_count?: number;
  created_at?: string;
}

export interface ProjectContext {
  adjacent_features?: string;
  global_constraints?: string;
}

export interface Scenario {
  id?: number;
  scenario_id: string;
  title: string;
  scenario_type: 'functional' | 'negative' | 'edge-case' | 'boundary';
  priority: 'high' | 'medium' | 'low';
  given_text: string;
  when_text: string;
  then_text: string;
  feature_name?: string;
  accepted?: boolean;
  is_tnr?: boolean;
  source_reference?: string;
  /** Workflow P3.2 */
  validation_status?: 'draft' | 'submitted' | 'validated' | 'rejected';
  rejection_reason?: string | null;
  assigned_to?: number | null;
  assignee_name?: string | null;
  created_at?: string;
}

export interface Analysis {
  id?: number;
  feature_detected: string;
  complexity: 'simple' | 'moyenne' | 'complexe';
  ambiguities: string[];
  regression_risks: string[];
  created_at?: string;
}

export interface Stats {
  total: number;
  accepted: number;
  /** Backend field — number of TNR-flagged scenarios */
  tnr_count: number;
  critical: number;
  features: { feature_name: string; total: number; accepted: number }[];
}

export interface Session {
  id: number;
  session_name: string;
  scenario_count: number;
  started_at: string;
  finished_at?: string;
  pass_count?: number;
  fail_count?: number;
  blocked_count?: number;
}

export interface SessionResult {
  id: number;
  scenario_id: number;
  status: 'PASS' | 'FAIL' | 'BLOQUE';
  comment?: string;
}

// ── P1.1 Import Excel ────────────────────────────────
export interface ImportPreviewRow {
  title: string;
  scenario_type: string;
  priority: string;
  given_text: string;
  when_text: string;
  then_text: string;
  feature_name?: string;
  is_tnr?: boolean;
  accepted?: boolean;
  _rowIndex?: number;
}

// ── P1.2 Historique campagnes ────────────────────────
export interface Campaign {
  id: number;
  project_id: number;
  /** Nom de la campagne — champ backend `name` */
  name?: string;
  type?: string;
  started_at?: string;
  finished_at?: string;
  archived_at?: string;
  total_scenarios?: number;
  pass_count?: number;
  fail_count?: number;
  blocked_count?: number;
  not_run_count?: number;
  tnr_count?: number;
  tnr_pass?: number;
  /** Taux de succès (0-100) */
  success_rate?: number;
  /** Taux de fuite production (0-100) */
  leak_rate?: number;
  duration_sec?: number;
}

// ── P1.3 Traçabilité ─────────────────────────────────
export interface CoverageMatrixRow {
  source_reference: string | null;
  label: string;
  scenarios: {
    id: number;
    scenario_id: string;
    title: string;
    accepted: boolean;
    is_tnr: boolean;
    priority: string;
    scenario_type: string;
    validation_status?: string;
  }[];
  total: number;
  accepted: number;
  tnr: number;
  coverage_pct: number;
}



// ── P2.1 ClickUp ─────────────────────────────────────
export interface ClickUpConfig {
  /** Token API ClickUp — champ backend `api_token` */
  api_token?: string;
  list_id?: string;
  tag_prefix?: string;
  default_priority?: number;
  enabled?: boolean;
  workspace_id?: string;
}

export interface ClickUpList {
  id: string;
  name: string;
  folder?: { name: string };
  space?: { name: string };
}

// ── P2.2 COMEP ───────────────────────────────────────
// Structure réelle retournée par GET /api/projects/:id/comep-report
export interface ComepReport {
  generated_at: string;
  project: { id: number; name: string; [key: string]: unknown };
  score: {
    value: number;
    level: 'ÉLEVÉ' | 'MOYEN' | 'FAIBLE' | 'CRITIQUE';
    color: string;
    components: {
      coverage: number;          // 0-100 (représente /30)
      traceability: number;      // 0-100 (représente /20)
      pass_rate: number;         // 0-100 (représente /30)
      critical_coverage: number; // 0-100 (représente /20)
    };
  };
  summary: {
    totalScenarios: number;
    accepted: number;
    tnr: number;
    withRef: number;
    highPriority: number;
    highAccepted: number;
    coverageRate: number;
    traceRate: number;
    totalCampaigns: number;
    lastPassRate: number | null;
    lastLeakRate: number | null;
  };
  features: {
    name: string;
    total: number;
    accepted: number;
    high: number;
    coverage_pct: number;
  }[];
  residualRisks: {
    id?: string;
    title?: string;
    feature?: string;
    reason: string;
    level: 'HIGH' | 'MEDIUM';
    comment?: string | null;
  }[];
  trend: {
    name: string;
    date: string;
    pass_rate: number;
    leak_rate: number;
    total: number;
    pass: number;
    fail: number;
    blocked: number;
  }[];
  recommendations: { priority: string; text: string }[];
  lastCampaign: {
    name: string;
    date: string;
    total: number;
    pass: number;
    fail: number;
    blocked: number;
    skipped: number;
  } | null;
  lastAnalysis: {
    feature_detected: string;
    complexity: string;
    ambiguities: string[];
    regression_risks: string[];
    date: string;
  } | null;
  production?: {
    total_bugs_30d: number;
    leaked_bugs_30d: number;
    leak_rate_30d: number;
    critical_bugs_30d: {
      id: number; title: string; severity: string;
      feature: string | null; detected_date: string; external_id: string | null;
    }[];
  };
}

// ── P3.1 Utilisateurs / Rôles ────────────────────────
export type UserRole = 'automaticien' | 'cp' | 'key_user' | 'admin';

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  email?: string;
  created_at?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
}

// ── P3.3 Notifications ───────────────────────────────
export interface Notification {
  id: number;
  user_id: number;
  type: 'assigned' | 'validated' | 'rejected' | 'submitted';
  message: string;
  scenario_id?: number;
  read: boolean;
  created_at: string;
}

// ── P4.1 Production bugs / Taux de fuite ─────────────
export interface ProductionBug {
  id: number;
  project_id: number;
  external_id: string | null;
  title: string;
  description: string | null;
  severity: 'critical' | 'major' | 'minor' | 'trivial';
  scenario_id: number | null;
  scenario_title?: string | null;
  scenario_ref?: string | null;
  detected_date: string;
  feature: string | null;
  root_cause: string | null;
  created_at: string;
}

export interface LeakRateKPI {
  total_bugs: number;
  bugs_with_scenario: number;
  bugs_without_scenario: number;
  leak_rate_percent: number;
  by_severity: Record<string, { total: number; leaked: number }>;
  by_feature: Record<string, { total: number; leaked: number }>;
  trend_30d: (number | null)[];
  recent_bugs: Pick<ProductionBug, 'id' | 'title' | 'severity' | 'feature' | 'detected_date' | 'scenario_id' | 'scenario_title' | 'external_id'>[];
}

export interface ProductionBugListResponse {
  bugs: ProductionBug[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ── P4.2 Durée TNR + Flakiness ───────────────────────
export interface TnrDurationKPI {
  average_duration_seconds: number | null;
  average_duration_formatted: string | null;
  min_duration_seconds: number | null;
  max_duration_seconds: number | null;
  last_10_sessions: {
    id: number;
    date: string;
    session_name: string;
    duration_seconds: number;
    duration_formatted: string;
    scenario_count: number;
  }[];
  trend: 'improving' | 'stable' | 'degrading';
  target_duration_seconds: number | null;
}

export interface FlakinessKPI {
  global_flakiness_rate: number;
  flaky_scenarios_count: number;
  total_scenarios_count: number;
  stability_rate: number;
  most_flaky: {
    scenario_id: number;
    scenario_ref: string;
    title: string;
    feature: string | null;
    priority: string;
    flakiness_rate: number;
    total_executions: number;
    flaky_changes: number;
    last_change: string | null;
    last_from: string | null;
    last_to: string | null;
  }[];
  by_feature: Record<string, { count: number; flaky_count: number }>;
}

export interface FlakinessHistory {
  history: {
    id: number;
    session_id: number;
    previous_status: string | null;
    new_status: string;
    is_flaky_change: number;
    detected_at: string;
    session_name: string;
    finished_at: string;
  }[];
  stats: {
    scenario_id: number;
    total_executions: number;
    flaky_changes: number;
    flakiness_rate: number;
    last_status: string | null;
    last_calculated: string;
  } | null;
}

// ── P5.1 CI/CD API Tokens ─────────────────────────────
export interface ApiToken {
  id: number;
  name: string;
  token_prefix: string;
  scopes: string[];
  project_ids: number[] | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ApiTokenCreated extends ApiToken {
  token: string; // affiché une seule fois à la création
  message: string;
}

export interface TriggerHistory {
  id: number;
  session_id: number;
  session_name: string;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  project_name: string;
  token_name: string | null;
  trigger_source: string | null;
  commit_sha: string | null;
  branch: string | null;
  pipeline_url: string | null;
  triggered_at: string;
}

// ── P6 Export documentaire ────────────────────────────
export interface ProjectDocConfig {
  project_id: number;
  filiale: string;
  company_name: string | null;
  company_address: string | null;
  company_postal_code: string | null;
  company_city: string | null;
  company_email: string | null;
  logo_base64: string | null;
  updated_at: string | null;
}

// ── Audit Logs ────────────────────────────────────────
export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// ── LLM / Provider ────────────────────────────────────
export type ProviderKey = 'anthropic' | 'openai' | 'mistral' | 'ollama';

export interface ProviderConfig {
  label: string;
  needsKey: boolean;
  endpoint?: string;
  keyPlaceholder?: string;
  endpointEditable?: boolean;
  offline?: boolean;
  models: string[];
}

export interface ProviderSettings {
  key: string;
  model: string;
  endpoint: string;
  host?: string;
  modelCustom?: string;
}

export interface StoredProviderState {
  _current: ProviderKey;
  anthropic: ProviderSettings;
  openai: ProviderSettings;
  mistral: ProviderSettings;
  ollama: ProviderSettings & { _cachedModels?: string[] };
}

export type OllamaStatus = 'unknown' | 'ok' | 'error';

// ── P9.1 User Stories ─────────────────────────────────
export type UserStoryPriority = 'high' | 'medium' | 'low';
export type UserStoryStatus = 'draft' | 'ready' | 'in_progress' | 'done';

export interface UserStoryCriterion {
  id: number;
  user_story_id: number;
  criterion: string;
  display_order: number;
  created_at: string;
}

export interface UserStory {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  epic: string | null;
  priority: UserStoryPriority;
  story_points: number | null;
  status: UserStoryStatus;
  created_by: number | null;
  assigned_to: number | null;
  created_at: string;
  updated_at: string;
  // Relations (populated by backend)
  criteria?: UserStoryCriterion[];
  linked_scenarios?: number[]; // IDs des scénarios liés
  creator_name?: string;
  assignee_name?: string;
}

export interface CreateUserStoryPayload {
  title: string;
  description?: string;
  epic?: string;
  priority?: UserStoryPriority;
  story_points?: number;
  status?: UserStoryStatus;
  criteria?: string[]; // Liste de critères texte
}

export interface UpdateUserStoryPayload extends Partial<CreateUserStoryPayload> {
  assigned_to?: number | null;
}

export interface GenerateUserStoryPayload {
  input_description: string;
  provider?: ProviderKey;
  model?: string;
  temperature?: number;
}

export interface GenerateBatchUserStoriesPayload {
  context_description: string;
  count?: number; // Nombre de US à générer (défaut: 5)
  provider?: ProviderKey;
  model?: string;
  temperature?: number;
}
