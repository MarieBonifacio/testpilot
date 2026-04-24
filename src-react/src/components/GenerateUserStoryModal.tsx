import { useState } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { llmApi } from '../lib/api';

interface GenerateUserStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (story: { title: string; description: string; epic?: string; priority: 'high' | 'medium' | 'low'; story_points?: number; criteria: string[] }) => void;
  projectId: number;
}

/**
 * Prompt pour générer une User Story (version simplifiée côté frontend)
 */
function buildPrompt(description: string): string {
  return `Tu es un assistant Product Owner expert. Ta mission est de générer une User Story complète et de haute qualité à partir d'une description utilisateur.

# Format de sortie (JSON strict)

\`\`\`json
{
  "title": "En tant que [rôle], je veux [action], afin de [bénéfice]",
  "description": "Description détaillée de la fonctionnalité avec contexte métier et technique",
  "epic": "Nom de l'epic ou fonctionnalité parent",
  "priority": "high|medium|low",
  "story_points": 1|2|3|5|8|13,
  "criteria": [
    "Critère d'acceptation 1 (format Given/When/Then ou assertion testable)",
    "Critère d'acceptation 2",
    "Critère d'acceptation 3"
  ]
}
\`\`\`

# Règles de génération

1. **Title**: Format canonique "En tant que [rôle], je veux [action], afin de [bénéfice]"
2. **Description**: 3-5 phrases avec contexte métier et contraintes techniques
3. **Epic**: Regroupement logique (ex: "Authentification", "Dashboard", "Reporting")
4. **Priority**: high (critique), medium (important), low (nice-to-have)
5. **Story Points** (Fibonacci): 1 (trivial), 2 (simple), 3 (moyen), 5 (complexe), 8 (très complexe), 13 (à découper)
6. **Criteria**: 3-7 critères testables (Given/When/Then recommandé)

# Important

- Réponds UNIQUEMENT avec le JSON valide
- Pas de texte avant ou après le JSON
- Pas de balises markdown autour du JSON

# Description utilisateur

${description}`;
}

export function GenerateUserStoryModal({ isOpen, onClose, onGenerated }: GenerateUserStoryModalProps) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setError(null);
    if (!description.trim()) {
      setError('Veuillez entrer une description.');
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);

    try {
      const raw = await llmApi.call(buildPrompt(description.trim()), {
        signal: controller.signal,
        maxTokens: 2000,
        temperature: 0.3,
      });

      // Parse JSON response (with or without markdown code fences)
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Réponse IA invalide — JSON introuvable.');

      const parsed = JSON.parse(match[0]) as {
        title: string;
        description: string;
        epic?: string;
        priority: 'high' | 'medium' | 'low';
        story_points?: number;
        criteria: string[];
      };

      if (!parsed.title || !parsed.description || !Array.isArray(parsed.criteria)) {
        throw new Error('Format JSON invalide — champs manquants.');
      }

      onGenerated({
        title: parsed.title,
        description: parsed.description,
        epic: parsed.epic,
        priority: parsed.priority || 'medium',
        story_points: parsed.story_points,
        criteria: parsed.criteria,
      });

      setDescription('');
      onClose();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setError('Timeout — le modèle met trop de temps à répondre.');
      } else {
        setError((err as Error).message || 'Erreur lors de la génération.');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-panel max-w-2xl w-full">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-pl-600 dark:text-pl-400" />
            <h2 className="text-2xl font-bold text-pl-dark dark:text-pl-light">
              Générer une User Story avec l'IA
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-2" disabled={loading}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Description de la fonctionnalité souhaitée
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Je veux pouvoir exporter les résultats de campagne au format Excel..."
              className="input-field h-32 resize-none"
              disabled={loading}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Décrivez la fonctionnalité que vous souhaitez. L'IA générera une User Story complète avec critères d'acceptation.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
            <button onClick={onClose} className="btn-ghost" disabled={loading}>
              Annuler
            </button>
            <button onClick={handleGenerate} className="btn-primary" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Génération en cours...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Générer
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
