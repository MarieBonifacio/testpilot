import { useState, useEffect } from 'react';
import { useAuth } from '../lib/hooks';
import { usersApi, authApi } from '../lib/api';
import type { User, UserRole } from '../types';
import { Users as UsersIcon, Plus, Pencil, Trash2, Check, X, ShieldCheck } from 'lucide-react';

const ROLES: { value: UserRole; label: string; color: string }[] = [
  { value: 'automaticien', label: 'Automaticien',  color: 'var(--info)' },
  { value: 'cp',           label: 'Chef de projet', color: 'var(--warning)' },
  { value: 'key_user',     label: 'Key User',       color: 'var(--accent)' },
  { value: 'admin',        label: 'Admin',          color: 'var(--danger)' },
];

const roleStyle = (role: string) => {
  const found = ROLES.find(r => r.value === role);
  return found ? { background: `${found.color}22`, color: found.color, border: `1px solid ${found.color}` } : {};
};

interface NewUserForm {
  username: string;
  password: string;
  display_name: string;
  role: UserRole;
  email: string;
}

export function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<User> & { password?: string }>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newForm, setNewForm] = useState<NewUserForm>({
    username: '', password: '', display_name: '', role: 'automaticien', email: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const data = await usersApi.list();
      setUsers(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (u: User) => {
    setEditingId(u.id);
    setEditForm({ display_name: u.display_name, role: u.role, email: u.email || '', password: '' });
  };

  const saveEdit = async (id: number) => {
    try {
      await usersApi.update(id, editForm);
      setEditingId(null);
      setSuccess('Utilisateur mis à jour.');
      setTimeout(() => setSuccess(null), 2500);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteUser = async (id: number) => {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      await usersApi.delete(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createUser = async () => {
    setError(null);
    if (!newForm.username || !newForm.password || !newForm.display_name) {
      setError('Username, mot de passe et nom complet requis.');
      return;
    }
    try {
      await authApi.register({ ...newForm });
      setShowCreate(false);
      setNewForm({ username: '', password: '', display_name: '', role: 'automaticien', email: '' });
      setSuccess('Utilisateur créé.');
      setTimeout(() => setSuccess(null), 2500);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const isAdmin = currentUser?.role === 'admin';

  return (
    <div>
      <header className="mb-6 pb-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Utilisateurs</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Gestion des accès et des rôles</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
            <Plus size={14} />
            Nouvel utilisateur
          </button>
        )}
      </header>

      {error && <div className="error-msg">{error}</div>}
      {success && (
        <div className="rounded-lg p-3 mb-4 flex items-center gap-2" style={{ background: 'var(--success-bg)', border: '1px solid var(--success)', color: 'var(--success)' }}>
          <Check size={14} />
          {success}
        </div>
      )}

      {/* Formulaire de création */}
      {showCreate && isAdmin && (
        <div className="panel mb-5">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Créer un utilisateur</div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Username</label>
              <input type="text" value={newForm.username} onChange={(e) => setNewForm({ ...newForm, username: e.target.value })} placeholder="marie.b" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Mot de passe</label>
              <input type="password" value={newForm.password} onChange={(e) => setNewForm({ ...newForm, password: e.target.value })} placeholder="••••••" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Nom complet</label>
              <input type="text" value={newForm.display_name} onChange={(e) => setNewForm({ ...newForm, display_name: e.target.value })} placeholder="Marie Bonifacio" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Email</label>
              <input type="email" value={newForm.email} onChange={(e) => setNewForm({ ...newForm, email: e.target.value })} placeholder="marie@carter-cash.com" />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Rôle</label>
              <select value={newForm.role} onChange={(e) => setNewForm({ ...newForm, role: e.target.value as UserRole })}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={createUser}>
              <Check size={13} /> Créer
            </button>
            <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>
              <X size={13} /> Annuler
            </button>
          </div>
        </div>
      )}

      {/* Tableau */}
      {loading ? (
        <div className="loader"><div className="spinner" /><span>Chargement…</span></div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              {editingId === u.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Nom complet</label>
                      <input type="text" value={editForm.display_name || ''} onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Email</label>
                      <input type="email" value={editForm.email || ''} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                    </div>
                    {isAdmin && (
                      <div>
                        <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Rôle</label>
                        <select value={editForm.role || 'automaticien'} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}>
                          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="text-xs mb-1 block" style={{ color: 'var(--text-muted)' }}>Nouveau mot de passe (optionnel)</label>
                      <input type="password" value={editForm.password || ''} placeholder="Laisser vide pour ne pas changer"
                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={() => saveEdit(u.id)}>
                      <Check size={13} /> Enregistrer
                    </button>
                    <button className="btn btn-secondary" onClick={() => setEditingId(null)}>
                      <X size={13} /> Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                    style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                    {u.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{u.display_name}</span>
                      {u.id === currentUser?.id && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>Vous</span>
                      )}
                      <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={roleStyle(u.role)}>
                        {ROLES.find(r => r.value === u.role)?.label || u.role}
                      </span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
                      @{u.username}{u.email ? ` · ${u.email}` : ''}
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="flex gap-1 flex-shrink-0">
                    {(isAdmin || u.id === currentUser?.id) && (
                      <button className="btn-icon" onClick={() => startEdit(u)} title="Modifier">
                        <Pencil size={13} style={{ color: 'var(--text-dim)' }} />
                      </button>
                    )}
                    {isAdmin && u.id !== currentUser?.id && (
                      <button className="btn-icon" onClick={() => deleteUser(u.id)} title="Supprimer">
                        <Trash2 size={13} style={{ color: 'var(--danger)' }} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {users.length === 0 && (
            <div className="empty-state">
              <UsersIcon size={40} className="mx-auto mb-3 opacity-20" />
              <p>Aucun utilisateur. Créez le premier compte via l'endpoint API.</p>
            </div>
          )}
        </div>
      )}

      {/* Légende rôles */}
      <div className="panel mt-6">
        <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--text-dim)' }}>
          <ShieldCheck size={13} />
          <span className="text-xs font-bold uppercase tracking-wide">Permissions par rôle</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          {[
            { role: 'Automaticien', perms: 'Rédaction, campagne, export, import' },
            { role: 'Key User',     perms: 'Lecture seule + validation de scénarios (CP requis)' },
            { role: 'Chef de projet', perms: 'Toutes les permissions + validation / rejet + assignation' },
            { role: 'Admin',        perms: 'Accès complet + gestion des utilisateurs' },
          ].map(({ role, perms }) => (
            <div key={role} className="rounded p-2.5" style={{ background: 'var(--bg-hover)' }}>
              <div className="font-semibold mb-0.5">{role}</div>
              <div style={{ color: 'var(--text-dim)' }}>{perms}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
