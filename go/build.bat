@echo off
rem Sync frontend build output into web\ then compile a single-file exe.
rem Note: keep this file ASCII-only (cmd.exe reads it in the OEM codepage).
setlocal
cd /d "%~dp0"

set GO=%ProgramFiles%\Go\bin\go.exe
if not exist "%GO%" set GO=D:\Program\_go-toolchain\go\bin\go.exe
if not exist "%GO%" set GO=go

if exist "web" rmdir /S /Q "web"
mkdir web
xcopy /E /I /Y "..\dist" "web" >nul

rem -buildvcs=false: keep the binary byte-identical regardless of local git state.
%GO% build -trimpath -buildvcs=false -ldflags "-s -w" -o dist\mania-bp-compare.exe .
if errorlevel 1 (
  echo Build failed.
  exit /b 1
)
for %%A in (dist\mania-bp-compare.exe) do echo Done: dist\mania-bp-compare.exe  %%~zA bytes
endlocal