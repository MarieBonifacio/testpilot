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
export interface ComepReport {
  project_id: number;
  project_name: string;
  generated_at: string;
  confidence_score: number;
  confidence_level: 'ÉLEVÉ' | 'MOYEN' | 'FAIBLE' | 'CRITIQUE';
  components: {
    coverage: number;
    traceability: number;
    pass_rate: number;
    critical_failures: number;
  };
  risks: { level: 'HIGH' | 'MEDIUM'; description: string }[];
  recommendations: { priority: number; text: string }[];
  stats: {
    total: number;
    accepted: number;
    tnr: number;
    pass_rate: number;
    coverage_pct: number;
    traceability_pct: number;
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
