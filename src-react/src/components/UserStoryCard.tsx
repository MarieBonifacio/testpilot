import { useState } from 'react';
import type { UserStory } from '../types';
import { Edit2, Trash2, ChevronDown, ChevronUp, Link2, User } from 'lucide-react';

interface UserStoryCardProps {
  story: UserStory;
  onEdit: (story: UserStory) => void;
  onDelete: (id: number) => void;
  onViewScenarios?: (story: UserStory) => void;
}

const priorityColors: Record<string, string> = {
  high: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  low: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
};

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
  ready: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  in_progress: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  done: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
};

const statusLabels: Record<string, string> = {
  draft: 'Brouillon',
  ready: 'Prête',
  in_progress: 'En cours',
  done: 'Terminée',
};

export function UserStoryCard({ story, onEdit, onDelete, onViewScenarios }: UserStoryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass-panel p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-pl-dark dark:text-pl-light mb-1 line-clamp-2">
            {story.title}
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${priorityColors[story.priority]}`}>
              {story.priority === 'high' ? 'Haute' : story.priority === 'medium' ? 'Moyenne' : 'Basse'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[story.status]}`}>
              {statusLabels[story.status]}
            </span>
            {story.story_points && (
              <span className="px-2 py-0.5 rounded bg-pl-100 dark:bg-pl-800 text-pl-700 dark:text-pl-300 text-xs font-medium">
                {story.story_points} pts
              </span>
            )}
            {story.epic && (
              <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs">
                {story.epic}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="btn-ghost p-2"
            title={expanded ? 'Réduire' : 'Développer'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onEdit(story)}
            className="btn-ghost p-2"
            title="Modifier"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (confirm(`Supprimer la user story "${story.title}" ?`)) {
                onDelete(story.id);
              }
            }}
            className="btn-ghost p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
            title="Supprimer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Description (toujours visible si présente) */}
      {story.description && (
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3 line-clamp-2">
          {story.description}
        </p>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
          {/* Full description */}
          {story.description && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Description
              </h4>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                {story.description}
              </p>
            </div>
          )}

          {/* Critères d'acceptation */}
          {story.criteria && story.criteria.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                Critères d'acceptation ({story.criteria.length})
              </h4>
              <ul className="space-y-1">
                {story.criteria.map((criterion) => (
                  <li
                    key={criterion.id}
                    className="text-sm text-gray-700 dark:text-gray-300 pl-4 relative before:content-['✓'] before:absolute before:left-0 before:text-pl-600 dark:before:text-pl-400"
                  >
                    {criterion.criterion}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Linked scenarios */}
          {story.linked_scenarios && story.linked_scenarios.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  Scénarios liés ({story.linked_scenarios.length})
                </h4>
                {onViewScenarios && (
                  <button
                    onClick={() => onViewScenarios(story)}
                    className="text-xs text-pl-600 dark:text-pl-400 hover:underline flex items-center gap-1"
                  >
                    <Link2 className="w-3 h-3" />
                    Voir les scénarios
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            {story.creator_name && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                Créé par {story.creator_name}
              </span>
            )}
            {story.assignee_name && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                Assigné à {story.assignee_name}
              </span>
            )}
            <span>
              Créée le {new Date(story.created_at).toLocaleDateString('fr-FR')}
            </span>
            {story.updated_at !== story.created_at && (
              <span>
                Modifiée le {new Date(story.updated_at).toLocaleDateString('fr-FR')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
