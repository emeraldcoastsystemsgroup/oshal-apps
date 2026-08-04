# CHANGE LOG
# -----------------------------------------------------------------------------
# DATE/TIME           | AUTHOR                      | DESCRIPTION
# -----------------------------------------------------------------------------
# 2026-08-03 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation -- rebuild
#                     |                             | the dedicated aerosim venv on a fresh
#                     |                             | Windows box (Python 3.11 + exact pins).
#
# Usage:  powershell -ExecutionPolicy Bypass -File setup-venv.ps1 [-EngineDir <path>]
# Builds <EngineDir>/.venv (default: this directory, which carries the vendored
# aerosim tree). The venv is DEDICATED on purpose -- aerosandbox pins pandas,
# and a shared interpreter's pins will drift the surrogate model's numbers.

param(
    [string]$EngineDir = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$req = Join-Path $PSScriptRoot "requirements.txt"
$venv = Join-Path $EngineDir ".venv"

if (-not (Test-Path $req)) { throw "requirements.txt not found at $req" }

Write-Host "Creating venv at $venv (Python 3.11)..."
py -3.11 -m venv $venv
if ($LASTEXITCODE -ne 0) { throw "py -3.11 -m venv failed -- is Python 3.11 installed?" }

$python = Join-Path $venv "Scripts/python.exe"
& $python -m pip install --upgrade pip
& $python -m pip install -r $req
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

Write-Host "Verifying the engine imports from $EngineDir ..."
$env:AERO_LAB_ENGINE_DIR = $EngineDir
& $python -c "import sys, os; sys.path.insert(0, os.environ['AERO_LAB_ENGINE_DIR']); import aerosim.validate_designs, aerosim.integrate, aerosim.validate_screen, aerosim.aeropolar; print('aerosim stable entry points import OK')"
if ($LASTEXITCODE -ne 0) { throw "engine import verification failed" }

Write-Host "Done. Point AERO_LAB_PYTHON at $python and AERO_LAB_ENGINE_DIR at $EngineDir"
