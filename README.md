# TestPilot v2.0

Générateur de scénarios de tests assisté par IA pour Carter-Cash.

[![CI](https://github.com/MarieBonifacio/testpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/MarieBonifacio/testpilot/actions/workflows/ci.yml)

---

## Présentation

TestPilot est une application web (React 18 + Node.js) permettant de :

- Gérer **plusieurs projets/applicatifs** avec scénarios séparés (ATHENA, HERMES, HADES, etc.)
- Générer automatiquement des scénarios de tests via IA (Anthropic Claude, OpenAI, Mistral, Ollama)
- Analyser la complexité, les ambiguïtés et les risques de régression
- Constituer une **bibliothèque de TNR** (Tests de Non Régression) réutilisables
- Exécuter des **campagnes de tests** avec KPIs et historique
- Tracer les exigences vers les scénarios (**matrice de traçabilité**)
- Intégrer **ClickUp** (création auto de tickets sur les FAIL/BLOQUÉ)
- Générer des **rapports COMEP** avec score de confiance qualité
- Gérer les utilisateurs avec **rôles et workflow de validation** (P3)

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS |
| Backend | Node.js + Express 5 |
| Base de données | SQLite 3 |
| LLM | Anthropic Claude, OpenAI, Mistral, Ollama |
| CI/CD | GitHub Actions |

---

## Installation

```bash
# Cloner le projet
git clone https://github.com/MarieBonifacio/testpilot.git
cd testpilot

# Dépendances backend
npm install

# Dépendances frontend
cd src-react && npm install && cd ..

# Configurer l'environnement
cp .env.example .env
# Éditer .env avec votre clé API

# Initialiser la base de données
node init_db.js
```

---

## Démarrage

Deux processus à lancer en parallèle (deux terminaux) :

```bash
# Terminal 1 — Backend (port 3000)
node proxy.js

# Terminal 2 — Frontend React (port 5173)
cd src-react
npm run dev
```

Ouvrir **http://localhost:5173**

> Le frontend proxifie automatiquement `/api` vers `localhost:3000`.

---

## Commandes utiles

| Commande | Répertoire | Description |
|----------|-----------|-------------|
| `node proxy.js` | racine | Démarre le serveur backend |
| `node init_db.js` | racine | Initialise/migre la base de données |
| `npm run dev` | `src-react/` | Lance le front en mode développement |
| `npm run build` | `src-react/` | Compile le front pour la production |
| `npx tsc --noEmit` | `src-react/` | Vérifie les types TypeScript sans builder |

---

## Configuration

### .env

```
ANTHROPIC_API_KEY=sk-ant-api03-...
PORT=3000
```

### Compte admin initial

Au premier démarrage, créer un compte via `POST /api/auth/register` (libre si la base est vide).
Les créations suivantes nécessitent un token admin.

Exemple :
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin2026!","display_name":"Admin","role":"admin"}'
```

### Projets pré-configurés Carter-Cash

La base est initialisée avec :
`ATHENA` · `HERMES` · `HADES` · `Open Bravo` · `KEPLER` · `APIs` · `Batch` · `Site Web` · `Semarchy`

---

## Structure du projet

```
testpilot/
├── .github/
│   └── workflows/
│       ├── ci.yml          # CI — typecheck + build sur push/PR
│       └── cd.yml          # CD — release archive sur tag vX.Y.Z
├── proxy.js                # Serveur Express (~1600 lignes) — API REST + proxy LLM
├── init_db.js              # Migrations SQLite (P0 → P3)
├── db_schema.sql           # Schéma de référence
├── package.json            # Dépendances backend
├── testpilot.db            # BDD SQLite (ignorée git)
└── src-react/              # Frontend React
    ├── vite.config.ts      # Port 5173, proxy /api → :3000
    ├── package.json
    └── src/
        ├── App.tsx         # Routeur + navigation + RequireAuth
        ├── types/          # Types TypeScript partagés
        ├── lib/
        │   ├── api.ts      # Tous les appels API
        │   └── hooks.tsx   # ProjectProvider, AuthProvider, useNotifications
        ├── components/
        │   ├── ProjectSelector.tsx
        │   └── NotificationBell.tsx
        └── pages/          # 11 pages (Redaction, Dashboard, Campagne, Import,
                            #  Historique, Tracabilite, ClickUp, Comep,
                            #  Export, Login, Users)
```

---

## CI/CD

### Pipeline CI (`.github/workflows/ci.yml`)

Déclenché sur chaque **push** et **pull request** vers `master` / `main` :

| Étape | Description |
|-------|-------------|
| `backend-lint` | Vérification syntaxe `proxy.js` via `node --check` |
| `frontend-build` | `tsc --noEmit` + `vite build` — bloque si erreur TS ou build cassé |
| Upload artifact | Le `dist/` buildé est conservé 7 jours |

### Pipeline CD (`.github/workflows/cd.yml`)

Déclenché sur chaque **tag** `vX.Y.Z` :

- Build complet backend + frontend
- Génération d'une archive `testpilot-vX.Y.Z.zip`
- Création d'une **GitHub Release** avec notes automatiques

### Hook pre-commit local

Un hook `.git/hooks/pre-commit` vérifie automatiquement :
- Le build TypeScript si des fichiers `src-react/` sont stagés
- La syntaxe de `proxy.js` s'il est stagé

Pour bypasser ponctuellement : `git commit --no-verify`

---

## API REST — Référence rapide

### Auth
- `POST /api/auth/register` — Créer un utilisateur (admin requis sauf bootstrap)
- `POST /api/auth/login` — Connexion → token
- `POST /api/auth/logout` — Déconnexion
- `GET  /api/auth/me` — Profil courant

### Projets
- `GET    /api/projects` — Liste
- `POST   /api/projects` — Créer
- `PUT    /api/projects/:id` — Modifier
- `DELETE /api/projects/:id` — Supprimer

### Scénarios
- `GET    /api/projects/:id/scenarios` — Liste
- `POST   /api/projects/:id/scenarios` — Créer
- `PUT    /api/scenarios/:id` — Modifier
- `PATCH  /api/scenarios/:id/accept` — Basculer accepté
- `PATCH  /api/scenarios/:id/tnr` — Basculer TNR
- `PATCH  /api/scenarios/:id/reference` — Modifier référence exigence
- `DELETE /api/scenarios/:id` — Supprimer

### Campagnes & Historique
- `GET  /api/projects/:id/campaigns` — Historique campagnes avec KPIs
- `POST /api/projects/:id/sessions` — Créer une session de test
- `GET  /api/sessions/:id` — Détail session + résultats
- `POST /api/sessions/:id/results` — Enregistrer résultats
- `POST /api/sessions/:id/archive` — Archiver la campagne

### Traçabilité
- `GET /api/projects/:id/coverage-matrix` — Matrice exigences ↔ scénarios

### Import
- `POST /api/projects/:id/import` — Importer scénarios depuis Excel/JSON

### ClickUp
- `GET  /api/projects/:id/clickup/config` — Configuration ClickUp
- `POST /api/projects/:id/clickup/config` — Sauvegarder config
- `GET  /api/projects/:id/clickup/lists` — Listes ClickUp disponibles
- `POST /api/projects/:id/clickup/push` — Créer tickets FAIL/BLOQUÉ

### COMEP
- `GET /api/projects/:id/comep` — Rapport COMEP avec score de confiance

### Utilisateurs & Notifications
- `GET    /api/users` — Liste des utilisateurs (admin)
- `POST   /api/users` — Créer un utilisateur (admin)
- `DELETE /api/users/:id` — Supprimer (admin)
- `GET    /api/notifications` — Notifications de l'utilisateur courant
- `PATCH  /api/notifications/:id/read` — Marquer comme lu

---

## Rôles utilisateurs

| Rôle | Droits |
|------|--------|
| `automaticien` | Rédaction, exécution campagnes, import |
| `cp` | + Validation scénarios, historique complet |
| `key_user` | Consultation, feedback sur scénarios |
| `admin` | Accès total, gestion utilisateurs |

---

## License

MIT
