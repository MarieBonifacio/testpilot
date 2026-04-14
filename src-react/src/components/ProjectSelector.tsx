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

  if (loading) return <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Chargement…</div>;

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-semibold" style={{ color: 'var(--text-dim)' }}>Projet</label>
      <select
        className="text-sm rounded min-w-[180px] cursor-pointer"
        style={{
          background: 'var(--bg-hover)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          padding: '5px 10px',
          outline: 'none',
          borderRadius: 'var(--radius-sm)',
        }}
        value={projectId || ''}
        onChange={handleChange}
      >
        <option value="">— Sélectionner —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.scenario_count || 0})
          </option>
        ))}
      </select>
      <button
        onClick={() => setShowModal(true)}
        className="btn-icon"
        title="Nouveau projet"
      >
        <Plus size={15} />
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
    if (!name.trim()) { alert('Le nom du projet est requis'); return; }
    onSave({ name: name.trim(), tech_stack: techStack.trim(), business_domain: domain.trim(), description: desc.trim() });
  };

  const fieldStyle = { marginBottom: '16px' } as React.CSSProperties;
  const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' } as React.CSSProperties;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="w-[90%] max-w-md rounded-xl p-6"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-strong)', boxShadow: 'var(--shadow)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold mb-5" style={{ color: 'var(--accent)' }}>Nouveau projet</h3>
        <form onSubmit={handleSubmit}>
          <div style={fieldStyle}>
            <label style={labelStyle}>Nom du projet *</label>
            <input type="text" placeholder="Ex: ATHENA, Module Commandes…" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Stack technique</label>
            <input type="text" placeholder="Ex: .NET 4.8 (C#), Python/Robocorp…" value={techStack} onChange={(e) => setTechStack(e.target.value)} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Domaine métier</label>
            <input type="text" placeholder="Ex: Encaissement, E-commerce…" value={domain} onChange={(e) => setDomain(e.target.value)} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Description</label>
            <textarea rows={3} placeholder="Description optionnelle…" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ minHeight: 'unset' }} />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary">Créer</button>
          </div>
        </form>
      </div>
    </div>
  );
}
