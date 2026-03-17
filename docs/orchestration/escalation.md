# Test failure escalation

조건:
- 같은 작업에서 테스트가 2회 연속 실패

절차:
1. primary 작업 상태를 기록
2. challenger용 worktree 생성
3. reviewer용 비교 브리프 생성
4. 두 구현안을 비교
5. 최종 선택과 이유를 보고서에 기록
