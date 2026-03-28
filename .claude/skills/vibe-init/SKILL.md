---
name: vibe-init
description: 프로젝트 초기 세팅을 대화형으로 진행합니다. 환경 점검, provider 인증, 프로젝트 맞춤 설정까지 자동으로 안내합니다.
---

이 스킬은 프로젝트 초기 세팅을 Claude Code 대화형으로 진행합니다.
총 5단계(Phase)로 구성되며, 각 Phase를 순서대로 진행합니다.

---

## Phase 1 — 환경 점검 (doctor)

`npm run vibe:init`을 실행하여 기본 파일(`.env`, `.vibe/config.local.json`)을 생성한 뒤,
아래 환경 점검을 직접 수행합니다:

1. **필수 도구 확인** — `node` (>=20), `npm`, `git`
   - 하나라도 없으면 설치 방법을 안내하고 중단합니다.

2. **AI Agent CLI 확인** — `claude`, `codex` 등 CLI 존재 여부를 확인합니다.
   - 결과를 사용자에게 보여줍니다. 예:
     ```
     환경 점검 결과:
       node (v22.x)  ✓
       npm            ✓
       git            ✓
       claude CLI     ✓
       codex CLI      ✗ (미설치)
     ```
   - 이 결과는 Phase 2에서 provider 선택/인증 안내에 사용됩니다.

---

## Phase 2 — Sprint 역할별 Provider 배정 및 인증

사용자에게 Sprint의 3가지 역할에 대해 **각각** 어떤 AI를 사용할지 물어봅니다.

### Step 2-1: 역할별 Provider 선택

아래와 같이 질문합니다:

```
Sprint 역할별 AI를 설정합니다. 각 역할에 어떤 AI를 사용할지 선택해주세요.
기본값은 괄호 안에 표시됩니다. 그대로 쓰려면 엔터만 누르면 됩니다.

1. Planner (스펙 정의 — "무엇을" 만들지 정의) [기본: claude-opus]
   선택지: claude-opus / codex / 기타

2. Generator (코드 구현 — 체크리스트 기반 구현) [기본: codex]
   선택지: codex / claude-opus / 기타

3. Evaluator (판정 — 합격/불합격 판정) [기본: claude-opus]
   선택지: claude-opus / codex / 기타

"기타"를 선택하면 커스텀 AI agent를 연결할 수 있습니다.
```

사용자가 **"기타"**를 선택한 경우, 추가 질문:

```
커스텀 AI agent 설정:
  - provider 이름은 뭔가요? (예: deepseek, grok, gemini, aider)
  - CLI 명령어는 뭔가요? (예: deepseek, grok)
  - 프롬프트를 전달하는 인자 형식은 어떻게 되나요?
    예시) deepseek --prompt "{prompt}"
    예시) grok chat "{prompt}"
    모르면 비워두세요. 나중에 .vibe/config.local.json에서 직접 수정할 수 있습니다.
```

### Step 2-2: 선택된 Provider 인증 확인

각 선택된 provider에 대해 CLI가 설치되어 있는지 Phase 1 결과를 참조하여 확인합니다.

**CLI가 미설치인 경우**, 해당 provider의 설치 및 인증 방법을 step-by-step으로 안내합니다:

| Provider | 설치 안내 | 인증 안내 |
|----------|-----------|-----------|
| codex | `npm install -g @openai/codex` | `codex login --device-auth` 실행 후 브라우저에서 인증 |
| claude-opus | Claude Code 사용 중이므로 이미 인증됨 | - |
| 기타 (custom) | 사용자가 알려준 설치 방법 또는 "해당 AI의 공식 문서를 참고하세요" | 사용자에게 인증 방법 확인 |

안내 후 사용자에게 확인합니다:
```
설치/인증을 지금 진행하시겠어요?
  - "예" → 사용자가 터미널에서 직접 명령 실행하도록 안내 (! 명령어 prefix 안내)
  - "나중에" → 건너뛰고 다음 단계로 진행
  - "건너뛰기" → 해당 provider를 일단 설정만 해두고 나중에 연결
```

### Step 2-3: 설정 파일 업데이트

선택 결과를 바탕으로 아래 파일들을 업데이트합니다:

#### `.vibe/config.local.json`

선택한 Sprint 역할 구성을 반영합니다. 커스텀 provider는 `providers` 맵에 추가합니다.

예시 (generator를 deepseek로 선택한 경우):
```json
{
  "orchestrator": "claude-opus",
  "sprintRoles": {
    "planner": "claude-opus",
    "generator": "deepseek",
    "evaluator": "claude-opus"
  },
  "providers": {
    "claude-opus": {
      "command": "claude",
      "args": ["-p", "{prompt}"],
      "env": {}
    },
    "deepseek": {
      "command": "deepseek",
      "args": ["--prompt", "{prompt}"],
      "env": {}
    }
  }
}
```

#### `AGENTS.md`

Generator로 선택된 provider에 맞게 파일 내용을 수정합니다.
- 기본 codex가 아닌 경우, 파일 상단의 provider 이름을 변경합니다.
- 예: generator가 deepseek인 경우:
  ```markdown
  # DeepSeek project memory

  너의 기본 역할은 Sprint의 **Generator (코드 구현)** 다.
  ...
  ```

#### `docs/orchestration/roles.md`

선택된 역할 배정을 roles.md의 Configuration 섹션에 반영합니다.

#### `docs/orchestration/providers.md`

커스텀 provider가 추가된 경우, 해당 provider 섹션을 문서에 추가합니다.

---

## Phase 3 — 프로젝트 맞춤 설정

사용자에게 아래 3단계 질문을 **한 단계씩** 대화로 진행합니다.
각 단계에서 사용자의 답변을 받은 뒤 해당 파일을 작성하고 다음 단계로 넘어갑니다.

### Step 3-1: 프로젝트 기본 정보 → `docs/context/product.md`

아래 질문을 **한 번에** 묻습니다:

1. 프로젝트 이름이 뭔가요? (예: 우리동네 맛집 지도, 할일 관리 앱)
2. 한 줄로 설명해주세요. 이 프로젝트는 뭘 하나요? (예: 내 주변 맛집을 지도에서 찾고 리뷰를 남길 수 있는 웹앱)
3. 이 프로젝트가 성공하려면 뭐가 되어야 하나요? 목표를 자유롭게 적어주세요.
4. 어디서 동작하나요? (예: 웹, 모바일앱, 데스크톱)

답변을 받으면 아래 형식으로 `docs/context/product.md`를 작성합니다:

```markdown
# Product context

이 저장소는 **{이름}** — {설명}

## 성공 기준
- {목표1}
- {목표2}

## 플랫폼
- {플랫폼1}
```

### Step 3-2: 기술 스택 → `docs/context/architecture.md`

아래 질문을 **한 번에** 묻습니다:

1. 어떤 기술로 만들 건가요? 알고 있는 것만 적어주세요. (예: React, Next.js, Python)
2. 어디에 배포/호스팅 할 예정인가요? (예: Vercel, AWS, 아직 모름)
3. 데이터 저장은 어떻게 하나요? (예: PostgreSQL, Supabase, 아직 모름)

답변을 받으면 아래 형식으로 `docs/context/architecture.md`를 작성합니다:

```markdown
# Architecture context

## 기술 스택
- **프레임워크 / 라이브러리**: {답변 또는 (미정)}
- **호스팅 / 배포**: {답변 또는 (미정)}
- **데이터 저장**: {답변 또는 (미정)}

## 레이어

1. **Memory layer** — AI가 읽는 컨텍스트
   - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
   - `.claude/skills/*`
   - `docs/context/*`

2. **Control plane** — 오케스트레이션 실행
   - `src/commands/*`
   - `src/providers/*`
   - `.vibe/config*.json`

3. **Execution / evidence layer** — 실행 기록
   - `.vibe/runs/*`
   - `docs/plans/*`
   - `docs/reports/*`
   - `.worktrees/*`

## 설계 원칙

- 얇은 루트 메모리 — 상세 규칙은 shard로 분리
- Sprint 기반 개발 — Planner/Generator/Evaluator sub-agent 생성·소멸
- 설정 가능 provider runner — `.vibe/config.json` 기본값 + `.vibe/config.local.json` 로컬 override
- Generator는 격리 실행 우선
- Sprint 실패 시 Evaluator 판정 기반 에스컬레이션
- JSONL evidence 축적

## 프로젝트별 디렉터리 구조

```text
(프로젝트 구조는 첫 구현 후 자동으로 업데이트됩니다)
```
```

### Step 3-3: 코드 스타일 및 선호도 → `docs/context/conventions.md`

아래 질문을 **한 번에** 묻습니다:

1. 주 프로그래밍 언어는 뭔가요? (예: TypeScript, Python, 잘 모름)
2. 코드 스타일에 선호가 있나요? (예: 깔끔하고 읽기 쉬운 코드, 성능 우선, 특별히 없음)
3. 테스트 도구를 알고 계시면 적어주세요. (예: Jest, Vitest, 잘 모름)
4. AI에게 추가로 지켜달라고 할 규칙이 있나요? (없으면 없다고 하면 됨)

답변을 받으면 아래 형식으로 `docs/context/conventions.md`를 작성합니다:

```markdown
# Conventions

## 기본 규칙

- 변경은 최소 범위로 한다.
- 로그는 사람이 읽기 쉽게 남긴다.
- 스크립트는 실패 원인을 명확히 출력한다.
- 문서/보고서는 짧고 결정 사항 중심으로 유지한다.

## 프로젝트별 규칙

- **언어 / 런타임**: {답변 또는 (AI가 기술 스택에 맞게 선택)}
- **코드 스타일**: {답변 또는 (기본: 깔끔하고 읽기 쉬운 코드)}
- **테스트**: {답변 또는 (AI가 기술 스택에 맞게 선택)}

## 추가 규칙
- {있으면 추가}
```

---

## Phase 4 — 설정 요약 및 완료

모든 단계가 끝나면 아래를 출력합니다:

```
초기 세팅이 완료되었습니다!

  환경:
    node {버전}  ✓
    npm          ✓
    git          ✓

  Sprint 역할 설정:
    Orchestrator : claude-opus (기본)
    Planner      : {선택된 planner}  {✓ 인증됨 / ⚠ 미연결}
    Generator    : {선택된 generator}  {✓ 인증됨 / ⚠ 미연결}
    Evaluator    : {선택된 evaluator}  {✓ 인증됨 / ⚠ 미연결}

  작성/수정된 파일:
    - .vibe/config.local.json          (Sprint 역할 + provider 설정)
    - docs/context/product.md          (프로젝트 목표)
    - docs/context/architecture.md     (기술 스택)
    - docs/context/conventions.md      (코드 규칙)
    - AGENTS.md                        (Generator 규칙)
    - docs/orchestration/roles.md      (Sprint 역할 배정)

이제 목표를 말씀해주시면 Sprint 단위로 작업을 시작할 수 있습니다.
예) "Goal: 로그인 페이지를 만들어줘"
```

---

## 중요 규칙

- 질문은 **친절하고 쉬운 말**로 합니다. 코딩을 모르는 사용자를 대상으로 합니다.
- 각 Phase/Step을 순서대로 진행하며, 답변을 받은 후 파일을 작성하고 다음으로 넘어갑니다.
- 사용자가 "모름", "잘 모름", "패스", "기본" 등으로 답하면 기본값을 사용합니다.
- 빈 답변도 허용합니다. 빈 값은 기본값으로 채웁니다.
- `npm run vibe:init` 실행이 실패하면 원인을 파악하여 해결 후 재시도합니다.
- provider 인증 시, 사용자가 직접 터미널 명령을 실행해야 하는 경우 `! 명령어` 형식을 안내합니다.
- 커스텀 provider의 CLI 인자 형식을 모르는 경우, 기본 템플릿(`["--prompt", "{prompt}"]`)을 사용하고 나중에 `.vibe/config.local.json`에서 수정 가능하다고 안내합니다.
- AGENTS.md는 파일명은 유지하되, 내용만 선택된 Generator provider에 맞게 수정합니다.
