#!/usr/bin/env node
// scripts/verify-cd-config.mjs — checa se o CD (Railway via GitHub Actions) está
// PRONTO ou BLOQUEADO. Só lê NOMES/booleans: nunca imprime token nem valor secreto.
//
// Fontes de verdade, nesta ordem:
//   1. ambiente (usado DENTRO do GitHub Actions, onde o GITHUB_TOKEN de CI não
//      tem permissão admin para listar secrets): RAILWAY_TOKEN presente? e
//      CD_VAR_ENABLED == 'true'?
//   2. CLI `gh` (uso local): gh secret list / gh variable list.
//
// Regra do projeto: CD fica DESLIGADO até o operador criar um project token no
// Railway. O workflow é gateado por `if: vars.RAILWAY_DEPLOY_ENABLED == 'true'`,
// então enquanto a variable não existir NADA é deployado (job skipped).
//
// Uso:
//   node scripts/verify-cd-config.mjs          # legível; exit 0=READY, 1=BLOQUEADO
//   node scripts/verify-cd-config.mjs --json   # para automação
//
// Limite: token presente != token válido. Validade só é provada no 1º deploy.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Uso: node scripts/verify-cd-config.mjs [--json]');
  console.log('Exit 0 = CD READY; exit 1 = BLOQUEADO.');
  process.exit(0);
}

const WORKFLOW = '.github/workflows/deploy-railway.yml';
const SECRET_NAME = 'RAILWAY_TOKEN';
const VAR_NAME = 'RAILWAY_DEPLOY_ENABLED';

const OPERATOR_STEPS = [
  'Railway -> Project auto-trader -> Settings -> Tokens -> Create Project Token (escopo do projeto)',
  'gh secret set RAILWAY_TOKEN   # alternativa: GitHub -> Settings -> Secrets and variables -> Actions',
  'gh variable set RAILWAY_DEPLOY_ENABLED --body true   # alternativa: mesma tela, aba Variables',
];
const ROLLBACK_STEPS = [
  'Railway -> Deployments -> deploy anterior -> Redeploy (imediato, sem git)',
  'ou: git revert <commit> && git push origin main (CD roda de novo no push)',
  'parar todo o CD: gh variable set RAILWAY_DEPLOY_ENABLED --body false',
];

function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8' });
  if (res.error) {
    return { ok: false, error: res.error.code === 'ENOENT' ? 'gh CLI nao encontrado no PATH' : String(res.error.message) };
  }
  return { ok: res.status === 0, status: res.status, out: String(res.stdout || ''), err: String(res.stderr || '') };
}

const result = {
  ready: false,
  repo: process.env.GITHUB_REPOSITORY || null,
  workflowPresent: existsSync(WORKFLOW),
  workflowGated: false,
  secretPresent: false,
  secretSource: null,
  variablePresent: false,
  variableEnabled: false,
  variableSource: null,
  blockers: [],
  checkedAt: new Date().toISOString(),
};

// --- workflow --------------------------------------------------------------
if (result.workflowPresent) {
  try {
    const wf = readFileSync(WORKFLOW, 'utf8');
    result.workflowGated = /vars\.RAILWAY_DEPLOY_ENABLED\s*==\s*'true'/.test(wf);
  } catch {
    /* já marcado como presente */
  }
  if (!result.workflowGated) result.blockers.push('workflow sem gate if: vars.' + VAR_NAME + " == 'true'");
} else {
  result.blockers.push('workflow ' + WORKFLOW + ' ausente');
}

// --- secret RAILWAY_TOKEN --------------------------------------------------
const envToken = process.env.RAILWAY_TOKEN;
if (envToken && envToken.trim().length > 0) {
  result.secretPresent = true;
  result.secretSource = 'env';
} else {
  const secrets = gh(['secret', 'list', '--json', 'name']);
  if (secrets.ok) {
    try {
      result.secretPresent = JSON.parse(secrets.out).some((s) => s.name === SECRET_NAME);
      result.secretSource = 'gh';
    } catch {
      result.blockers.push('nao foi possivel interpretar gh secret list');
    }
  } else if (process.env.GITHUB_ACTIONS) {
    result.blockers.push('RAILWAY_TOKEN ausente no ambiente do job');
  } else {
    result.blockers.push('gh secret list falhou (' + (secrets.error || 'sem permissao admin') + ')');
  }
}
if (!result.secretPresent && !result.blockers.some((b) => b.indexOf(SECRET_NAME) >= 0)) {
  result.blockers.push('secret ' + SECRET_NAME + ' ausente');
}

// --- variable RAILWAY_DEPLOY_ENABLED --------------------------------------
if (process.env.CD_VAR_ENABLED !== undefined) {
  result.variablePresent = true;
  result.variableEnabled = String(process.env.CD_VAR_ENABLED).toLowerCase() === 'true';
  result.variableSource = 'env';
} else {
  const variables = gh(['variable', 'list', '--json', 'name,value']);
  if (variables.ok) {
    try {
      const found = JSON.parse(variables.out).find((v) => v.name === VAR_NAME);
      result.variablePresent = Boolean(found);
      result.variableEnabled = Boolean(found) && String(found.value).toLowerCase() === 'true';
      result.variableSource = 'gh';
    } catch {
      result.blockers.push('nao foi possivel interpretar gh variable list');
    }
  } else if (process.env.GITHUB_ACTIONS) {
    result.blockers.push(VAR_NAME + ' nao exposta ao job');
  } else {
    result.blockers.push('gh variable list falhou (' + (variables.error || 'sem permissao admin') + ')');
  }
}
if (!result.variablePresent) {
  if (!result.blockers.some((b) => b.indexOf(VAR_NAME) >= 0)) result.blockers.push('variable ' + VAR_NAME + ' ausente');
} else if (!result.variableEnabled) {
  result.blockers.push('variable ' + VAR_NAME + " != 'true' (CD desligado)");
}

// --- repo (informativo, nunca bloqueante) ---------------------------------
if (!result.repo) {
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']);
  if (repo.ok) result.repo = repo.out.trim();
}

result.ready = result.blockers.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify(result));
} else {
  console.log('[verify-cd-config] repo: ' + (result.repo || '(desconhecido)'));
  console.log('[verify-cd-config] workflow: ' + WORKFLOW + ' -> ' + (result.workflowPresent ? 'presente' : 'AUSENTE') + (result.workflowGated ? ' (gated por vars.' + VAR_NAME + ')' : ' (SEM GATE!)'));
  console.log('[verify-cd-config] secret ' + SECRET_NAME + ': ' + (result.secretPresent ? 'presente (' + result.secretSource + ')' : 'AUSENTE'));
  console.log('[verify-cd-config] variable ' + VAR_NAME + ': ' + (result.variablePresent ? (result.variableEnabled ? 'true' : 'false (CD desligado)') + ' (' + result.variableSource + ')' : 'AUSENTE'));
  console.log('[verify-cd-config] RESULTADO: ' + (result.ready ? 'READY — o proximo push em main vai deployar' : 'BLOQUEADO — nenhum deploy automatico vai rodar'));
  if (!result.ready) {
    console.log('[verify-cd-config] bloqueios: ' + result.blockers.join('; '));
    console.log('[verify-cd-config] Como habilitar (operador, 3 passos):');
    OPERATOR_STEPS.forEach((s, i) => console.log('  ' + (i + 1) + '. ' + s));
  }
  console.log('[verify-cd-config] Rollback:');
  ROLLBACK_STEPS.forEach((s) => console.log('  - ' + s));
  console.log('[verify-cd-config] nota: segredo presente != segredo valido; validade so e provada no 1o deploy.');
}
process.exit(result.ready ? 0 : 1);
