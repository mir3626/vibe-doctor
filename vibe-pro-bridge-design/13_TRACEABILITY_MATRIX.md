# Traceability Matrix

| User requirement | Design component | Spec |
|---|---|---|
| 마지막 CLI Goal 조사 | App Server + fallback GoalSourceProvider | VPB-001 |
| vibe-goal-iterate 원본 설계 조사 | durable state/prompt/iteration resolver | VPB-001 |
| code scope 조사 | Git scope + call/wiring expansion hints | VPB-001, VPB-002 |
| Web Pro 검증 prompt | PromptComposer | VPB-002 |
| 전체 code scope 전달 | GitHub connector + exact refs + optional patch | VPB-002 |
| Web Pro로 전달 | MCP mailbox + one-line invocation | VPB-003, VPB-004 |
| Web result를 project에 저장 | result protocol + atomic importer | VPB-005 |
| docs/plans 폴더 | output contract | VPB-005 |
| prompt 하위 폴더 | mandatory implementation prompt | VPB-005 |
| 새 기능 설계도 동일 interface | request kind + web-origin flow | VPB-007 |
| 기존 library/plugin 활용 | App Server, GitHub app, Developer Mode MCP, plugin | VPB-003, VPB-004 |
| direct integration이 없을 때 구현 | thin remote MCP mailbox | VPB-003 |
| 모듈화 | GoalSource, Scope, Transport, Importer ports | VPB-001~VPB-005 |
| 경량 하네스 유지 | explicit skills, no hooks/gates | VPB-006 |
