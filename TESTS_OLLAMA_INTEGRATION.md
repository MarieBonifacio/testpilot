# Tests d'intégration Ollama

## Résumé des changements

Cette PR ajoute le support complet d'Ollama dans TestPilot avec :
1. **Détection automatique des modèles** via le bouton "Tester"
2. **Prompts adaptatifs** selon la taille du modèle (1B/3B vs 7B+)
3. **Gestion robuste des erreurs** et timeouts
4. **Fix du bug `[object Object]`** dans les scénarios générés

## Tests unitaires (Backend)

Les tests backend sont dans `tests/ollama.test.js` et couvrent :
- ✅ Health check (`GET /api/ollama/health`)
- ✅ Liste des modèles (`GET /api/ollama/models`)
- ✅ Chat completion (`POST /api/ollama/chat`)
- ✅ Gestion des erreurs réseau
- ✅ Validation des payloads

**Lancer les tests :**
```bash
npm test
```

## Tests manuels (Frontend)

### Test 1 : Bouton "Tester" Ollama

**Pré-requis :** Ollama installé et en cours d'exécution (`ollama serve`)

1. Aller dans **Paramètres LLM**
2. Cliquer sur l'onglet **Ollama**
3. Cliquer sur le bouton **Tester**
4. **Attendu :** La pastille passe de "vérification..." à "● en ligne" (vert)
5. **Attendu :** Le dropdown des modèles se remplit avec les modèles installés

**Cas d'erreur :**
1. Arrêter Ollama (`pkill ollama` ou fermer l'app)
2. Cliquer sur **Tester**
3. **Attendu :** La pastille passe à "● hors ligne" (rouge)
4. **Attendu :** Un message d'erreur s'affiche

### Test 2 : Génération avec petit modèle (llama3.2:1b)

**Pré-requis :** `ollama pull llama3.2:1b`

1. Dans **Paramètres LLM → Ollama**, sélectionner **llama3.2:1b**
2. Cliquer sur **Sauvegarder**
3. Aller dans **Rédaction**
4. Coller ce texte de test :
   ```
   [NOVA] - Impossible de supprimer un projet
   Retour client: "Nous ne pouvons pas supprimer de dossier, 
   cette option de suppression ne doit être accessible qu'aux administrateurs"
   ```
5. Cliquer sur **Générer**
6. **Attendu :** 3-5 scénarios générés avec Given/When/Then cohérents
7. **Attendu :** Pas de `[object Object]` dans les champs
8. **Attendu :** Les scénarios mentionnent la suppression de projet (pas de sujets hors-contexte)

### Test 3 : Génération avec gros modèle (qwen2.5-coder:7b)

**Pré-requis :** `ollama pull qwen2.5-coder:7b`

1. Dans **Paramètres LLM → Ollama**, sélectionner **qwen2.5-coder:7b**
2. Cliquer sur **Sauvegarder**
3. Répéter le test précédent avec le même texte
4. **Attendu :** 5-8 scénarios générés (plus que le petit modèle)
5. **Attendu :** Scénarios plus détaillés et pertinents
6. **Attendu :** Champs `ambiguities` et `regressionRisks` remplis dans l'analyse

### Test 4 : Changement de host Ollama

1. Dans **Paramètres LLM → Ollama**, modifier le host à `http://192.168.1.10:11434`
2. Cliquer sur **Tester**
3. **Attendu :** Si le serveur existe, la pastille passe au vert
4. **Attendu :** Sinon, erreur explicite affichée

### Test 5 : Persistance des paramètres

1. Configurer Ollama avec un modèle spécifique
2. Cliquer sur **Sauvegarder**
3. Rafraîchir la page (F5)
4. **Attendu :** Le modèle sélectionné est toujours affiché
5. **Attendu :** Le provider actif est toujours Ollama

## Cas limites testés

### Fix `[object Object]` 
**Problème :** Le LLM retournait parfois des objets au lieu de strings dans `given`/`then`

**Solution :** Ajout de `String()` cast dans `Redaction.tsx:242-244`

**Test :**
1. Générer des scénarios avec llama3.2:1b
2. Vérifier qu'aucun `[object Object]` n'apparaît

### Fix `useCallback` dependencies
**Problème :** Le bouton "Tester" ne déclenchait pas la vérification

**Solution :** Ajout de `providerSettings.ollama.host` et `model` dans les dépendances du `useCallback`

**Test :**
1. Modifier le host dans l'input
2. Cliquer sur "Tester"
3. Vérifier dans DevTools Network qu'une requête est envoyée au nouveau host

### Détection des petits modèles
**Logique :** `model.includes(':1b') || model.includes(':3b') || model.startsWith('llama3.2:1b') || model.startsWith('phi')`

**Test manuel :**
- `llama3.2:1b` → prompt simplifié ✅
- `phi:latest` → prompt simplifié ✅
- `qwen2.5-coder:7b` → prompt complet ✅
- `mistral:latest` → prompt complet ✅

## Résultats attendus

**Backend tests (npm test) :**
```
PASS  tests/ollama.test.js
  GET /api/ollama/health
    ✓ retourne { ok: true } quand Ollama répond 200
    ✓ retourne { ok: false } avec HTTP 502 quand Ollama répond 500
    ✓ utilise localhost:11434 par défaut si host absent
    ✓ retourne 502 si Ollama est inaccessible (erreur réseau)
  GET /api/ollama/models
    ✓ retourne la liste des modèles depuis Ollama
    ✓ retourne un tableau vide si Ollama n'a aucun modèle
    ✓ retourne HTTP 502 si Ollama répond avec une erreur
    ✓ retourne 502 si Ollama est inaccessible (erreur réseau)
  POST /api/ollama/chat
    ✓ proxifie la requête vers Ollama et retourne la réponse
    ✓ utilise l'hôte personnalisé si fourni dans le body
    ✓ retourne 400 si model est absent
    ✓ retourne 400 si messages est absent
    ✓ retourne 502 avec hint si Ollama retourne une erreur
    ✓ retourne 502 avec hint si Ollama est inaccessible
    ✓ applique temperature 0.2 par défaut
    ✓ accepte une temperature personnalisée

Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
```

**Frontend : Tous les tests manuels ci-dessus doivent passer.**

## Checklist de validation

- [x] Tests backend passent (`npm test`)
- [x] Bouton "Tester" fonctionne et détecte les modèles
- [x] Génération avec llama3.2:1b produit des scénarios cohérents
- [x] Génération avec qwen2.5-coder:7b produit des scénarios détaillés
- [x] Pas de `[object Object]` dans les scénarios
- [x] Changement de host Ollama fonctionne
- [x] Paramètres sont persistés après refresh
- [x] Build frontend passe sans erreurs TypeScript (`npm run build`)
