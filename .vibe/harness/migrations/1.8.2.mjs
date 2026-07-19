#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const LEGACY_SCAN_ROOTS = [
  '.claude/skills/vibe-pro-design',
  '.codex/skills/vibe-pro-design',
  '.vibe/harness/schemas',
  '.vibe/harness/scripts',
  '.vibe/harness/src/commands',
  '.vibe/harness/src/lib/schemas',
  '.vibe/harness/src/pro-bridge',
  '.vibe/harness/test',
  'docs/context',
];

const LEGACY_PATH_PATTERNS = [
  /^\.claude\/skills\/vibe-pro-design\//,
  /^\.codex\/skills\/vibe-pro-design\//,
  /^\.vibe\/harness\/schemas\/pro-bridge-[^/]+\.schema\.json$/,
  /^\.vibe\/harness\/scripts\/vibe-pro-bridge\.mjs$/,
  /^\.vibe\/harness\/src\/commands\/pro-bridge\.ts$/,
  /^\.vibe\/harness\/src\/lib\/schemas\/pro-bridge\.ts$/,
  /^\.vibe\/harness\/src\/pro-bridge\//,
  /^\.vibe\/harness\/test\/.*pro-bridge.*$/,
  /^docs\/context\/pro-bridge-setup\.md$/,
];

// Git blob IDs from the harness-owned MCP bridge files published between
// v1.8.0 and the final preserved origin/vibe-pro-bridge lineage. This lets a
// pristine template checkout migrate safely even when it has no sync hash file.
const KNOWN_RELEASE_BLOBS = new Set([
  '015850d579159cd88e35721eb494e197dd7f635a',
  '030748c04ef659b580b65cc40b688155e03d9389',
  '0552ecd904268ba61b31b60cf3bcc4d6af64b933',
  '084e6ca02a72ced63638b117ba194417cb1abbc2',
  '0cb3a2812f97af9beb793a12f73c7fd1d2c4d173',
  '1173c28484ce72e269da23c324a852312593ccac',
  '16dadb680aa45c8907bfbb6bb77bbe818704ab2d',
  '170ea7d562fe9ce2b1a1d23a041d88fc572e806f',
  '1a5b603be566d87439b8b8d7193c697ffe5004cd',
  '1b91f146ebd2aa0c963ca5ca650bc64a484d3007',
  '2f6158719685ac82f0cd88f58f8315b9e8fc1e94',
  '3278e77d431d1209a5e2142a0a6a69de42d459a5',
  '33a51d088675cfb1b63ce110ae4df8f9fb59d1c7',
  '371607a4528852ebf2b0bc9982884eebd59f222a',
  '39064d1f23fc8e3d03eeb64ce6d3ade114309fc3',
  '3b00aca758ef3dcb108ad7beab4cbc2b67b45328',
  '3c1f2e41fe4f798071d1485f4a60a0b39dd99b13',
  '3e5405b3fe7b52fe91cd3dbcf13a6c13d647d950',
  '3e6a60f69a90c07db641a36b8af7d72256a4ce01',
  '41b8d8ec1ef645361dbf98f2bc39677c70408e56',
  '49653f75cd46028b2be324386212d5f80de3a9ba',
  '4b107c9712ae307defe8fedb8dedee37c23c2695',
  '4bfa0012886d49d8a83c8745e776de49c173eb18',
  '4d842e5281bc2df8b850fafa40bd61736351f96b',
  '4db601255c8fb5fcf3cf6e0588c50f5ec6c836c3',
  '5109ed74ce2caa60c6e9533dfcaaccfb0f0aeea3',
  '52fb1866900a24c44538b5d957af1443e75beecd',
  '5302a181a011cec4294c1b7a3795587cc1d52fa1',
  '54fb9b8063202cbda8393d9e7b285822b5e7ba44',
  '59c79827b9fb8db78b58ca8753d85704fad62206',
  '5b09304fce858f0c9a1d6d875d8f702e9ffd66c9',
  '5cf9f1bf9b323f6e997ba4cb97cbfa5c2feac755',
  '5cfce1688998a4aa4ef926b9bee3df8167ae79b4',
  '5d361e2be01536fb4202e074c5ea2fdcc4959b5f',
  '60e5d774d25bfd008372580c357af6e0a43e6ce9',
  '61d592ca89d815abeb5a351da37fe9635bd5e35c',
  '65a7ffe6f1503003be5ff4271bbd888709d7ad6d',
  '6842965a9ebef86add3a7e38c0c8b4ac115f0906',
  '6c7e37be103b3d57d33fbde98767ea69d49e0a8e',
  '75c04a88c7e324d507e3257b3707ff3dbed5b283',
  '7b4e6086628c5e0fe0d0b7562c45e4ba83a8f618',
  '80f0d2cd300aa39376c3ac129d177b36c18b21ed',
  '8265fd6f0035bc1a02bf149119501da59ca70ba5',
  '83f99d331951b1ca10cce681fc73af13919347bb',
  '853d5d963af580636fcb86473870a9c57fce83a7',
  '85e5d9aafbf3d369576663a29fd2eb3ab6ecc2e5',
  '86339c361525bd2091aa61e266e3e86df9aaf479',
  '87866b1e8840198742dc94b2f4961e3e557b9b60',
  '88ec96e8dda3f98920fd3ec174a4b7f78477798e',
  '892daffdb36c9a5e766a5a2b8f7c5799083ff2db',
  '89716907409647b2e426a2c46fcd12cce6d53f99',
  '9418b8ac6e23b5350df70528083df3a09ba72eac',
  '94450a4354f652d88d7f46076f06ad71700400cb',
  '970ea3e33fdb2f27fc842e3cd025641627bab37d',
  '9779151cabcfed8b34937cfdf9266746bed59b3e',
  '97bbed9cd5a75199b56640e70f2815aaa8ed58cd',
  '982d76936de920a82615522762e842c4db65dff7',
  'a1f16c7d020d56965d4dd4a7bb3f4f16ed9fb121',
  'a238d42bb736757bf0b634830d316359e3f3cfa3',
  'a2c4c5396fc0db9ed103372bb581e020f8132ea4',
  'a406fa064cf5e2e735c7998979178d15eb2d422c',
  'a4dba41f6038f34f44e4550a3aadecad6a1b9d34',
  'a973afc415a5934579dca42b1918b53c0744be5c',
  'a999424c42e9d52db58b7f0700438d90e14f911d',
  'b2267ea2c23e6a001fadcac9d82bb8e5be47d579',
  'b7da7000740549bc5c1ae677ae11ccc35afa7a78',
  'b9d2997576d72899c44cdc85b203615d5130917c',
  'becb6afcc36040086a3d11a643bf02f75dd9683d',
  'c1ec3d035ded39f44e5ae09a144c610c52d6eb57',
  'c2a4fdf512acc05cf8d241022fd5b7ca1f0a9e43',
  'c9831a41a8322a8f4f6b0e98a8fcdb3c63c46d47',
  'ca34a414efcbb8fefdab2cdcd53ef85b4b377041',
  'ca7c57ed7ffe34fa56c83885f4857d309b6b12ad',
  'cb5023eb32f41217e58c9a81e1cda092853a442a',
  'cc3349eff8e464536c057bb2d859c1e070be2774',
  'ce3e4b3d1cce780a8cebf934e9647cfc8083f2f6',
  'cfd353680e355f88fe8bee3ba9b7186b0bc13710',
  'd3011b3539db1eb5ed442738497edb7e9bc57815',
  'd30cb7d958d85663b6eced1225cec721f1c153d8',
  'd65208e6685a62018bf618a0e6ecce1bfdcdf8fe',
  'da6af4735f3e31c7dfa81b943f1bae9cb312eb3e',
  'db6958b09f0fab4ef264338061606cdedd6186db',
  'de5566e869a4113d53e5b3fe2cd94e55b62c967e',
  'e21a4aa6b21ed2fa227bd284ff123e9eb7d616fb',
  'eb29c77cb08245f2b3c4434e34caba903730a83c',
  'eb98f672fe54b60357f33f09325db39bbd2b1808',
  'ed2daa1341a585a4c00d563bc4a687612ad7abfb',
  'f5a72db2809f3f95932cec73168d01d0a1c0a248',
  'f9a451cda7546111ec542491b4f2cad9174a4f9d',
  'fbe5facab1723c9d3d04646afc230e8a2cc74de9',
  'fd6ab7f9e9147337090d5247e4371837012a827a',
  'ff0180e7bc740604f23a52dadd7f347b1aefdb3d',
]);

const DEFAULT_PRO_BRIDGE_CONFIG = {
  enabled: false,
  transport: 'manual',
  resultRoot: 'docs/plans',
  requestTtlHours: 72,
  maxPatchBytes: 1048576,
  openBrowser: true,
  copyInvocation: true,
  githubRequired: true,
  mcp: {
    port: 18488,
    tunnel: 'none',
  },
  workspaceAgent: {
    enabled: false,
    triggerCommand: [],
  },
  api: {
    enabled: false,
    model: '',
    effort: 'high',
    maxInputTokens: 200000,
    priceInputPerMTok: 0,
    priceOutputPerMTok: 0,
    pollIntervalMs: 5000,
  },
  apply: {
    envId: null,
  },
};

const LEGACY_PACKAGE_SCRIPTS = {
  'vibe:pro-audit': 'node .vibe/harness/scripts/vibe-pro-bridge.mjs audit',
  'vibe:pro-design': 'node .vibe/harness/scripts/vibe-pro-bridge.mjs design',
  'vibe:pro-sync': 'node .vibe/harness/scripts/vibe-pro-bridge.mjs sync',
  'vibe:pro-status': 'node .vibe/harness/scripts/vibe-pro-bridge.mjs status',
  'vibe:pro-mcp': 'node .vibe/harness/scripts/vibe-pro-bridge.mjs mcp',
  'vibe:pro-apply': 'node .vibe/harness/scripts/vibe-pro-bridge.mjs apply',
};

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function gitBlobId(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha1')
    .update(Buffer.from(`blob ${content.byteLength}\0`))
    .update(content)
    .digest('hex');
}

function isLegacyHarnessPath(relativePath) {
  return LEGACY_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function listLegacyHarnessFiles(root) {
  const results = new Set();
  for (const scanRoot of LEGACY_SCAN_ROOTS) {
    const absoluteRoot = path.join(root, scanRoot);
    if (!existsSync(absoluteRoot)) {
      continue;
    }

    for (const entry of readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      const absolutePath = path.join(entry.parentPath, entry.name);
      const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
      if (isLegacyHarnessPath(relativePath)) {
        results.add(relativePath);
      }
    }
  }

  return [...results].sort((left, right) => left.localeCompare(right));
}

function pruneEmptyDirs(root, relativePaths) {
  const directories = Array.from(
    new Set(
      relativePaths
        .map((relativePath) => path.dirname(relativePath))
        .filter((relativePath) => relativePath !== '.')
        .sort((left, right) => right.length - left.length),
    ),
  );

  for (const directory of directories) {
    try {
      rmdirSync(path.join(root, directory));
    } catch {
      // The directory still contains preserved or unrelated files.
    }
  }
}

function migrateLegacyHarnessFiles(root) {
  const syncHashesPath = path.join(root, '.vibe', 'sync-hashes.json');
  const syncHashes = readJson(syncHashesPath, { files: {} });
  const hashMap =
    syncHashes.files && typeof syncHashes.files === 'object' && !Array.isArray(syncHashes.files)
      ? syncHashes.files
      : {};
  const removed = [];
  const retained = [];

  for (const relativePath of listLegacyHarnessFiles(root)) {
    const absolutePath = path.join(root, relativePath);
    const trackedHash = typeof hashMap[relativePath] === 'string' ? hashMap[relativePath] : null;
    const trackedAndUnmodified = trackedHash !== null && trackedHash === sha256(absolutePath);
    const knownReleaseBlob = KNOWN_RELEASE_BLOBS.has(gitBlobId(absolutePath));

    if (!trackedAndUnmodified && !knownReleaseBlob) {
      retained.push(`${relativePath}: locally modified or unknown content`);
      continue;
    }

    rmSync(absolutePath, { force: true });
    delete hashMap[relativePath];
    removed.push(relativePath);
  }

  if (removed.length > 0 && existsSync(syncHashesPath)) {
    syncHashes.files = hashMap;
    writeJson(syncHashesPath, syncHashes);
  }
  pruneEmptyDirs(root, removed);

  const reportPath = path.join(root, '.vibe', 'harness-migration-1.8.2.md');
  if (retained.length > 0) {
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      [
        '# Harness Migration v1.8.2',
        '',
        'The GitHub-only `$vibe-pro-go` workflow replaced the former MCP bridge.',
        'The following legacy harness files were preserved because their contents could not be proven unmodified:',
        '',
        ...retained.map((entry) => `- ${entry}`),
        '',
        'Review them manually. Historical `.vibe/pro-bridge/**` results and project-owned design documents are intentionally preserved.',
        '',
      ].join('\n'),
      'utf8',
    );
  } else {
    rmSync(reportPath, { force: true });
  }

  return { removed, retained };
}

function migrateConfig(root) {
  const configPath = path.join(root, '.vibe', 'config.json');
  if (!existsSync(configPath)) {
    return 'missing';
  }

  const config = readJson(configPath, {});
  if (!Object.hasOwn(config, 'proBridge')) {
    return 'idempotent';
  }
  if (!isDeepStrictEqual(config.proBridge, DEFAULT_PRO_BRIDGE_CONFIG)) {
    return 'retained-custom';
  }

  delete config.proBridge;
  writeJson(configPath, config);
  return 'removed-default';
}

function migratePackageScripts(root) {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) {
    return 'missing';
  }

  const pkg = readJson(packagePath, {});
  if (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) {
    return 'idempotent';
  }

  let removed = 0;
  for (const [name, value] of Object.entries(LEGACY_PACKAGE_SCRIPTS)) {
    if (pkg.scripts[name] === value) {
      delete pkg.scripts[name];
      removed += 1;
    }
  }

  if (removed > 0) {
    writeJson(packagePath, pkg);
  }
  return `removed:${removed}`;
}

function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd());
  const files = migrateLegacyHarnessFiles(root);
  const config = migrateConfig(root);
  const packageScripts = migratePackageScripts(root);
  process.stdout.write(
    `[migrate 1.8.2] removedLegacyHarness=${files.removed.length} retainedLegacyHarness=${files.retained.length} config=${config} packageScripts=${packageScripts}\n`,
  );
}

try {
  main();
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
