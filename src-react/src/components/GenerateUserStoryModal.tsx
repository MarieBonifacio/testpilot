import { X, Sparkles } from 'lucide-react';

interface GenerateUserStoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (story: { title: string; description: string; epic?: string; priority: 'high' | 'medium' | 'low'; story_points?: number; criteria: string[] }) => void;
  projectId: number;
}

export function GenerateUserStoryModal({ isOpen, onClose }: GenerateUserStoryModalProps) {
  if (!isOpen) return null;

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
          <button onClick={onClose} className="btn-ghost p-2">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-center py-8">
          <Sparkles className="w-16 h-16 mx-auto text-pl-600 dark:text-pl-400 mb-4" />
          <h3 className="text-xl font-semibold mb-2">Fonctionnalité en cours de développement</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            La génération IA de User Stories sera bientôt disponible. <br/>
            En attendant, utilisez le bouton "Nouvelle US" pour créer manuellement.
          </p>
          <button onClick={onClose} className="btn-primary">
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}
