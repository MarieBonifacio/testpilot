export interface Project {
  id: number;
  name: string;
  tech_stack?: string;
  business_domain?: string;
  description?: string;
  scenario_count?: number;
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
  created_at?: string;
  // Legacy properties for parsing
  given?: string;
  when?: string;
  then?: string;
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