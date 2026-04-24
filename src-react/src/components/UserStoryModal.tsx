import { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { UserStory, CreateUserStoryPayload, UserStoryPriority, UserStoryStatus } from '../types';

interface UserStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CreateUserStoryPayload) => Promise<void>;
  story?: UserStory | null;
  mode: 'create' | 'edit';
}

const STORY_POINTS_OPTIONS = [1, 2, 3, 5, 8, 13];

export function UserStoryModal({ isOpen, onClose, onSave, story, mode }: UserStoryModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [epic, setEpic] = useState('');
  const [priority, setPriority] = useState<UserStoryPriority>('medium');
  const [storyPoints, setStoryPoints] = useState<number | null>(null);
  const [status, setStatus] = useState<UserStoryStatus>('draft');
  const [criteria, setCriteria] = useState<string[]>([]);
  const [newCriterion, setNewCriterion] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes or story changes
  useEffect(() => {
    if (isOpen && story && mode === 'edit') {
      setTitle(story.title);
      setDescription(story.description || '');
      setEpic(story.epic || '');
      setPriority(story.priority);
      setStoryPoints(story.story_points);
      setStatus(story.status);
      setCriteria(story.criteria?.map(c => c.criterion) || []);
    } else if (isOpen && mode === 'create') {
      // Reset to defaults for new story
      setTitle('');
      setDescription('');
      setEpic('');
      setPriority('medium');
      setStoryPoints(null);
      setStatus('draft');
      setCriteria([]);
    }
    setNewCriterion('');
    setError(null);
  }, [isOpen, story, mode]);

  const handleAddCriterion = () => {
    if (!newCriterion.trim()) return;
    setCriteria([...criteria, newCriterion.trim()]);
    setNewCriterion('');
  };

  const handleRemoveCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Le titre est obligatoire');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const payload: CreateUserStoryPayload = {
        title: title.trim(),
        description: description.trim() || undefined,
        epic: epic.trim() || undefined,
        priority,
        story_points: storyPoints || undefined,
        status,
        criteria: criteria.length > 0 ? criteria : undefined,
      };

      await onSave(payload);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-panel max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-pl-dark dark:text-pl-light">
            {mode === 'create' ? 'Nouvelle User Story' : 'Modifier la User Story'}
          </h2>
          <button
            onClick={onClose}
            className="btn-ghost p-2"
            disabled={saving}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Titre <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="En tant que [rôle], je veux [action], afin de [bénéfice]"
              className="input-field w-full"
              required
              disabled={saving}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Format recommandé : "En tant que... je veux... afin de..."
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Détails de la fonctionnalité, contexte métier, contraintes techniques..."
              rows={4}
              className="input-field w-full resize-none"
              disabled={saving}
            />
          </div>

          {/* Epic */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Epic / Fonctionnalité parent
            </label>
            <input
              type="text"
              value={epic}
              onChange={(e) => setEpic(e.target.value)}
              placeholder="ex: Authentification, Dashboard, Reporting..."
              className="input-field w-full"
              disabled={saving}
            />
          </div>

          {/* Priority, Story Points, Status */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Priorité
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as UserStoryPriority)}
                className="input-field w-full"
                disabled={saving}
              >
                <option value="high">Haute</option>
                <option value="medium">Moyenne</option>
                <option value="low">Basse</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Story Points
              </label>
              <select
                value={storyPoints || ''}
                onChange={(e) => setStoryPoints(e.target.value ? parseInt(e.target.value) : null)}
                className="input-field w-full"
                disabled={saving}
              >
                <option value="">Non estimé</option>
                {STORY_POINTS_OPTIONS.map(pts => (
                  <option key={pts} value={pts}>{pts}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Statut
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as UserStoryStatus)}
                className="input-field w-full"
                disabled={saving}
              >
                <option value="draft">Brouillon</option>
                <option value="ready">Prête</option>
                <option value="in_progress">En cours</option>
                <option value="done">Terminée</option>
              </select>
            </div>
          </div>

          {/* Critères d'acceptation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Critères d'acceptation
            </label>

            {/* List of criteria */}
            {criteria.length > 0 && (
              <ul className="space-y-2 mb-3">
                {criteria.map((criterion, index) => (
                  <li key={index} className="flex items-start gap-2 glass-panel p-3">
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                      {index + 1}. {criterion}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCriterion(index)}
                      className="btn-ghost p-1 text-red-600 dark:text-red-400"
                      disabled={saving}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add new criterion */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newCriterion}
                onChange={(e) => setNewCriterion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCriterion();
                  }
                }}
                placeholder="Ajouter un critère (Given/When/Then ou assertion testable)"
                className="input-field flex-1"
                disabled={saving}
              />
              <button
                type="button"
                onClick={handleAddCriterion}
                className="btn-primary"
                disabled={!newCriterion.trim() || saving}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Format recommandé : "Étant donné... Quand... Alors..." ou assertions claires
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={saving || !title.trim()}
            >
              {saving ? 'Sauvegarde...' : mode === 'create' ? 'Créer' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={saving}
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
