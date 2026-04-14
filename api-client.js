/**
 * TestPilot API Client & Shared Components
 * =========================================
 * Module partagé entre toutes les pages de l'application.
 * Gère la communication avec le backend et le contexte projet.
 */

const TestPilotAPI = (function() {
  "use strict";

  const BASE_URL = "";
  const PROJECT_KEY = "testpilot_current_project";

  // ══════════════════════════════════════════════════════
  // ██  CURRENT PROJECT MANAGEMENT
  // ══════════════════════════════════════════════════════

  function getCurrentProjectId() {
    return parseInt(localStorage.getItem(PROJECT_KEY)) || null;
  }

  function setCurrentProjectId(id) {
    localStorage.setItem(PROJECT_KEY, id);
    window.dispatchEvent(new CustomEvent("projectChanged", { detail: { projectId: id } }));
  }

  // ══════════════════════════════════════════════════════
  // ██  HTTP HELPERS
  // ══════════════════════════════════════════════════════

  async function request(method, path, body = null) {
    const options = {
      method,
      headers: { "Content-Type": "application/json" }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(BASE_URL + path, options);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || "Erreur API");
    }
    
    return response.json();
  }

  const get = (path) => request("GET", path);
  const post = (path, body) => request("POST", path, body);
  const put = (path, body) => request("PUT", path, body);
  const patch = (path, body) => request("PATCH", path, body);
  const del = (path) => request("DELETE", path);

  // ══════════════════════════════════════════════════════
  // ██  PROJECTS API
  // ══════════════════════════════════════════════════════

  const Projects = {
    list: () => get("/api/projects"),
    get: (id) => get(`/api/projects/${id}`),
    create: (data) => post("/api/projects", data),
    update: (id, data) => put(`/api/projects/${id}`, data),
    delete: (id) => del(`/api/projects/${id}`),
    getContext: (id) => get(`/api/projects/${id}/context`),
    updateContext: (id, data) => put(`/api/projects/${id}/context`, data),
    getStats: (id) => get(`/api/projects/${id}/stats`)
  };

  // ══════════════════════════════════════════════════════
  // ██  SCENARIOS API
  // ══════════════════════════════════════════════════════

  const Scenarios = {
    list: (projectId, filters = {}) => {
      const params = new URLSearchParams(filters).toString();
      return get(`/api/projects/${projectId}/scenarios${params ? "?" + params : ""}`);
    },
    create: (projectId, scenarios) => post(`/api/projects/${projectId}/scenarios`, scenarios),
    update: (id, data) => put(`/api/scenarios/${id}`, data),
    delete: (id) => del(`/api/scenarios/${id}`),
    deleteAll: (projectId) => del(`/api/projects/${projectId}/scenarios`),
    toggleAccept: (id) => patch(`/api/scenarios/${id}/accept`),
    toggleTNR: (id) => patch(`/api/scenarios/${id}/tnr`),
    acceptAll: (projectId) => post(`/api/projects/${projectId}/scenarios/accept-all`)
  };

  // ══════════════════════════════════════════════════════
  // ██  ANALYSES API
  // ══════════════════════════════════════════════════════

  const Analyses = {
    get: (projectId) => get(`/api/projects/${projectId}/analysis`),
    save: (projectId, data) => post(`/api/projects/${projectId}/analysis`, data)
  };

  // ══════════════════════════════════════════════════════
  // ██  SESSIONS API
  // ══════════════════════════════════════════════════════

  const Sessions = {
    list: (projectId) => get(`/api/projects/${projectId}/sessions`),
    get: (id) => get(`/api/sessions/${id}`),
    create: (projectId, data) => post(`/api/projects/${projectId}/sessions`, data),
    finish: (id) => put(`/api/sessions/${id}/finish`),
    addResult: (sessionId, data) => post(`/api/sessions/${sessionId}/results`, data)
  };

  // ══════════════════════════════════════════════════════
  // ██  UI COMPONENTS
  // ══════════════════════════════════════════════════════

  /**
   * Crée et injecte le sélecteur de projet dans la navbar
   * @param {string} containerId - ID de l'élément conteneur
   * @param {function} onChange - Callback appelé lors du changement de projet
   */
  async function renderProjectSelector(containerId, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const projects = await Projects.list();
    const currentId = getCurrentProjectId();

    container.innerHTML = `
      <div class="project-selector">
        <label class="project-label">Projet :</label>
        <select id="projectSelect" class="project-select">
          <option value="">-- Sélectionner --</option>
          ${projects.map(p => `
            <option value="${p.id}" ${p.id === currentId ? "selected" : ""}>
              ${p.name} 
              <span class="scenario-count">(${p.scenario_count || 0})</span>
            </option>
          `).join("")}
        </select>
        <button type="button" id="btnNewProject" class="btn-new-project" title="Nouveau projet">+</button>
      </div>
    `;

    const select = document.getElementById("projectSelect");
    select.addEventListener("change", (e) => {
      const id = parseInt(e.target.value);
      if (id) {
        setCurrentProjectId(id);
        if (onChange) onChange(id);
      }
    });

    document.getElementById("btnNewProject").addEventListener("click", () => {
      showNewProjectModal(async (newProject) => {
        const created = await Projects.create(newProject);
        setCurrentProjectId(created.id);
        await renderProjectSelector(containerId, onChange);
        if (onChange) onChange(created.id);
      });
    });

    // Auto-sélectionner le premier projet si aucun n'est sélectionné
    if (!currentId && projects.length > 0) {
      setCurrentProjectId(projects[0].id);
      select.value = projects[0].id;
      if (onChange) onChange(projects[0].id);
    }
  }

  /**
   * Affiche une modale pour créer un nouveau projet
   */
  function showNewProjectModal(onSave) {
    const existing = document.getElementById("newProjectModal");
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = "newProjectModal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal-content">
        <h3>Nouveau projet</h3>
        <div class="form-group">
          <label>Nom du projet *</label>
          <input type="text" id="newProjectName" placeholder="Ex: ATHENA, Module Commandes..." required>
        </div>
        <div class="form-group">
          <label>Stack technique</label>
          <input type="text" id="newProjectStack" placeholder="Ex: .NET 4.8 (C#), Python/Robocorp...">
        </div>
        <div class="form-group">
          <label>Domaine métier</label>
          <input type="text" id="newProjectDomain" placeholder="Ex: Encaissement, E-commerce...">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea id="newProjectDesc" rows="3" placeholder="Description optionnelle..."></textarea>
        </div>
        <div class="modal-actions">
          <button type="button" id="btnCancelProject" class="btn-secondary">Annuler</button>
          <button type="button" id="btnSaveProject" class="btn-primary">Créer</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("btnCancelProject").addEventListener("click", () => modal.remove());
    document.getElementById("btnSaveProject").addEventListener("click", async () => {
      const name = document.getElementById("newProjectName").value.trim();
      if (!name) {
        alert("Le nom du projet est requis");
        return;
      }
      try {
        await onSave({
          name,
          tech_stack: document.getElementById("newProjectStack").value.trim(),
          business_domain: document.getElementById("newProjectDomain").value.trim(),
          description: document.getElementById("newProjectDesc").value.trim()
        });
        modal.remove();
      } catch (err) {
        alert("Erreur: " + err.message);
      }
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Injecte les styles CSS partagés pour les composants
   */
  function injectSharedStyles() {
    if (document.getElementById("testpilot-shared-styles")) return;

    const style = document.createElement("style");
    style.id = "testpilot-shared-styles";
    style.textContent = `
      /* Project Selector */
      .project-selector {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .project-label {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-muted, #6c757d);
      }
      .project-select {
        padding: 6px 12px;
        border: 1px solid var(--border, #dee2e6);
        border-radius: 6px;
        font-size: 0.85rem;
        font-family: inherit;
        background: white;
        min-width: 180px;
        cursor: pointer;
      }
      .project-select:focus {
        outline: none;
        border-color: var(--primary, #3B6D11);
        box-shadow: 0 0 0 2px rgba(59,109,17,0.15);
      }
      .btn-new-project {
        width: 28px;
        height: 28px;
        border: 1px solid var(--border, #dee2e6);
        border-radius: 6px;
        background: white;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--primary, #3B6D11);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
      }
      .btn-new-project:hover {
        background: var(--primary, #3B6D11);
        color: white;
        border-color: var(--primary, #3B6D11);
      }

      /* TNR Badge */
      .badge-tnr {
        display: inline-block;
        background: #6f42c1;
        color: white;
        font-size: 0.65rem;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
      }
      .btn-tnr {
        padding: 4px 8px;
        border: 1px solid #6f42c1;
        border-radius: 4px;
        background: white;
        color: #6f42c1;
        font-size: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .btn-tnr:hover, .btn-tnr.active {
        background: #6f42c1;
        color: white;
      }

      /* Modal */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }
      .modal-content {
        background: white;
        border-radius: 12px;
        padding: 24px;
        width: 90%;
        max-width: 450px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      }
      .modal-content h3 {
        margin: 0 0 20px 0;
        color: var(--primary, #3B6D11);
      }
      .form-group {
        margin-bottom: 16px;
      }
      .form-group label {
        display: block;
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--text-muted, #6c757d);
        margin-bottom: 6px;
      }
      .form-group input,
      .form-group textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--border, #dee2e6);
        border-radius: 6px;
        font-size: 0.9rem;
        font-family: inherit;
      }
      .form-group input:focus,
      .form-group textarea:focus {
        outline: none;
        border-color: var(--primary, #3B6D11);
        box-shadow: 0 0 0 2px rgba(59,109,17,0.15);
      }
      .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 24px;
      }
      .btn-secondary {
        padding: 10px 18px;
        border: 1px solid var(--border, #dee2e6);
        border-radius: 6px;
        background: white;
        color: var(--text, #212529);
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .btn-secondary:hover {
        background: var(--bg-alt, #f8f9fa);
      }
      .btn-primary {
        padding: 10px 18px;
        border: none;
        border-radius: 6px;
        background: var(--primary, #3B6D11);
        color: white;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
      }
      .btn-primary:hover {
        background: var(--primary-dark, #2d5309);
      }

      /* No project selected state */
      .no-project-banner {
        background: linear-gradient(135deg, #fff3cd 0%, #ffeeba 100%);
        border: 1px solid #ffc107;
        border-radius: 10px;
        padding: 20px 24px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .no-project-banner::before {
        content: '⚠️';
        font-size: 1.5rem;
      }
      .no-project-banner p {
        margin: 0;
        color: #856404;
        font-weight: 500;
      }
    `;
    document.head.appendChild(style);
  }

  // Inject styles on load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectSharedStyles);
  } else {
    injectSharedStyles();
  }

  // ══════════════════════════════════════════════════════
  // ██  PUBLIC API
  // ══════════════════════════════════════════════════════

  return {
    // Project context
    getCurrentProjectId,
    setCurrentProjectId,
    
    // API modules
    Projects,
    Scenarios,
    Analyses,
    Sessions,

    // UI components
    renderProjectSelector,
    showNewProjectModal,
    injectSharedStyles,

    // Re-export for convenience
    request,
    get,
    post,
    put,
    patch,
    del
  };
})();

// Export for ES modules if needed
if (typeof module !== "undefined" && module.exports) {
  module.exports = TestPilotAPI;
}
