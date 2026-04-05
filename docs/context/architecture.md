# Architecture context

## 기술 스택
- **프론트엔드**: Vite + React (TypeScript)
- **백엔드**: Generator 재량 (Node.js / Python / Go 중 택1)
- **AI 이미지 생성**: Google Gemini API (`gemini-2.5-flash-image`)
- **호스팅 / 배포**: 미정
- **데이터 저장**: 브라우저 로컬스토리지 (서버 측 영구 저장 없음)

## 앱 아키텍처

```
[모바일 브라우저]
    │ 이미지 선택 (갤러리)
    ↓
[클라이언트 전처리]
    │ 리사이즈 (max 1024~2048px) + 압축 (max 2~3MB)
    ↓
[백엔드 서버]
    │ Gemini API 프록시
    ↓
[Gemini API] → 변형 이미지 (6곳 변경)
    ↓
[백엔드 서버]
    │ 픽셀 diff 처리 → 정답 좌표 추출
    ↓
[클라이언트]
    │ 게임 데이터 수신
    │ 로컬스토리지 저장
    ↓
[게임 플레이 UI]
    │ 좌(원본) / 우(변형) 비교
    │ 탭 → 정답/오답 판정
    ↓
[결과 화면]
    │ 하이라이트 + 재도전/새 게임/SNS 공유
```

## 레이어

1. **Memory layer** — AI가 읽는 컨텍스트
   - `CLAUDE.md`, `AGENTS.md`
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
- Generator(codex)는 격리 실행 우선
- Sprint 실패 시 Evaluator 판정 기반 에스컬레이션
- JSONL evidence 축적

## 프로젝트별 디렉터리 구조

```text
(프로젝트 디렉터리 구조는 첫 구현 후 자동으로 업데이트됩니다)
```
