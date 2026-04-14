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
// Champs backend (name/pass/fail/blocked/success_rate) + aliases front
export interface Campaign {
  id: number;
  project_id: number;
  name?: string;            // champ BDD réel
  campaign_name?: string;   // alias front
  type?: string;
  started_at?: string;
  finished_at?: string;
  archived_at?: string;
  total?: number;
  total_scenarios?: number;
  pass?: number;
  pass_count?: number;
  fail?: number;
  fail_count?: number;
  blocked?: number;
  blocked_count?: number;
  skipped?: number;
  not_run_count?: number;
  tnr_count?: number;
  tnr_pass?: number;
  success_rate?: number;    // champ BDD réel
  pass_rate?: number;       // alias front
  leak_rate?: number;       // champ BDD réel
  escape_rate?: number;     // alias front
  duration_sec?: number;
  duration_minutes?: number;
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
  token?: string;
  list_id?: string;
  tag_prefix?: string;
  default_priority?: number;
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
