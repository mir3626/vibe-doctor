@echo off 
setlocal EnableExtensions EnableDelayedExpansion 
set _first= 
for /f \" "delims=\ %%%%I in ('call codex --version 2>nul') do (echo LINE=%%%%I & if not defined _first set _first=%%%%I) 
echo AFTER_FIRST=!_first! 
echo AFTER_RC=!ERRORLEVEL! 
