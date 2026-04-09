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

2. **AI Agent CLI 확인** — `claude`, `codex` CLI 등 존재 여부를 확인합니다.
   - Codex는 **CLI** (`codex exec`)로 직접 호출합니다. 플러그인(`codex:rescue`)은 Windows 불안정·속도 저하로 보류.

3. **ouroboros 설치 확인** — `python -m ouroboros --version`으로 ouroboros-ai 패키지 설치 여부를 확인합니다.
   - **패키지명은 `ouroboros-ai`** 입니다 (하이픈 없는 `ouroboros`가 아님). PyPI에서 `ouroboros`로 검색하면 다른 패키지가 나오므로 반드시 `ouroboros-ai`로 설치해야 합니다.
   - **Python 3.12 이상**이 필요합니다. 먼저 `python --version`으로 확인하고, 3.12 미만이면 사용자에게 업그레이드를 먼저 안내합니다 (3.12 미만에서는 `Could not find a version that satisfies the requirement ouroboros-ai` 에러가 발생).
   - 미설치인 경우 아래 순서로 안내하고, 사용자 승인 후 설치합니다:
     1. `pipx install "ouroboros-ai[all]"` (권장 — 격리 환경)
     2. `pip install --user "ouroboros-ai[all]"` (pipx 미설치 시)
     3. `curl -fsSL https://raw.githubusercontent.com/Q00/ouroboros/main/scripts/install.sh | bash` (macOS/Linux 원클릭)
   - 설치 완료 후 `ouroboros setup`을 한 번 실행하도록 안내합니다.
   - **설치 실패 시 최대 3회까지 재시도합니다.** 각 재시도마다 실패 원인을 진단하고 다른 방법을 시도합니다:
     - `Could not find a version...` → Python 버전이 3.12 미만. 업그레이드 안내 후 중단.
     - `externally-managed-environment` (PEP 668) → `pipx` 또는 `--break-system-packages` 대신 가상환경 사용 안내.
     - 네트워크/SSL 오류 → `--index-url https://pypi.org/simple` 재시도.
     - pip 경로 문제 → `python -m pip install ...` 형식으로 재시도.
   - **3회 모두 실패한 경우**: 즉시 수동 Q&A로 전환하지 않습니다. 사용자에게 상황을 설명하고 다음 중 선택하도록 질문합니다:
     ```
     ouroboros 설치가 3회 시도 모두 실패했습니다.
     원인: {마지막 에러 메시지 요약}

     다음 중 선택해주세요:
       1. 수동 Q&A로 진행 — ouroboros 없이 Orchestrator가 직접 질문합니다
       2. 직접 설치 후 재시도 — 터미널에서 직접 설치한 뒤 알려주세요
       3. ouroboros 없이 기본값으로 건너뛰기 — Phase 3를 기본 템플릿으로 진행합니다
     ```
   - 설치 성공 시 `.mcp.json`에 ouroboros MCP 서버가 등록되어 있는지 확인합니다.
   - ouroboros는 Phase 3(기획서 작성)에서 소크라테스식 인터뷰 엔진으로 사용됩니다.

   결과를 사용자에게 보여줍니다. 예:
     ```
     환경 점검 결과:
       node (v22.x)      ✓
       npm                ✓
       git                ✓
       claude CLI         ✓
       codex CLI          ✗ (미설치)
       ouroboros          ✓ (v0.27.1)
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

2. Generator (코드 구현 — 체크리스트 기반 구현) [기본: codex (CLI)]
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
| codex | `npm install -g @openai/codex` 으로 Codex CLI 설치. `codex --version`으로 설치 확인 | 아래 인증 방식 선택 안내 참조 |
| claude-opus | Claude Code 사용 중이므로 이미 인증됨 | - |
| 기타 (custom) | 사용자가 알려준 설치 방법 또는 "해당 AI의 공식 문서를 참고하세요" | 사용자에게 인증 방법 확인 |

**Codex CLI 인증 방식 선택** (codex가 선택된 경우):

Codex CLI 설치 후, 사용자에게 인증 방식을 선택하도록 안내합니다:

```
Codex CLI 인증 방식을 선택해주세요:

  1. OAuth 로그인 (기본, 권장)
     → `codex auth login` 실행 후 브라우저에서 OpenAI 계정 로그인
     → API 키 관리 없이 간편하게 사용 가능

  2. API 키 직접 설정
     → OPENAI_API_KEY 환경변수에 API 키를 설정
     → .env 파일에 추가하거나, 터미널에서 직접 설정
```

사용자가 **1 (OAuth)**를 선택한 경우:
- `! codex auth login` 실행을 안내합니다 (사용자가 직접 실행)
- 브라우저 로그인 완료 후 `codex auth status`로 인증 상태를 확인합니다

사용자가 **2 (API 키)**를 선택한 경우:
- `.env` 파일에 `OPENAI_API_KEY=sk-...` 추가를 안내합니다
- 또는 `! export OPENAI_API_KEY=sk-...` 로 현재 세션에서 직접 설정하도록 안내합니다

---

안내 후 사용자에게 확인합니다:
```
설치/인증을 지금 진행하시겠어요?
  - "예" → 사용자가 터미널에서 직접 명령 실행하도록 안내 (! 명령어 prefix 안내)
  - "나중에" → 건너뛰고 다음 단계로 진행
  - "건너뛰기" → 해당 provider를 일단 설정만 해두고 나중에 연결
```

### Step 2-3: 설정 파일 업데이트

선택 결과를 바탕으로 아래 파일들을 업데이트합니다:

#### `CLAUDE.md` (CRITICAL — 반드시 수행)

`<!-- BEGIN:SPRINT_ROLES -->` ~ `<!-- END:SPRINT_ROLES -->` 영역의 역할 테이블을 선택된 provider 이름으로 교체합니다.
또한 CRITICAL 블록 내 `Generator sub-agent(현재 설정: **{이전 값}**)` 부분을 선택된 generator provider로 업데이트합니다.

이 업데이트는 context 압축 후에도 올바른 모델이 참조되도록 보장하기 위해 필수입니다.

예시 (generator를 deepseek로 선택한 경우):
```markdown
<!-- BEGIN:SPRINT_ROLES (vibe-init 자동 업데이트 영역) -->
| 역할 | Provider | 상주 여부 | 책임 |
|------|----------|-----------|------|
| **Orchestrator** | **claude-opus** (메인 대화) | 상주 | Sprint 생명주기 관리, 사용자 소통, context 전달, 보고서 |
| **Planner** | **claude-opus** (sub-agent) | Sprint 내 | "무엇을(WHAT)" 정의 + 완료 체크리스트 작성 |
| **Generator** | **deepseek** (sub-agent) | Sprint 내 | 체크리스트 기반 코드 구현 (HOW는 Generator 재량) |
| **Evaluator** | **claude-opus** (sub-agent) | Sprint 내 | 체크리스트 기준 합격/불합격 판정 |
<!-- END:SPRINT_ROLES -->
```

CRITICAL 블록도 업데이트:
```markdown
> 모든 코드 구현은 반드시 Generator sub-agent(현재 설정: **deepseek**)를 생성하여 위임한다.
```

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
  "sprint": {
    "unit": "feature",
    "subAgentPerRole": true,
    "freshContextPerSprint": true
  },
  "providers": {
    "claude-opus": {
      "command": "claude",
      "args": ["-p", "{prompt}"],
      "env": {}
    },
    "codex": {
      "command": "./scripts/run-codex.sh",
      "args": ["{prompt}"],
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

## Phase 3 — 프로젝트 맞춤 설정 (ouroboros 소크라테스식 인터뷰)

ouroboros의 인터뷰 엔진을 사용하여 사용자의 프로젝트 아이디어에서 숨겨진 가정을 드러내고,
모호성이 충분히 낮아질 때까지 질문을 반복한 뒤, 검증된 명세를 기반으로 문서를 생성합니다.

Orchestrator(Claude)가 ouroboros MCP 도구와 사용자 사이의 **중계자** 역할을 합니다.

### Step 3-0: 인터뷰 시작

사용자에게 프로젝트 아이디어를 한 줄로 설명해달라고 요청합니다:

```
이제 프로젝트 기획을 시작합니다.
ouroboros의 소크라테스식 인터뷰를 통해 아이디어를 구체화합니다.

프로젝트 아이디어를 자유롭게 한 줄로 설명해주세요.
(예: "내 주변 맛집을 지도에서 찾고 리뷰를 남길 수 있는 웹앱")
```

사용자의 답변을 받으면, ouroboros MCP 도구 `ouroboros_interview`를 호출하여 인터뷰 세션을 시작합니다.
호출 시 사용자의 한 줄 설명을 context로 전달합니다.

### Step 3-1: 인터뷰 루프

ouroboros가 반환하는 소크라테스식 질문을 사용자에게 **친절하게 번역·전달**합니다.

루프 진행 방식:

1. `ouroboros_interview` 도구 호출 → ouroboros가 질문(들)을 반환
2. Orchestrator가 질문을 사용자 친화적으로 정리하여 전달
   - 기술 용어가 있으면 쉬운 말로 바꾸거나 예시를 추가
   - 한 번에 너무 많은 질문이 오면 3~4개씩 나눠서 전달
3. 사용자 답변을 수집
4. 답변을 다시 `ouroboros_interview`에 전달 → 다음 질문 또는 모호성 점수 반환
5. **모호성 점수(Ambiguity) ≤ 0.2**가 될 때까지 반복

사용자에게 진행 상황을 주기적으로 알려줍니다:
```
현재 모호성 점수: 0.45 (목표: 0.2 이하)
아직 몇 가지 더 명확히 해야 할 부분이 있습니다.
```

사용자가 "모름", "패스", "나중에" 등으로 답하면:
- 해당 항목은 ouroboros에게 "미정(undecided)"으로 전달
- 전체 인터뷰 흐름은 계속 진행

### Step 3-2: 인터뷰 결과 → 문서 생성

모호성 점수가 0.2 이하에 도달하면 인터뷰가 완료됩니다.
ouroboros가 반환한 인터뷰 결과(seed 데이터)를 파싱하여 아래 3개 파일을 생성합니다.

#### `docs/context/product.md`

인터뷰에서 도출된 목표, 성공 기준, 플랫폼, 핵심 가정을 정리합니다:

```markdown
# Product context

이 저장소는 **{프로젝트 이름}** — {인터뷰에서 확정된 설명}

## 성공 기준
- {인터뷰에서 도출된 목표 1}
- {인터뷰에서 도출된 목표 2}
- {인터뷰에서 도출된 목표 3}

## 플랫폼
- {인터뷰에서 확정된 플랫폼}

## 핵심 가정 (ouroboros 인터뷰에서 드러난 사항)
- {인터뷰를 통해 명시화된 가정 1}
- {인터뷰를 통해 명시화된 가정 2}

## 모호성 점수
- 최종 Ambiguity: {점수} (임계값 0.2 통과)
```

#### `docs/context/architecture.md`

인터뷰에서 도출된 기술적 결정사항을 정리합니다:

```markdown
# Architecture context

## 기술 스택
- **프레임워크 / 라이브러리**: {인터뷰 결과 또는 (미정)}
- **호스팅 / 배포**: {인터뷰 결과 또는 (미정)}
- **데이터 저장**: {인터뷰 결과 또는 (미정)}

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

#### `docs/context/conventions.md`

인터뷰에서 도출된 코드 스타일, 언어, 테스트 전략을 정리합니다:

```markdown
# Conventions

## 기본 규칙

- 변경은 최소 범위로 한다.
- 로그는 사람이 읽기 쉽게 남긴다.
- 스크립트는 실패 원인을 명확히 출력한다.
- 문서/보고서는 짧고 결정 사항 중심으로 유지한다.

## 프로젝트별 규칙

- **언어 / 런타임**: {인터뷰 결과 또는 (AI가 기술 스택에 맞게 선택)}
- **코드 스타일**: {인터뷰 결과 또는 (기본: 깔끔하고 읽기 쉬운 코드)}
- **테스트**: {인터뷰 결과 또는 (AI가 기술 스택에 맞게 선택)}

## 추가 규칙
- {인터뷰에서 도출된 추가 규칙이 있으면 추가}
```

### ouroboros MCP 도구 사용 시 주의사항

- `ouroboros_interview` 도구만 사용합니다. 다른 ouroboros 도구(execute, evolve 등)는 호출하지 않습니다.
- 인터뷰 도구가 응답하지 않거나 에러가 발생하면, **최대 3회까지 재시도**합니다. 3회 모두 실패한 경우에만 사용자에게 수동 Q&A로 전환할지 질문합니다 (즉시 자동 전환하지 않음).
- ouroboros가 영어로 질문을 반환하면, Orchestrator가 한국어로 번역하여 전달합니다.
- 인터뷰 결과의 원본 데이터는 `.ouroboros/` 디렉토리에 ouroboros가 자동 저장합니다.

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
    - CLAUDE.md                        (Sprint 역할 테이블 + CRITICAL 블록)
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
