# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller specification file for CAPS Desktop Print Agent.

Produces a reproducible, signed-ready Windows executable bundle containing:
- Pinned Python runtime and dependencies
- Native Windows spooler libraries (pywin32 / win32print)
- Bundled schemas from packages/print-contracts
- Windows PE version metadata for Authenticode code signing
- Deterministic, uncompressed binaries (UPX disabled for signing stability)
"""

import os
from pathlib import Path

# Base paths
spec_dir = os.path.abspath(SPECPATH)
agent_root = os.path.abspath(os.path.join(spec_dir, ".."))
src_dir = os.path.join(agent_root, "src")
main_script = os.path.join(src_dir, "caps_agent", "main.py")
version_file = os.path.join(spec_dir, "version_info.txt")

# Repo root for bundled contracts
repo_root = os.path.abspath(os.path.join(agent_root, "..", ".."))
contracts_schema_dir = os.path.join(repo_root, "packages", "print-contracts", "schema")

datas = []
if os.path.isdir(contracts_schema_dir):
    datas.append((contracts_schema_dir, os.path.join("packages", "print-contracts", "schema")))

# Explicit hidden imports to prevent runtime missing-module crashes
hidden_imports = [
    "caps_agent",
    "caps_agent.config",
    "caps_agent.main",
    "caps_agent.utils",
    "caps_agent.utils.logging",
    "caps_agent.printing",
    "caps_agent.printing.engine",
    "caps_agent.printing.fake_engine",
    "caps_agent.printing.printer_discovery",
    "caps_agent.printing.capabilities",
    "win32print",
    "win32api",
    "win32con",
    "pywintypes",
    "pythoncom",
    "pydantic",
    "pydantic_settings",
    "jsonschema",
    "jsonschema_specifications",
    "referencing",
    "rpds",
]

# Excluded packages to ensure slim, deterministic binary build
excluded_modules = [
    "tkinter",
    "matplotlib",
    "numpy",
    "scipy",
    "pandas",
    "IPython",
    "pytest",
    "_pytest",
]

a = Analysis(
    [main_script],
    pathex=[src_dir],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excluded_modules,
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="caps-agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version=version_file if os.path.exists(version_file) else None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="caps-agent",
)
