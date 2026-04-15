# TestPilot v2.0

Application web de gestion et génération de scénarios de tests assistée par IA — conçue pour les équipes QA Carter-Cash.

[![CI](https://github.com/MarieBonifacio/testpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/MarieBonifacio/testpilot/actions/workflows/ci.yml)

---

## Fonctionnalités

- **Multi-projets** — scénarios isolés par applicatif (ATHENA, HERMES, HADES, etc.)
- **Génération IA** — scénarios Given/When/Then via Anthropic Claude, OpenAI, Mistral ou Ollama (local)
- **Import Excel** — normalisation automatique en GWT via IA
- **Campagnes de tests** — exécution pas-à-pas avec PASS / FAIL / BLOQUÉ, analyse des échecs par IA
- **Historique & KPIs** — taux de succès, taux de fuite, tendance sur les campagnes
- **Matrice de traçabilité** — couverture exigences ↔ scénarios
- **Rapport COMEP** — score de confiance qualité (0-100), risques résiduels, commentaire go/no-go IA
- **Export** — rapport HTML autonome (avec synthèse exécutive IA optionnelle), JSON brut, résultats de campagne
- **Intégration ClickUp** — création automatique de tickets sur les FAIL/BLOQUÉ
- **Gestion des utilisateurs** — rôles (automaticien, cp, key_user, admin), workflow de validation, notifications

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Backend | Node.js 20 + Express 5 |
| Base de données | SQLite 3 |
| Frontend principal | React 18 + Vite + TypeScript + Tailwind CSS |
| Frontend legacy | HTML vanilla + `api-client.js` |
| LLM | Anthropic Claude, OpenAI, Mistral, Ollama |
| Tests | Jest 30 + Supertest 7 |
| CI/CD | GitHub Actions |

---

## Installation

```bash
# 1. Cloner le projet
git clone https://github.com/MarieBonifacio/testpilot.git
cd testpilot

# 2. Dépendances backend
npm install

# 3. Dépendances frontend React
cd src-react && npm install && cd ..

# 4. Variables d'environnement (optionnel — uniquement pour Anthropic)
cp .env.example .env
# Éditer .env si nécessaire

# 5. Initialiser la base de données
node init_db.js
```

> **Note :** `testpilot.db` n'est pas versionné. L'exécuter une seule fois par environnement. En cas de migration (nouvelles tables), relancer `node init_db.js` — les migrations sont idempotentes.

---

## Démarrage

```bash
# Terminal 1 — Backend (port 3000)
node proxy.js

# Terminal 2 — Frontend React (port 5173, optionnel)
cd src-react
npm run dev
```

| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Interface HTML vanilla (toujours disponible) |
| `http://localhost:5173` | Interface React (dev uniquement) |
| `http://localhost:3000/api/` | API REST |

> En production, le frontend React buildé est servi directement par Express depuis `src-react/dist/`.

---

## Tests automatisés

```bash
npm test            # Lance Jest (16 tests)
npm run test:watch  # Mode watch
```

Les tests couvrent les 3 endpoints Ollama proxy avec mocks Jest (`jest.spyOn` sur `ollamaRequest`) — aucun serveur Ollama requis.

---

## Commandes utiles

| Commande | Répertoire | Description |
|----------|-----------|-------------|
| `node proxy.js` | racine | Démarre le backend |
| `node init_db.js` | racine | Initialise/migre la BDD |
| `npm test` | racine | Lance la suite de tests |
| `npm run dev` | `src-react/` | Frontend React en mode développement |
| `npm run build` | `src-react/` | Compile le frontend pour la production |
| `npx tsc --noEmit` | `src-react/` | Vérification TypeScript sans build |

---

## Configuration

### Variables d'environnement (`.env`)

```env
# Optionnel — uniquement si vous utilisez Anthropic côté serveur
ANTHROPIC_API_KEY=sk-ant-api03-...

# Port du serveur (défaut : 3000)
PORT=3000
```

> Les clés OpenAI et Mistral sont transmises **par le client** (stockées dans `localStorage`) — elles ne transitent pas par le serveur.

### Utiliser Ollama (100 % local, sans clé API)

Ollama permet de faire tourner des modèles IA directement sur votre machine.

**1. Installer Ollama** — [ollama.com](https://ollama.com) (Windows, macOS, Linux)

**2. Démarrer le serveur**
```bash
ollama serve
```
> Sur Windows/macOS, Ollama démarre automatiquement après installation.

**3. Télécharger un modèle**
```bash
ollama pull mistral        # ~4 Go — recommandé pour débuter
ollama pull llama3.2
ollama pull qwen2.5-coder  # orienté code
ollama pull phi4
```

**4. Configurer dans TestPilot**

Dans la page **Rédaction**, sélectionnez le provider **Ollama** :
- Champ **Hôte** : pré-rempli à `http://localhost:11434`
- Bouton **↻** : détecte automatiquement les modèles installés
- Bouton **Tester** : vérifie la connexion

Le badge affiche l'état en temps réel : `en ligne` (vert) / `hors ligne` (rouge).

> Le paramètre `host` accepte uniquement des URLs `http://` ou `https://`. Les adresses de métadonnées cloud (AWS IMDS, GCP, Azure) sont bloquées côté serveur.

### Compte administrateur initial

Au premier démarrage (base vide), la route `POST /api/auth/register` est ouverte :

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"MotDePasseStrong!","display_name":"Admin","role":"admin"}'
```

Les créations suivantes nécessitent un token admin dans le header `Authorization: Bearer <token>`.

### Projets pré-configurés

La base est initialisée avec les projets Carter-Cash :
`ATHENA` · `HERMES` · `HADES` · `Open Bravo` · `KEPLER` · `APIs` · `Batch` · `Site Web` · `Semarchy`

---

## Structure du projet

```
testpilot/
├── .github/
│   └── workflows/
│       ├── ci.yml              # CI — lint + tests + build sur push/PR
│       └── cd.yml              # CD — release archive sur tag vX.Y.Z
├── tests/
│   └── ollama.test.js          # Suite Jest (16 tests)
├── proxy.js                    # Serveur Express — API REST + proxys LLM (~1760 lignes)
├── api-client.js               # Module JS partagé — appels API + module LLM multi-provider
├── init_db.js                  # Migrations SQLite (P0 → P3, idempotent)
├── db_schema.sql               # Schéma de référence
├── package.json                # Dépendances backend + scripts test
├── testpilot.db                # BDD SQLite (ignorée git — générée par init_db.js)
├── index.html                  # Page Rédaction (génération IA scénarios)
├── campagne.html               # Page Campagne (exécution + analyse échecs IA)
├── export.html                 # Page Export (HTML/JSON + synthèse exécutive IA)
├── comep.html                  # Page COMEP (rapport qualité + commentaire IA)
├── import.html                 # Page Import Excel (normalisation GWT via IA)
├── tracabilite.html            # Page Traçabilité (matrice exigences)
├── historique.html             # Page Historique campagnes
├── dashboard.html              # Page Dashboard KPIs
├── clickup.html                # Page ClickUp (configuration + push tickets)
└── src-react/                  # Frontend React (interface principale)
    ├── vite.config.ts          # Port 5173, proxy /api → :3000
    ├── package.json
    └── src/
        ├── App.tsx             # Routeur + RequireAuth
        ├── types/              # Types TypeScript partagés
        ├── lib/
        │   ├── api.ts          # Tous les appels API typés
        │   └── hooks.tsx       # ProjectProvider, AuthProvider, useNotifications
        ├── components/
        │   ├── ProjectSelector.tsx
        │   └── NotificationBell.tsx
        └── pages/              # 11 pages React (Redaction, Dashboard, Campagne,
                                #  Import, Historique, Tracabilite, ClickUp,
                                #  Comep, Export, Login, Users)
```

---

## CI/CD

### Pipeline CI (`.github/workflows/ci.yml`)

Déclenché sur chaque **push** et **pull request** vers `master` / `main` / `develop` :

| Job | Description |
|-----|-------------|
| `backend-lint` | Vérification syntaxe `proxy.js` via `node --check` + ESLint si présent |
| `backend-test` | `node init_db.js` + `npm test` (Jest) — dépend de `backend-lint` |
| `frontend-build` | `tsc --noEmit` + `vite build` — bloque si erreur TypeScript ou build cassé |

### Pipeline CD (`.github/workflows/cd.yml`)

Déclenché sur chaque **tag** `vX.Y.Z` :

- Build complet backend + frontend
- Génération d'une archive `testpilot-vX.Y.Z.zip` (sans `node_modules` — faire `npm install` après extraction)
- Création d'une **GitHub Release** avec notes automatiques

### Hook pre-commit local

Le hook `.git/hooks/pre-commit` vérifie automatiquement :
- Build TypeScript si des fichiers `src-react/` sont stagés
- Syntaxe de `proxy.js` s'il est stagé

Pour bypasser ponctuellement : `git commit --no-verify`

---

## API REST — Référence

### Auth
| Méthode | Route | Description | Auth |
|---------|-------|-------------|------|
| `POST` | `/api/auth/register` | Créer un utilisateur | Admin (sauf bootstrap) |
| `POST` | `/api/auth/login` | Connexion → token Bearer | — |
| `POST` | `/api/auth/logout` | Déconnexion | Requis |
| `GET`  | `/api/auth/me` | Profil courant | Requis |

### Projets
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`    | `/api/projects` | Liste tous les projets |
| `GET`    | `/api/projects/:id` | Détail d'un projet |
| `POST`   | `/api/projects` | Créer un projet |
| `PUT`    | `/api/projects/:id` | Modifier un projet |
| `DELETE` | `/api/projects/:id` | Supprimer un projet |
| `GET`    | `/api/projects/:id/context` | Contexte projet (features adjacentes, contraintes) |
| `PUT`    | `/api/projects/:id/context` | Mettre à jour le contexte |
| `GET`    | `/api/projects/:id/stats` | Statistiques (total, acceptés, TNR, par feature) |

### Scénarios
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`    | `/api/projects/:id/scenarios` | Liste (filtres : `?accepted=true`, `?is_tnr=true`) |
| `POST`   | `/api/projects/:id/scenarios` | Créer un ou plusieurs scénarios (tableau accepté) |
| `PUT`    | `/api/scenarios/:id` | Modifier un scénario |
| `PATCH`  | `/api/scenarios/:id/accept` | Basculer l'état accepté |
| `PATCH`  | `/api/scenarios/:id/tnr` | Basculer le marquage TNR |
| `PUT`    | `/api/scenarios/:id/reference` | Modifier la référence exigence |
| `DELETE` | `/api/scenarios/:id` | Supprimer un scénario |
| `DELETE` | `/api/projects/:id/scenarios` | Supprimer tous les scénarios d'un projet |
| `POST`   | `/api/projects/:id/scenarios/accept-all` | Accepter tous les scénarios |
| `PATCH`  | `/api/scenarios/:id/submit` | Soumettre pour validation (workflow) |
| `PATCH`  | `/api/scenarios/:id/validate` | Valider (rôle CP/admin) |
| `PATCH`  | `/api/scenarios/:id/reject` | Rejeter avec motif (rôle CP/admin) |
| `PATCH`  | `/api/scenarios/:id/assign` | Assigner à un utilisateur (rôle CP/admin) |

### Analyses IA
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`  | `/api/projects/:id/analysis` | Dernière analyse (feature, complexité, ambiguïtés) |
| `POST` | `/api/projects/:id/analysis` | Sauvegarder une analyse |

### Campagnes & Sessions
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`  | `/api/projects/:id/sessions` | Liste des sessions de test |
| `POST` | `/api/projects/:id/sessions` | Créer une session |
| `GET`  | `/api/sessions/:id` | Détail session + résultats |
| `PUT`  | `/api/sessions/:id/finish` | Terminer une session |
| `POST` | `/api/sessions/:id/results` | Enregistrer un résultat (statuts : `pass`, `fail`, `blocked`, `skipped`) |
| `GET`  | `/api/projects/:id/campaigns` | Historique campagnes avec KPIs |
| `POST` | `/api/projects/:id/campaigns` | Archiver une campagne terminée |
| `GET`  | `/api/campaigns/:id` | Détail campagne avec résultats |
| `DELETE` | `/api/campaigns/:id` | Supprimer une campagne |
| `GET`  | `/api/projects/:id/campaigns/kpis` | KPIs agrégés + tendance |

### Traçabilité
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/projects/:id/coverage-matrix` | Matrice exigences ↔ scénarios avec stats de couverture |

### Import Excel
| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/projects/:id/import-excel` | Parser un fichier `.xlsx` → scénarios normalisés |

Body : `application/octet-stream` (fichier brut) ou `{ base64: "..." }`.

### Proxy LLM
| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/messages` | Proxy Anthropic Claude (clé API transmise côté serveur) |

### Ollama (proxy local)
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`  | `/api/ollama/health?host=<url>` | Vérifie si Ollama est joignable → `{ ok: true/false }` |
| `GET`  | `/api/ollama/models?host=<url>` | Liste les modèles installés → `{ models: ["llama3.2", ...] }` |
| `POST` | `/api/ollama/chat` | Proxy de génération (format OpenAI-compatible) |

Paramètre `host` optionnel, défaut : `http://localhost:11434`. Seuls `http://` et `https://` sont autorisés.

Corps de `/api/ollama/chat` :
```json
{
  "model": "llama3.2",
  "messages": [{ "role": "user", "content": "..." }],
  "host": "http://localhost:11434",
  "temperature": 0.2
}
```

### ClickUp
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`  | `/api/projects/:id/clickup-config` | Configuration ClickUp du projet |
| `PUT`  | `/api/projects/:id/clickup-config` | Sauvegarder la configuration |
| `GET`  | `/api/clickup/lists?token=<token>` | Lister les listes ClickUp accessibles |
| `POST` | `/api/clickup/create-task` | Créer une tâche pour un scénario FAIL/BLOQUÉ |
| `POST` | `/api/clickup/create-batch` | Créer plusieurs tâches en lot |

### COMEP
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/api/projects/:id/comep-report` | Rapport COMEP complet (score, KPIs, risques, recommandations) |

### Utilisateurs & Notifications
| Méthode | Route | Description |
|---------|-------|-------------|
| `GET`    | `/api/users` | Liste des utilisateurs | 
| `GET`    | `/api/users/:id` | Détail utilisateur |
| `PUT`    | `/api/users/:id` | Modifier (soi-même ou admin) — modification de rôle réservée admin |
| `DELETE` | `/api/users/:id` | Supprimer (admin) |
| `GET`    | `/api/notifications` | Notifications de l'utilisateur courant |
| `PATCH`  | `/api/notifications/:id/read` | Marquer comme lu |
| `POST`   | `/api/notifications/read-all` | Tout marquer comme lu |

---

## Rôles utilisateurs

| Rôle | Droits |
|------|--------|
| `automaticien` | Rédaction, exécution campagnes, import |
| `key_user` | Consultation, feedback sur scénarios |
| `cp` | + Validation scénarios, assignation, historique complet |
| `admin` | Accès total, gestion utilisateurs, modification des rôles |

---

## Sécurité — points d'attention

- Les **mots de passe** sont stockés avec SHA-256 (sans salt). Pour un déploiement en production exposé à Internet, migrer vers `bcrypt`.
- Le **CORS** est ouvert (`*`) — adapté en réseau local. Restreindre à l'origine du frontend en production.
- Les **clés API** (OpenAI, Mistral) sont stockées en `localStorage` côté client et ne passent pas par le serveur.
- Le paramètre `host` des routes Ollama est validé côté serveur (schéma HTTP(S) uniquement, blocage des adresses de métadonnées cloud).

---

## License

MIT
