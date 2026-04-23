# 🚀 Démarrage TestPilot Backend + Frontend

Trois façons de démarrer le serveur complet:

## 1️⃣ **Batch (Windows - Recommandé)**

```bash
dev.bat
```

Ouvre automatiquement deux fenêtres terminales: une pour le backend, une pour le frontend.

## 2️⃣ **PowerShell (Windows)**

```powershell
.\dev.ps1
```

Lance les serveurs en arrière-plan avec monitoring. Appuyez sur `Ctrl+C` pour arrêter.

## 3️⃣ **Bash (Git Bash / WSL / macOS / Linux)**

```bash
./dev.sh
```

Lance les serveurs en arrière-plan. Appuyez sur `Ctrl+C` pour arrêter.

## 4️⃣ **npm (Tous les OS)**

```bash
npm run dev:full
```

Lance via npm (nécessite deux terminales ouvertes, une pour backend, une pour frontend).

---

## 📋 Ce qui se passe

| Étape | Action | Port |
|-------|--------|------|
| 1 | Initialise la base de données SQLite | - |
| 2 | Démarre le backend Express | **3000** |
| 3 | Démarre le frontend Vite React | **5173** |

---

## 🌐 URLs d'accès

- **Application**: http://localhost:5173
- **API Backend**: http://localhost:3000/api
- **Base de données**: `testpilot.db`

---

## 🛑 Arrêter les serveurs

- **Windows (batch/PS1)**: Fermer les fenêtres ou `Ctrl+C`
- **Bash**: `Ctrl+C` dans le terminal
- **npm**: `Ctrl+C` dans le terminal

---

## ⚙️ Configuration

Variables d'environnement (fichier `.env`):
- `ANTHROPIC_API_KEY`: Clé API Anthropic (optionnel)
- `PORT`: Port du backend (défaut: 3000)

Voir `.env.example` pour plus d'options.

---

## 🐛 Troubleshooting

### Port 3000 ou 5173 déjà utilisé
```bash
# Lister les processus sur le port
netstat -ano | findstr :3000    # Windows
lsof -i :3000                   # macOS/Linux
```

### Node.js non trouvé
Installer depuis https://nodejs.org

### Base de données corrompue
Supprimer `testpilot.db` et relancer (sera recréée)
