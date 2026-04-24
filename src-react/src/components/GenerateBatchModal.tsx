import { useState } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { llmApi } from '../lib/api';

interface GenerateBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (stories: Array<{ title: string; description: string; epic?: string; priority: 'high' | 'medium' | 'low'; story_points?: number; criteria: string[] }>) => void;
  projectId: number;
}

/**
 * Prompt pour générer plusieurs User Stories (version simplifiée côté frontend)
 */
function buildBatchPrompt(context: string, count: number): string {
  return `Tu es un assistant Product Owner expert. Ta mission est de générer ${count} User Stories cohérentes et complémentaires à partir d'un contexte projet.

# Format de sortie (tableau JSON)

\`\`\`json
[
  {
    "title": "En tant que [rôle], je veux [action], afin de [bénéfice]",
    "description": "Description détaillée avec contexte métier et technique",
    "epic": "Nom de l'epic",
    "priority": "high|medium|low",
    "story_points": 1|2|3|5|8|13,
    "criteria": [
      "Critère d'acceptation 1",
      "Critère d'acceptation 2",
      "Critère d'acceptation 3"
    ]
  }
]
\`\`\`

# Règles de génération

1. **Cohérence**: Les ${count} US doivent former un ensemble logique et complémentaire
2. **Couverture**: Varie les rôles, priorités et complexités
3. **Dépendances**: Ordonne les US par dépendances logiques (fondations → features → améliorations)
4. **Réalisme**: Basé sur le contexte fourni, génère des US concrètes et implémentables

5. **Distribution suggérée**:
   - ~30% high priority (fonctionnalités critiques)
   - ~50% medium priority (fonctionnalités importantes)
   - ~20% low priority (améliorations)
   - Story points variés: équilibre entre quick wins (1-2) et fonctionnalités complexes (5-8)

6. **Qualité**: Chaque US doit respecter:
   - Title au format "En tant que... je veux... afin de..."
   - Description de 3-5 phrases minimum
   - Epic cohérent (regroupe les US liées)
   - 3-7 critères d'acceptation testables

# Important

- Réponds UNIQUEMENT avec le tableau JSON
- Pas de texte explicatif avant ou après
- Génère exactement ${count} User Stories
- JSON valide avec guillemets doubles
- Pas de balises markdown autour du JSON

# Contexte projet

${context}`;
}

export function GenerateBatchModal({ isOpen, onClose, onGenerated }: GenerateBatchModalProps) {
  const [context, setContext] = useState('');
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setError(null);
    if (!context.trim()) {
      setError('Veuillez entrer un contexte projet.');
      return;
    }
    if (count < 2 || count > 20) {
      setError('Le nombre de User Stories doit être entre 2 et 20.');
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2min timeout for batch

    try {
      const raw = await llmApi.call(buildBatchPrompt(context.trim(), count), {
        signal: controller.signal,
        maxTokens: 4000,
        temperature: 0.4,
      });

      // Parse JSON response (with or without markdown code fences)
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('Réponse IA invalide — tableau JSON introuvable.');

      const parsed = JSON.parse(match[0]) as Array<{
        title: string;
        description: string;
        epic?: string;
        priority: 'high' | 'medium' | 'low';
        story_points?: number;
        criteria: string[];
      }>;

      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Format JSON invalide — tableau vide ou manquant.');
      }

      // Validate each story
      const validated = parsed.map(story => {
        if (!story.title || !story.description || !Array.isArray(story.criteria)) {
          throw new Error('Format JSON invalide — champs manquants dans une User Story.');
        }
        return {
          title: story.title,
          description: story.description,
          epic: story.epic,
          priority: story.priority || 'medium',
          story_points: story.story_points,
          criteria: story.criteria,
        };
      });

      onGenerated(validated);
      setContext('');
      setCount(5);
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
              Générer plusieurs User Stories avec l'IA
            </h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-2" disabled={loading}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Contexte du projet ou de l'epic
            </label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Ex: Développer un module de gestion des utilisateurs avec authentification, rôles et permissions..."
              className="input-field h-40 resize-none"
              disabled={loading}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Décrivez le contexte global. L'IA générera plusieurs User Stories cohérentes couvrant différents aspects.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              Nombre de User Stories à générer
            </label>
            <input
              type="number"
              min={2}
              max={20}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value) || 5)}
              className="input-field w-32"
              disabled={loading}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Entre 2 et 20 User Stories
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
                  Générer {count} US
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
