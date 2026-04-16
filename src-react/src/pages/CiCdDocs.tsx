import { useState } from 'react';
import { Copy, Check, Github, Cloud, Gitlab, Terminal, AlertCircle } from 'lucide-react';

const API_REFERENCE = [
  { method: 'POST', path: '/api/trigger', desc: 'Déclencher une campagne de tests' },
  { method: 'GET', path: '/api/sessions/:id/status', desc: 'Statut de la session (polling)' },
  { method: 'GET', path: '/api/sessions/:id/junit', desc: 'Télécharger le rapport JUnit XML' },
  { method: 'POST', path: '/api/sessions/:id/bulk-results', desc: 'Soumettre des résultats en masse' },
];

const TRIGGER_PARAMS = [
  { name: 'project', required: true, desc: "Nom ou ID du projet (ex: 'ATHENA')" },
  { name: 'filter', required: false, desc: "Filtre: 'all', 'tnr', 'critical', 'feature:XXX'" },
  { name: 'mode', required: false, desc: "Mode: 'full' (défaut), 'smoke', 'regression'" },
  { name: 'scenario_ids', required: false, desc: 'Tableau IDs scénarios spécifiques (alternative au filter)' },
  { name: 'commit_sha', required: false, desc: 'SHA du commit pour traçabilité' },
  { name: 'branch', required: false, desc: 'Nom de la branche' },
  { name: 'pipeline_url', required: false, desc: 'URL du pipeline (lien retour)' },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };
  return (
    <button onClick={copy} className="btn btn-secondary text-xs px-2 py-1" style={{ minWidth: '60px' }}>
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'OK' : 'Copier'}
    </button>
  );
}

export function CiCdDocs() {
  const [tab, setTab] = useState<'github' | 'azure' | 'gitlab'>('github');

  // Les doubles accolades {{ }} sont interpretées par TS comme objet inline.
  // On utilise des variables pour eviter le parsing.
  const d = '{{';
  const d2 = '}}';
  const s = '$';
  const sf = s + d + ' secrets.TESTPILOT_URL' + d2;
  const st = s + d + ' secrets.TESTPILOT_TOKEN' + d2;
  const sgi = s + d + ' github.sha' + d2;
  const sgb = s + d + ' github.ref_name' + d2;
  const sps = s + d + ' steps.testpilot.outputs.session_id' + d2;
  const spju = s + d + ' steps.testpilot.outputs.junit_url' + d2;

  const example = tab === 'github' ? 
`jobs:
  test-pilot:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger TNR TestPilot
        id: testpilot
        run: |
          RESPONSE=$(curl -s -X POST "${sf}/api/trigger" \\
            -H "Authorization: Bearer ${st}" \\
            -H "Content-Type: application/json" \\
            -d '{"project": "ATHENA", "filter": "tnr", "mode": "smoke", "commit_sha": "${sgi}", "branch": "${sgb}"}')
          echo "session_id=$(echo $RESPONSE | jq -r '.session_id')" >> $GITHUB_OUTPUT

      - name: Wait for completion
        run: |
          while true; do
            STATUS=$(curl -s "${sf}/api/sessions/${sps}/status" -H "Authorization: Bearer ${st}")
            STATE=$(echo $STATUS | jq -r '.state')
            if [ "$STATE" = "completed" ]; then break; fi
            sleep 10
          done

      - name: Fetch JUnit report
        run: |
          curl -s "${sf}${spju}" -H "Authorization: Bearer ${st}" -o test-results.xml

      - name: Publish Test Results
        uses: dorny/test-reporter@v1
        with:
          name: TestPilot TNR
          path: test-results.xml
          reporter: java-junit` :
    tab === 'azure' ?
`trigger: none

stages:
  - stage: TestPilot_TNR
    jobs:
      - job: Run_TNR
        pool:
          vmImage: ubuntu-latest
        steps:
          - bash: |
              RESPONSE=$(curl -s -X POST "${sf}/api/trigger" -H "Authorization: Bearer ${st}" -H "Content-Type: application/json" -d '{"project": "ATHENA", "filter": "tnr"}')
              SESSION_ID=$(echo $RESPONSE | jq -r '.session_id')
              while true; do
                STATUS=$(curl -s "${sf}/api/sessions/$SESSION_ID/status" -H "Authorization: Bearer ${st}")
                STATE=$(echo $STATUS | jq -r '.state')
                if [ "$STATE" = "completed" ]; then break; fi
                sleep 10
              done
              curl -s "${sf}/api/sessions/$SESSION_ID/junit" -H "Authorization: Bearer ${st}" -o $(Build.ArtifactStagingDirectory)/test-results.xml
            displayName: Run TNR Campaign
          - publish: $(Build.ArtifactStagingDirectory)/test-results.xml
            displayName: Publish Test Results
            artifact: TestResults` :
`testpilot_tnr:
  image: alpine/latest
  variables:
    TESTPILOT_URL: "$TESTPILOT_URL"
    TESTPILOT_TOKEN: "$TESTPILOT_TOKEN"
  script:
    - apk add --no-cache curl jq
    - RESPONSE=$(curl -s -X POST "$TESTPILOT_URL/api/trigger" -H "Authorization: Bearer $TESTPILOT_TOKEN" -H "Content-Type: application/json" -d '{"project": "ATHENA", "filter": "tnr", "commit_sha": "$CI_COMMIT_SHA", "branch": "$CI_COMMIT_REF_NAME"}')
      SESSION_ID=$(echo $RESPONSE | jq -r '.session_id')
      JUNIT_URL=$(echo $RESPONSE | jq -r '.junit_url')
    - while true; do
        STATUS=$(curl -s "$TESTPILOT_URL/api/sessions/$SESSION_ID/status" -H "Authorization: Bearer $TESTPILOT_TOKEN")
        STATE=$(echo $STATUS | jq -r '.state')
        if [ "$STATE" = "completed" ]; then break; fi
        sleep 10
      done
    - curl -s "$TESTPILOT_URL$JUNIT_URL" -o test-results.xml
  artifacts:
    reports:
      junit: test-results.xml`;

  const tabLabel = { github: 'GitHub Actions', azure: 'Azure DevOps', gitlab: 'GitLab CI' }[tab];
  const tabIcon = { github: <Github size={14} />, azure: <Cloud size={14} />, gitlab: <Gitlab size={14} /> }[tab];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Documentation CI/CD</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Intégrez TestPilot dans vos pipelines CI/CD
          </p>
        </div>
      </div>

      <div className="rounded-lg p-4 mb-6 flex items-start gap-3"
        style={{ background: 'var(--warning-bg, #fff8e1)', border: '1px solid var(--warning)' }}>
        <AlertCircle size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
        <div className="text-sm" style={{ color: 'var(--text)' }}>
          <strong>Avant de commencer :</strong>
          <ul className="mt-1 list-disc list-inside space-y-1" style={{ color: 'var(--text-dim)' }}>
            <li>Créez un token API dans la page <a href="/api-tokens" className="underline" style={{ color: 'var(--accent)' }}>Tokens API</a></li>
            <li>Ajoutez <code>TESTPILOT_URL</code> et <code>TESTPILOT_TOKEN</code> comme secrets dans votre pipeline</li>
            <li>Assurez-vous d'avoir des scénarios acceptés dans votre projet</li>
          </ul>
        </div>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {(['github', 'azure', 'gitlab'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-2 rounded text-sm font-semibold flex items-center gap-2"
            style={tab === t
              ? { background: 'var(--accent)', color: '#fff' }
              : { background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          >
            {tabIcon} {tabLabel}
          </button>
        ))}
      </div>

      <div className="panel mb-6">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--accent)' }}>
            <Terminal size={14} /> Exemple de workflow ({tabLabel})
          </div>
          <CopyButton text={example} />
        </div>
        <pre className="text-xs p-4 rounded overflow-x-auto"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {example}
        </pre>
      </div>

      <div className="panel mb-6">
        <div className="text-sm font-bold mb-3" style={{ color: 'var(--accent)' }}>
          Paramètres de /api/trigger
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--bg-hover)' }}>
                <th className="text-left p-2">Paramètre</th>
                <th className="text-left p-2">Requis</th>
                <th className="text-left p-2">Description</th>
              </tr>
            </thead>
            <tbody>
              {TRIGGER_PARAMS.map(p => (
                <tr key={p.name} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="p-2 font-mono">{p.name}</td>
                  <td className="p-2">{p.required ? <span style={{ color: 'var(--danger)' }}>Oui</span> : 'Non'}</td>
                  <td className="p-2" style={{ color: 'var(--text-dim)' }}>{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel mb-6">
        <div className="text-sm font-bold mb-3" style={{ color: 'var(--accent)' }}>
          Référence des endpoints
        </div>
        <div className="space-y-2">
          {API_REFERENCE.map(a => (
            <div key={a.path} className="flex items-center gap-3 p-2 rounded" style={{ background: 'var(--bg)' }}>
              <span className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded ${
                a.method === 'GET' ? 'bg-green-100 text-green-700' :
                a.method === 'POST' ? 'bg-blue-100 text-blue-700' :
                a.method === 'PUT' ? 'bg-yellow-100 text-yellow-700' :
                'bg-red-100 text-red-700'
              }`}>
                {a.method}
              </span>
              <code className="text-xs font-mono flex-1" style={{ color: 'var(--text)' }}>{a.path}</code>
              <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{a.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="text-sm font-bold mb-3" style={{ color: 'var(--accent)' }}>
          Dépannage
        </div>
        <div className="space-y-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <div>
            <strong>Erreur 401 Unauthorized</strong>
            <p className="mt-1">Vérifiez que le token est correct et n'a pas expiré. Les tokens ont le préfixe <code>tpt_</code>.</p>
          </div>
          <div>
            <strong>Erreur 404 Project not found</strong>
            <p className="mt-1">Le nom du projet doit correspondre exactement (ex: <code>ATHENA</code>, pas <code>Athena</code>).</p>
          </div>
          <div>
            <strong>Erreur 400 No scenarios match</strong>
            <p className="mt-1">Vérifiez que le projet contient des scénarios acceptés avec le filtre demandé.</p>
          </div>
          <div>
            <strong>Polling infini</strong>
            <p className="mt-1">Ajoutez un timeout dans votre boucle (ex: max 30min) pour éviter une attente infinie.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
