import { useState, useEffect } from 'react';
import { projectsApi } from '../lib/api';
import { useProject } from '../lib/hooks';
import type { Project } from '../types';
import { Plus } from 'lucide-react';

export function ProjectSelector() {
  const { projectId, setProjectId } = useProject();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    projectsApi.list().then(setProjects).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = parseInt(e.target.value, 10);
    setProjectId(id || null);
  };

  const handleCreateProject = async (data: Partial<Project>) => {
    try {
      const created = await projectsApi.create(data);
      setProjects([...projects, created]);
      setProjectId(created.id);
      setShowModal(false);
    } catch (err) {
      alert('Erreur: ' + (err as Error).message);
    }
  };

  if (loading) return <div className="text-sm text-[var(--text-muted)]">Chargement...</div>;

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-semibold text-[var(--text-muted)]">Projet :</label>
      <select
        className="px-3 py-1.5 border border-[var(--border)] rounded-md text-sm bg-white min-w-[180px] cursor-pointer focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[rgba(59,109,17,0.15)]"
        value={projectId || ''}
        onChange={handleChange}
      >
        <option value="">-- Sélectionner --</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.scenario_count || 0})
          </option>
        ))}
      </select>
      <button
        onClick={() => setShowModal(true)}
        className="w-7 h-7 border border-[var(--border)] rounded-md bg-white text-[var(--primary)] font-semibold flex items-center justify-center hover:bg-[var(--primary)] hover:text-white transition-colors"
        title="Nouveau projet"
      >
        <Plus size={16} />
      </button>

      {showModal && (
        <NewProjectModal onSave={handleCreateProject} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}

function NewProjectModal({ onSave, onClose }: { onSave: (data: Partial<Project>) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [techStack, setTechStack] = useState('');
  const [domain, setDomain] = useState('');
  const [desc, setDesc] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Le nom du projet est requis');
      return;
    }
    onSave({ name: name.trim(), tech_stack: techStack.trim(), business_domain: domain.trim(), description: desc.trim() });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-[90%] max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-[var(--primary)] mb-5">Nouveau projet</h3>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-[var(--text-muted)] mb-1.5">Nom du projet *</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm"
              placeholder="Ex: ATHENA, Module Commandes..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-[var(--text-muted)] mb-1.5">Stack technique</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm"
              placeholder="Ex: .NET 4.8 (C#), Python/Robocorp..."
              value={techStack}
              onChange={(e) => setTechStack(e.target.value)}
            />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-[var(--text-muted)] mb-1.5">Domaine métier</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm"
              placeholder="Ex: Encaissement, E-commerce..."
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
          <div className="mb-5">
            <label className="block text-sm font-semibold text-[var(--text-muted)] mb-1.5">Description</label>
            <textarea
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm resize-none"
              rows={3}
              placeholder="Description optionnelle..."
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" className="px-4 py-2 border border-[var(--border)] rounded-md bg-white text-[var(--text)] font-semibold hover:bg-[var(--bg-alt)]" onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className="px-4 py-2 bg-[var(--primary)] text-white rounded-md font-semibold hover:bg-[var(--primary-dark)]">
              Créer
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}