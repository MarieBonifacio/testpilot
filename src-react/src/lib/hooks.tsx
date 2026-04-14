import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { projectsApi, projectStore } from './api';
import type { Project, ProjectContext } from '../types';

interface ProjectContextType {
  projectId: number | null;
  project: Project | null;
  context: ProjectContext | null;
  loading: boolean;
  setProjectId: (id: number | null) => void;
  refetch: () => Promise<void>;
}

const ProjectCtx = createContext<ProjectContextType | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projectId, setProjectIdState] = useState<number | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [context, setContext] = useState<ProjectContext | null>(null);
  const [loading, setLoading] = useState(false);

  const setProjectId = useCallback((id: number | null) => {
    if (id) {
      projectStore.setCurrentProjectId(id);
    }
    setProjectIdState(id);
  }, []);

  const refetch = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setContext(null);
      return;
    }
    setLoading(true);
    try {
      const [p, ctx] = await Promise.all([
        projectsApi.get(projectId),
        projectsApi.getContext(projectId).catch(() => null),
      ]);
      setProject(p);
      setContext(ctx);
    } catch (err) {
      console.error('Error loading project:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const id = projectStore.getCurrentProjectId();
    if (id && id !== projectId) {
      setProjectIdState(id);
    }
  }, []);

  useEffect(() => {
    if (projectId) {
      refetch();
    }
  }, [projectId, refetch]);

  return (
    <ProjectCtx.Provider value={{ projectId, project, context, loading, setProjectId, refetch }}>
      {children}
    </ProjectCtx.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectCtx);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
}