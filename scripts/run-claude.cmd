@echo off
setlocal
if "%~1"=="--health"  goto :stub
if "%~1"=="--version" goto :stub
>&2 echo run-claude.cmd is a placeholder (exit code 2). See run-claude.sh header comment.
endlocal & exit /b 2
:stub
>&2 echo run-claude: not wired - Claude is invoked via Claude Code Agent tool
endlocal & exit /b 2
