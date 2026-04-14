# TestPilot v2.0

Générateur de scénarios de tests assisté par IA — avec persistance multi-projets et bibliothèque TNR.

---

## Présentation

TestPilot est une application web permettant de :
- Gérer **plusieurs projets/applicatifs** avec des scénarios séparés
- Générer automatiquement des scénarios de tests via IA (Anthropic, OpenAI, Mistral, Ollama)
- Analyser la complexité, les ambiguïtés et les risques de régression
- Constituer une **bibliothèque de TNR** (Tests de Non Régression) réutilisables
- Exécuter des campagnes de tests avec filtrage TNR
- Exporter des livrables (HTML, JSON, rapports)

**Nouveautés v2.0 :**
- Backend SQLite pour la persistance des données
- Gestion multi-projets (ATHENA, HERMES, HADES, etc.)
- Marquage des scénarios comme TNR
- Campagnes TNR dédiées
- API REST complète

---

## Installation

```bash
# Cloner le projet
git clone https://github.com/MarieBonifacio/testpilot.git
cd testpilot

# Installer les dépendances
npm install

# Configurer l'environnement
cp .env.example .env
# Éditer .env avec votre clé API Anthropic

# Initialiser la base de données
npm run init-db

# Démarrer le serveur
npm start
```

Ouvrir http://localhost:3000

---

## Commandes

| Commande | Description |
|----------|-------------|
| `npm start` | Démarre le serveur |
| `npm run init-db` | Initialise/réinitialise la base de données |
| `npm run dev` | Init DB + démarrage (développement) |

---

## Structure des fichiers

| Fichier | Description |
|---------|-------------|
| `index.html` | Rédaction - génération de scénarios |
| `dashboard.html` | Dashboard - couverture de tests |
| `campagne.html` | Campagne - exécution et suivi |
| `export.html` | Export - génération de livrables |
| `proxy.js` | Serveur Express (API REST + proxy LLM) |
| `api-client.js` | Client API JavaScript partagé |
| `init_db.js` | Script d'initialisation de la BDD |
| `db_schema.sql` | Schéma de la base de données |
| `testpilot.db` | Base de données SQLite (générée) |

---

## API REST

### Projets
- `GET /api/projects` — Liste des projets
- `GET /api/projects/:id` — Détail d'un projet
- `POST /api/projects` — Créer un projet
- `PUT /api/projects/:id` — Modifier un projet
- `DELETE /api/projects/:id` — Supprimer un projet

### Scénarios
- `GET /api/projects/:id/scenarios` — Liste des scénarios d'un projet
- `POST /api/projects/:id/scenarios` — Créer des scénarios
- `PUT /api/scenarios/:id` — Modifier un scénario
- `PATCH /api/scenarios/:id/accept` — Basculer l'état accepté
- `PATCH /api/scenarios/:id/tnr` — Basculer le marquage TNR
- `DELETE /api/scenarios/:id` — Supprimer un scénario

### Sessions de test
- `GET /api/projects/:id/sessions` — Liste des sessions
- `POST /api/projects/:id/sessions` — Créer une session
- `GET /api/sessions/:id` — Détail avec résultats
- `POST /api/sessions/:id/results` — Enregistrer un résultat

### Statistiques
- `GET /api/projects/:id/stats` — Statistiques du projet

---

## Configuration

### .env

```
ANTHROPIC_API_KEY=sk-ant-api03-...
PORT=3000
```

### Projets pré-configurés

La base de données est initialisée avec les projets Carter-Cash :
- ATHENA (ERP historique)
- HERMES (Encaissement Italie/Espagne)
- HADES (Gestion des pneus)
- Open Bravo (SaaS encaissement)
- APIs, Batch, Site Web, Semarchy

---

## Fonctionnalités

### Rédaction (index.html)
- **Sélecteur de projet** dans la navbar
- **Création de projets** via le bouton "+"
- 4 fournisseurs LLM (Anthropic, OpenAI, Mistral, Ollama)
- Analyse automatique (feature, complexité, ambiguïtés)
- Scénarios avec Given/When/Then
- **Marquage TNR** par scénario
- Actions : Accepter, TNR, Modifier, Supprimer

### Dashboard (dashboard.html)
- 5 métriques (Total, Acceptés, TNR, Critiques, Non couverts)
- Barre de progression globale
- Groupement par feature avec badge TNR

### Campagne (campagne.html)
- **Filtre TNR** pour exécuter uniquement les tests de non régression
- Progression (pass/fail/blocked/pending)
- Commentaires par scénario
- Résultats avec horodatages

### Export (export.html)
- 4 formats (HTML complet, HTML scénarios, JSON brut, JSON résultats)
- **Option TNR uniquement**
- Badge TNR dans les rapports

---

## Roadmap

### P1 - Prochaines évolutions (haute priorité)
- Import Excel des cahiers de tests existants
- Historique des campagnes avec KPIs
- Traçabilité exigence ↔ scénario

### P2 - À court terme (priorité moyenne)
- Intégration ClickUp (création auto de tickets)
- Rapports COMEP (synthétique, score de confiance)

### P3 - À plus long terme (priorité basse)
- Mode multi-utilisateur / rôles
- Assignation de scénarios
- Workflow de validation

---

## Stack technique

- **Frontend** : HTML5 / CSS3 / JavaScript vanilla
- **Backend** : Node.js + Express 5
- **Base de données** : SQLite 3
- **LLM** : Anthropic Claude, OpenAI, Mistral, Ollama

---

## License

MIT
