@echo off
rem Starts the harness with the Java runtime bundled next to this script; no JDK needed.
rem Usage: harness.cmd [path\to\project]
rem Default project: the repository's workspace\ when this package was built into <repo>\agentic-harness\,
rem otherwise the workspace\ folder next to this script.
setlocal
set "HERE=%~dp0"

rem extensions resolves from the working directory, so run from here;
rem make a project path absolute first, so it still points where the user meant.
set "PROJECT="
if not "%~1"=="" set "PROJECT=%~f1"
if not defined PROJECT for %%P in ("%HERE%..") do if /i "%%~nxP"=="agentic-harness" if exist "%HERE%..\..\workspace\" for %%W in ("%HERE%..\..\workspace") do set "PROJECT=%%~fW"
cd /d "%HERE%"

set "JAVA_HOME=%HERE%runtime"
if defined PROJECT (call "%HERE%app\bin\app.bat" "%PROJECT%") else (call "%HERE%app\bin\app.bat")
