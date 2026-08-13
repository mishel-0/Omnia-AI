# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ['backend.main', 'backend.license', 'backend.trials', 'backend.analysis_engine', 'backend.storage', 'backend.hardware', 'backend.training', 'backend.users', 'backend.audit', 'backend.queries', 'backend.deps', 'backend.pathology_report', 'backend.routes', 'backend.routes.license', 'backend.routes.trials', 'backend.routes.reports', 'backend.routes.analysis', 'backend.routes.users', 'backend.routes.audit', 'backend.routes.queries', 'backend.routes.training', 'multipart', 'multipart.multipart', 'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.middleware']
tmp_ret = collect_all('reportlab')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['backend/main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='omnia-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
