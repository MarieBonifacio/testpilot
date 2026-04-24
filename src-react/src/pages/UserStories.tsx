import { useState, useEffect, useCallback } from 'react';
import { useProject } from '../lib/hooks';
import { userStoriesApi } from '../lib/api';
import type { UserStory, CreateUserStoryPayload, UpdateUserStoryPayload } from '../types';
import { UserStoryCard } from '../components/UserStoryCard';
import { UserStoryModal } from '../components/UserStoryModal';
import { GenerateUserStoryModal } from '../components/GenerateUserStoryModal';
import { GenerateBatchModal } from '../components/GenerateBatchModal';
import { Plus, Sparkles, List, Filter } from 'lucide-react';

export function UserStories() {
  const { projectId } = useProject();
  const [stories, setStories] = useState<UserStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showGenerateBatchModal, setShowGenerateBatchModal] = useState(false);
  const [editingStory, setEditingStory] = useState<UserStory | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [filterEpic, setFilterEpic] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Load user stories
  const loadStories = useCallback(async () => {
    if (!projectId) {
      setStories([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const filters: { status?: string; priority?: string; epic?: string } = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterPriority) filters.priority = filterPriority;
      if (filterEpic) filters.epic = filterEpic;

      const data = await userStoriesApi.list(projectId, filters);
      setStories(data);
    } catch (err) {
      console.error('Erreur chargement user stories:', err);
      setError(err instanceof Error ? err.message : 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [projectId, filterStatus, filterPriority, filterEpic]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  // Create story (manual or AI-generated)
  const handleCreate = async (payload: CreateUserStoryPayload) => {
    if (!projectId) return;
    await userStoriesApi.create(projectId, payload);
    await loadStories();
  };

  // Update story
  const handleUpdate = async (payload: UpdateUserStoryPayload) => {
    if (!editingStory) return;
    await userStoriesApi.update(editingStory.id, payload);
    await loadStories();
  };

  // Delete story
  const handleDelete = async (id: number) => {
    await userStoriesApi.delete(id);
    await loadStories();
  };

  // Handle AI-generated single story
  const handleGenerated = async (generatedData: { title: string; description: string; epic?: string; priority: 'high' | 'medium' | 'low'; story_points?: number; criteria: string[] }) => {
    await handleCreate(generatedData);
  };

  // Handle AI-generated batch stories
  const handleGeneratedBatch = async (generatedStories: Array<{ title: string; description: string; epic?: string; priority: 'high' | 'medium' | 'low'; story_points?: number; criteria: string[] }>) => {
    if (!projectId) return;

    // Create all stories sequentially
    for (const storyData of generatedStories) {
      await userStoriesApi.create(projectId, storyData);
    }

    await loadStories();
  };

  // Edit story
  const handleEdit = (story: UserStory) => {
    setEditingStory(story);
    setShowEditModal(true);
  };

  // Get unique epics for filter
  const uniqueEpics = Array.from(new Set(stories.map(s => s.epic).filter(Boolean))) as string[];

  // Filter stats
  const stats = {
    total: stories.length,
    draft: stories.filter(s => s.status === 'draft').length,
    ready: stories.filter(s => s.status === 'ready').length,
    in_progress: stories.filter(s => s.status === 'in_progress').length,
    done: stories.filter(s => s.status === 'done').length,
    highPriority: stories.filter(s => s.priority === 'high').length,
    totalPoints: stories.reduce((sum, s) => sum + (s.story_points || 0), 0),
  };

  if (!projectId) {
    return (
      <div className="text-center py-12">
        <List className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
        <p className="text-gray-600 dark:text-gray-400">
          Sélectionnez un projet pour gérer les User Stories
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-pl-dark dark:text-pl-light mb-2">
            User Stories
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Créez et gérez les user stories de votre projet
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            Filtres
          </button>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Générer (IA)
          </button>
          <button
            onClick={() => setShowGenerateBatchModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Générer Batch
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nouvelle US
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <div className="glass-panel p-4">
          <div className="text-2xl font-bold text-pl-600 dark:text-pl-400">{stats.total}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-2xl font-bold text-gray-500 dark:text-gray-400">{stats.draft}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Brouillons</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.ready}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Prêtes</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.in_progress}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">En cours</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.done}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Terminées</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.highPriority}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Haute priorité</div>
        </div>
        <div className="glass-panel p-4">
          <div className="text-2xl font-bold text-pl-600 dark:text-pl-400">{stats.totalPoints}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Points totaux</div>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="glass-panel p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Statut
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="input-field w-full"
              >
                <option value="">Tous</option>
                <option value="draft">Brouillon</option>
                <option value="ready">Prête</option>
                <option value="in_progress">En cours</option>
                <option value="done">Terminée</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Priorité
              </label>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="input-field w-full"
              >
                <option value="">Toutes</option>
                <option value="high">Haute</option>
                <option value="medium">Moyenne</option>
                <option value="low">Basse</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Epic
              </label>
              <select
                value={filterEpic}
                onChange={(e) => setFilterEpic(e.target.value)}
                className="input-field w-full"
              >
                <option value="">Tous</option>
                {uniqueEpics.map(epic => (
                  <option key={epic} value={epic}>{epic}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin w-8 h-8 border-4 border-pl-600 dark:border-pl-400 border-t-transparent rounded-full" />
          <p className="text-gray-600 dark:text-gray-400 mt-4">Chargement...</p>
        </div>
      )}

      {/* Stories list */}
      {!loading && stories.length === 0 && (
        <div className="text-center py-12 glass-panel">
          <List className="w-16 h-16 mx-auto text-gray-400 dark:text-gray-600 mb-4" />
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Aucune user story pour ce projet
          </p>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Créer manuellement
            </button>
            <button
              onClick={() => setShowGenerateModal(true)}
              className="btn-secondary flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Générer avec l'IA
            </button>
          </div>
        </div>
      )}

      {!loading && stories.length > 0 && (
        <div className="grid gap-4">
          {stories.map(story => (
            <UserStoryCard
              key={story.id}
              story={story}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <UserStoryModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleCreate}
        mode="create"
      />

      <UserStoryModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditingStory(null);
        }}
        onSave={handleUpdate}
        story={editingStory}
        mode="edit"
      />

      <GenerateUserStoryModal
        isOpen={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onGenerated={handleGenerated}
        projectId={projectId}
      />

      <GenerateBatchModal
        isOpen={showGenerateBatchModal}
        onClose={() => setShowGenerateBatchModal(false)}
        onGenerated={handleGeneratedBatch}
        projectId={projectId}
      />
    </div>
  );
}
