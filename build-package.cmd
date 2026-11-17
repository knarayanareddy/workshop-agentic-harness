@echo off
rem Builds the standalone harness package for this machine into agentic-harness\agentic-harness-windows-x64\.
rem Usage: build-package.cmd [extra docker build options]
rem Windows on ARM also gets the x64 package: it runs under the built-in x64 emulation.
setlocal
cd /d "%~dp0"

echo Building agentic-harness for windows-x64
docker build --output . --build-arg TARGETS=windows-x64 %* .
if errorlevel 1 exit /b %errorlevel%
echo Done: run agentic-harness\agentic-harness-windows-x64\harness.cmd
