# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = ['backend.main', 'backend.license', 'backend.trials', 'backend.analysis_engine', 'backend.grading_model', 'backend.patient_timeline', 'backend.cohort_insights', 'backend.drug_profile', 'backend.storage', 'backend.hardware', 'backend.training', 'backend.users', 'backend.audit', 'backend.queries', 'backend.deps', 'backend.pathology_report', 'backend.routes', 'backend.routes.license', 'backend.routes.trials', 'backend.routes.reports', 'backend.routes.analysis', 'backend.routes.users', 'backend.routes.audit', 'backend.routes.queries', 'backend.routes.training', 'backend.routes.patients', 'backend.patients', 'backend.finetune', 'backend.workers', 'backend.version', 'multipart', 'multipart.multipart', 'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto', 'uvicorn.protocols', 'uvicorn.protocols.http', 'uvicorn.protocols.http.auto', 'uvicorn.middleware']
tmp_ret = collect_all('reportlab')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# The trained grading checkpoint — must ship alongside the executable so
# backend/grading_model.py can find it at backend/models/omnia_prostate_v1.pt
# relative to the frozen app (see grading_model.MODEL_PATH).
datas += [('backend/models/omnia_prostate_v1.pt', 'backend/models')]

# torch/torchvision have a lot of non-Python payload (native libs, ATen
# kernels) that plain hiddenimports won't catch — collect_all pulls in
# everything PyInstaller's static analysis would otherwise miss.
for _pkg in ('torch', 'torchvision'):
    tmp_ret = collect_all(_pkg)
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]

# openslide-python loads the OpenSlide C library through ctypes at import
# time. PyInstaller's static analysis cannot see a ctypes dependency, so the
# native library has to be added explicitly or the frozen backend imports
# fine and then fails to open any slide.
#
# `openslide-bin` ships prebuilt libraries for macOS, Linux and Windows, so
# collecting it is what makes a Windows build able to read slides at all.
# The Homebrew glob below is kept as a fallback for macOS source checkouts
# that predate openslide-bin; on Windows it simply matches nothing.
try:
    tmp_ret = collect_all('openslide_bin')
    datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]
except Exception as _e:
    print(f'[spec] openslide-bin not collected ({_e}) — relying on a system library')

import glob as _glob
for _pattern in (
    '/opt/homebrew/opt/openslide/lib/libopenslide*.dylib',
    '/usr/local/opt/openslide/lib/libopenslide*.dylib',
):
    for _lib in _glob.glob(_pattern):
        binaries += [(_lib, '.')]

hiddenimports += ['openslide', 'openslide_bin', 'cv2']

# RDKit ships native extensions plus data files (ring templates, element
# tables) that PyInstaller's analysis will not find on its own.
tmp_ret = collect_all('rdkit')
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

# onedir, not onefile.
#
# A onefile executable is an archive with a bootloader stapled to the front: on
# every launch it unpacks the whole payload — torch, torchvision, the ATen
# kernels, the checkpoint — into a temporary directory before the server can
# start. That cost is paid at each start and grows with the bundle. Measured on
# this machine it had reached 48 seconds from launch to the backend answering
# /health, and it was climbing: 33s, then 48s, then 57s across three builds.
# It is also the first thing anyone sees after installing.
#
# onedir ships the same payload already unpacked, so start-up is the process
# launching rather than the process launching plus a decompression. The app
# bundle gains a directory of libraries instead of one large binary, which
# nobody sees — macOS shows the .app, and Windows shows the installer.
#
# sys._MEIPASS still resolves: under PyInstaller 6 the onedir layout puts data
# in _internal/ and points _MEIPASS at it, so grading_model._resource_dir()
# finds the checkpoint without changing.
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='omnia-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='omnia-backend',
)
