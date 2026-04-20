# Task — `vibe-sprint-mode` 에 `--tier core|extended` 플래그 추가

## Goal

`/vibe-sprint-mode` (`scripts/vibe-sprint-mode.mjs`) 이 두 개의 preset tier 를 선택할 수 있도록 `--tier core|extended` 플래그를 추가한다. 기존 테스트 하위호환 유지.

## Preset 파일 구조

- `.vibe/settings-presets/agent-delegation.json` — **core** tier (기존, v1.0.0, 그대로)
- `.vibe/settings-presets/agent-delegation-extended.json` — **extended** tier (신규, v1.0.0, 이미 생성됨)

extended 는 core 의 모든 rule 을 포함하는 superset. 따라서 두 tier 모두 dedupe merge 하면 된다.

## CLI 계약

```bash
node scripts/vibe-sprint-mode.mjs on                     # = on --tier core  (backward compat)
node scripts/vibe-sprint-mode.mjs on --tier core
node scripts/vibe-sprint-mode.mjs on --tier extended
node scripts/vibe-sprint-mode.mjs off                    # 양 tier preset rule 모두 제거
node scripts/vibe-sprint-mode.mjs status                 # active tier + rule count 표시
```

- `on` **tier 생략 시 core 로 동작** — 기존 `test/sprint-mode.test.ts` 가 `on` 만으로 호출하므로 하위호환 유지가 필수.
- `--tier` 값은 `core` 또는 `extended` 만 허용. 다른 값이면 usage 에러.
- `on --tier extended` 실행 시:
  - core preset 파일이 존재하지만 extended preset 파일이 **없으면**, 경고 후 core 로 fallback (`[vibe-sprint-mode] WARN -- extended preset missing; falling back to core`).
  - 둘 다 있으면 extended 의 rule 만 merge (core 는 extended 의 subset 이므로 별도 merge 불필요).
- `off` 는 tier 무관, 두 preset 의 rule union 을 모두 allow 에서 제거. (기존 behavior: preset rule 제거만, 사용자 커스텀 rule 은 보존.)
- `status` 출력:
  - extended preset rule 들이 allow 에 모두 있으면 → `ON (extended) -- N/M preset rules active`
  - core preset rule 들만 있고 extended 전용 rule 은 없으면 → `ON (core) -- N/M preset rules active`
  - 둘 다 0 개 match → `OFF -- 0/M preset rules active` (M 은 현재 확인 중인 tier 의 rule 수, extended 기준)
  - 일부만 있으면 (partial) → `PARTIAL -- N/M preset rules active`

## 구현 힌트

`loadPreset(rootDir, tier)` 같이 tier 파라미터 추가:

```js
function loadPreset(rootDir, tier = 'core') {
  const fileName = tier === 'extended'
    ? 'agent-delegation-extended.json'
    : 'agent-delegation.json';
  const presetPath = path.resolve(rootDir, '.vibe', 'settings-presets', fileName);
  if (!existsSync(presetPath) && tier === 'extended') {
    // fallback to core with warning
    process.stderr.write(`[vibe-sprint-mode] WARN -- extended preset missing; falling back to core\n`);
    return loadPreset(rootDir, 'core');
  }
  if (!existsSync(presetPath)) {
    fail(`Missing preset file: ${presetPath}`);
  }
  const preset = readJson(presetPath);
  if (!Array.isArray(preset.rules) || preset.rules.some((entry) => typeof entry !== 'string')) {
    fail(`Invalid preset rules in ${presetPath}`);
  }
  return preset.rules;
}
```

`runOff` 는 기존 core preset + 신규 extended preset 양쪽의 rule 모두 읽어서 union set 을 만들고 제거. 둘 중 하나만 있어도 동작:

```js
function loadAllPresetRules(rootDir) {
  const out = new Set();
  for (const tier of ['core', 'extended']) {
    try {
      for (const rule of loadPreset(rootDir, tier)) out.add(rule);
    } catch {
      // missing preset is OK for off
    }
  }
  return out;
}
```

(단, fallback warn 은 off path 에서는 silent — fallback recursion 대신 `existsSync` 체크로 끝.)

`runStatus` 는 extended preset 존재 여부에 따라 분기. extended 가 있으면 extended 기준으로 check.

CLI 파싱:

```js
function parseArgs(argv) {
  // argv[0] = 'on' | 'off' | 'status'
  const command = argv[0];
  let tier = 'core';
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--tier') {
      tier = argv[i + 1];
      i++;
    }
  }
  if (!['core', 'extended'].includes(tier)) {
    fail(`Invalid --tier value: ${tier}. Expected core or extended.`);
  }
  return { command, tier };
}
```

## 테스트 유지

`test/sprint-mode.test.ts` 는 `execFile(..., [sprintModePath, 'on'])` 형태로만 호출하고 `agent-delegation.json` (core) 만 scaffold 한다. 따라서:
- `on` (tier 생략) 이 core 를 로드해야 — **PASS 유지 목표**.
- extended preset 파일이 scaffold 안 되어 있어도 테스트는 `on` 만 호출하므로 영향 없음.
- `off` path 는 core preset 만 scaffold 된 상태에서도 동작해야 함 (extended 미존재 silent skip).
- `status` path 는 core preset 기준 active count 를 리포트해야 — 현재 출력 포맷을 깨뜨리지 않도록 주의.

**현재 테스트 출력 포맷** (변경 금지):
- `[vibe-sprint-mode] ON -- 3 preset rules merged (3 new). Total allow rules: 3`
- `[vibe-sprint-mode] OFF -- 3 preset rules removed. Remaining allow rules: 2`
- `[vibe-sprint-mode] OFF -- nothing to remove`
- `[vibe-sprint-mode] ON -- 3/3 preset rules active`

이 4 개 패턴을 `on --tier core`, `off` (core 만 scaffold 된 상태), `status` (core 만 scaffold 된 상태) 에서 그대로 유지해야 한다. extended preset 이 없으면 기존 포맷, 있으면 약간 augmented (`ON (core)`, `ON (extended)`, `PARTIAL`) 포맷 허용.

가장 안전한 접근: **extended preset 이 존재할 때만** `(tier)` 라벨 추가. 존재하지 않으면 정확히 기존 문자열 출력. 이러면 기존 테스트 지속 PASS.

## 스코프 / 제약

- 변경 파일: `scripts/vibe-sprint-mode.mjs` **단일 파일만**.
- `.vibe/settings-presets/*.json` 건드리지 말 것 (Orchestrator 가 이미 준비).
- `.claude/skills/vibe-sprint-mode/SKILL.md` 건드리지 말 것 (Orchestrator 가 이미 작성).
- 새 테스트 파일 작성 선택 가능 — `on --tier extended` 가 extended preset 파일을 읽는지, 누락 시 fallback 동작 하는지 정도. 단 추가 테스트는 필수 아님.

## 검증 기대

완료 후 다음이 통과:

```bash
node --import tsx --test test/sprint-mode.test.ts
# 6/6 pass — 기존 테스트 전부 유지
```

또한 수동 스모크:

```bash
node scripts/vibe-sprint-mode.mjs on --tier extended
# → extended preset merge, Total allow rules 증가
node scripts/vibe-sprint-mode.mjs status
# → ON (extended) -- N/M preset rules active (N == M 이면)
node scripts/vibe-sprint-mode.mjs off
# → extended + core 양쪽의 rule 모두 제거
```

## 리포트

완료 후 stderr 로:
- 수정 LOC
- test/sprint-mode.test.ts 실행 결과 (가능하면)
- 남은 우려 1-2 줄 (없으면 "none")
