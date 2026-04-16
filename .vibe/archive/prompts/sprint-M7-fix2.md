# Sprint M7 — 추가 테스트 수정 (regex trailing newline)

## 현상
`test/phase0-seal.test.ts:77` 의 regex `/Demo Project$/` 가 trailing `\n` 때문에 match 실패.
실제 output: `'chore(phase0): vibe-init Phase 0 seal — Demo Project\n'`

## 수정 (1줄)
regex 를 `/Demo Project\n?$/` 혹은 `.trim()` 후 match.

다른 파일 일체 손대지 않음.

## 완료 기준
`npm test` → 108/108 pass (1 skip).
