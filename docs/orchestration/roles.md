# Orchestration Roles — Sprint 기반

## Overview

모든 개발은 Sprint 단위로 진행한다. Sprint마다 3개의 독립적인 sub-agent가 생성되며,
Sprint 종료 시 소멸한다. 이를 통해 대용량 context 유지 없이 효율적으로 작업한다.

## Roles

### Orchestrator (메인 대화, 상주)
- Sprint 생명주기 관리 (분할 → 생성 → 실행 → 종료)
- 사용자와의 소통 및 승인 게이트
- Sprint 간 context 전달 (스펙, 체크리스트, 평가 결과)
- 보고서 작성 및 메모리 관리

### Planner (Sprint sub-agent)
- Sprint 시작 시 생성, 종료 시 소멸
- **"무엇을(WHAT)"** 만들 것인지 정의
- 완료 기준을 **체크리스트**로 작성
- **"어떻게(HOW)"는 명시하지 않음** — 구현 방법은 Generator에게 위임
- 사용자가 별도로 구현 방법을 지정한 경우에만 HOW를 포함
- Sprint 크기 결정 (기능 단위 기본, Planner 재량으로 조절)

### Generator (Sprint sub-agent)
- Sprint 시작 시 생성, 종료 시 소멸
- Planner의 스펙 + 체크리스트를 입력으로 받아 구현
- **구현 방법(HOW)은 Generator 재량** (기술 스택, 디자인 패턴, 파일 구조 등)
- 체크리스트의 각 항목을 만족하는 코드를 생성

> **호출 방법**: 각 sub-agent(Planner, Generator, Evaluator)의 provider에 따라 호출 도구가 다르다.
> - **Claude 계열** provider → Agent 도구 사용
> - **비-Claude 계열** provider (codex, gemini 등) → Bash 도구로 CLI/API 명령 실행
>
> `.vibe/config.json` → `providers` 섹션에서 해당 provider의 command/args를 참조한다.
> Agent 도구는 Claude 전용이므로, 비-Claude provider를 Agent 도구로 호출하면 사용자가 선택한 모델 대신 Claude가 실행된다.

### Evaluator (Sprint sub-agent)
- Sprint 시작 시 생성, 종료 시 소멸
- Planner의 체크리스트를 **평가 기준**으로 사용
- Generator의 출력이 체크리스트를 충족하는지 항목별 합격/불합격 판정
- 불합격 항목에 대해 구체적 사유 명시
- 전체 합격 시 Sprint 완료, 불합격 시 Generator에게 수정 지시

## Sprint Lifecycle

```
사용자 목표 입력
  ↓
Orchestrator: 목표를 Sprint 단위로 분할 → 사용자 승인
  ↓
┌─────────────── Sprint N ───────────────┐
│                                         │
│  1. Planner sub-agent 생성              │
│     → 기능 스펙 + 완료 체크리스트 출력   │
│     → sub-agent 소멸                    │
│                                         │
│  2. Generator sub-agent 생성            │
│     → 스펙 + 체크리스트 입력            │
│     → 코드 구현 출력                    │
│     → sub-agent 소멸                    │
│                                         │
│  3. Evaluator sub-agent 생성            │
│     → 체크리스트 + 구현 결과 입력       │
│     → 항목별 합격/불합격 판정           │
│     → sub-agent 소멸                    │
│                                         │
│  4. 판정 결과:                          │
│     ├─ 전체 합격 → Sprint 종료          │
│     └─ 불합격 → 2번으로 (Generator 재생성) │
│                                         │
└─────────────────────────────────────────┘
  ↓
Orchestrator: 다음 Sprint 또는 전체 완료 보고
```

## Planner Output Format

```markdown
# Sprint [N]: [기능명]

## 기능 스펙
- [무엇을 만들 것인지 서술]

## 완료 체크리스트
- [ ] 항목 1: [검증 가능한 완료 기준]
- [ ] 항목 2: [검증 가능한 완료 기준]
- [ ] ...
```

## Evaluator Output Format

```markdown
# Sprint [N] 평가 결과

## 체크리스트 평가
- [x] 항목 1: 합격 — [근거]
- [ ] 항목 2: 불합격 — [사유]

## 종합 판정: 합격 / 불합격

## 불합격 시 수정 요구사항:
- [구체적 수정 내용]
```

## Configuration

Sprint 역할과 옵션은 `.vibe/config.json`에서 프로젝트 기본값으로 관리한다.

```jsonc
// .vibe/config.json (커밋 대상 — 프로젝트 공통 기본값)
{
  "orchestrator": "claude-opus",
  "sprintRoles": {
    "planner": "claude-opus",    // WHAT 정의
    "generator": "codex",        // HOW 구현
    "evaluator": "claude-opus"   // 체크리스트 기반 판정
  },
  "sprint": {
    "unit": "feature",           // Sprint 단위 (기본: 기능)
    "subAgentPerRole": true,     // 역할별 독립 sub-agent
    "freshContextPerSprint": true  // Sprint마다 새 context
  },
  "providers": {
    "claude-opus": { "command": "claude", "args": ["-p", "{prompt}"] },
    "codex": { "command": "codex", "args": ["exec", "--json", "{prompt}"] }
  }
}
```

사용자별 로컬 override가 필요한 경우(예: provider 절대경로) `.vibe/config.local.json`을 생성한다.
이 파일은 gitignore 대상이며, `.vibe/config.local.example.json`을 복사하여 사용한다.
`config.local.json`이 없으면 `config.json`의 기본값으로 작동한다.

## Rules

1. Planner는 "무엇을"만 정의한다. "어떻게"는 사용자 요청 시에만 포함한다.
2. Generator는 Planner의 체크리스트를 만족하는 한 자유롭게 구현한다.
3. Evaluator는 체크리스트 외의 기준으로 불합격 판정하지 않는다.
4. Sprint 크기는 기능 단위가 기본이되, Planner 재량으로 조절한다.
5. 각 sub-agent는 Sprint 내에서만 존재하며, Sprint 간 context를 공유하지 않는다.
6. Sprint 간 필요한 정보는 Orchestrator가 문서(스펙, 보고서)로 전달한다.
