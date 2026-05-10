"""
Throttlr - per-application network throttler for Windows.

Web UI version: backend logic runs in Python, UI is HTML/CSS/JS in an embedded
Chromium webview (QWebEngineView). Same features as before, gorgeous frontend.

Requires Windows 7+, Administrator, pydivert, psutil, PySide6 (with WebEngine).
"""

import sys
import os
import json
import time
import random
import threading
import heapq
import ctypes
import urllib.request
import urllib.error
import subprocess
import shutil
import zipfile
import tempfile
import uuid
import socket
import hmac
import hashlib
from ctypes import wintypes
from collections import deque, defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import psutil

try:
    import winsound
    HAS_WINSOUND = True
except Exception:
    HAS_WINSOUND = False

try:
    import pydivert
    HAS_PYDIVERT = True
    PYDIVERT_ERROR = None
except Exception as _e:
    HAS_PYDIVERT = False
    PYDIVERT_ERROR = str(_e)

from PySide6.QtCore import (
    Qt, QObject, QTimer, Signal, Slot, QUrl, QPoint, QRect, QFile, QIODevice
)
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QMessageBox, QSplashScreen, QWidget, QMenu
)
from PySide6.QtGui import (
    QPixmap, QPainter, QColor, QPen, QBrush, QLinearGradient, QFont, QPolygon,
    QGuiApplication
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings, QWebEngineProfile
from PySide6.QtWebChannel import QWebChannel


# ============================================================
# Constants
# ============================================================

# App version. Bumped when releasing notable new features so the
# update-log modal can fire on the next launch after upgrade.
__version__ = "3.0.5"

# ============================================================
# GitHub auto-update
# ============================================================
# On launch, Throttlr asks the GitHub Releases API for the latest tag.
# If newer than __version__, the user is prompted with a yes/no modal.
# - YES → download the release zip, write a helper batch that swaps the
#         files after Throttlr exits, then relaunch the new version.
#         The new version sees last_seen_version differs from __version__
#         and automatically shows the changelog modal — that's how the
#         "what's new" detail panel appears post-update.
# - NO  → the dismissed_update_version setting is set so we don't nag
#         again for THIS version. Settings → Info still shows a badge
#         until they update or a newer version comes out.

GITHUB_OWNER = "BillysMatrix18"
GITHUB_REPO  = "throttlr"
GITHUB_RELEASES_API = f"https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"
GITHUB_RELEASES_URL = f"https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest"


def _parse_version(s: str):
    """Parse 'v2.1.0' or '2.1.0-beta' into a tuple of ints for comparison.
    Non-numeric trailing chunks are stripped. Returns (0,0,0) on parse error."""
    if not s:
        return (0, 0, 0)
    s = str(s).strip().lstrip('vV')
    s = s.split('-')[0].split('+')[0]      # drop pre-release / build metadata
    parts = s.split('.')
    out = []
    for p in parts:
        digits = ''.join(c for c in p if c.isdigit())
        out.append(int(digits) if digits else 0)
    while len(out) < 3:
        out.append(0)
    return tuple(out[:3])


class UpdateChecker:
    """Background-threaded GitHub release checker. Cached per session.

    Runs once shortly after app launch so startup isn't blocked. Result is
    accessed via .get_state() which is what the bridge slot returns to JS.
    """

    def __init__(self):
        self._state = {
            "checked":   False,           # has the check completed at all
            "available": False,           # is a newer release available
            "latest":    "",              # tag name of latest, e.g. "v2.1.0"
            "current":   __version__,
            "body":      "",              # release notes from GitHub
            "html_url":  GITHUB_RELEASES_URL,
            "zip_url":   "",              # release asset download URL (if any)
            "error":     "",              # populated on failure (network, rate limit, etc.)
            "checked_at": 0,              # unix timestamp of last completed check
        }
        self._lock = threading.Lock()
        self._thread = None

    def kick_off(self):
        """Start the background check. Safe to call multiple times — only
        the first call spawns; later calls are no-ops while in flight."""
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._state["error"] = ""
            self._state["checked"] = False
        t = threading.Thread(target=self._do_check, daemon=True)
        self._thread = t
        t.start()

    def _do_check(self):
        try:
            req = urllib.request.Request(
                GITHUB_RELEASES_API,
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": f"Throttlr/{__version__}",
                },
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            tag = (data.get("tag_name") or "").strip()
            body = data.get("body") or ""
            html_url = data.get("html_url") or GITHUB_RELEASES_URL
            # Find a downloadable .zip asset (preferred) or fall back to source
            zip_url = ""
            for asset in (data.get("assets") or []):
                name = (asset.get("name") or "").lower()
                if name.endswith(".zip"):
                    zip_url = asset.get("browser_download_url") or ""
                    break
            if not zip_url:
                # Fall back to the source code zipball that GitHub auto-generates
                zip_url = data.get("zipball_url") or ""

            available = _parse_version(tag) > _parse_version(__version__) and bool(tag)

            with self._lock:
                self._state.update({
                    "checked":   True,
                    "available": available,
                    "latest":    tag,
                    "body":      body,
                    "html_url":  html_url,
                    "zip_url":   zip_url,
                    "error":     "",
                    "checked_at": int(time.time()),
                })
        except urllib.error.HTTPError as e:
            with self._lock:
                self._state.update({
                    "checked": True,
                    "error":   f"HTTP {e.code}: {e.reason}",
                    "checked_at": int(time.time()),
                })
        except Exception as e:
            with self._lock:
                self._state.update({
                    "checked": True,
                    "error":   f"{type(e).__name__}: {e}",
                    "checked_at": int(time.time()),
                })

    def get_state(self):
        with self._lock:
            return dict(self._state)


# Module-level singleton — instantiated in main()
update_checker: 'UpdateChecker | None' = None


def install_update_and_relaunch(zip_url: str, latest_tag: str, progress_cb=None) -> tuple[bool, str]:
    """Download the release zip, write a Windows batch that swaps the files
    in place via retry-based xcopy, spawn it hidden, and return. Caller is
    expected to QApplication.quit() after this returns True.

    progress_cb(phase, message, extras=None) is called at major milestones.
    Phases: 'downloading' (with extras dict containing bytes_done/bytes_total/
    speed_bps/eta_seconds), 'extracting', 'preparing'. May be None.

    The helper batch logs every step to %TEMP%\\throttlr_update.log so we
    can diagnose any failures.

    v2.5.1 changes vs v2.4.1:
      - Chunked download with byte-level progress callbacks
      - Retry-based file copy instead of brittle tasklist|find process-wait
        (the old approach hung on some systems because tasklist|find pipe
         could stall when the parent process was in a UAC-elevated state)
      - STARTUPINFO with SW_HIDE to reliably hide the helper window
        (CREATE_NO_WINDOW alone wasn't enough — pipeline subprocesses inside
         the batch could still allocate their own consoles)

    Returns (ok, error_message). On success error_message is empty."""

    def _emit(phase, message, extras=None):
        if progress_cb:
            try:
                progress_cb(phase, message, extras)
            except TypeError:
                # Backward-compat: old progress_cb only accepts (phase, message)
                try:
                    progress_cb(phase, message)
                except Exception:
                    pass
            except Exception:
                pass

    if not zip_url:
        return (False, "No download URL available for the latest release.")

    try:
        # 1. Resolve install dir — the directory containing this .exe (or .py in dev mode)
        if getattr(sys, 'frozen', False):
            install_dir = os.path.dirname(sys.executable)
            exe_name = os.path.basename(sys.executable)   # e.g. Throttlr.exe
        else:
            install_dir = os.path.dirname(os.path.abspath(__file__))
            exe_name = "throttlr.py"

        # 2. Download zip to temp — chunked with progress reporting
        _emit("downloading", "Starting download…", {
            "bytes_done": 0, "bytes_total": 0, "speed_bps": 0, "eta_seconds": 0,
        })
        tmp_dir = tempfile.mkdtemp(prefix="throttlr_upd_")
        zip_path = os.path.join(tmp_dir, f"throttlr_{latest_tag or 'latest'}.zip")
        req = urllib.request.Request(zip_url, headers={"User-Agent": f"Throttlr/{__version__}"})

        chunk_size = 64 * 1024  # 64 KB
        bytes_done = 0
        # Throttle progress emits — at most every ~150ms or every ~512KB —
        # otherwise we flood the Qt signal queue with thousands of events
        last_emit_time = 0.0
        emit_interval_s = 0.15
        emit_byte_step = 512 * 1024
        last_emit_bytes = 0
        # Rolling speed: track recent (time, bytes) pairs to compute speed
        # over the last ~2 seconds. Smoother than instantaneous, less laggy
        # than total-elapsed average.
        speed_window = deque()  # (timestamp, bytes_done) tuples
        speed_window_seconds = 2.0
        start_time = time.time()

        with urllib.request.urlopen(req, timeout=60) as resp, open(zip_path, "wb") as f:
            try:
                bytes_total = int(resp.headers.get('Content-Length', 0) or 0)
            except (TypeError, ValueError):
                bytes_total = 0

            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                bytes_done += len(chunk)

                now = time.time()
                # Update rolling speed window
                speed_window.append((now, bytes_done))
                while speed_window and speed_window[0][0] < now - speed_window_seconds:
                    speed_window.popleft()

                # Decide whether to emit a progress event
                should_emit = (
                    (now - last_emit_time) >= emit_interval_s
                    or (bytes_done - last_emit_bytes) >= emit_byte_step
                )
                if should_emit:
                    if len(speed_window) >= 2:
                        t0, b0 = speed_window[0]
                        t1, b1 = speed_window[-1]
                        dt = max(t1 - t0, 0.001)
                        speed_bps = (b1 - b0) / dt
                    else:
                        elapsed = max(now - start_time, 0.001)
                        speed_bps = bytes_done / elapsed
                    if speed_bps > 0 and bytes_total > bytes_done:
                        eta_seconds = (bytes_total - bytes_done) / speed_bps
                    else:
                        eta_seconds = 0
                    _emit("downloading", "Downloading update…", {
                        "bytes_done": bytes_done,
                        "bytes_total": bytes_total,
                        "speed_bps": speed_bps,
                        "eta_seconds": eta_seconds,
                    })
                    last_emit_time = now
                    last_emit_bytes = bytes_done

        # Final 100% emit so the UI can land on a clean "complete" state
        _emit("downloading", "Download complete", {
            "bytes_done": bytes_done,
            "bytes_total": bytes_total or bytes_done,
            "speed_bps": 0,
            "eta_seconds": 0,
        })

        # 3. Extract zip to staging folder
        _emit("extracting", "Extracting files…")
        stage_dir = os.path.join(tmp_dir, "stage")
        os.makedirs(stage_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(stage_dir)

        # GitHub source zipballs nest content inside a single top-level folder
        entries = [e for e in os.listdir(stage_dir) if not e.startswith('.')]
        if len(entries) == 1 and os.path.isdir(os.path.join(stage_dir, entries[0])):
            stage_dir = os.path.join(stage_dir, entries[0])

        # 4. Write a Windows batch that:
        #    - logs every step to %TEMP%\throttlr_update.log
        #    - sleeps 3s for Throttlr to release file locks
        #    - tries xcopy; if it fails (file lock, etc.) waits 2s and retries
        #      up to 10 times. This replaces the fragile tasklist|find loop
        #      that hung on some systems in v2.4.1/v2.5.0.
        #    - relaunches Throttlr via EXPLORER.EXE — this breaks the UAC
        #      elevation chain and lets Windows trigger UAC properly.
        _emit("preparing", "Preparing installer…")
        bat_path = os.path.join(tmp_dir, "apply_update.bat")
        log_path = os.path.join(os.environ.get("TEMP", tmp_dir), "throttlr_update.log")

        install_dir_w = install_dir.replace('/', '\\')
        stage_dir_w   = stage_dir.replace('/', '\\')
        tmp_dir_w     = tmp_dir.replace('/', '\\')
        log_path_w    = log_path.replace('/', '\\')

        bat_content = f"""@echo off
setlocal enabledelayedexpansion

set LOGFILE={log_path_w}
echo. > "%LOGFILE%"
echo [%date% %time%] === Throttlr update applier started === >> "%LOGFILE%"
echo Install dir: {install_dir_w} >> "%LOGFILE%"
echo Stage dir:   {stage_dir_w} >> "%LOGFILE%"
echo Exe name:    {exe_name} >> "%LOGFILE%"
echo Strategy:    retry-based file swap (v2.5.1+) >> "%LOGFILE%"

rem 1. Brief settle delay so Throttlr can quit and Windows can release locks.
echo [%date% %time%] Sleeping 3s for file-lock release >> "%LOGFILE%"
timeout /t 3 /nobreak >nul

rem 2. Try xcopy with retries — if Throttlr.exe is still locked by a stale
rem    process, xcopy will fail and we wait 2s + retry. Max 10 attempts =
rem    ~23 seconds total before giving up.
rem    /Y = no overwrite prompt, /E = include subdirs (even empty),
rem    /I = treat dest as dir if multiple files, /Q = quiet,
rem    /R = overwrite read-only, /H = include hidden
set RETRY_COUNT=0
:trycopy
set /a ATTEMPT=!RETRY_COUNT!+1
echo [%date% %time%] Copy attempt !ATTEMPT!/10... >> "%LOGFILE%"
xcopy /Y /E /I /Q /R /H "{stage_dir_w}\\*" "{install_dir_w}\\" >> "%LOGFILE%" 2>&1
set XCOPY_EXIT=!errorlevel!
echo [%date% %time%] xcopy attempt !ATTEMPT! returned !XCOPY_EXIT! >> "%LOGFILE%"
if !XCOPY_EXIT! equ 0 goto :copydone

set /a RETRY_COUNT+=1
if !RETRY_COUNT! geq 10 (
    echo [%date% %time%] ERROR: xcopy failed after 10 attempts, aborting relaunch >> "%LOGFILE%"
    goto :cleanup
)
echo [%date% %time%] Waiting 2s before retry !RETRY_COUNT!... >> "%LOGFILE%"
timeout /t 2 /nobreak >nul
goto :trycopy

:copydone
echo [%date% %time%] Copy succeeded (took !ATTEMPT! attempt(s)) >> "%LOGFILE%"

rem 3. Brief pause so the file system settles
timeout /t 1 /nobreak >nul

rem 4. Relaunch Throttlr via EXPLORER.EXE
rem    This breaks the elevation chain — Windows treats it as a normal
rem    user-initiated launch, UAC prompts correctly, Throttlr starts with
rem    the right elevation token.
echo [%date% %time%] Relaunching via explorer.exe: {install_dir_w}\\{exe_name} >> "%LOGFILE%"
start "" explorer.exe "{install_dir_w}\\{exe_name}"
echo [%date% %time%] Relaunch command issued >> "%LOGFILE%"

:cleanup
rem 5. Wait, then clean up temp dir + this script
timeout /t 4 /nobreak >nul
echo [%date% %time%] Cleaning up temp dir >> "%LOGFILE%"
rmdir /s /q "{tmp_dir_w}" 2>nul
echo [%date% %time%] === Update applier finished === >> "%LOGFILE%"
(goto) 2>nul & del "%~f0"
"""
        with open(bat_path, "w", encoding="utf-8") as f:
            f.write(bat_content)

        # 5. v2.6.1 — VBScript wrapper for TRULY invisible updates.
        #    Even with STARTUPINFO + SW_HIDE on the cmd parent, some children
        #    (xcopy, timeout /t, start "" explorer) can flash brief consoles
        #    because Windows console allocation rules are inconsistent.
        #
        #    The bulletproof technique used by professional installers:
        #    spawn wscript.exe (which has no console) running a tiny .vbs
        #    that calls Wscript.Shell.Run("cmd /c batch", 0, False). The
        #    `0` is vbHide — propagates to ALL children, no exceptions.
        vbs_path = os.path.join(tmp_dir, "run_hidden.vbs")
        # Escape backslashes and quotes for the VBS string literal
        bat_path_vbs = bat_path.replace('"', '""')
        vbs_content = (
            'Set WshShell = CreateObject("Wscript.Shell")\r\n'
            f'WshShell.Run "cmd /c """ & "{bat_path_vbs}" & """", 0, False\r\n'
        )
        try:
            with open(vbs_path, "w", encoding="utf-8") as f:
                f.write(vbs_content)
        except Exception:
            vbs_path = None  # fallback to direct cmd spawn below

        # 6. Spawn the helper. Detached so we can quit Throttlr immediately.
        DETACHED_PROCESS         = 0x00000008
        CREATE_NEW_PROCESS_GROUP = 0x00000200
        CREATE_NO_WINDOW         = 0x08000000
        CREATE_BREAKAWAY_FROM_JOB= 0x01000000

        flags_full = (DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP |
                      CREATE_NO_WINDOW | CREATE_BREAKAWAY_FROM_JOB)
        flags_fallback = (DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP |
                          CREATE_NO_WINDOW)

        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0  # SW_HIDE

        # Prefer wscript path (no console flashes); fall back to direct cmd.
        if vbs_path and os.path.exists(vbs_path):
            spawn_argv = ["wscript.exe", "//B", "//Nologo", vbs_path]
        else:
            spawn_argv = ["cmd", "/c", bat_path]

        try:
            subprocess.Popen(
                spawn_argv,
                creationflags=flags_full,
                startupinfo=startupinfo,
                close_fds=True,
                shell=False,
                cwd=tmp_dir,
            )
        except (OSError, PermissionError):
            # Job object refuses breakaway — fall back to basic detach
            subprocess.Popen(
                spawn_argv,
                creationflags=flags_fallback,
                startupinfo=startupinfo,
                close_fds=True,
                shell=False,
                cwd=tmp_dir,
            )
        return (True, "")
    except Exception as e:
        return (False, f"{type(e).__name__}: {e}")


# Changelog data for the in-app update log modal. Newest version FIRST.
# Each entry: {"version", "date", "title", "changes": [str, ...]}
# Keep change lines short — the modal is a quick reference, not a manual.
CHANGELOG = [
    {
        "version": "3.0.4",
        "date":    "May 2026",
        "title":   "Hotkey reliability + Optimised theme",
        "changes": [
            "FIXED · Hotkeys now work reliably in fullscreen games + when other apps have grabbed the same key. The old code used Windows RegisterHotKey which silently failed if Discord overlay, OBS, Steam, or the game itself had already registered the same global hotkey — your F5 went to that other app instead of Throttlr. Replaced with a system-wide low-level keyboard hook that intercepts keypresses BEFORE any app processes them. Same keys, never conflicts.",
            "NEW · Click-to-set keybinds — click any hotkey field, press a key, done. No more scrolling through dropdowns. Esc cancels, Backspace unbinds. Supports any letter, digit, F-key, arrow, numpad, or punctuation key.",
            "NEW · Optimised theme — fourth design option for low-end hardware. Solid colors only, no gradients, no animations, no glow effects, system fonts. The fastest possible render path.",
            "POLISH · Changelog modal cleaned up — older versions now collapsed by default, click to expand. Stops the modal feeling overwhelming when there are 30+ versions of history. Current version + last-seen-version always start expanded so you see what's relevant.",
            "FIXED · Untagged v1.0.0 changelog items were rendering as empty rows — added the NEW prefix so they get proper badges like every other entry.",
        ],
    },
    {
        "version": "3.0.3",
        "date":    "May 2026",
        "title":   "Windows 7 theme + overlay polish",
        "changes": [
            "NEW · Windows 7 theme — third design option alongside Industrial and Midnight. Aero glass titlebars, cornflower blue accents, gradient buttons, rounded corners, drop shadows, Segoe UI font. The full late-2000s Microsoft software vibe.",
            "POLISH · Overlay Midnight theme redesigned to actually feel like Midnight — deep navy background (#0a0e1a, matching the main app), soft accent gradient bar instead of harsh hazard zigzag, subtle glow border when running. No more 'industrial-with-blue-tint' look.",
            "POLISH · Overlay also gets the Windows 7 chrome treatment when that theme is selected — Aero glass gradient bar with white shine on top edge, frost-blue subtle border.",
            "FIXED · Changelog modal items with POLISH tag had no badge so they appeared empty/cramped. Added the missing POLISH badge (purple POL chip) plus bumped font to 13px, brighter text color, more vertical breathing room, wider badge column, and a subtle left rail for visual rhythm. Items are now actually readable.",
        ],
    },
    {
        "version": "3.0.2",
        "date":    "May 2026",
        "title":   "Overlay theming",
        "changes": [
            "NEW · The floating overlay now follows your selected theme — Industrial keeps its hazard yellow, Midnight tints the overlay accent + background to match your selected accent variant (aurora, sunset, forest, amber, rose, ocean, or your custom color)",
            "NEW · Overlay theme updates live when you change themes in Settings — no restart needed",
            "POLISH · Status colors (drop=red, running=green, replay=cyan) intentionally stay constant across themes — semantic meaning takes priority over visual coherence",
        ],
    },
    {
        "version": "3.0.1",
        "date":    "May 2026",
        "title":   "Polish & post-launch fixes",
        "changes": [
            "FIXED · App crash on launch — SettingsManager.get() didn't accept a default arg, breaking LANCoordinator init. All 23 callers across automation/LAN/plugins now work.",
            "POLISH · Changelog modal is now properly scrollable with a themed scrollbar — no more squashed unreadable bullets",
            "POLISH · 'Vibes' preset tab renamed to 'Chaos' — better describes what's in it (SPIKE, DDOS BLOCK, Connection Killer, etc.)",
            "POLISH · Every icon in the app redrawn — bolder 2.4 stroke, round caps, more distinctive shapes. All monochrome via currentColor so they pick up theme tint cleanly.",
        ],
    },
    {
        "version": "3.0.0",
        "date":    "May 2026",
        "title":   "Phase 5 — Multi-machine LAN + Plugin system (the finale)",
        "changes": [
            "NEW · Multi-machine LAN coordination — control Throttlr running on other PCs on your network",
            "NEW · Auto-discovery via UDP broadcast — peers announce themselves every 5 seconds",
            "NEW · Secure pairing with 6-digit codes — only paired peers can be controlled",
            "NEW · Broadcast commands — start/stop capture, apply preset, toggle functions across all paired peers at once",
            "NEW · Live peer status — see each peer's running state, target app, and current bandwidth",
            "NEW · Settings → Network tab — manage discoverability, paired peers, and pairing requests",
            "NEW · Plugin system — drop .py files into the plugins folder for custom backend extensions",
            "NEW · Plugin lifecycle hooks: on_load, on_unload, on_capture_start, on_capture_stop, on_packet",
            "NEW · Settings → Plugins tab — discover, enable, disable, and view plugin status",
            "NEW · Bundled example plugin demonstrating the API",
            "NEW · 'Open plugins folder' shortcut for easy plugin install",
            "POLISH · This is v3.0.0 — major version bump marking the completion of the original 5-phase roadmap",
        ],
    },
    {
        "version": "2.7.0",
        "date":    "May 2026",
        "title":   "Phase 4 — Throttlr Studio (visual timeline editor)",
        "changes": [
            "NEW · Throttlr Studio — visual timeline editor for recorded sessions",
            "NEW · Open any .thrtlrec recording in a multi-lane timeline view (one lane per function)",
            "NEW · Function-on/off events render as colored blocks on their lane",
            "NEW · Drag any block to move it in time, drag the edges to resize",
            "NEW · Click empty timeline space to add a new event there",
            "NEW · Click a block to select it; press Delete to remove it",
            "NEW · Scrub head — drag to jump to any point in the timeline",
            "NEW · Snap-to-grid options (off / 100ms / 1s) for clean event boundaries",
            "NEW · Undo and redo (Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z) — full edit history",
            "NEW · Zoom in/out on the timeline via mouse wheel or +/- keys",
            "NEW · Save back over the original recording, or 'Save as' to a new file",
            "FIXED · Changelog modal now uses unambiguous wording — 'Updated from vX to vY' — and handles weird states (downgrade, stale settings) gracefully",
            "FIXED · Auto-update no longer flashes brief cmd windows for xcopy/timeout children — now uses a wscript.exe + .vbs wrapper which truly hides everything (vbHide propagates to all descendants)",
        ],
    },
    {
        "version": "2.6.0",
        "date":    "May 2026",
        "title":   "Phase 3 — Automation Rules Engine",
        "changes": [
            "NEW · Define rules of the form 'when X, then Y' that fire automatically",
            "NEW · Conditions: schedule (time + weekday window), app-running, bandwidth threshold, connection-count threshold",
            "NEW · Actions: apply a quick preset, toggle any function on/off, show a toast notification, start/stop capture",
            "NEW · Settings → Automation tab — manage rules with one-click enable/disable per rule",
            "NEW · Edge-triggered evaluation — rules fire once when condition becomes true, won't spam",
            "NEW · Master switch in the tab header to disable the entire engine without losing rules",
            "FIXED · Auto-update no longer hangs when a stale Throttlr.exe lingers (rolled in from v2.5.1)",
            "FIXED · Helper batch is now properly hidden during update (rolled in from v2.5.1)",
            "FIXED · Dot positions on the Geo Map no longer shift when other connections come/go (rolled in from v2.5.2)",
            "FIXED · App no longer lags after clicking Stop (rolled in from v2.5.2)",
            "NEW · Live download progress bar with MB/speed/ETA during update (rolled in from v2.5.1)",
            "NEW · Click any Inspector row for full connection details (rolled in from v2.5.2)",
            "NEW · Export connections as CSV (rolled in from v2.5.2)",
            "NEW · Topology view reworked — country clusters, bidirectional flow, idle fade, click for details (rolled in from v2.5.2)",
            "NEW · Map info bar showing countries, connections, bandwidth, top country (rolled in from v2.5.2)",
            "POLISH · Brighter map continents, sharper grid, stronger dot glow (rolled in from v2.5.2)",
            "POLISH · Bigger hitboxes on overlay layout toggles (rolled in from v2.5.2)",
        ],
    },
    {
        "version": "2.5.2",
        "date":    "May 2026",
        "title":   "Phase 2 polish — Map glow-up, Inspector detail view, Topology rework",
        "changes": [
            "NEW · Geo Map looks much better — brighter continents, sharper grid, glowing pulse rings, animated country trails",
            "NEW · Map stats bar — live counts of countries, connections, and total in/out bytes above the map",
            "NEW · Click any connection in the Inspector table to open a full detail panel with all bytes/packets/timing data",
            "NEW · Export connections as CSV from the Inspector — full snapshot, opens cleanly in Excel/Sheets",
            "NEW · Topology rework — connections now grouped into country clusters, bidirectional packet flow on edges, click any node for full details, idle nodes fade visually",
            "FIXED · Connection dots no longer jitter/jump between map refreshes — positions are now stable per remote address, not based on array order",
            "FIXED · App lag for ~1 second after clicking Stop — capture shutdown now runs on a background thread so the UI stays responsive",
            "NEW · Bigger click areas on the overlay layout toggles — the visual size is unchanged but the hitbox extends further so they're easier to hit",
        ],
    },
    {
        "version": "2.5.1",
        "date":    "May 2026",
        "title":   "Hotfix — auto-updater UX",
        "changes": [
            "FIXED · Auto-update no longer hangs when a stale Throttlr.exe lingers — replaced fragile process-wait with a retry-based file swap that just keeps trying for ~25 seconds",
            "FIXED · Helper batch is now properly hidden — no more black cmd window popping up during update (was caused by tasklist|find spawning its own console)",
            "NEW · Live download progress bar with MB downloaded, transfer speed, and time-remaining estimate",
            "NEW · Update modal is locked during install — close button + 'Not now' disabled so the install can't be accidentally interrupted",
            "NEW · More detailed update log at %TEMP%\\throttlr_update.log — every retry attempt is recorded for debugging",
        ],
    },
    {
        "version": "2.5.0",
        "date":    "May 2026",
        "title":   "Phase 2 — Network Geo Map",
        "changes": [
            "NEW · Connection Inspector now has a Map view — see your app's connections plotted on a world map in real time",
            "NEW · Each remote endpoint shows as a glowing dot at its country's location, sized by total bytes transferred",
            "NEW · Hover any dot to see the hostname, IP, country, and traffic stats",
            "NEW · Active connections pulse, idle ones fade to muted",
            "NEW · Toggle between Table view and Map view in the Inspector header",
            "NEW · Country center coordinates for ~250 countries embedded — no external lookup required",
        ],
    },
    {
        "version": "2.4.1",
        "date":    "May 2026",
        "title":   "Hotfix — auto-update relaunch on Program Files installs",
        "changes": [
            "FIXED · Auto-update now actually swaps files and relaunches when Throttlr is installed in Program Files",
            "FIXED · Helper batch uses explorer.exe to launch the new Throttlr — breaks the UAC elevation chain that was silently killing the relaunch",
            "FIXED · Helper batch process now fully detaches from Throttlr's job object so it survives the app exit",
            "NEW · Auto-update activity logs to %TEMP%\\throttlr_update.log for debugging if anything goes wrong",
        ],
    },
    {
        "version": "2.4.0",
        "date":    "May 2026",
        "title":   "Phase 1 — Killswitch, Profiles, Enhanced Graph",
        "changes": [
            "NEW · Global killswitch hotkey — instantly disables all 6 functions from anywhere (no default binding, set in Hotkeys settings)",
            "NEW · Profile import/export — save your full configuration (target apps, function settings, presets, filter script, theme) as a .throttlr file",
            "NEW · Drop a .throttlr file on the app window to import a profile",
            "NEW · Bandwidth graph upgrade — peak / average / total readouts above the graph, with proper KB/s and MB/s axis labels",
            "NEW · Drop indicator on the graph — small red marks where packet drops occurred",
            "NEW · Settings → Profile tab for the import/export controls",
        ],
    },
    {
        "version": "2.3.0",
        "date":    "May 2026",
        "title":   "Proper Windows installer",
        "changes": [
            "NEW · Real Windows installer (Throttlr-Setup.exe) — replaces the zip-extract install flow for new users",
            "NEW · Installs Throttlr to Program Files with Start Menu + optional Desktop shortcuts",
            "NEW · Proper uninstaller registered in Windows 'Add or Remove Programs'",
            "NEW · MIT license shown during install",
            "NEW · Optional 'Launch Throttlr after install' checkbox on the final wizard page",
        ],
    },
    {
        "version": "2.2.1",
        "date":    "May 2026",
        "title":   "Hotfix — UI freeze on update apply",
        "changes": [
            "FIXED · App no longer freezes when clicking 'Yes, update now' — download now runs in a background thread",
            "NEW · Live progress on the update button: 'Downloading…' → 'Extracting…' → 'Preparing…' → 'Restarting…'",
            "FIXED · App relaunch after update is now more reliable — explicit working directory + extra time for file handles to release",
        ],
    },
    {
        "version": "2.2.0",
        "date":    "May 2026",
        "title":   "Polished Info screen + system diagnostics",
        "changes": [
            "NEW · System diagnostics in Settings → Info — Windows version, admin status, WinDivert driver status",
            "NEW · 'Last checked' timestamp next to update status so you know how fresh the info is",
            "NEW · 'Report a bug' button opens a pre-filled GitHub issue",
            "NEW · Color-coded status pills (green = up to date, yellow = update available, red = error)",
            "RENAMED · Cleaner copy throughout the Info tab — clearer labels, less jargon",
            "REMOVED · 'Source code on GitHub' button (link still available via the repo URL in the bug report flow)",
        ],
    },
    {
        "version": "2.1.0",
        "date":    "May 2026",
        "title":   "Auto-update from GitHub",
        "changes": [
            "NEW · Throttlr now checks GitHub on every launch for new releases",
            "NEW · One-click in-app update — downloads, swaps files, restarts",
            "NEW · Settings → Info tab shows current version, latest version, and update status",
            "NEW · 'Not now' option remembers your choice until a newer release ships",
            "NEW · Manual 'Check now' button in Settings → Info to force a re-check",
            "NEW · Direct links to the GitHub repo and latest release page",
            "FIXED · After an update, the 'What's New' changelog now fires automatically on first launch of the new version",
        ],
    },
    {
        "version": "2.0.0",
        "date":    "May 2026",
        "title":   "Phase 2 + Phase 3 — the big one",
        "changes": [
            # Phase 2 features
            "NEW · Connection Inspector — see every connection your app makes",
            "NEW · HTTPS hostname inspector via TLS SNI parsing",
            "NEW · Domain blocklist — Ads / Trackers / Telemetry built-in lists + custom",
            "NEW · Geo blocking by region (12-region picker grid)",
            "NEW · Practice Ping mode — feel real high-ping gameplay",
            "NEW · Recording & Replay sessions (.thrtlrec format)",
            "NEW · Replay viewer with scrub bar + Play/Pause + speed selector (0.25× to 10×)",
            # Phase 3 features
            "NEW · Network Topology — live force-graph of remote endpoints",
            "NEW · PCAP capture — exports standard libpcap (Wireshark-compatible)",
            "NEW · Filter Script — sandboxed expression evaluator (AST-based)",
            # UI / layout
            "NEW · Side tool rail on the right edge, 7 advanced tools",
            "NEW · 25 SVG icons replacing every emoji (Lucide-style, MIT licensed)",
            "NEW · 8 distinct preset card icons (skull / snowflake / snail / phone / signal bars / satellite)",
            "NEW · 'Open folder' buttons in Recordings and PCAP modals",
            "NEW · 'View recordings' entry point",
            "NEW · First-launch tutorial (this thing) — re-watchable from Settings",
            "NEW · Update log on version change (this other thing)",
            "NEW · 28 new bridge slots (15 Phase 2 + 13 Phase 3)",
            # Fixes
            "FIXED · Per-app preset auto-save (was completely broken — never triggered)",
            "FIXED · Per-app preset prompt deduplicates per-session, skips empty configs",
            "FIXED · Bridge async pattern (getRecentApps / getPerAppPreset / getAchievements / getUserPresets)",
            "FIXED · Stats now reset on every Start — no more stale counters",
            "FIXED · Loading screen 'BY BILLY'S MATRIX' spacing under THROTTLR title",
            "FIXED · Record button no longer auto-opens recordings modal on stop",
            "FIXED · Toolbar text contrast (warm cream over dim grey)",
            "FIXED · Replay scrub slider properly themed (was default browser blue)",
            "FIXED · Cluttered action bar (tools moved out to the side rail)",
            # Layout / cleanup
            "RENAMED · 'Game Killer' preset → 'Connection Killer'",
            "RENAMED · 'Replay' button → 'View recordings'",
            "REMOVED · 'Voice Lag' preset",
            "REMOVED · Cramped horizontal toolbar from action bar",
        ],
    },
    {
        "version": "1.0.0",
        "date":    "Earlier",
        "title":   "Initial release + Phase 1",
        "changes": [
            "NEW · Per-app network throttling (lag, drop, throttle, freeze, block, fun)",
            "NEW · Quick presets, per-app memory, recent apps",
            "NEW · Multi-target mode, drag-drop .exe targeting",
            "NEW · Sound effects, animated tray icon",
            "NEW · Stream-safe overlay, ghost mode",
            "NEW · 10 achievements with toast notifications",
            "NEW · Industrial + Midnight designs (6 accent variants)",
            "NEW · Crash reporter, DNS-only drop, reset-on-start",
        ],
    },
]

DELAY_QUEUE_CAP = 200_000
FREEZE_QUEUE_CAP = 1_000_000

WM_HOTKEY = 0x0312
PM_REMOVE = 0x0001
VK_F5 = 0x74
VK_F8 = 0x77
VK_F9 = 0x78
VK_F10 = 0x79

PROFILE_DIR = Path.home() / ".throttlr"
PROFILE_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_PATH = PROFILE_DIR / "settings.json"

# v3.0.5 — custom themes folder. Users drop downloaded .json + .css pairs
# from throttlr-themes.netlify.app here. The app scans on boot and renders
# tiles next to the built-in 4 designs.
THEMES_DIR = PROFILE_DIR / "themes"
THEMES_DIR.mkdir(parents=True, exist_ok=True)
THEMES_GALLERY_URL = "https://throttlr-themes.netlify.app/"


KEY_NAMES = {
    # Function keys
    "F1": 0x70, "F2": 0x71, "F3": 0x72, "F4": 0x73,
    "F5": 0x74, "F6": 0x75, "F7": 0x76, "F8": 0x77,
    "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
    "F13": 0x7C, "F14": 0x7D, "F15": 0x7E, "F16": 0x7F,
    "F17": 0x80, "F18": 0x81, "F19": 0x82, "F20": 0x83,
    "F21": 0x84, "F22": 0x85, "F23": 0x86, "F24": 0x87,
    # Navigation cluster
    "Insert": 0x2D, "Home": 0x24, "End": 0x23,
    "Page Up": 0x21, "Page Down": 0x22, "Pause": 0x13,
    "Scroll Lock": 0x91, "Print Screen": 0x2C,
    # Arrows
    "Up": 0x26, "Down": 0x28, "Left": 0x25, "Right": 0x27,
    # Whitespace / control
    "Space": 0x20, "Enter": 0x0D, "Tab": 0x09,
    # Punctuation
    "-": 0xBD, "=": 0xBB, "[": 0xDB, "]": 0xDD, "\\": 0xDC,
    ";": 0xBA, "'": 0xDE, ",": 0xBC, ".": 0xBE, "/": 0xBF, "`": 0xC0,
    # Numpad
    "Num 0": 0x60, "Num 1": 0x61, "Num 2": 0x62, "Num 3": 0x63, "Num 4": 0x64,
    "Num 5": 0x65, "Num 6": 0x66, "Num 7": 0x67, "Num 8": 0x68, "Num 9": 0x69,
    "Num *": 0x6A, "Num +": 0x6B, "Num -": 0x6D, "Num .": 0x6E, "Num /": 0x6F,
}
# Letters A-Z and digits 0-9 — populated programmatically rather than hand-typed
for _i, _c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    KEY_NAMES[_c] = 0x41 + _i
for _i in range(10):
    KEY_NAMES[str(_i)] = 0x30 + _i


# ============================================================
# Settings
# ============================================================

DEFAULT_SETTINGS = {
    "theme": "lethal",
    "ui_design": "industrial",          # industrial | midnight | windows7 | optimised
    "midnight_accent": "aurora",        # aurora | sunset | forest | amber | rose | ocean
    "hotkey_startstop": "F5",
    "hotkey_freeze": "F8",
    "hotkey_block": "F9",
    "hotkey_fun": "F10",
    "hotkey_killswitch": "",        # global "disable all functions" — no default binding

    # Sound
    "sound_enabled": True,
    "sound_volume": 100,

    # Behavior
    "auto_start_on_launch": False,
    "auto_clear_freeze_queue": False,
    "reset_stats_on_start": True,        # Phase 2: default ON — fresh stats per run
    "confirm_before_quit": True,

    # Onboarding — tutorial gates first launch, update log fires when version changes
    "tutorial_seen": False,
    "last_seen_version": "",
    "auto_stop_minutes": 0,
    "hotkey_notifications": True,

    # Auto-update — version string the user said "Not now" to. Stays set
    # until they update or a NEWER release supersedes it (then we prompt
    # again because the dismissed version is no longer the latest).
    "dismissed_update_version": "",

    # Window
    "window_w": 1100,
    "window_h": 920,

    # Floating overlay
    "show_overlay": True,
    "overlay_mode": "compact",          # compact | advanced | custom
    "overlay_advanced": False,          # legacy — kept for back-compat
    "overlay_x": 30,
    "overlay_y": 30,
    "overlay_opacity": 95,
    "overlay_locked": False,
    "overlay_layout": [],               # list of {type, visible} for custom mode
    "overlay_presets": {},              # name -> layout

    # Screen-edge border indicator
    "screen_border_enabled": False,
    "screen_border_duration_ms": 2000,
    "screen_border_feather": 90,

    # Appearance extras
    "compact_mode": False,
    "crt_effects": True,
    "anim_speed": 1.0,                  # 0.5 = slower, 2 = faster

    # Advanced
    "stats_interval_ms": 200,
    "apps_refresh_ms": 2000,
    "toast_duration_ms": 3500,
    "number_format": "raw",             # raw | abbrev
    "main_always_on_top": False,
    "auto_load_profile": "",            # name of profile to load on launch ("" = none)
    "tooltips_enabled": True,
    "skip_localhost": True,
    "verbose_logging": False,

    # ===== Phase 1 additions =====

    # Recent apps (most-recently-targeted, max 8)
    "recent_apps": [],

    # Per-app preset memory: { "Discord.exe": {<full filter cfg>}, ... }
    "per_app_presets": {},
    "auto_load_per_app_preset": True,   # prompt on app pick to restore last

    # User-named quick presets, on top of the built-in ones
    "user_quick_presets": [],            # list of {name, color, config}

    # Sound effects (per-function audio cues — distinct from Sound tab)
    "sound_effects_enabled": True,
    "sound_effects_volume": 80,

    # Theme — custom Midnight accent. Hex color string or "" if unused.
    "midnight_custom_color": "",         # e.g. "#ff44aa"
    "active_custom_theme": "",           # v3.0.5 — id of installed custom theme, empty = use built-in
    "theme_customizations": {},          # v3.0.5 — { theme_id: { key: value | [stops] } } user color overrides per theme

    # Stream-safe overlay — bigger fonts, opaque background for clean OBS capture
    "overlay_stream_safe": False,

    # Ghost mode — overlay invisible to screen-capture (Windows API)
    "overlay_ghost_mode": False,

    # Achievements ledger: { "first_drop": "2026-05-07T...", ... }
    "achievements_unlocked": {},

    # Animated taskbar/window icon while capture is running
    "animated_icon": True,

    # ===== Phase 3 (v2.6.0) — Automation Rules Engine =====
    # Master enable for the engine itself. When False, no rules fire even if
    # individual rules are marked enabled.
    "automation_enabled": True,

    # List of rule dicts. Each rule:
    #   {
    #     "id": "<uuid>",
    #     "name": "Throttle Discord during work hours",
    #     "enabled": True,
    #     "condition": {
    #         "type": "schedule" | "app_running" | "bandwidth" | "conn_count",
    #         ... type-specific params (see AutomationEngine for details)
    #     },
    #     "action": {
    #         "type": "preset" | "function" | "toast" | "capture",
    #         ... type-specific params
    #     }
    #   }
    "automation_rules": [],

    # ===== Phase 5 (v3.0.0) — LAN coordination + plugins =====
    # LAN sync — discoverable + accept pairing requests from other Throttlr
    # instances on the network. Off by default for privacy.
    "lan_sync_enabled":      False,
    # Display name shown to peers (defaults to hostname if empty)
    "lan_display_name":      "",
    # UDP discovery port (most users won't change)
    "lan_discovery_port":    7878,
    # TCP control port (commands + status)
    "lan_control_port":      7879,
    # List of trusted peers, each: {peer_id, name, last_ip, shared_secret}
    "lan_trusted_peers":     [],
    # Pending incoming pairing requests waiting for user approval:
    # [{peer_id, name, ip, code, expires_ts}]
    "lan_pending_pairings":  [],

    # Plugin system — plugins run with full Python privileges so they're
    # disabled by default. User must explicitly enable each one in Settings.
    "plugins_enabled":       [],   # list of plugin names (folder names) currently enabled
}


class SettingsManager:
    def __init__(self):
        self.data = dict(DEFAULT_SETTINGS)
        self.load()

    def load(self):
        try:
            if SETTINGS_PATH.exists():
                loaded = json.loads(SETTINGS_PATH.read_text())
                for k, v in DEFAULT_SETTINGS.items():
                    self.data[k] = loaded.get(k, v)
        except Exception:
            self.data = dict(DEFAULT_SETTINGS)

    def save(self):
        try:
            SETTINGS_PATH.write_text(json.dumps(self.data, indent=2))
        except Exception:
            pass

    def get(self, key, default=None):
        # Fall back to DEFAULT_SETTINGS first, then to the caller's default.
        # This preserves existing single-arg behavior (where default=None and
        # DEFAULT_SETTINGS handles the fallback) while supporting the natural
        # dict.get(key, default) pattern that callers expect.
        if key in self.data:
            return self.data[key]
        if key in DEFAULT_SETTINGS:
            return DEFAULT_SETTINGS[key]
        return default

    def set(self, key, value):
        self.data[key] = value
        self.save()


# ============================================================
# Sound
# ============================================================

_sound_enabled = True


def set_sound_enabled(on: bool):
    global _sound_enabled
    _sound_enabled = on


def play_tones(*notes):
    if not HAS_WINSOUND or not _sound_enabled:
        return
    def _run():
        try:
            for freq, dur in notes:
                winsound.Beep(int(freq), int(dur))
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


# ============================================================
# FilterConfig
# ============================================================

@dataclass
class FilterConfig:
    target_pids: set = field(default_factory=set)
    target_name: str = ""
    target_names: list = field(default_factory=list)   # multi-target: list of names

    lag_on: bool = False
    lag_inbound: bool = True
    lag_outbound: bool = True
    lag_ms: int = 500
    lag_jitter_ms: int = 0

    drop_on: bool = False
    drop_inbound: bool = True
    drop_outbound: bool = True
    drop_chance: int = 60
    drop_dns_only: bool = False                          # only drop port-53 packets

    throttle_on: bool = False
    throttle_inbound: bool = True
    throttle_outbound: bool = True
    throttle_kbps: int = 100

    freeze_on: bool = False
    freeze_inbound: bool = True
    freeze_outbound: bool = True
    freeze_replay_ms: int = 0

    block_on: bool = False
    block_inbound: bool = True
    block_outbound: bool = True

    fun_mode: bool = False
    fun_intensity: int = 50

    packets_seen: int = 0
    packets_dropped: int = 0
    packets_delayed: int = 0
    packets_held: int = 0
    bytes_seen: int = 0

    # ===== Phase 2 fields =====
    # Domain blocklist (a Block-Domain function alongside the existing 6)
    domain_block_on: bool = False
    domain_block_lists: list = field(default_factory=list)   # ["ads","trackers","telemetry"]
    domain_block_custom: list = field(default_factory=list)  # user-added domain strings
    # Geo blocking
    geo_block_on: bool = False
    geo_block_countries: list = field(default_factory=list)  # ["RU","CN",...]
    # Practice ping (just a wrapper around lag — no separate filter, but tracked
    # so the UI knows we're in "practice ping" mode for display purposes)
    practice_ping_on: bool = False
    practice_ping_target_ms: int = 0

    # ===== Phase 3 fields =====
    # Filter scripting — applied as a custom drop rule. Empty = disabled.
    script_source: str = ""
    script_action: str = "drop"      # "drop" | "keep_only" | "lag" | "log"
    script_on: bool = False


@dataclass
class ConnectionInfo:
    """Rich per-connection tracking — populated by the FLOW-layer listener
    and updated by the capture loop with byte counts. Surfaced to the UI
    via the Connection Inspector."""
    pid: int = 0
    proto: str = ""                  # "TCP" | "UDP"
    local_addr: str = ""
    local_port: int = 0
    remote_addr: str = ""
    remote_port: int = 0
    bytes_in: int = 0
    bytes_out: int = 0
    packets_in: int = 0
    packets_out: int = 0
    established_at: float = 0.0      # monotonic time
    last_seen: float = 0.0
    hostname: str = ""               # SNI from TLS ClientHello if available
    country: str = ""                # 2-letter ISO code from geo lookup


# ============================================================
# Phase 2 — domain blocklist data
# ============================================================

# Compact built-in blocklists. Each is a tuple of suffix patterns —
# matched via endswith() against an SNI/hostname. Keeps things fast and
# avoids regex overhead in the capture path.
BUILTIN_BLOCKLISTS = {
    "ads": (
        "doubleclick.net", "googleadservices.com", "googlesyndication.com",
        "adservice.google.com", "ads.yahoo.com", "advertising.com",
        "adnxs.com", "amazon-adsystem.com", "rubiconproject.com",
        "criteo.com", "criteo.net", "pubmatic.com", "openx.net",
        "moatads.com", "adsafeprotected.com", "scorecardresearch.com",
        "outbrain.com", "taboola.com", "media.net",
        "yieldlab.net", "yieldmo.com", "smartadserver.com",
    ),
    "trackers": (
        "google-analytics.com", "googletagmanager.com", "googletagservices.com",
        "facebook.com", "fb.com", "fbcdn.net", "connect.facebook.net",
        "hotjar.com", "mixpanel.com", "segment.io", "segment.com",
        "amplitude.com", "fullstory.com", "newrelic.com",
        "branch.io", "appsflyer.com", "adjust.com", "kochava.com",
        "chartbeat.com", "quantserve.com", "comscore.com",
        "matomo.org", "yandex.ru", "yandex.com",
    ),
    "telemetry": (
        "telemetry.microsoft.com", "vortex.data.microsoft.com",
        "events.data.microsoft.com", "settings-win.data.microsoft.com",
        "watson.telemetry.microsoft.com", "watson.microsoft.com",
        "incoming.telemetry.mozilla.org", "telemetry.mozilla.org",
        "metrics.icloud.com", "telemetry.dropbox.com",
        "stats.g.doubleclick.net", "ssl.google-analytics.com",
        "browser.events.data.msn.com",
    ),
}


# ============================================================
# Phase 2 — minimal embedded country IPv4 ranges for geo blocking.
# This is a coarse approximation — covers the most common ~30 countries
# at the /16 or /8 level. For finer-grained accuracy, users can drop a
# GeoLite2-Country.mmdb at ~/.throttlr/geoip.mmdb and we'll use that.
# Source: aggregated public RIR (ARIN/RIPE/APNIC/AFRINIC/LACNIC) data.
# Stored as a list of (cidr, cc) tuples; loaded once at module import.
# ============================================================
_GEO_RANGES_RAW = """\
1.0.0.0/8 US
2.0.0.0/8 EU
3.0.0.0/8 US
4.0.0.0/8 US
5.0.0.0/8 EU
6.0.0.0/8 US
7.0.0.0/8 US
8.0.0.0/8 US
9.0.0.0/8 US
11.0.0.0/8 US
12.0.0.0/8 US
13.0.0.0/8 US
14.0.0.0/8 AP
15.0.0.0/8 US
16.0.0.0/8 US
17.0.0.0/8 US
18.0.0.0/8 US
19.0.0.0/8 US
20.0.0.0/8 US
21.0.0.0/8 US
22.0.0.0/8 US
23.0.0.0/8 US
24.0.0.0/8 US
25.0.0.0/8 GB
26.0.0.0/8 US
27.0.0.0/8 AP
28.0.0.0/8 US
29.0.0.0/8 US
30.0.0.0/8 US
31.0.0.0/8 EU
32.0.0.0/8 US
33.0.0.0/8 US
34.0.0.0/8 US
35.0.0.0/8 US
36.0.0.0/8 AP
37.0.0.0/8 EU
38.0.0.0/8 US
39.0.0.0/8 CN
40.0.0.0/8 US
41.0.0.0/8 AF
42.0.0.0/8 AP
43.0.0.0/8 AP
44.0.0.0/8 US
45.0.0.0/8 US
46.0.0.0/8 EU
47.0.0.0/8 CA
48.0.0.0/8 US
49.0.0.0/8 AP
50.0.0.0/8 US
51.0.0.0/8 EU
52.0.0.0/8 US
53.0.0.0/8 DE
54.0.0.0/8 US
55.0.0.0/8 US
56.0.0.0/8 US
57.0.0.0/8 EU
58.0.0.0/8 AP
59.0.0.0/8 AP
60.0.0.0/8 AP
61.0.0.0/8 AP
62.0.0.0/8 EU
63.0.0.0/8 US
64.0.0.0/8 US
65.0.0.0/8 US
66.0.0.0/8 US
67.0.0.0/8 US
68.0.0.0/8 US
69.0.0.0/8 US
70.0.0.0/8 US
71.0.0.0/8 US
72.0.0.0/8 US
73.0.0.0/8 US
74.0.0.0/8 US
75.0.0.0/8 US
76.0.0.0/8 US
77.0.0.0/8 EU
78.0.0.0/8 EU
79.0.0.0/8 EU
80.0.0.0/8 EU
81.0.0.0/8 EU
82.0.0.0/8 EU
83.0.0.0/8 EU
84.0.0.0/8 EU
85.0.0.0/8 EU
86.0.0.0/8 EU
87.0.0.0/8 EU
88.0.0.0/8 EU
89.0.0.0/8 EU
90.0.0.0/8 EU
91.0.0.0/8 EU
92.0.0.0/8 EU
93.0.0.0/8 EU
94.0.0.0/8 EU
95.0.0.0/8 EU
96.0.0.0/8 US
97.0.0.0/8 US
98.0.0.0/8 US
99.0.0.0/8 US
100.0.0.0/8 US
101.0.0.0/8 AP
102.0.0.0/8 AF
103.0.0.0/8 AP
104.0.0.0/8 US
105.0.0.0/8 AF
106.0.0.0/8 AP
107.0.0.0/8 US
108.0.0.0/8 US
109.0.0.0/8 EU
110.0.0.0/8 AP
111.0.0.0/8 AP
112.0.0.0/8 AP
113.0.0.0/8 AP
114.0.0.0/8 AP
115.0.0.0/8 AP
116.0.0.0/8 AP
117.0.0.0/8 AP
118.0.0.0/8 AP
119.0.0.0/8 AP
120.0.0.0/8 AP
121.0.0.0/8 AP
122.0.0.0/8 AP
123.0.0.0/8 AP
124.0.0.0/8 AP
125.0.0.0/8 AP
126.0.0.0/8 JP
128.0.0.0/8 US
129.0.0.0/8 US
130.0.0.0/8 US
131.0.0.0/8 US
132.0.0.0/8 US
133.0.0.0/8 JP
134.0.0.0/8 US
135.0.0.0/8 US
136.0.0.0/8 US
137.0.0.0/8 US
138.0.0.0/8 US
139.0.0.0/8 US
140.0.0.0/8 US
141.0.0.0/8 EU
142.0.0.0/8 CA
143.0.0.0/8 US
144.0.0.0/8 US
145.0.0.0/8 EU
146.0.0.0/8 US
147.0.0.0/8 US
148.0.0.0/8 US
149.0.0.0/8 US
150.0.0.0/8 AP
151.0.0.0/8 EU
152.0.0.0/8 US
153.0.0.0/8 JP
154.0.0.0/8 US
155.0.0.0/8 US
156.0.0.0/8 US
157.0.0.0/8 US
158.0.0.0/8 US
159.0.0.0/8 US
160.0.0.0/8 US
161.0.0.0/8 US
162.0.0.0/8 US
163.0.0.0/8 AP
164.0.0.0/8 US
165.0.0.0/8 US
166.0.0.0/8 US
167.0.0.0/8 US
168.0.0.0/8 US
169.0.0.0/8 US
170.0.0.0/8 US
171.0.0.0/8 AP
172.0.0.0/8 US
173.0.0.0/8 US
174.0.0.0/8 US
175.0.0.0/8 AP
176.0.0.0/8 EU
177.0.0.0/8 BR
178.0.0.0/8 EU
179.0.0.0/8 BR
180.0.0.0/8 AP
181.0.0.0/8 LATAM
182.0.0.0/8 AP
183.0.0.0/8 AP
184.0.0.0/8 US
185.0.0.0/8 EU
186.0.0.0/8 LATAM
187.0.0.0/8 BR
188.0.0.0/8 EU
189.0.0.0/8 BR
190.0.0.0/8 LATAM
191.0.0.0/8 BR
192.0.0.0/8 US
193.0.0.0/8 EU
194.0.0.0/8 EU
195.0.0.0/8 EU
196.0.0.0/8 AF
197.0.0.0/8 AF
198.0.0.0/8 US
199.0.0.0/8 US
200.0.0.0/8 LATAM
201.0.0.0/8 LATAM
202.0.0.0/8 AP
203.0.0.0/8 AP
204.0.0.0/8 US
205.0.0.0/8 US
206.0.0.0/8 US
207.0.0.0/8 US
208.0.0.0/8 US
209.0.0.0/8 US
210.0.0.0/8 AP
211.0.0.0/8 AP
212.0.0.0/8 EU
213.0.0.0/8 EU
214.0.0.0/8 US
215.0.0.0/8 US
216.0.0.0/8 US
217.0.0.0/8 EU
218.0.0.0/8 AP
219.0.0.0/8 AP
220.0.0.0/8 AP
221.0.0.0/8 AP
222.0.0.0/8 AP
223.0.0.0/8 AP
"""

# Parse on import — fast lookup table indexed by first octet
_GEO_TABLE = {}
def _build_geo_table():
    for line in _GEO_RANGES_RAW.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            cidr, cc = line.split()
            first_octet = int(cidr.split('.')[0])
            _GEO_TABLE[first_octet] = cc
        except Exception:
            continue
_build_geo_table()

def lookup_country(ip_str: str) -> str:
    """Return ISO country code or region marker. Falls back to 'XX' on
    unknown. The bundled table is /8-granularity — adequate for blocking
    at the regional level. For finer accuracy users can drop a real
    GeoLite2-Country.mmdb at ~/.throttlr/geoip.mmdb."""
    try:
        first = int(ip_str.split('.')[0])
        return _GEO_TABLE.get(first, "XX")
    except Exception:
        return "XX"


# ============================================================
# Phase 2 — TLS SNI parser (extracts hostname from ClientHello)
# ============================================================

def parse_sni(payload: bytes) -> str:
    """Extract Server Name Indication from a TLS ClientHello.
    Returns the hostname or '' if not parseable. Strict, fast parser —
    bails out on any unexpected byte. Spec: RFC 6066 §3."""
    try:
        # TLS record header: type(1) + ver(2) + len(2)
        if len(payload) < 5:
            return ""
        if payload[0] != 0x16:               # 0x16 = handshake
            return ""
        # TLS handshake: msg_type(1) + len(3) + version(2) + random(32) +
        # session_id_len(1) + session_id(...) + cipher_suites_len(2) +
        # cipher_suites + compression_len(1) + compression + ext_len(2) + extensions
        if len(payload) < 43:
            return ""
        if payload[5] != 0x01:               # 0x01 = ClientHello
            return ""
        idx = 5 + 4 + 2 + 32                 # skip msg_type+len+version+random
        sess_id_len = payload[idx]; idx += 1 + sess_id_len
        if idx + 2 > len(payload):
            return ""
        cs_len = (payload[idx] << 8) | payload[idx + 1]
        idx += 2 + cs_len
        if idx + 1 > len(payload):
            return ""
        comp_len = payload[idx]; idx += 1 + comp_len
        if idx + 2 > len(payload):
            return ""
        ext_total = (payload[idx] << 8) | payload[idx + 1]
        idx += 2
        ext_end = idx + ext_total
        while idx + 4 <= ext_end:
            ext_type = (payload[idx] << 8) | payload[idx + 1]
            ext_len = (payload[idx + 2] << 8) | payload[idx + 3]
            idx += 4
            if ext_type == 0x00:             # SNI
                # SNI inner: list_len(2) + name_type(1) + name_len(2) + name
                if idx + 5 > len(payload):
                    return ""
                # list_len = (payload[idx] << 8) | payload[idx + 1]
                name_type = payload[idx + 2]
                if name_type != 0x00:
                    return ""
                name_len = (payload[idx + 3] << 8) | payload[idx + 4]
                if idx + 5 + name_len > len(payload):
                    return ""
                return payload[idx + 5: idx + 5 + name_len].decode('ascii', errors='replace')
            idx += ext_len
        return ""
    except Exception:
        return ""


def host_in_blocklists(host: str, lists: list, custom: list) -> bool:
    """Return True if hostname matches any active built-in or user list."""
    if not host:
        return False
    h = host.lower()
    for name in lists:
        for suffix in BUILTIN_BLOCKLISTS.get(name, ()):
            if h == suffix or h.endswith("." + suffix):
                return True
    for entry in custom:
        e = (entry or "").strip().lower().lstrip(".")
        if not e:
            continue
        if h == e or h.endswith("." + e):
            return True
    return False


# ============================================================
# Hotkeys
# ============================================================

class _LowLevelKeyboardHook(QObject):
    """v3.0.4 — System-wide low-level keyboard hook. Replaces the old
    RegisterHotKey-based GlobalHotkey class which had a real issue:
    RegisterHotKey silently fails (returns 0) when ANY other app has already
    registered the same key globally — Discord overlay, OBS, Steam, NVIDIA
    GeForce Experience, screen recorders, the game itself. Result: user
    presses F5 to start Throttlr, the OTHER app eats the key, Throttlr
    never sees it. They have to alt-tab and click the button manually.

    Low-level hooks intercept ALL keyboard input system-wide BEFORE any
    app processes it, completely bypassing the hotkey-conflict issue. This
    is what gaming overlays, screen recorders, and accessibility tools use.

    Single shared hook serves ALL hotkeys via a vk_code → callback dict.
    Hook callback never blocks the keypress (returns CallNextHookEx) so
    games still see the key normally — Throttlr just observes it.
    """

    keyPressed = Signal(int)   # emits vk_code on keydown for registered VKs

    # Win32 constants
    WH_KEYBOARD_LL = 13
    WM_KEYDOWN     = 0x0100
    WM_SYSKEYDOWN  = 0x0104
    HC_ACTION      = 0

    class _KBDLLHOOKSTRUCT(ctypes.Structure):
        _fields_ = [
            ('vkCode',      wintypes.DWORD),
            ('scanCode',    wintypes.DWORD),
            ('flags',       wintypes.DWORD),
            ('time',        wintypes.DWORD),
            ('dwExtraInfo', ctypes.c_void_p),
        ]

    def __init__(self):
        super().__init__()
        self._registered_vks = set()
        self._hook_handle = None
        self._thread = None
        self._stop = threading.Event()
        self._proc = None        # KEEP REFERENCE — GC'd callbacks crash ctypes
        self._lock = threading.RLock()

    def register_vk(self, vk_code: int):
        """Add a VK code to monitor. Calling this before start() is fine."""
        with self._lock:
            self._registered_vks.add(int(vk_code))

    def unregister_vk(self, vk_code: int):
        with self._lock:
            self._registered_vks.discard(int(vk_code))

    def clear(self):
        with self._lock:
            self._registered_vks.clear()

    def start(self):
        if self._thread is not None:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True,
                                        name="ThrottlrKBHook")
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _run(self):
        try:
            user32   = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32

            HOOKPROC = ctypes.WINFUNCTYPE(
                ctypes.c_long, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)

            def hook_proc(nCode, wParam, lParam):
                try:
                    if nCode == self.HC_ACTION and wParam in (self.WM_KEYDOWN, self.WM_SYSKEYDOWN):
                        kbd = ctypes.cast(
                            lParam,
                            ctypes.POINTER(self._KBDLLHOOKSTRUCT)).contents
                        vk = int(kbd.vkCode)
                        with self._lock:
                            registered = vk in self._registered_vks
                        if registered:
                            # Emit cross-thread; Qt queues to main thread.
                            self.keyPressed.emit(vk)
                except Exception:
                    pass
                # Always pass through — never block the key
                return user32.CallNextHookEx(None, nCode, wParam, lParam)

            self._proc = HOOKPROC(hook_proc)

            # Set return type and arg types for SetWindowsHookExW
            user32.SetWindowsHookExW.restype = wintypes.HHOOK
            user32.SetWindowsHookExW.argtypes = [
                ctypes.c_int, HOOKPROC, wintypes.HMODULE, wintypes.DWORD]

            self._hook_handle = user32.SetWindowsHookExW(
                self.WH_KEYBOARD_LL,
                self._proc,
                kernel32.GetModuleHandleW(None),
                0)

            if not self._hook_handle:
                # Hook install failed — extremely rare on Windows 7+. We
                # silently bail; the app still functions, hotkeys just won't.
                return

            # Pump messages — required for the hook callback to fire.
            msg = wintypes.MSG()
            while not self._stop.is_set():
                # PM_REMOVE = 1
                if user32.PeekMessageW(ctypes.byref(msg), 0, 0, 0, 1):
                    user32.TranslateMessage(ctypes.byref(msg))
                    user32.DispatchMessageW(ctypes.byref(msg))
                else:
                    # Tight loop would burn CPU; this stays under 1% load
                    time.sleep(0.005)

            user32.UnhookWindowsHookEx(self._hook_handle)
            self._hook_handle = None
        except Exception:
            pass


# Singleton — created on first GlobalHotkey() so we share one hook for all keys.
_KB_HOOK_SINGLETON = None
_KB_HOOK_LOCK      = threading.Lock()


def _get_kb_hook():
    global _KB_HOOK_SINGLETON
    if _KB_HOOK_SINGLETON is None:
        with _KB_HOOK_LOCK:
            if _KB_HOOK_SINGLETON is None:
                _KB_HOOK_SINGLETON = _LowLevelKeyboardHook()
                _KB_HOOK_SINGLETON.start()
    return _KB_HOOK_SINGLETON


# Map vk_code → list of GlobalHotkey instances listening to it
_HOTKEY_DISPATCH = {}
_HOTKEY_DISPATCH_LOCK = threading.RLock()


def _on_kb_hook_press(vk: int):
    """Routes a hooked keypress to all GlobalHotkey instances bound to it."""
    with _HOTKEY_DISPATCH_LOCK:
        listeners = list(_HOTKEY_DISPATCH.get(vk, []))
    for hk in listeners:
        try:
            hk.pressed.emit()
        except Exception:
            pass


class GlobalHotkey(QObject):
    """Public API matches the old class — one instance per registered hotkey.
    Internally backed by the shared low-level keyboard hook."""

    pressed = Signal()

    def __init__(self, vk_code: int, hotkey_id: int):
        super().__init__()
        self.vk_code = int(vk_code)
        self.hotkey_id = hotkey_id   # legacy; kept for API compatibility
        self.registered = False

    def start(self):
        # Lazy-init the shared hook, register this VK, route this VK to us
        hook = _get_kb_hook()
        # Connect dispatcher once (idempotent — Qt's connect is unique-id'd
        # by sender/signal/slot but we use a flag to be sure)
        global _HOTKEY_DISPATCH_CONNECTED
        try:
            already = _HOTKEY_DISPATCH_CONNECTED  # noqa
        except NameError:
            hook.keyPressed.connect(_on_kb_hook_press, Qt.QueuedConnection)
            globals()['_HOTKEY_DISPATCH_CONNECTED'] = True

        with _HOTKEY_DISPATCH_LOCK:
            _HOTKEY_DISPATCH.setdefault(self.vk_code, []).append(self)
        hook.register_vk(self.vk_code)
        self.registered = True

    def stop(self):
        try:
            with _HOTKEY_DISPATCH_LOCK:
                lst = _HOTKEY_DISPATCH.get(self.vk_code, [])
                if self in lst:
                    lst.remove(self)
                # If no one else is listening to this VK, unregister it from
                # the hook (small optimization — fewer dict lookups per keypress)
                if not lst:
                    _HOTKEY_DISPATCH.pop(self.vk_code, None)
                    if _KB_HOOK_SINGLETON is not None:
                        _KB_HOOK_SINGLETON.unregister_vk(self.vk_code)
        except Exception:
            pass
        self.registered = False


# ============================================================
# NetworkController
# ============================================================

class NetworkController(QObject):
    status_changed = Signal(str)
    error_occurred = Signal(str)

    def __init__(self):
        super().__init__()
        self.config = FilterConfig()
        self.config_lock = threading.RLock()

        self.conn_map: dict = {}
        self.conn_lock = threading.RLock()
        # Phase 2 — richer per-connection tracking for the Connection
        # Inspector and the SNI/geo/blocklist filters. Keyed by local_port.
        # Populated by the FLOW-layer listener (real-time kernel events) and
        # decorated by the capture loop with byte counts and SNI hostnames.
        self.connection_table: dict = {}     # local_port -> ConnectionInfo

        self.delay_queue: list = []
        self.delay_lock = threading.Lock()
        self.delay_seq = 0

        self.freeze_queue: deque = deque()
        self.freeze_lock = threading.Lock()
        self.freeze_started_at: float = 0.0

        self.throttle_tokens_in = 0.0
        self.throttle_tokens_out = 0.0
        self.throttle_last_ts = time.monotonic()
        self.throttle_lock = threading.Lock()

        self.bw_history_in = deque(maxlen=60)
        self.bw_history_out = deque(maxlen=60)
        self.bw_current_in = 0
        self.bw_current_out = 0
        self.bw_window_start = time.monotonic()

        self.running = False
        self.windivert = None
        self.flow_handle = None    # FLOW-layer handle for kernel-level PID resolution
        self._pass_through = False  # while True, capture loop just relays packets without filtering

        # Phase 3 — PCAP writer + compiled filter script
        self.pcap_writer = PcapWriter()
        self.filter_script = None   # None or FilterScript instance

    def update_config(self, cfg: FilterConfig):
        with self.config_lock:
            was_frozen = self.config.freeze_on
            cfg.packets_seen = self.config.packets_seen
            cfg.packets_dropped = self.config.packets_dropped
            cfg.packets_delayed = self.config.packets_delayed
            cfg.packets_held = self.config.packets_held
            cfg.bytes_seen = self.config.bytes_seen
            self.config = cfg
            if cfg.freeze_on and not was_frozen:
                self.freeze_started_at = time.monotonic()
            elif not cfg.freeze_on and was_frozen:
                self.freeze_started_at = 0.0

    def reset_stats(self):
        with self.config_lock:
            self.config.packets_seen = 0
            self.config.packets_dropped = 0
            self.config.packets_delayed = 0
            self.config.bytes_seen = 0
        self.bw_history_in.clear()
        self.bw_history_out.clear()
        self.bw_current_in = 0
        self.bw_current_out = 0

    def clear_freeze_queue(self):
        with self.freeze_lock:
            n = len(self.freeze_queue)
            self.freeze_queue.clear()
        with self.config_lock:
            self.config.packets_held = 0
        return n

    def get_stats(self):
        with self.config_lock:
            duration = 0.0
            if self.config.freeze_on and self.freeze_started_at:
                duration = time.monotonic() - self.freeze_started_at
            return (
                self.config.packets_seen,
                self.config.packets_dropped,
                self.config.packets_delayed,
                self.config.packets_held,
                self.config.bytes_seen,
                self.config.freeze_on,
                duration,
            )

    def get_bandwidth_history(self):
        return list(self.bw_history_in), list(self.bw_history_out)

    def start(self):
        if self.running:
            return
        if not HAS_PYDIVERT:
            self.error_occurred.emit(f"pydivert not available: {PYDIVERT_ERROR}")
            return
        try:
            self.windivert = pydivert.WinDivert("tcp or udp")
            self.windivert.open()
            self.running = True
        except Exception as e:
            self.error_occurred.emit(
                f"Could not open WinDivert: {e}\n\n"
                "Make sure you're running as Administrator."
            )
            self.running = False
            return

        threading.Thread(target=self._capture_loop, daemon=True).start()
        threading.Thread(target=self._delay_drain_loop, daemon=True).start()
        threading.Thread(target=self._freeze_drain_loop, daemon=True).start()
        threading.Thread(target=self._conn_refresh_loop, daemon=True).start()
        # Open a second WinDivert handle on the FLOW layer to receive
        # connection-open/close events with ProcessId already attached at
        # the kernel level. This is dramatically more reliable than polling
        # psutil for the port→PID mapping, especially for short-lived UDP
        # flows (Discord voice, game traffic, etc.) that psutil can miss
        # entirely.
        self._start_flow_listener()
        self.status_changed.emit("running")

    def _start_flow_listener(self):
        """Open a SNIFF-mode WinDivert handle on the FLOW layer and start
        a thread that reads connection events into self.conn_map.
        Falls back silently if the FLOW layer is unavailable — the psutil-
        based refresh loop still runs as a backup."""
        try:
            import pydivert
            self.flow_handle = pydivert.WinDivert(
                "true",
                layer=pydivert.Layer.FLOW,
                flags=pydivert.Flag.SNIFF | pydivert.Flag.RECV_ONLY,
            )
            self.flow_handle.open()
            threading.Thread(target=self._flow_listen_loop, daemon=True).start()
        except Exception:
            # FLOW layer not supported / driver too old / something else —
            # fall back to psutil polling alone.
            self.flow_handle = None

    def _flow_listen_loop(self):
        """Read connection events as fast as the kernel emits them and
        populate both the lightweight conn_map (local_port → PID) and the
        richer connection_table (local_port → ConnectionInfo). Runs until
        self.running flips false or the handle is closed."""
        EVT_FLOW_ESTABLISHED = 1
        EVT_FLOW_DELETED     = 2
        while self.running and self.flow_handle is not None:
            try:
                pkt = self.flow_handle.recv()
            except Exception:
                break
            try:
                f = pkt.flow
                if f is None:
                    continue
                local_port = int(f.LocalPort)
                pid = int(f.ProcessId)
                evt = int(pkt.event)
                remote_port = int(f.RemotePort)
                proto_num = int(f.Protocol)
                # Convert the IPv6-mapped IPv4 stored in LocalAddr/RemoteAddr.
                # WinDivert stores IPv4 in [3] of the c_uint32 array in
                # *host* byte order, with [0..2] zero or 0xffff.
                la = int(f.LocalAddr[3])
                ra = int(f.RemoteAddr[3])
                local_addr = (f"{(la >> 24) & 0xff}.{(la >> 16) & 0xff}."
                              f"{(la >> 8) & 0xff}.{la & 0xff}") if la else ""
                remote_addr = (f"{(ra >> 24) & 0xff}.{(ra >> 16) & 0xff}."
                               f"{(ra >> 8) & 0xff}.{ra & 0xff}") if ra else ""
            except Exception:
                continue
            if pid <= 0 or local_port == 0:
                continue
            now = time.monotonic()
            proto_str = {6: "TCP", 17: "UDP"}.get(proto_num, str(proto_num))
            with self.conn_lock:
                if evt == EVT_FLOW_ESTABLISHED:
                    self.conn_map[local_port] = pid
                    info = ConnectionInfo(
                        pid=pid, proto=proto_str,
                        local_addr=local_addr, local_port=local_port,
                        remote_addr=remote_addr, remote_port=remote_port,
                        established_at=now, last_seen=now,
                    )
                    # Resolve country lazily — geo lookup is cheap
                    if remote_addr:
                        info.country = lookup_country(remote_addr)
                    self.connection_table[local_port] = info
                elif evt == EVT_FLOW_DELETED:
                    if self.conn_map.get(local_port) == pid:
                        self.conn_map.pop(local_port, None)
                    # Keep ConnectionInfo around for ~30s after close so the
                    # Inspector can still show the most-recently-closed flows.
                    info = self.connection_table.get(local_port)
                    if info and info.pid == pid:
                        info.last_seen = now
                        # Mark for cleanup later; capture_loop trims old entries
        try:
            if self.flow_handle:
                self.flow_handle.close()
        except Exception:
            pass
        self.flow_handle = None

    def stop(self):
        """Stop the capture. If the freeze queue still has held packets,
        drain them first (replay them out) and finalize the stop only when
        the queue is empty. The user expects this — that's the whole point
        of freeze: hold packets, then release them on demand.

        Pressing stop a second time during the drain force-quits."""
        if self._pass_through:
            # Already in drain mode and user hit stop again → cancel drain,
            # discard remaining packets, finalize immediately.
            self._finalize_stop()
            return

        with self.freeze_lock:
            queued = len(self.freeze_queue)

        if queued > 0:
            # Enter "draining for stop" mode.
            self._pass_through = True
            with self.config_lock:
                self.config.freeze_on = False
            threading.Thread(target=self._watch_drain_then_finalize,
                             daemon=True).start()
        else:
            self._finalize_stop()

    def _watch_drain_then_finalize(self):
        """Background watcher: waits for the freeze queue to drain to zero,
        then triggers the real shutdown."""
        # Hard timeout safety: if drain doesn't finish in 60s (e.g. user set
        # 2000ms replay with 100k packets in queue), force-stop anyway.
        deadline = time.monotonic() + 60.0
        while time.monotonic() < deadline:
            with self.freeze_lock:
                qlen = len(self.freeze_queue)
            if qlen == 0:
                break
            time.sleep(0.05)
        self._finalize_stop()

    def _finalize_stop(self):
        """The actual shutdown. Closes WinDivert handles, clears state,
        emits the stopped signal."""
        self.running = False
        self._pass_through = False
        try:
            if self.windivert:
                self.windivert.close()
        except Exception:
            pass
        self.windivert = None
        try:
            if self.flow_handle:
                self.flow_handle.close()
        except Exception:
            pass
        self.flow_handle = None
        # Phase 3: finalize PCAP recording if active
        try:
            if self.pcap_writer.recording:
                self.pcap_writer.stop()
        except Exception:
            pass
        with self.conn_lock:
            self.conn_map.clear()
            self.connection_table.clear()
        with self.delay_lock:
            self.delay_queue = []
            self.delay_seq = 0
        with self.freeze_lock:
            self.freeze_queue.clear()
        with self.config_lock:
            self.config.packets_held = 0
        self.status_changed.emit("stopped")

    def _conn_refresh_loop(self):
        tick = 0
        while self.running:
            try:
                self._refresh_conn_map()
            except Exception:
                pass
            tick += 1
            if tick % 2 == 0:
                try:
                    self._refresh_target_pids()
                except Exception:
                    pass
            # Every 10 ticks (~5s) trim stale connections from the table
            if tick % 10 == 0:
                try:
                    self._trim_connection_table()
                except Exception:
                    pass
            time.sleep(0.5)

    def _refresh_target_pids(self):
        """Re-resolve target_pids from the saved target_names. Walks the
        process tree to include child processes (Discord helpers, Chrome
        renderers, anti-cheat sub-processes, etc.) so the entire app family
        gets filtered, not just the parent.

        Honors target_names (multi-target). Falls back to target_name for
        legacy single-target behavior."""
        with self.config_lock:
            names = list(self.config.target_names)
            if not names and self.config.target_name:
                names = [self.config.target_name]
        if not names:
            return

        name_set = set(names)

        # First pass: find every top-level PID whose process name matches ANY
        # of the targets.
        root_pids = set()
        try:
            for proc in psutil.process_iter(['pid', 'name']):
                try:
                    if proc.info['name'] in name_set:
                        root_pids.add(proc.info['pid'])
                except Exception:
                    continue
        except Exception:
            return
        if not root_pids:
            return

        # Second pass: walk descendants of each root PID
        all_pids = set(root_pids)
        try:
            for root_pid in list(root_pids):
                try:
                    p = psutil.Process(root_pid)
                    for child in p.children(recursive=True):
                        try:
                            all_pids.add(child.pid)
                        except Exception:
                            continue
                except Exception:
                    continue
        except Exception:
            pass

        with self.config_lock:
            self.config.target_pids = all_pids

    def _refresh_conn_map(self):
        """psutil-polling fallback. The FLOW-layer listener is the primary
        source for the conn_map; this merges in any additional entries
        psutil knows about, without clobbering FLOW-discovered entries."""
        new_entries = {}
        try:
            for c in psutil.net_connections(kind="inet"):
                if c.pid is None:
                    continue
                if c.laddr:
                    # Key by local port to match the FLOW listener's format
                    new_entries[c.laddr.port] = c.pid
        except (psutil.AccessDenied, PermissionError):
            return
        except Exception:
            return
        # Merge: don't overwrite entries the FLOW listener has already
        # populated — those are from real kernel events and are more
        # reliable than the psutil snapshot.
        with self.conn_lock:
            for port, pid in new_entries.items():
                self.conn_map.setdefault(port, pid)

    def _packet_pid(self, pkt) -> int:
        """Resolve a packet's owning PID via the conn_map. The map is
        primarily fed by the FLOW-layer listener (kernel-level events with
        ProcessId), with a psutil-polling fallback. We key by local port —
        for outbound packets that's the source port, for inbound it's the
        destination port."""
        try:
            with self.conn_lock:
                cm = self.conn_map
            try:
                port = pkt.src_port if pkt.is_outbound else pkt.dst_port
            except Exception:
                return 0
            return cm.get(port, 0)
        except Exception:
            return 0

    def _matches_target(self, pkt) -> bool:
        with self.config_lock:
            tpids = set(self.config.target_pids)
        if not tpids:
            return False
        return self._packet_pid(pkt) in tpids

    def _direction_allowed(self, pkt, in_flag, out_flag) -> bool:
        try:
            return out_flag if pkt.is_outbound else in_flag
        except Exception:
            return False

    def _capture_loop(self):
        try:
            while self.running and self.windivert:
                try:
                    pkt = self.windivert.recv()
                except Exception:
                    if not self.running:
                        break
                    continue

                # During the post-stop drain, capture loop becomes a pure
                # relay — no PID matching, no filtering, no stat updates.
                # The drain loop is responsible for replaying the held
                # queue out to the network during this phase.
                if self._pass_through:
                    try:
                        self.windivert.send(pkt)
                    except Exception:
                        pass
                    continue

                if not self._matches_target(pkt):
                    try:
                        self.windivert.send(pkt)
                    except Exception:
                        pass
                    continue

                pkt_size = 0
                try:
                    pkt_size = len(pkt.raw)
                except Exception:
                    pass

                with self.config_lock:
                    self.config.packets_seen += 1
                    self.config.bytes_seen += pkt_size
                    cfg = self.config

                self._track_bandwidth(pkt, pkt_size)

                # === Phase 2: per-connection tracking + SNI parsing ===
                # Update the rich ConnectionInfo for this packet so the
                # Connection Inspector and the Domain/Geo filters have
                # accurate, current data.
                self._track_connection(pkt, pkt_size)

                # === Phase 3: PCAP recording ===
                # Always-on while pcap_writer.recording. We write the raw
                # IP packet bytes; Wireshark / tcpdump can decode this
                # straight away (linktype RAW IPv4).
                try:
                    if self.pcap_writer.recording:
                        self.pcap_writer.write_packet(bytes(pkt.raw))
                except Exception:
                    pass

                # === Phase 3: Filter script ===
                # If a compiled filter script is active and matches this
                # packet, apply the configured action.
                if cfg.script_on and self.filter_script is not None and self.filter_script.compiled:
                    info = self._connection_for(pkt)
                    pv = _PktView(pkt,
                                  hostname=info.hostname if info else "",
                                  country=info.country if info else "")
                    if self.filter_script.matches(pv):
                        action = cfg.script_action
                        if action == "drop":
                            with self.config_lock:
                                self.config.packets_dropped += 1
                            continue
                        elif action == "keep_only":
                            # If it matches, it passes — nothing to do
                            pass
                        # "lag" and "log" actions could be handled here too;
                        # for now they're recognized but treat as drop=False
                    elif cfg.script_action == "keep_only":
                        # In keep_only mode, non-matching packets get dropped
                        with self.config_lock:
                            self.config.packets_dropped += 1
                        continue

                # === Phase 2: Domain blocklist ===
                # Drop packets whose connection has a hostname matching
                # any active blocklist. Uses the SNI captured on TLS
                # ClientHello packets.
                if cfg.domain_block_on:
                    info = self._connection_for(pkt)
                    if info and info.hostname and host_in_blocklists(
                            info.hostname, cfg.domain_block_lists, cfg.domain_block_custom):
                        with self.config_lock:
                            self.config.packets_dropped += 1
                        continue

                # === Phase 2: Geo blocking ===
                if cfg.geo_block_on and cfg.geo_block_countries:
                    info = self._connection_for(pkt)
                    if info and info.country in cfg.geo_block_countries:
                        with self.config_lock:
                            self.config.packets_dropped += 1
                        continue

                if cfg.block_on and self._direction_allowed(pkt, cfg.block_inbound, cfg.block_outbound):
                    with self.config_lock:
                        self.config.packets_dropped += 1
                    continue

                if cfg.freeze_on and self._direction_allowed(pkt, cfg.freeze_inbound, cfg.freeze_outbound):
                    with self.freeze_lock:
                        if len(self.freeze_queue) >= FREEZE_QUEUE_CAP:
                            self.freeze_queue.popleft()
                        self.freeze_queue.append(pkt)
                    with self.config_lock:
                        self.config.packets_held = len(self.freeze_queue)
                    continue

                if cfg.drop_on and self._direction_allowed(pkt, cfg.drop_inbound, cfg.drop_outbound):
                    # Optional "DNS only" sub-filter — only drop packets to/from
                    # port 53 (DNS). Lets the user simulate a broken DNS while
                    # leaving the rest of the connection intact.
                    if cfg.drop_dns_only:
                        try:
                            on_dns = (pkt.src_port == 53 or pkt.dst_port == 53)
                        except Exception:
                            on_dns = False
                        if not on_dns:
                            pass   # not DNS — fall through to other handlers
                        elif random.randint(1, 100) <= cfg.drop_chance:
                            with self.config_lock:
                                self.config.packets_dropped += 1
                            continue
                    elif random.randint(1, 100) <= cfg.drop_chance:
                        with self.config_lock:
                            self.config.packets_dropped += 1
                        continue

                if cfg.fun_mode:
                    if random.randint(0, 100) < cfg.fun_intensity / 4:
                        with self.config_lock:
                            self.config.packets_dropped += 1
                        continue

                if cfg.throttle_on and self._direction_allowed(pkt, cfg.throttle_inbound, cfg.throttle_outbound):
                    if not self._consume_token(pkt, pkt_size, cfg.throttle_kbps):
                        with self.config_lock:
                            self.config.packets_dropped += 1
                        continue

                if cfg.lag_on and self._direction_allowed(pkt, cfg.lag_inbound, cfg.lag_outbound):
                    delay_ms = cfg.lag_ms
                    if cfg.lag_jitter_ms > 0:
                        jitter = random.randint(-cfg.lag_jitter_ms, cfg.lag_jitter_ms)
                        delay_ms = max(0, delay_ms + jitter)
                    if cfg.fun_mode and random.randint(0, 100) < cfg.fun_intensity / 3:
                        delay_ms += random.randint(500, 3000)
                    self._enqueue_delay(pkt, delay_ms)
                    with self.config_lock:
                        self.config.packets_delayed += 1
                    continue

                try:
                    self.windivert.send(pkt)
                except Exception:
                    pass
        except Exception as e:
            if self.running:
                self.error_occurred.emit(f"Capture error: {e}")
            self.running = False

    def _track_bandwidth(self, pkt, size):
        now = time.monotonic()
        is_out = False
        try:
            is_out = bool(pkt.is_outbound)
        except Exception:
            pass
        if is_out:
            self.bw_current_out += size
        else:
            self.bw_current_in += size
        if now - self.bw_window_start >= 1.0:
            self.bw_history_in.append(self.bw_current_in)
            self.bw_history_out.append(self.bw_current_out)
            self.bw_current_in = 0
            self.bw_current_out = 0
            self.bw_window_start = now

    def _connection_for(self, pkt):
        """Return the ConnectionInfo (or None) for this packet, keyed by
        local port — the same key used by conn_map."""
        try:
            port = pkt.src_port if pkt.is_outbound else pkt.dst_port
        except Exception:
            return None
        with self.conn_lock:
            return self.connection_table.get(port)

    def _track_connection(self, pkt, size):
        """Update the ConnectionInfo for this packet — bytes, last_seen,
        and SNI hostname if this is a TLS ClientHello on port 443."""
        try:
            is_out = bool(pkt.is_outbound)
            port = pkt.src_port if is_out else pkt.dst_port
            remote_addr = pkt.dst_addr if is_out else pkt.src_addr
            remote_port = pkt.dst_port if is_out else pkt.src_port
        except Exception:
            return

        now = time.monotonic()
        with self.conn_lock:
            info = self.connection_table.get(port)
            if info is None:
                # Create a stub if we missed the FLOW event (rare, but can happen
                # for connections that pre-existed our handle opening)
                pid = self.conn_map.get(port, 0)
                if pid <= 0:
                    return
                info = ConnectionInfo(
                    pid=pid,
                    proto="TCP" if pkt.tcp else ("UDP" if pkt.udp else ""),
                    local_addr=pkt.src_addr if is_out else pkt.dst_addr,
                    local_port=port,
                    remote_addr=remote_addr,
                    remote_port=remote_port,
                    established_at=now, last_seen=now,
                )
                if remote_addr:
                    info.country = lookup_country(remote_addr)
                self.connection_table[port] = info
            info.last_seen = now
            if is_out:
                info.bytes_out += size
                info.packets_out += 1
            else:
                info.bytes_in += size
                info.packets_in += 1
            # Backfill remote info if we got it later than the FLOW event
            if not info.remote_addr and remote_addr:
                info.remote_addr = remote_addr
                info.remote_port = remote_port
                info.country = lookup_country(remote_addr)

            # SNI parsing — only on outbound TLS handshake to port 443
            if (is_out and not info.hostname and
                    remote_port == 443 and pkt.tcp):
                try:
                    payload = bytes(pkt.tcp.payload) if pkt.tcp.payload else b""
                except Exception:
                    payload = b""
                if payload and len(payload) > 5 and payload[0] == 0x16:
                    host = parse_sni(payload)
                    if host:
                        info.hostname = host

    def _trim_connection_table(self):
        """Remove connections that haven't been seen in the last 60 seconds.
        Called periodically from the conn_refresh_loop."""
        cutoff = time.monotonic() - 60.0
        with self.conn_lock:
            stale = [k for k, v in self.connection_table.items()
                     if v.last_seen < cutoff]
            for k in stale:
                self.connection_table.pop(k, None)

    def _consume_token(self, pkt, size, kbps):
        with self.throttle_lock:
            now = time.monotonic()
            elapsed = now - self.throttle_last_ts
            self.throttle_last_ts = now
            tokens_per_sec = kbps * 1024
            burst_max = tokens_per_sec
            try:
                if pkt.is_outbound:
                    self.throttle_tokens_out = min(burst_max,
                                                   self.throttle_tokens_out + tokens_per_sec * elapsed)
                    if self.throttle_tokens_out >= size:
                        self.throttle_tokens_out -= size
                        try:
                            self.windivert.send(pkt)
                        except Exception:
                            pass
                        return True
                else:
                    self.throttle_tokens_in = min(burst_max,
                                                  self.throttle_tokens_in + tokens_per_sec * elapsed)
                    if self.throttle_tokens_in >= size:
                        self.throttle_tokens_in -= size
                        try:
                            self.windivert.send(pkt)
                        except Exception:
                            pass
                        return True
            except Exception:
                pass
        return False

    def _enqueue_delay(self, pkt, delay_ms):
        deadline = time.monotonic() + (delay_ms / 1000.0)
        with self.delay_lock:
            if len(self.delay_queue) >= DELAY_QUEUE_CAP:
                _, _, oldest = heapq.heappop(self.delay_queue)
                try:
                    if self.windivert:
                        self.windivert.send(oldest)
                except Exception:
                    pass
            heapq.heappush(self.delay_queue, (deadline, self.delay_seq, pkt))
            self.delay_seq += 1

    def _delay_drain_loop(self):
        while self.running:
            now = time.monotonic()
            to_send = []
            with self.delay_lock:
                while self.delay_queue and self.delay_queue[0][0] <= now:
                    _, _, pkt = heapq.heappop(self.delay_queue)
                    to_send.append(pkt)
            for pkt in to_send:
                try:
                    if self.windivert:
                        self.windivert.send(pkt)
                except Exception:
                    pass
            time.sleep(0.005)

    def _freeze_drain_loop(self):
        while self.running:
            with self.config_lock:
                cfg = self.config
            with self.freeze_lock:
                qlen = len(self.freeze_queue)
            if cfg.freeze_on or qlen == 0:
                time.sleep(0.02)
                continue
            replay_ms = cfg.freeze_replay_ms
            with self.freeze_lock:
                if not self.freeze_queue:
                    with self.config_lock:
                        self.config.packets_held = 0
                    continue
                pkt = self.freeze_queue.popleft()
                with self.config_lock:
                    self.config.packets_held = len(self.freeze_queue)
            try:
                if self.windivert:
                    self.windivert.send(pkt)
            except Exception:
                pass
            if replay_ms > 0:
                time.sleep(replay_ms / 1000.0)


# ============================================================
# Process discovery
# ============================================================

def get_visible_window_pids():
    """Return set of PIDs that own at least one visible top-level window with a title.

    Windows-only. Used to distinguish 'open apps' (likely user-facing) from
    'background processes' in the app picker. Returns None on non-Windows
    so callers can degrade gracefully.
    """
    if sys.platform != "win32":
        return None

    try:
        from ctypes import wintypes
        user32 = ctypes.windll.user32
        EnumWindowsProc = ctypes.WINFUNCTYPE(
            wintypes.BOOL, wintypes.HWND, wintypes.LPARAM
        )
        pids = set()

        def cb(hwnd, lparam):
            try:
                if not user32.IsWindowVisible(hwnd):
                    return True
                # Skip windows with no title — most invisible Win32 housekeeping
                # windows fall into this bucket.
                if user32.GetWindowTextLengthW(hwnd) == 0:
                    return True
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value:
                    pids.add(pid.value)
            except Exception:
                pass
            return True

        user32.EnumWindows(EnumWindowsProc(cb), 0)
        return pids
    except Exception:
        return None


def get_process_groups():
    """Return list of {name, pids[], conns, has_window} grouped by process name."""
    groups: dict = defaultdict(lambda: {"pids": set(), "conns": 0})
    try:
        for proc in psutil.process_iter(['pid', 'name']):
            try:
                name = proc.info['name'] or "unknown"
                groups[name]["pids"].add(proc.info['pid'])
            except Exception:
                continue
    except Exception:
        return []

    try:
        for c in psutil.net_connections(kind="inet"):
            if c.pid is None:
                continue
            try:
                p = psutil.Process(c.pid)
                name = p.name()
                if name in groups:
                    groups[name]["conns"] += 1
            except Exception:
                continue
    except Exception:
        pass

    visible_pids = get_visible_window_pids()  # None on non-Windows

    out = []
    for name, info in groups.items():
        if visible_pids is None:
            has_window = False  # unknown — caller's filter UI will reflect this
        else:
            has_window = bool(info["pids"] & visible_pids)
        out.append({
            "name": name,
            "pids": list(info["pids"]),
            "instances": len(info["pids"]),
            "conns": info["conns"],
            "has_window": has_window,
        })
    out.sort(key=lambda x: (-x["conns"], x["name"].lower()))
    return out


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def ensure_qwebchannel_js(ui_dir: Path) -> bool:
    """Extract qwebchannel.js from Qt's compiled resources to the ui/ folder.
    
    QWebChannel ships qwebchannel.js as a Qt resource at qrc:///qtwebchannel/.
    We copy it to ui/qwebchannel.js so index.html can load it via file://.
    """
    target = ui_dir / "qwebchannel.js"
    if target.exists() and target.stat().st_size > 1000:
        return True  # Already there

    # Try Qt resource path
    try:
        f = QFile(":/qtwebchannel/qwebchannel.js")
        if f.open(QIODevice.ReadOnly):
            data = bytes(f.readAll())
            f.close()
            if data and len(data) > 1000:
                target.write_bytes(data)
                return True
    except Exception:
        pass

    # Try filesystem locations as a fallback
    try:
        import PySide6
        ps_root = Path(PySide6.__file__).parent
        candidates = [
            ps_root / "Qt6" / "resources" / "qtwebchannel" / "qwebchannel.js",
            ps_root / "Qt" / "resources" / "qtwebchannel" / "qwebchannel.js",
            ps_root / "qtwebchannel" / "qwebchannel.js",
        ]
        for c in candidates:
            if c.exists() and c.stat().st_size > 1000:
                target.write_bytes(c.read_bytes())
                return True
    except Exception:
        pass

    return False


# ============================================================
# Phase 2 — Recording / Replay
# ============================================================

RECORDINGS_DIR = PROFILE_DIR / "recordings"
try:
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass

PCAP_DIR = PROFILE_DIR / "pcaps"
try:
    PCAP_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass


# ============================================================
# Phase 3 — PCAP writer (libpcap format, opens in Wireshark)
# ============================================================

class PcapWriter:
    """Writes captured packets to a standard libpcap file. The file format
    is a 24-byte global header followed by a 16-byte per-packet record
    header + the raw packet bytes (IPv4 header + payload).

    Opens lazily on first write; closes cleanly via stop()."""

    # Global header: magic + version + thiszone + sigfigs + snaplen + linktype
    # linktype 101 = LINKTYPE_RAW (raw IPv4/IPv6 — no Ethernet header), which
    # matches what WinDivert hands us at the network layer.
    _GLOBAL_HEADER = bytes([
        0xD4, 0xC3, 0xB2, 0xA1,            # magic (little-endian)
        0x02, 0x00, 0x04, 0x00,            # version 2.4
        0x00, 0x00, 0x00, 0x00,            # thiszone (UTC)
        0x00, 0x00, 0x00, 0x00,            # sigfigs
        0xFF, 0xFF, 0x00, 0x00,            # snaplen 65535
        0x65, 0x00, 0x00, 0x00,            # linktype 101 = RAW
    ])

    def __init__(self):
        self.recording = False
        self.file = None
        self.path = ""
        self.lock = threading.Lock()
        self.packet_count = 0
        self.byte_count = 0

    def start(self, target_app: str = ""):
        with self.lock:
            if self.recording:
                return self.path
            try:
                ts = datetime.now().strftime("%Y%m%d-%H%M%S")
                safe = "".join(c if c.isalnum() or c in "-_" else "_"
                               for c in (target_app or "session"))[:40]
                fname = f"{ts}-{safe}.pcap"
                self.path = str(PCAP_DIR / fname)
                self.file = open(self.path, "wb")
                self.file.write(self._GLOBAL_HEADER)
                self.file.flush()
                self.recording = True
                self.packet_count = 0
                self.byte_count = 0
                return self.path
            except Exception:
                self.recording = False
                self.file = None
                self.path = ""
                return ""

    def write_packet(self, raw_bytes):
        """Append a packet record. Called from the capture loop."""
        if not self.recording or self.file is None:
            return
        try:
            with self.lock:
                if self.file is None:
                    return
                ts = time.time()
                ts_sec = int(ts)
                ts_usec = int((ts - ts_sec) * 1_000_000)
                length = len(raw_bytes)
                # 16-byte record header
                hdr = (ts_sec.to_bytes(4, 'little') +
                       ts_usec.to_bytes(4, 'little') +
                       length.to_bytes(4, 'little') +
                       length.to_bytes(4, 'little'))
                self.file.write(hdr)
                self.file.write(raw_bytes)
                self.packet_count += 1
                self.byte_count += length
        except Exception:
            # If write fails, stop recording to avoid filling disk with garbage
            self.recording = False

    def stop(self) -> str:
        with self.lock:
            try:
                if self.file:
                    self.file.flush()
                    self.file.close()
            except Exception:
                pass
            self.file = None
            self.recording = False
            return self.path

    def list_pcaps(self) -> list:
        try:
            files = []
            for p in sorted(PCAP_DIR.glob("*.pcap"),
                            key=lambda x: x.stat().st_mtime, reverse=True):
                try:
                    files.append({
                        "name": p.stem,
                        "path": str(p),
                        "size": p.stat().st_size,
                        "mtime": p.stat().st_mtime,
                    })
                except Exception:
                    continue
            return files
        except Exception:
            return []

    def delete_pcap(self, path: str) -> bool:
        try:
            p = Path(path)
            if p.parent != PCAP_DIR:
                return False
            p.unlink()
            return True
        except Exception:
            return False


# ============================================================
# Phase 3 — Filter scripting (sandboxed expression evaluator)
# ============================================================
# Lets users write filter expressions like:
#   pkt.dst_port == 443 and pkt.size > 500
#   pkt.host endswith ".discord.gg"
#   random() < 0.3
# Evaluated using Python's ast module — only specific node types are
# allowed, no arbitrary code execution. Compile once, evaluate per-packet.

import ast as _ast

_ALLOWED_AST_NODES = {
    _ast.Expression, _ast.BoolOp, _ast.BinOp, _ast.UnaryOp, _ast.Compare,
    _ast.Call, _ast.Attribute, _ast.Name, _ast.Load, _ast.Constant,
    _ast.And, _ast.Or, _ast.Not, _ast.USub, _ast.UAdd,
    _ast.Eq, _ast.NotEq, _ast.Lt, _ast.LtE, _ast.Gt, _ast.GtE,
    _ast.In, _ast.NotIn,
    _ast.Add, _ast.Sub, _ast.Mult, _ast.Div, _ast.FloorDiv, _ast.Mod,
    _ast.IfExp,
}

# Allowed builtins/functions inside scripts
def _scr_random():
    return random.random()
def _scr_len(x):
    try: return len(x)
    except: return 0
def _scr_lower(x):
    try: return str(x).lower()
    except: return ""
def _scr_startswith(s, p):
    try: return str(s).lower().startswith(str(p).lower())
    except: return False
def _scr_endswith(s, p):
    try: return str(s).lower().endswith(str(p).lower())
    except: return False
def _scr_contains(s, p):
    try: return str(p).lower() in str(s).lower()
    except: return False

_SCR_FUNCS = {
    "random": _scr_random, "len": _scr_len, "lower": _scr_lower,
    "startswith": _scr_startswith, "endswith": _scr_endswith,
    "contains": _scr_contains, "min": min, "max": max, "abs": abs,
}


class FilterScript:
    """Wraps a user-supplied expression. Parses+validates once at compile;
    evaluating per-packet is just a tree walk on the validated AST."""

    def __init__(self, source: str):
        self.source = (source or "").strip()
        self.ast_obj = None
        self.error = ""
        self.compiled = False
        self._compile()

    def _compile(self):
        if not self.source:
            self.compiled = False
            return
        try:
            tree = _ast.parse(self.source, mode="eval")
        except SyntaxError as e:
            self.error = f"Syntax: {e.msg}"
            return
        # Validate every node
        for node in _ast.walk(tree):
            if type(node) not in _ALLOWED_AST_NODES:
                self.error = f"Disallowed: {type(node).__name__}"
                return
            # No double-underscore attributes allowed
            if isinstance(node, _ast.Attribute) and node.attr.startswith("_"):
                self.error = "Underscore attributes not allowed"
                return
            # Restrict function calls to whitelist
            if isinstance(node, _ast.Call):
                if not isinstance(node.func, _ast.Name):
                    self.error = "Only direct function calls allowed"
                    return
                if node.func.id not in _SCR_FUNCS:
                    self.error = f"Unknown function: {node.func.id}"
                    return
        self.ast_obj = compile(tree, "<filter-script>", "eval")
        self.compiled = True
        self.error = ""

    def matches(self, pkt_view) -> bool:
        """Evaluate against a packet view object. Any error → False (fail-safe)."""
        if not self.compiled or self.ast_obj is None:
            return False
        try:
            env = dict(_SCR_FUNCS)
            env["pkt"] = pkt_view
            result = eval(self.ast_obj, {"__builtins__": {}}, env)
            return bool(result)
        except Exception:
            return False


class _PktView:
    """Lightweight view of a packet exposed to filter scripts. Only specific
    fields are exposed — no raw access."""
    __slots__ = ('src_port', 'dst_port', 'src_addr', 'dst_addr', 'size',
                 'proto', 'is_outbound', 'host', 'country')
    def __init__(self, pkt, hostname="", country=""):
        try:
            self.src_port = int(pkt.src_port or 0)
            self.dst_port = int(pkt.dst_port or 0)
            self.src_addr = str(pkt.src_addr or "")
            self.dst_addr = str(pkt.dst_addr or "")
            self.size = len(pkt.raw)
            self.proto = "TCP" if pkt.tcp else ("UDP" if pkt.udp else "OTHER")
            self.is_outbound = bool(pkt.is_outbound)
            self.host = str(hostname or "")
            self.country = str(country or "")
        except Exception:
            self.src_port = 0; self.dst_port = 0
            self.src_addr = ""; self.dst_addr = ""
            self.size = 0; self.proto = "OTHER"
            self.is_outbound = False; self.host = ""; self.country = ""


# ============================================================
# Phase 2 — Recording / Replay
# ============================================================


class RecordingManager:
    """Captures stat snapshots + config changes during a session and
    writes them to a gzipped-JSON `.thrtlrec` file. Format:
      { "v": 1, "started": iso, "ended": iso, "target": "...",
        "frames": [ {"t": ms_since_start, "stats": {...}, "config": {...}}, ... ] }
    Frames are written every stats tick when recording is active."""

    def __init__(self):
        self.recording = False
        self.start_time = 0.0
        self.target_app = ""
        self.frames = []
        self.last_config_hash = None
        self.lock = threading.Lock()

    def start(self, target_app: str = ""):
        with self.lock:
            self.recording = True
            self.start_time = time.time()
            self.target_app = target_app or ""
            self.frames = []
            self.last_config_hash = None

    def stop(self) -> str:
        """Stop recording and write the file. Returns the saved path."""
        with self.lock:
            if not self.recording:
                return ""
            self.recording = False
            data = {
                "v": 1,
                "started": _iso(self.start_time),
                "ended": _iso(time.time()),
                "target": self.target_app,
                "frames": self.frames,
            }
            self.frames = []
        try:
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            safe = "".join(c if c.isalnum() or c in "-_" else "_"
                           for c in (data["target"] or "session"))[:40]
            fname = f"{ts}-{safe}.thrtlrec"
            path = RECORDINGS_DIR / fname
            blob = json.dumps(data, separators=(",", ":")).encode("utf-8")
            import gzip
            with gzip.open(path, "wb") as f:
                f.write(blob)
            return str(path)
        except Exception:
            return ""

    def add_frame(self, stats: dict, config_snapshot: dict):
        """Add a frame. Config is only stored when it changes vs last frame."""
        if not self.recording:
            return
        with self.lock:
            t_ms = int((time.time() - self.start_time) * 1000)
            cfg_hash = hash(json.dumps(config_snapshot, sort_keys=True))
            frame = {"t": t_ms, "stats": stats}
            if cfg_hash != self.last_config_hash:
                frame["config"] = config_snapshot
                self.last_config_hash = cfg_hash
            self.frames.append(frame)
            # Cap memory: 1 frame per 200ms = 18000/hour. Hard cap 100k.
            if len(self.frames) > 100000:
                self.frames = self.frames[-100000:]

    def list_recordings(self) -> list:
        try:
            files = []
            for p in sorted(RECORDINGS_DIR.glob("*.thrtlrec"),
                            key=lambda x: x.stat().st_mtime, reverse=True):
                try:
                    files.append({
                        "name": p.stem,
                        "path": str(p),
                        "size": p.stat().st_size,
                        "mtime": p.stat().st_mtime,
                    })
                except Exception:
                    continue
            return files
        except Exception:
            return []

    def load_recording(self, path: str) -> dict:
        try:
            import gzip
            with gzip.open(path, "rb") as f:
                blob = f.read()
            return json.loads(blob.decode("utf-8"))
        except Exception:
            return {}

    def delete_recording(self, path: str) -> bool:
        try:
            p = Path(path)
            if p.parent != RECORDINGS_DIR:
                return False               # safety: only delete inside our dir
            p.unlink()
            return True
        except Exception:
            return False

    # ============================================================
    # Phase 4 (v2.7.0) — Throttlr Studio: timeline editing
    # ============================================================
    # Each recording stores frames containing periodic stats + sparse config
    # changes. The Studio works in a different shape — discrete EVENTS (a
    # function turning on or off) — which is what the user actually edits.
    # We convert in both directions on load/save. The original frames are
    # preserved (stats + structure); only the config changes are rewritten
    # to match the edited events.

    # The 6 functions whose on/off state we track on the timeline. Block
    # colors mirror the function-panel theming. Order matters — it's the
    # vertical lane order in Studio, top to bottom.
    STUDIO_FUNCTIONS = [
        ("lag",      "Lag",      "#ffb800"),
        ("drop",     "Drop",     "#ff5b5b"),
        ("throttle", "Throttle", "#66ddff"),
        ("freeze",   "Freeze",   "#7fbfff"),
        ("block",    "Block",    "#888888"),
        ("fun",      "Fun",      "#c66bff"),
    ]

    @classmethod
    def frames_to_events(cls, frames: list) -> dict:
        """Convert frame list → editable event list.

        Returns {
          'duration_ms': int,    # length of the recording
          'events': [{
              'lane': 'lag'|'drop'|...,
              'start_ms': int,
              'end_ms': int,
              'params': {<function-specific config snapshot at start>},
          }, ...]
        }
        Walks frames looking at config-change frames; each `<func>_on` going
        false→true opens a new event, true→false closes it. An event still
        open at end-of-recording is closed at duration_ms.
        """
        if not isinstance(frames, list) or not frames:
            return {"duration_ms": 0, "events": []}

        # Track current per-function state (was_on, start_t, params)
        open_events = {}   # func_key → {'start_ms': int, 'params': dict}
        events = []
        last_t = 0
        last_known_state = {f[0]: False for f in cls.STUDIO_FUNCTIONS}

        for frame in frames:
            t = int(frame.get("t", 0))
            last_t = max(last_t, t)
            cfg = frame.get("config")
            if cfg is None:
                continue   # stats-only frame, no config change

            # Compare each function's on flag in this frame to last known state
            for func_key, _, _ in cls.STUDIO_FUNCTIONS:
                # Map function key → config field that holds its on flag
                # Special case: 'fun' lives in cfg['fun_mode'], rest are '<key>_on'
                cfg_field = "fun_mode" if func_key == "fun" else f"{func_key}_on"
                cur = bool(cfg.get(cfg_field, False))
                prev = last_known_state[func_key]
                if cur and not prev:
                    # Open new event
                    open_events[func_key] = {
                        "start_ms": t,
                        # Capture relevant params for this function from the
                        # snapshot — used to restore on save
                        "params": cls._extract_fn_params(func_key, cfg),
                    }
                elif (not cur) and prev:
                    # Close existing event
                    if func_key in open_events:
                        ev = open_events.pop(func_key)
                        events.append({
                            "lane":     func_key,
                            "start_ms": ev["start_ms"],
                            "end_ms":   t,
                            "params":   ev["params"],
                        })
                last_known_state[func_key] = cur

        # Close any still-open events at end of recording
        for func_key, ev in open_events.items():
            events.append({
                "lane":     func_key,
                "start_ms": ev["start_ms"],
                "end_ms":   last_t,
                "params":   ev["params"],
            })

        events.sort(key=lambda e: (e["start_ms"], e["lane"]))
        return {"duration_ms": last_t, "events": events}

    @staticmethod
    def _extract_fn_params(func_key: str, cfg: dict) -> dict:
        """Extract function-relevant config fields. Used so when we save
        edited events, we restore the right per-function params."""
        if func_key == "lag":
            return {
                "lag_ms":         int(cfg.get("lag_ms", 500)),
                "lag_jitter_ms":  int(cfg.get("lag_jitter_ms", 0)),
                "lag_inbound":    bool(cfg.get("lag_inbound", True)),
                "lag_outbound":   bool(cfg.get("lag_outbound", True)),
            }
        if func_key == "drop":
            return {
                "drop_chance":    int(cfg.get("drop_chance", 60)),
                "drop_dns_only":  bool(cfg.get("drop_dns_only", False)),
                "drop_inbound":   bool(cfg.get("drop_inbound", True)),
                "drop_outbound":  bool(cfg.get("drop_outbound", True)),
            }
        if func_key == "throttle":
            return {
                "throttle_kbps":     int(cfg.get("throttle_kbps", 100)),
                "throttle_inbound":  bool(cfg.get("throttle_inbound", True)),
                "throttle_outbound": bool(cfg.get("throttle_outbound", True)),
            }
        if func_key == "freeze":
            return {
                "freeze_replay_ms":  int(cfg.get("freeze_replay_ms", 0)),
                "freeze_inbound":    bool(cfg.get("freeze_inbound", True)),
                "freeze_outbound":   bool(cfg.get("freeze_outbound", True)),
            }
        if func_key == "block":
            return {
                "block_inbound":     bool(cfg.get("block_inbound", True)),
                "block_outbound":    bool(cfg.get("block_outbound", True)),
            }
        if func_key == "fun":
            return {
                "fun_intensity":     int(cfg.get("fun_intensity", 50)),
            }
        return {}

    @classmethod
    def events_to_frames(cls, events: list, duration_ms: int,
                         original_frames: list) -> list:
        """Rebuild the frames array using edited events. Preserves stats
        from the original recording (we don't try to fabricate stats for
        new event ranges — that would be lying). Each event boundary
        becomes a config-change frame inserted at that millisecond."""
        # Sort events by start time, then lane (stable)
        events = sorted(events, key=lambda e: (int(e.get("start_ms", 0)), e.get("lane", "")))

        # Build a list of "transition points" — each is (t_ms, fn, on, params)
        transitions = []
        for ev in events:
            lane = ev.get("lane", "")
            if lane not in {f[0] for f in cls.STUDIO_FUNCTIONS}:
                continue
            s = int(ev.get("start_ms", 0))
            e = int(ev.get("end_ms",   s))
            if e <= s: e = s + 1
            params = ev.get("params") or {}
            transitions.append((s, lane, True,  params))
            transitions.append((e, lane, False, params))
        transitions.sort(key=lambda x: (x[0], 0 if x[2] else 1))   # off-before-on at same ms

        # Walk transitions, building config snapshots
        cur_state = {f[0]: False for f in cls.STUDIO_FUNCTIONS}
        cur_params = {f[0]: {} for f in cls.STUDIO_FUNCTIONS}

        # Carry forward stats from the closest preceding frame so the editor
        # output still has stats history. Build a sorted list of original
        # stats-only frames for lookup.
        orig_by_t = sorted([(int(f.get("t", 0)), f) for f in (original_frames or [])],
                           key=lambda x: x[0])

        def _stats_at(t_ms: int) -> dict:
            """Latest stats from original recording at or before t_ms."""
            best = {}
            for t, f in orig_by_t:
                if t <= t_ms:
                    best = f.get("stats") or best
                else:
                    break
            return best

        def _build_config_snapshot() -> dict:
            cfg = {}
            for fk, _, _ in cls.STUDIO_FUNCTIONS:
                if fk == "fun":
                    cfg["fun_mode"] = bool(cur_state[fk])
                else:
                    cfg[f"{fk}_on"] = bool(cur_state[fk])
                cfg.update(cur_params[fk])
            return cfg

        new_frames = []
        # Initial frame at t=0 with all functions off
        new_frames.append({
            "t": 0,
            "stats": _stats_at(0),
            "config": _build_config_snapshot(),
        })

        last_t = 0
        for t, lane, on, params in transitions:
            t = max(t, 0)
            if on:
                cur_state[lane] = True
                cur_params[lane] = dict(params)
            else:
                cur_state[lane] = False
            new_frames.append({
                "t": t,
                "stats": _stats_at(t),
                "config": _build_config_snapshot(),
            })
            last_t = max(last_t, t)

        # Final frame at duration_ms preserving the last config snapshot
        if duration_ms > last_t:
            new_frames.append({
                "t": int(duration_ms),
                "stats": _stats_at(int(duration_ms)),
            })

        return new_frames

    def save_edited_recording(self, src_path: str, dest_path: str,
                              events: list, duration_ms: int) -> tuple:
        """Save edited events back to a .thrtlrec file. Returns (ok, error)."""
        try:
            data = self.load_recording(src_path)
            if not data or "frames" not in data:
                return (False, "Could not read source recording")
            new_frames = self.events_to_frames(events, duration_ms, data["frames"])
            data["frames"] = new_frames
            data["edited"] = _iso(time.time())
            blob = json.dumps(data, separators=(",", ":")).encode("utf-8")
            import gzip
            with gzip.open(dest_path, "wb") as f:
                f.write(blob)
            return (True, "")
        except Exception as e:
            return (False, f"{type(e).__name__}: {e}")


def _iso(ts: float) -> str:
    try:
        return datetime.fromtimestamp(ts).isoformat()
    except Exception:
        return ""


# ============================================================
# AutomationEngine — Phase 3 (v2.6.0)
# ============================================================
# Polls active rules every 2 seconds. Each rule has a condition (when X) and
# an action (do Y). Edge-triggered: fires once when condition transitions
# false→true, won't re-fire while the condition stays true. Resets when the
# condition goes back false.
#
# Conditions:
#   - schedule    — time-of-day window + weekday selector
#   - app_running — process name appears in current process list
#   - bandwidth   — current total bw (in+out) exceeds threshold KB/s
#   - conn_count  — number of active tracked connections exceeds N
#
# Actions:
#   - preset   — apply a saved Quick Preset by name
#   - function — toggle one of the 6 functions (lag/drop/throttle/...) on/off
#   - toast    — show a desktop toast with custom message
#   - capture  — start or stop the engine
#
# Run from Qt main thread via QTimer to ensure all bridge ops happen on the
# main thread. Cheap to run — even with 50 rules, eval takes <1 ms.

class AutomationEngine(QObject):
    """Periodic rules evaluator. Owned by the Bridge."""

    # Emitted whenever a rule fires — JS subscribes for visual confirmation
    ruleFired = Signal(str)   # JSON: {rule_id, rule_name, action_summary, ts}

    POLL_INTERVAL_MS = 2000

    def __init__(self, controller: 'NetworkController', settings: 'SettingsManager',
                 bridge: 'Bridge'):
        super().__init__()
        self.controller = controller
        self.settings   = settings
        self.bridge     = bridge

        # Per-rule state: {rule_id: {"was_active": bool, "last_fired_ts": float}}
        self._rule_state = {}

        # Process list cache (refreshed each tick — psutil is expensive)
        self._proc_cache = set()
        self._proc_cache_ts = 0.0

        self._timer = QTimer(self)
        self._timer.setInterval(self.POLL_INTERVAL_MS)
        self._timer.timeout.connect(self._tick)
        self._timer.start()

    # ---------- Tick loop ----------

    def _tick(self):
        try:
            if not self.settings.get("automation_enabled", True):
                return
            rules = self.settings.get("automation_rules", []) or []
            if not rules:
                return
            # Refresh proc cache once per tick (used by app_running condition)
            self._proc_cache = self._snapshot_processes()
            self._proc_cache_ts = time.time()

            for rule in rules:
                if not isinstance(rule, dict) or not rule.get("enabled", True):
                    continue
                self._evaluate(rule)
        except Exception as e:
            # Never let a rule eval crash the engine
            try:
                print(f"[automation] tick error: {e}")
            except Exception:
                pass

    def _evaluate(self, rule: dict):
        rule_id = rule.get("id") or ""
        if not rule_id:
            return
        cond = rule.get("condition") or {}
        try:
            is_active = self._check_condition(cond)
        except Exception as e:
            print(f"[automation] condition error in {rule_id}: {e}")
            return

        prev = self._rule_state.get(rule_id, {})
        was_active = bool(prev.get("was_active", False))

        # Edge-triggered: only fire on false → true transition
        if is_active and not was_active:
            self._fire_action(rule)
            self._rule_state[rule_id] = {
                "was_active": True,
                "last_fired_ts": time.time(),
            }
        elif not is_active and was_active:
            self._rule_state[rule_id] = {
                "was_active": False,
                "last_fired_ts": prev.get("last_fired_ts", 0),
            }

    # ---------- Conditions ----------

    def _check_condition(self, cond: dict) -> bool:
        ctype = (cond.get("type") or "").lower()
        if ctype == "schedule":
            return self._cond_schedule(cond)
        if ctype == "app_running":
            return self._cond_app_running(cond)
        if ctype == "bandwidth":
            return self._cond_bandwidth(cond)
        if ctype == "conn_count":
            return self._cond_conn_count(cond)
        return False

    def _cond_schedule(self, cond: dict) -> bool:
        """Active when current local time is within [start, end] AND today's
        weekday is in the selected set. start/end are 'HH:MM' strings.
        weekdays is a list of ints 0–6 (Mon=0)."""
        start_s = cond.get("start", "09:00")
        end_s   = cond.get("end",   "17:00")
        weekdays = cond.get("weekdays", [0, 1, 2, 3, 4])
        try:
            now = datetime.now()
            if int(now.weekday()) not in [int(d) for d in weekdays]:
                return False
            sh, sm = [int(x) for x in start_s.split(":")[:2]]
            eh, em = [int(x) for x in end_s.split(":")[:2]]
            cur_min = now.hour * 60 + now.minute
            start_min = sh * 60 + sm
            end_min   = eh * 60 + em
            if start_min <= end_min:
                return start_min <= cur_min < end_min
            else:
                # Wraps midnight (e.g. 22:00 → 06:00)
                return cur_min >= start_min or cur_min < end_min
        except Exception:
            return False

    def _cond_app_running(self, cond: dict) -> bool:
        """Active when the named process is in the current process list."""
        name = (cond.get("process_name") or "").strip().lower()
        if not name:
            return False
        return name in self._proc_cache

    def _cond_bandwidth(self, cond: dict) -> bool:
        """Active when current bw (in+out, KB/s) exceeds threshold."""
        threshold_kbps = float(cond.get("threshold_kbps", 0) or 0)
        if threshold_kbps <= 0:
            return False
        try:
            bw_in, bw_out = self.controller.get_bandwidth_history()
            cur_in  = (bw_in[-1]  if bw_in  else 0) / 1024.0
            cur_out = (bw_out[-1] if bw_out else 0) / 1024.0
            return (cur_in + cur_out) > threshold_kbps
        except Exception:
            return False

    def _cond_conn_count(self, cond: dict) -> bool:
        """Active when number of tracked connections exceeds threshold."""
        threshold = int(cond.get("threshold", 0) or 0)
        if threshold <= 0:
            return False
        try:
            return len(self.controller.connection_table) > threshold
        except Exception:
            return False

    # ---------- Actions ----------

    def _fire_action(self, rule: dict):
        action = rule.get("action") or {}
        atype = (action.get("type") or "").lower()
        rule_name = rule.get("name") or "(unnamed)"
        summary = ""
        try:
            if atype == "preset":
                summary = self._act_preset(action)
            elif atype == "function":
                summary = self._act_function(action)
            elif atype == "toast":
                summary = self._act_toast(action, rule_name)
            elif atype == "capture":
                summary = self._act_capture(action)
            else:
                summary = f"unknown action: {atype}"
        except Exception as e:
            summary = f"error: {e}"

        try:
            self.ruleFired.emit(json.dumps({
                "rule_id": rule.get("id"),
                "rule_name": rule_name,
                "action_summary": summary,
                "ts": time.time(),
            }))
        except Exception:
            pass

    def _act_preset(self, action: dict) -> str:
        """Apply a Quick Preset by name. Looks up user_quick_presets in settings."""
        preset_name = (action.get("preset_name") or "").strip()
        if not preset_name:
            return "skipped: no preset name"
        presets = self.settings.get("user_quick_presets", []) or []
        target = None
        for p in presets:
            if isinstance(p, dict) and p.get("name") == preset_name:
                target = p
                break
        if not target:
            return f"preset '{preset_name}' not found"
        cfg = target.get("config") or {}
        try:
            self.bridge._apply_filter_config(cfg)   # private helper, see Bridge
            return f"applied preset: {preset_name}"
        except Exception as e:
            return f"failed to apply preset: {e}"

    def _act_function(self, action: dict) -> str:
        """Toggle one of the 6 functions on/off."""
        func = (action.get("function") or "").lower()
        on   = bool(action.get("on", True))
        valid = {"lag", "drop", "throttle", "freeze", "block", "fun"}
        if func not in valid:
            return f"unknown function: {func}"
        try:
            with self.controller.config_lock:
                setattr(self.controller.config, f"{func}_on", on)
            return f"{func} → {'on' if on else 'off'}"
        except Exception as e:
            return f"failed: {e}"

    def _act_toast(self, action: dict, rule_name: str) -> str:
        """Show a desktop toast notification. Emits via the bridge's errorMessage
        signal which JS already subscribes to and renders as a toast."""
        msg = action.get("message") or f"Rule '{rule_name}' fired"
        try:
            self.bridge.errorMessage.emit(json.dumps({
                "level": "info",
                "message": msg,
                "source": "automation",
            }))
            return f"toast: {msg[:60]}"
        except Exception as e:
            return f"toast failed: {e}"

    def _act_capture(self, action: dict) -> str:
        """Start or stop capture."""
        cmd = (action.get("command") or "start").lower()
        try:
            if cmd == "start":
                if not self.controller.running:
                    self.controller.start()
                    return "capture started"
                return "capture already running"
            elif cmd == "stop":
                if self.controller.running:
                    threading.Thread(target=self.controller.stop, daemon=True).start()
                    return "capture stopping"
                return "capture already stopped"
            return f"unknown capture command: {cmd}"
        except Exception as e:
            return f"capture failed: {e}"

    # ---------- Helpers ----------

    def _snapshot_processes(self) -> set:
        """Return a set of lowercase process names currently running."""
        names = set()
        try:
            for p in psutil.process_iter(['name']):
                try:
                    n = (p.info.get('name') or '').lower()
                    if n:
                        names.add(n)
                except Exception:
                    continue
        except Exception:
            pass
        return names

    def stop(self):
        """Halt the timer (called on app shutdown)."""
        try:
            self._timer.stop()
        except Exception:
            pass


# ============================================================
# LANCoordinator — Phase 5 (v3.0.0)
# ============================================================
# Lets Throttlr instances on the same LAN discover each other and (after
# pairing) send each other commands. Architecture:
#
# 1. DISCOVERY — UDP broadcast on lan_discovery_port (default 7878)
#    Each instance periodically sends an "announce" message with its
#    peer_id, name, version, status, control_port. Peers that haven't been
#    heard from in PEER_TIMEOUT_S are dropped from the seen-list.
#
# 2. PAIRING — initiated by one peer:
#    a) PC A clicks "Pair new peer", generates 6-digit code, opens itself
#       to incoming pairing requests for 60 seconds.
#    b) PC B clicks "Connect to peer", picks PC A from the discovered list,
#       enters the 6-digit code.
#    c) PC B sends pairing TCP request with the code → PC A verifies →
#       both store each other in lan_trusted_peers with a shared secret
#       (derived from the code via PBKDF2 with a per-pairing salt).
#
# 3. COMMAND — once paired, peers can send signed JSON commands over TCP:
#    {"method": "start_capture", "params": {...}, "nonce": "...", "hmac": "..."}
#    HMAC-SHA256 over (method + params + nonce + timestamp) using the
#    shared secret. Replay protection via timestamp ±30s window.
#
# Run on a daemon thread to keep the Qt main thread free. Status updates
# emitted via Qt signal (peerListChanged) which the bridge re-emits to JS.

class LANCoordinator(QObject):
    """LAN peer discovery + control."""

    PEER_TIMEOUT_S      = 30
    BROADCAST_INTERVAL_S = 5
    PAIRING_WINDOW_S    = 60
    REPLAY_WINDOW_S     = 30
    DEFAULT_DISCOVERY_PORT = 7878
    DEFAULT_CONTROL_PORT   = 7879

    # Emitted when the seen-peer list changes (discoveries, expirations,
    # pairings, status updates). JSON: {peers: [...], pending: [...]}
    peerListChanged = Signal(str)

    # Emitted when an action arrives from a paired peer and we executed it
    # JSON: {from_name, method, ok, result}
    commandReceived = Signal(str)

    def __init__(self, controller: 'NetworkController', settings: 'SettingsManager',
                 bridge: 'Bridge'):
        super().__init__()
        self.controller = controller
        self.settings = settings
        self.bridge = bridge

        self._enabled = False
        self._stop_evt = threading.Event()
        self._threads = []

        # Map peer_id → {name, ip, port, version, status, last_seen_ts, paired}
        self._seen_peers = {}
        self._lock = threading.Lock()

        # Pending OUTGOING pairing — we're waiting for a peer to accept us
        self._pairing_outgoing = None   # {target_peer_id, code, started_ts}
        # Pending INCOMING pairing requests:
        # {peer_id: {name, ip, code, expires_ts}}
        self._pairing_incoming = {}

        # Our own peer identity (stable across runs)
        self._my_id = self._get_or_create_my_id()
        self._my_name = settings.get("lan_display_name", "") or self._hostname()
        self._discovery_port = int(settings.get("lan_discovery_port") or self.DEFAULT_DISCOVERY_PORT)
        self._control_port   = int(settings.get("lan_control_port")   or self.DEFAULT_CONTROL_PORT)

    # ---------- Public API ----------

    def start(self):
        """Start discovery + listening if not already running."""
        if self._enabled:
            return
        self._enabled = True
        self._stop_evt.clear()
        # Spawn 3 threads: announce, listen-broadcast, listen-tcp
        for target in (self._announce_loop, self._discovery_listen_loop, self._control_server_loop):
            t = threading.Thread(target=target, daemon=True)
            t.start()
            self._threads.append(t)
        # Reaper for expired peers + pairings
        t_reap = threading.Thread(target=self._reaper_loop, daemon=True)
        t_reap.start()
        self._threads.append(t_reap)

    def stop(self):
        """Stop all LAN activity."""
        self._enabled = False
        self._stop_evt.set()
        with self._lock:
            self._seen_peers.clear()
            self._pairing_outgoing = None
            self._pairing_incoming.clear()
        self._threads = []
        self._emit_peer_list()

    def list_peers(self) -> list:
        """Return list of currently known peers."""
        with self._lock:
            now = time.time()
            return sorted([
                {
                    "peer_id":  pid,
                    "name":     info.get("name", ""),
                    "ip":       info.get("ip", ""),
                    "port":     info.get("port", 0),
                    "version":  info.get("version", ""),
                    "status":   info.get("status", "idle"),
                    "target":   info.get("target", ""),
                    "kbps_in":  info.get("kbps_in", 0),
                    "kbps_out": info.get("kbps_out", 0),
                    "last_seen_ago_s": int(now - info.get("last_seen_ts", now)),
                    "paired":   self._is_paired(pid),
                }
                for pid, info in self._seen_peers.items()
            ], key=lambda x: x.get("name", ""))

    def list_pending_pairings(self) -> list:
        """Return incoming pairing requests waiting for approval."""
        with self._lock:
            now = time.time()
            return [
                {**p, "remaining_s": max(0, int(p.get("expires_ts", 0) - now))}
                for p in self._pairing_incoming.values()
            ]

    def open_pairing_window(self) -> str:
        """Open a 60-second window for incoming pairing requests, return
        the 6-digit code the user should share with the other peer."""
        code = "".join(random.choice("0123456789") for _ in range(6))
        with self._lock:
            self._pairing_outgoing = {
                "code": code,
                "started_ts": time.time(),
                "incoming_window_open": True,
            }
        return code

    def close_pairing_window(self):
        with self._lock:
            self._pairing_outgoing = None

    def request_pair(self, target_peer_id: str, code: str) -> tuple:
        """Send a pairing request to a discovered peer. Returns (ok, error)."""
        if len(code) != 6 or not code.isdigit():
            return (False, "Code must be 6 digits")
        with self._lock:
            target = self._seen_peers.get(target_peer_id)
        if not target:
            return (False, "Peer not found — has it gone offline?")
        try:
            shared_secret = self._derive_secret_from_code(code, target_peer_id, self._my_id)
            payload = {
                "type": "pair_request",
                "peer_id": self._my_id,
                "name": self._my_name,
                "code_hash": hashlib.sha256(code.encode("utf-8")).hexdigest()[:16],
            }
            resp = self._send_tcp(target["ip"], target["port"], payload, timeout=5)
            if not resp or resp.get("ok") is not True:
                return (False, resp.get("error", "Peer rejected pairing") if resp else "No response")
            # Pairing accepted — save trust
            self._add_trusted_peer(target_peer_id, target.get("name", ""), target["ip"], shared_secret)
            return (True, "")
        except Exception as e:
            return (False, f"{type(e).__name__}: {e}")

    def accept_pairing(self, peer_id: str) -> bool:
        """User approves a pending incoming pairing request."""
        with self._lock:
            req = self._pairing_incoming.pop(peer_id, None)
        if not req:
            return False
        # The shared secret was already derived when the request came in;
        # store it now that the user said yes.
        self._add_trusted_peer(peer_id, req.get("name", ""), req.get("ip", ""), req.get("secret", ""))
        self._emit_peer_list()
        return True

    def reject_pairing(self, peer_id: str) -> bool:
        with self._lock:
            removed = self._pairing_incoming.pop(peer_id, None)
        if removed:
            self._emit_peer_list()
        return bool(removed)

    def unpair(self, peer_id: str) -> bool:
        peers = list(self.settings.get("lan_trusted_peers", []) or [])
        new_peers = [p for p in peers if p.get("peer_id") != peer_id]
        if len(new_peers) == len(peers):
            return False
        self.settings.set("lan_trusted_peers", new_peers)
        self.settings.save()
        self._emit_peer_list()
        return True

    def send_command(self, peer_id: str, method: str, params: dict = None) -> tuple:
        """Send a signed command to a paired peer. Returns (ok, result_dict_or_error)."""
        secret = self._get_shared_secret(peer_id)
        if not secret:
            return (False, "Peer is not paired")
        with self._lock:
            target = self._seen_peers.get(peer_id)
        if not target:
            return (False, "Peer is offline")
        nonce = uuid.uuid4().hex[:16]
        ts = int(time.time())
        body = {
            "type":   "command",
            "from":   self._my_id,
            "method": method,
            "params": params or {},
            "nonce":  nonce,
            "ts":     ts,
        }
        body["hmac"] = self._sign(body, secret)
        try:
            resp = self._send_tcp(target["ip"], target["port"], body, timeout=8)
            if not resp:
                return (False, "No response from peer")
            return (bool(resp.get("ok")), resp)
        except Exception as e:
            return (False, f"{type(e).__name__}: {e}")

    def broadcast_command(self, method: str, params: dict = None) -> dict:
        """Send command to ALL paired peers. Returns dict of peer_id → (ok, result)."""
        results = {}
        peers = self.settings.get("lan_trusted_peers", []) or []
        for p in peers:
            pid = p.get("peer_id")
            if not pid:
                continue
            results[pid] = self.send_command(pid, method, params)
        return results

    # ---------- Threads ----------

    def _announce_loop(self):
        """Periodically broadcast our presence on the LAN."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            while not self._stop_evt.is_set():
                try:
                    msg = self._build_announce()
                    data = json.dumps(msg).encode("utf-8")
                    sock.sendto(data, ("<broadcast>", self._discovery_port))
                except Exception:
                    pass
                self._stop_evt.wait(self.BROADCAST_INTERVAL_S)
        finally:
            try: sock.close()
            except Exception: pass

    def _discovery_listen_loop(self):
        """Listen for announces from other Throttlr instances."""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("", self._discovery_port))
            sock.settimeout(1.0)
            while not self._stop_evt.is_set():
                try:
                    data, addr = sock.recvfrom(4096)
                except (socket.timeout, OSError):
                    continue
                try:
                    msg = json.loads(data.decode("utf-8"))
                except Exception:
                    continue
                if msg.get("type") != "announce":
                    continue
                pid = msg.get("peer_id")
                if not pid or pid == self._my_id:
                    continue   # ignore ourselves
                with self._lock:
                    self._seen_peers[pid] = {
                        "name":         msg.get("name", "?"),
                        "ip":           addr[0],
                        "port":         int(msg.get("control_port", 0)),
                        "version":      msg.get("version", ""),
                        "status":       msg.get("status", "idle"),
                        "target":       msg.get("target", ""),
                        "kbps_in":      int(msg.get("kbps_in", 0)),
                        "kbps_out":     int(msg.get("kbps_out", 0)),
                        "last_seen_ts": time.time(),
                    }
                self._emit_peer_list()
        finally:
            try: sock.close()
            except Exception: pass

    def _control_server_loop(self):
        """Accept TCP connections for pairing + commands."""
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind(("", self._control_port))
            srv.listen(8)
            srv.settimeout(1.0)
            while not self._stop_evt.is_set():
                try:
                    conn, addr = srv.accept()
                except (socket.timeout, OSError):
                    continue
                # Handle each connection in its own thread so a slow client
                # can't block other commands
                t = threading.Thread(
                    target=self._handle_client, args=(conn, addr), daemon=True)
                t.start()
        finally:
            try: srv.close()
            except Exception: pass

    def _handle_client(self, conn, addr):
        try:
            conn.settimeout(8.0)
            buf = b""
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                buf += chunk
                if b"\n" in buf or len(buf) > 65536:
                    break
            try:
                msg = json.loads(buf.decode("utf-8").strip())
            except Exception:
                self._send_resp(conn, {"ok": False, "error": "bad json"})
                return
            mtype = msg.get("type")
            if mtype == "pair_request":
                self._handle_pair_request(msg, addr, conn)
            elif mtype == "command":
                self._handle_command(msg, addr, conn)
            else:
                self._send_resp(conn, {"ok": False, "error": "unknown type"})
        except Exception:
            try:
                self._send_resp(conn, {"ok": False, "error": "internal error"})
            except Exception:
                pass
        finally:
            try: conn.close()
            except Exception: pass

    def _handle_pair_request(self, msg, addr, conn):
        """Incoming pairing request from another peer. We need a window
        currently open (user pressed 'Pair new peer') AND the code-hash
        must match the code we generated."""
        with self._lock:
            window = self._pairing_outgoing
            if not window or not window.get("incoming_window_open"):
                self._send_resp(conn, {"ok": False, "error": "no pairing window open"})
                return
            our_code = window.get("code", "")
        # Verify the code-hash they sent matches our code
        expected = hashlib.sha256(our_code.encode("utf-8")).hexdigest()[:16]
        if msg.get("code_hash") != expected:
            self._send_resp(conn, {"ok": False, "error": "wrong code"})
            return
        # Code matches — derive shared secret + queue user-approval prompt
        peer_id = msg.get("peer_id", "")
        name    = msg.get("name", "?")
        secret  = self._derive_secret_from_code(our_code, self._my_id, peer_id)
        with self._lock:
            self._pairing_incoming[peer_id] = {
                "peer_id":    peer_id,
                "name":       name,
                "ip":         addr[0],
                "expires_ts": time.time() + self.PAIRING_WINDOW_S,
                "secret":     secret,
            }
        # Tell the other side we accepted (the user will approve via UI; for
        # now we acknowledge so the request was structurally valid)
        self._send_resp(conn, {"ok": True, "msg": "awaiting user approval"})
        self._emit_peer_list()

    def _handle_command(self, msg, addr, conn):
        """Incoming signed command from a paired peer."""
        from_id = msg.get("from", "")
        secret = self._get_shared_secret(from_id)
        if not secret:
            self._send_resp(conn, {"ok": False, "error": "not paired"})
            return
        # Verify HMAC
        sig = msg.pop("hmac", "")
        if not sig or not self._verify_signature(msg, sig, secret):
            self._send_resp(conn, {"ok": False, "error": "bad signature"})
            return
        # Replay-protect via timestamp window
        ts = int(msg.get("ts", 0))
        if abs(time.time() - ts) > self.REPLAY_WINDOW_S:
            self._send_resp(conn, {"ok": False, "error": "stale request"})
            return
        method = msg.get("method", "")
        params = msg.get("params", {}) or {}
        # Execute the command (schedule on Qt thread for safety)
        result = self._execute_remote_command(method, params)
        try:
            peer_name = ""
            with self._lock:
                p = self._seen_peers.get(from_id)
                if p:
                    peer_name = p.get("name", "")
            self.commandReceived.emit(json.dumps({
                "from_name": peer_name,
                "method":    method,
                "ok":        bool(result.get("ok")),
                "result":    result,
            }))
        except Exception:
            pass
        self._send_resp(conn, result)

    def _reaper_loop(self):
        """Drop peers we haven't heard from in PEER_TIMEOUT_S, expire pairings."""
        while not self._stop_evt.is_set():
            self._stop_evt.wait(2.0)
            now = time.time()
            changed = False
            with self._lock:
                for pid in list(self._seen_peers.keys()):
                    if now - self._seen_peers[pid].get("last_seen_ts", now) > self.PEER_TIMEOUT_S:
                        del self._seen_peers[pid]
                        changed = True
                for pid in list(self._pairing_incoming.keys()):
                    if self._pairing_incoming[pid].get("expires_ts", now) < now:
                        del self._pairing_incoming[pid]
                        changed = True
                if self._pairing_outgoing:
                    if (now - self._pairing_outgoing.get("started_ts", now)) > self.PAIRING_WINDOW_S:
                        self._pairing_outgoing = None
                        changed = True
            if changed:
                self._emit_peer_list()

    # ---------- Helpers ----------

    def _build_announce(self) -> dict:
        cfg = self.controller.config
        bw_in, bw_out = self.controller.get_bandwidth_history()
        kin  = (bw_in[-1]  if bw_in  else 0) // 1024
        kout = (bw_out[-1] if bw_out else 0) // 1024
        return {
            "type":         "announce",
            "peer_id":      self._my_id,
            "name":         self._my_name,
            "version":      __version__,
            "control_port": self._control_port,
            "status":       "running" if self.controller.running else "idle",
            "target":       cfg.target_name or "",
            "kbps_in":      int(kin),
            "kbps_out":     int(kout),
        }

    def _send_tcp(self, ip: str, port: int, payload: dict, timeout: float = 5) -> dict:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(timeout)
                s.connect((ip, port))
                data = (json.dumps(payload) + "\n").encode("utf-8")
                s.sendall(data)
                buf = b""
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    buf += chunk
                    if b"\n" in buf or len(buf) > 65536:
                        break
                if not buf:
                    return None
                return json.loads(buf.decode("utf-8").strip())
        except Exception:
            return None

    def _send_resp(self, conn, payload: dict):
        try:
            data = (json.dumps(payload) + "\n").encode("utf-8")
            conn.sendall(data)
        except Exception:
            pass

    def _sign(self, body: dict, secret: str) -> str:
        s = self._canonical(body)
        return hmac.new(secret.encode("utf-8"), s.encode("utf-8"),
                        hashlib.sha256).hexdigest()

    def _verify_signature(self, body: dict, sig: str, secret: str) -> bool:
        expected = self._sign(body, secret)
        return hmac.compare_digest(expected, sig)

    def _canonical(self, body: dict) -> str:
        # Stable JSON so signature is reproducible
        return json.dumps(body, sort_keys=True, separators=(",", ":"))

    def _derive_secret_from_code(self, code: str, side_a: str, side_b: str) -> str:
        """Derive a shared secret from the pairing code + both peer IDs.
        Both sides compute the same value (we sort the IDs)."""
        ids = sorted([side_a, side_b])
        salt = (ids[0] + "|" + ids[1]).encode("utf-8")
        return hashlib.pbkdf2_hmac("sha256", code.encode("utf-8"), salt,
                                   iterations=10000).hex()

    def _is_paired(self, peer_id: str) -> bool:
        return self._get_shared_secret(peer_id) is not None

    def _get_shared_secret(self, peer_id: str) -> str:
        peers = self.settings.get("lan_trusted_peers", []) or []
        for p in peers:
            if p.get("peer_id") == peer_id:
                return p.get("shared_secret", "") or ""
        return ""

    def _add_trusted_peer(self, peer_id: str, name: str, ip: str, secret: str):
        peers = list(self.settings.get("lan_trusted_peers", []) or [])
        peers = [p for p in peers if p.get("peer_id") != peer_id]
        peers.append({
            "peer_id":       peer_id,
            "name":          name,
            "last_ip":       ip,
            "shared_secret": secret,
            "paired_ts":     time.time(),
        })
        self.settings.set("lan_trusted_peers", peers)
        self.settings.save()

    def _execute_remote_command(self, method: str, params: dict) -> dict:
        """Execute a command requested by a paired peer. Whitelist methods —
        we don't want to expose the entire bridge to LAN peers."""
        try:
            if method == "ping":
                return {"ok": True, "version": __version__}
            if method == "start_capture":
                self.bridge.startCapture()
                return {"ok": True}
            if method == "stop_capture":
                self.bridge.stopCapture()
                return {"ok": True}
            if method == "apply_preset":
                # params: {preset_name}
                preset_name = (params.get("preset_name") or "").strip()
                if not preset_name:
                    return {"ok": False, "error": "no preset_name"}
                presets = self.settings.get("user_quick_presets", []) or []
                target = next((p for p in presets if p.get("name") == preset_name), None)
                if not target:
                    return {"ok": False, "error": f"preset '{preset_name}' not found"}
                self.bridge._apply_filter_config(target.get("config") or {})
                return {"ok": True}
            if method == "toggle_function":
                func = (params.get("function") or "").lower()
                on   = bool(params.get("on", True))
                valid = {"lag", "drop", "throttle", "freeze", "block", "fun"}
                if func not in valid:
                    return {"ok": False, "error": f"invalid function: {func}"}
                with self.controller.config_lock:
                    setattr(self.controller.config, f"{func}_on", on)
                return {"ok": True}
            if method == "get_status":
                cfg = self.controller.config
                return {
                    "ok":      True,
                    "running": bool(self.controller.running),
                    "target":  cfg.target_name or "",
                }
            return {"ok": False, "error": f"unknown method: {method}"}
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    def _emit_peer_list(self):
        try:
            payload = json.dumps({
                "peers":   self.list_peers(),
                "pending": self.list_pending_pairings(),
                "pairing_window_open": self._pairing_outgoing is not None,
            })
            self.peerListChanged.emit(payload)
        except Exception:
            pass

    def _hostname(self) -> str:
        try:
            return socket.gethostname()
        except Exception:
            return "Throttlr"

    def _get_or_create_my_id(self) -> str:
        pid = self.settings.get("lan_my_peer_id", "") or ""
        if not pid:
            pid = uuid.uuid4().hex[:12]
            self.settings.set("lan_my_peer_id", pid)
            self.settings.save()
        return pid


# ============================================================
# PluginManager — Phase 5 (v3.0.0)
# ============================================================
# Discovers .py files in the plugins/ folder, loads enabled ones, and calls
# their lifecycle hooks. Plugins run with full Python privileges so they're
# disabled by default — user must explicitly enable each.
#
# Plugin folder structure:
#   <appdata>/Throttlr/plugins/
#     ├── my_plugin/
#     │     ├── plugin.py        # entry point, defines a class subclass
#     │     └── manifest.json    # optional metadata override
#     └── another/plugin.py
#
# A plugin entry point file must contain a class with these attributes:
#   class MyPlugin:
#       name        = "Display name"
#       version     = "1.0.0"
#       description = "What this plugin does"
#
#       def on_load(self, api):     pass    # called when plugin is enabled
#       def on_unload(self):        pass    # called when disabled / app closes
#       def on_capture_start(self, target_app): pass
#       def on_capture_stop(self):  pass
#       def on_packet(self, pkt):   return pkt  # optionally modify
#
# The `api` passed to on_load is a PluginAPI instance with a small surface:
#   api.log(msg), api.get_version(), api.toast(msg), api.get_setting(key)

class PluginAPI:
    """Restricted facade exposed to plugins. We don't hand them the full
    bridge or controller — too easy to break things accidentally."""

    def __init__(self, bridge: 'Bridge'):
        self._bridge = bridge

    def log(self, message: str):
        try:
            print(f"[plugin] {message}")
        except Exception:
            pass

    def toast(self, message: str, level: str = "info"):
        try:
            self._bridge.errorMessage.emit(json.dumps({
                "level": level, "message": str(message), "source": "plugin",
            }))
        except Exception:
            pass

    def get_version(self) -> str:
        return __version__

    def get_setting(self, key: str, default=None):
        try:
            return self._bridge.settings.get(key, default)
        except Exception:
            return default


class PluginManager:
    """Discovers + loads + manages plugins."""

    def __init__(self, controller: 'NetworkController', settings: 'SettingsManager',
                 bridge: 'Bridge'):
        self.controller = controller
        self.settings = settings
        self.bridge = bridge
        self._plugins = {}   # name → {module, instance, manifest, status}
        self._api = PluginAPI(bridge)

    @staticmethod
    def plugins_dir() -> Path:
        d = PROFILE_DIR / "plugins"
        try:
            d.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        return d

    def discover(self) -> list:
        """Scan plugins folder, return list of {name, version, description,
        enabled, error, path} for each found plugin."""
        results = []
        enabled_names = set(self.settings.get("plugins_enabled", []) or [])
        plugins_root = self.plugins_dir()
        try:
            for entry in sorted(plugins_root.iterdir(), key=lambda p: p.name.lower()):
                if entry.is_dir():
                    py = entry / "plugin.py"
                    if py.exists():
                        results.append(self._inspect_plugin(entry.name, py, enabled_names))
                elif entry.is_file() and entry.suffix == ".py":
                    results.append(self._inspect_plugin(entry.stem, entry, enabled_names))
        except Exception:
            pass
        return results

    def _inspect_plugin(self, name: str, path: Path, enabled_names: set) -> dict:
        """Load the plugin's metadata without instantiating it."""
        info = {
            "name":        name,
            "display_name": name,
            "version":     "?",
            "description": "",
            "enabled":     name in enabled_names,
            "loaded":      name in self._plugins,
            "error":       "",
            "path":        str(path),
        }
        # Try manifest.json first if present
        try:
            mf = path.parent / "manifest.json" if path.parent.name == name else None
            if mf and mf.exists():
                with open(mf, encoding="utf-8") as f:
                    data = json.load(f)
                info["display_name"] = data.get("name", name)
                info["version"]      = data.get("version", "?")
                info["description"]  = data.get("description", "")
        except Exception:
            pass
        # Probe class metadata
        try:
            cls = self._load_plugin_class(name, path)
            if cls is not None:
                if not info["display_name"] or info["display_name"] == name:
                    info["display_name"] = getattr(cls, "name", name)
                if info["version"] == "?":
                    info["version"] = getattr(cls, "version", "?")
                if not info["description"]:
                    info["description"] = getattr(cls, "description", "")
        except Exception as e:
            info["error"] = f"{type(e).__name__}: {e}"
        return info

    def _load_plugin_class(self, name: str, path: Path):
        """Import the plugin module and return its first plugin class."""
        import importlib.util
        spec = importlib.util.spec_from_file_location(f"throttlr_plugin_{name}", str(path))
        if not spec:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        # Find the first class with required attributes
        for attr_name in dir(mod):
            cls = getattr(mod, attr_name)
            if isinstance(cls, type) and hasattr(cls, "on_load"):
                return cls
        return None

    def load_enabled(self):
        """Instantiate + on_load every plugin currently in the enabled list."""
        enabled_names = list(self.settings.get("plugins_enabled", []) or [])
        for n in enabled_names:
            self.enable(n, save_setting=False)

    def enable(self, name: str, save_setting: bool = True) -> tuple:
        """Load + on_load. Returns (ok, error)."""
        if name in self._plugins:
            return (True, "")  # already loaded
        plugins_root = self.plugins_dir()
        candidates = [
            plugins_root / name / "plugin.py",
            plugins_root / f"{name}.py",
        ]
        path = next((p for p in candidates if p.exists()), None)
        if not path:
            return (False, f"plugin file not found for '{name}'")
        try:
            cls = self._load_plugin_class(name, path)
            if cls is None:
                return (False, "no plugin class found in file")
            instance = cls()
            try:
                instance.on_load(self._api)
            except Exception as e:
                return (False, f"on_load raised: {type(e).__name__}: {e}")
            self._plugins[name] = {
                "instance": instance,
                "path":     str(path),
            }
            if save_setting:
                enabled = list(self.settings.get("plugins_enabled", []) or [])
                if name not in enabled:
                    enabled.append(name)
                    self.settings.set("plugins_enabled", enabled)
                    self.settings.save()
            return (True, "")
        except Exception as e:
            return (False, f"{type(e).__name__}: {e}")

    def disable(self, name: str) -> bool:
        """Call on_unload + remove from registry. Updates enabled-list."""
        info = self._plugins.pop(name, None)
        if info:
            try:
                inst = info.get("instance")
                if inst and hasattr(inst, "on_unload"):
                    inst.on_unload()
            except Exception:
                pass
        enabled = list(self.settings.get("plugins_enabled", []) or [])
        if name in enabled:
            enabled.remove(name)
            self.settings.set("plugins_enabled", enabled)
            self.settings.save()
        return True

    def fire_event(self, event_name: str, *args):
        """Fan out a lifecycle event to all loaded plugins. Errors per-plugin
        are logged but never bubble up to break Throttlr."""
        for name, info in list(self._plugins.items()):
            inst = info.get("instance")
            if not inst:
                continue
            method = getattr(inst, event_name, None)
            if not callable(method):
                continue
            try:
                method(*args)
            except Exception as e:
                print(f"[plugin] {name}.{event_name} raised: {e}")

    def open_folder(self) -> bool:
        try:
            d = str(self.plugins_dir())
            if sys.platform == "win32":
                os.startfile(d)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", d])
            else:
                subprocess.Popen(["xdg-open", d])
            return True
        except Exception:
            return False

    def seed_example_plugin(self):
        """On first run, copy the bundled example plugin into the user's
        plugins folder so they have something to look at and toggle on.
        Idempotent — won't overwrite if user already has a folder by that name."""
        try:
            target = self.plugins_dir() / "capture_logger"
            if target.exists():
                return  # already seeded or user-managed
            # Locate the bundled example. When running from source: same dir
            # as throttlr.py / example_plugins/. When frozen by PyInstaller:
            # under sys._MEIPASS.
            base_candidates = []
            if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
                base_candidates.append(Path(sys._MEIPASS) / "example_plugins")
            base_candidates.append(Path(__file__).parent / "example_plugins")
            base_candidates.append(Path(os.path.abspath(".")) / "example_plugins")
            src_dir = next((p / "capture_logger" for p in base_candidates
                            if (p / "capture_logger").exists()), None)
            if not src_dir:
                return  # bundled assets not present, no-op
            shutil.copytree(src_dir, target)
        except Exception:
            pass


# ============================================================
# Bridge: Python <-> JavaScript
# ============================================================

class Bridge(QObject):
    """JS-callable interface. Methods are slots; signals push events to JS."""

    statsChanged = Signal(str)
    statusChanged = Signal(str)
    hotkeyFired = Signal(str)
    errorMessage = Signal(str)
    appsRefreshed = Signal(str)
    updateStatus = Signal(str)        # auto-update progress + completion
    automationRuleFired = Signal(str) # Phase 3 — emits when an automation rule fires
    lanPeerListChanged  = Signal(str) # Phase 5 — emits when peer list updates
    lanCommandReceived  = Signal(str) # Phase 5 — emits when a remote peer sent us a command

    def __init__(self, controller: NetworkController, settings: SettingsManager,
                 on_hotkey_rebind=None):
        super().__init__()
        self.controller = controller
        self.settings = settings
        self._on_hotkey_rebind = on_hotkey_rebind

        # Phase 2 — recording manager
        self.recorder = RecordingManager()

        self._stats_timer = QTimer(self)
        self._stats_timer.setInterval(int(settings.get('stats_interval_ms') or 200))
        self._stats_timer.timeout.connect(self._emit_stats)
        self._stats_timer.start()

        self._apps_timer = QTimer(self)
        self._apps_timer.setInterval(int(settings.get('apps_refresh_ms') or 2000))
        self._apps_timer.timeout.connect(self._emit_apps)
        self._apps_timer.start()

        self.controller.status_changed.connect(self.statusChanged)
        self.controller.error_occurred.connect(self.errorMessage)

        # Phase 3 (v2.6.0) — Automation rules engine. Created here so it has
        # the same lifetime as Bridge. Forwards its ruleFired signal out to JS.
        self._automation = AutomationEngine(controller, settings, self)
        self._automation.ruleFired.connect(self.automationRuleFired)

        # Phase 5 (v3.0.0) — LAN coordinator + Plugin manager
        self._lan = LANCoordinator(controller, settings, self)
        self._lan.peerListChanged.connect(self.lanPeerListChanged)
        self._lan.commandReceived.connect(self.lanCommandReceived)
        if bool(settings.get("lan_sync_enabled", False)):
            self._lan.start()

        self._plugins = PluginManager(controller, settings, self)
        try:
            self._plugins.seed_example_plugin()
        except Exception:
            pass
        try:
            self._plugins.load_enabled()
        except Exception as e:
            print(f"[plugins] startup load failed: {e}")

        # Wire capture lifecycle → plugin event fan-out
        try:
            self.controller.status_changed.connect(self._on_status_for_plugins)
        except Exception:
            pass

    def _on_status_for_plugins(self, status_str):
        """Fan out capture start/stop to plugins."""
        try:
            if not self._plugins:
                return
            s = (status_str or "").lower()
            if "running" in s or "started" in s:
                target = self.controller.config.target_name or ""
                self._plugins.fire_event("on_capture_start", target)
            elif "stopped" in s or "idle" in s:
                self._plugins.fire_event("on_capture_stop")
        except Exception:
            pass

    def _emit_stats(self):
        seen, dropped, delayed, held, sb, freeze_on, dur = self.controller.get_stats()
        bw_in, bw_out = self.controller.get_bandwidth_history()
        # Live queue size — what's currently held. This is what the user
        # actually wants to see going down during a replay.
        with self.controller.freeze_lock:
            held_live = len(self.controller.freeze_queue)
        # "Replaying" = freeze is OFF but the queue still has packets being
        # drained out via the freeze drain loop. This is the visible state
        # the user wants — released packets streaming back to the network
        # at the configured speed. Also fires during the post-stop drain
        # phase (running flips off only when queue is empty).
        replaying = bool(
            (not freeze_on) and held_live > 0
            and (self.controller.running or self.controller._pass_through)
        )
        payload = {
            "seen": seen, "dropped": dropped, "delayed": delayed,
            "held": held_live, "bytes": sb,
            "freeze_on": freeze_on, "replaying": replaying,
            "freeze_duration": dur, "running": self.controller.running,
            "bw_in": bw_in, "bw_out": bw_out,
        }
        self.statsChanged.emit(json.dumps(payload))
        # Phase 2: feed the recorder when active
        try:
            if self.recorder.recording:
                with self.controller.config_lock:
                    cfg = self.controller.config
                    cfg_snap = {
                        "lag_on": cfg.lag_on, "lag_ms": cfg.lag_ms,
                        "drop_on": cfg.drop_on, "drop_chance": cfg.drop_chance,
                        "drop_dns_only": cfg.drop_dns_only,
                        "throttle_on": cfg.throttle_on, "throttle_kbps": cfg.throttle_kbps,
                        "freeze_on": cfg.freeze_on,
                        "block_on": cfg.block_on, "fun_on": cfg.fun_mode,
                        "domain_block_on": cfg.domain_block_on,
                        "geo_block_on": cfg.geo_block_on,
                    }
                self.recorder.add_frame(payload, cfg_snap)
        except Exception:
            pass
        # Also push to the overlay if attached. Wrapped in try/except so any
        # error here can never prevent statsChanged from emitting on the
        # next tick.
        try:
            if hasattr(self, "_overlay") and self._overlay is not None:
                cfg = self.controller.config
                last_in = bw_in[-1] if bw_in else 0
                last_out = bw_out[-1] if bw_out else 0
                kbps = (last_in + last_out) / 1024.0
                funcs = {
                    'lag':      bool(cfg.lag_on),
                    'drop':     bool(cfg.drop_on),
                    'throttle': bool(cfg.throttle_on),
                    'freeze':   bool(cfg.freeze_on),
                    'block':    bool(cfg.block_on),
                    'fun':      bool(cfg.fun_mode),
                }
                self._overlay.set_state(
                    running=self.controller.running,
                    app_name=self.controller.config.target_name,
                    sent=seen, dropped=dropped, delayed=delayed, held=held_live,
                    bytes_total=sb, kbps=kbps, funcs=funcs,
                    replaying=replaying,
                )
        except Exception as e:
            # Don't surface to the user — overlay update failures shouldn't
            # spam toasts. Log to stderr only.
            import sys
            print(f"[overlay update] {e}", file=sys.stderr)

    def _emit_apps(self):
        self.appsRefreshed.emit(json.dumps(get_process_groups()))

    @Slot(result=str)
    def getApps(self):
        return json.dumps(get_process_groups())

    # ====== v3.0.5 — Custom themes ======

    @Slot(result=str)
    def listInstalledThemes(self):
        """Scan the user's themes folder for .json manifests with paired .css
        files and return them as a JSON array. Frontend renders these as
        tiles next to the built-in designs."""
        out = []
        try:
            for jf in sorted(THEMES_DIR.glob("*.json")):
                try:
                    raw = jf.read_text(encoding="utf-8")
                    manifest = json.loads(raw)
                    if not isinstance(manifest, dict):
                        continue
                    # Validate required fields — silently skip broken manifests
                    if not manifest.get("id") or not manifest.get("name"):
                        continue
                    css_filename = manifest.get("css_file") or f"{manifest['id']}.css"
                    css_path = THEMES_DIR / css_filename
                    manifest["_filename"] = jf.name
                    manifest["_css_filename"] = css_filename
                    manifest["_css_exists"] = css_path.exists()
                    out.append(manifest)
                except Exception:
                    # Malformed JSON — skip it but keep loading the rest
                    continue
        except Exception:
            pass
        return json.dumps(out)

    @Slot(str, result=str)
    def loadThemeCss(self, css_filename):
        """Read a CSS file from the themes folder and return its contents.
        Frontend injects this into a <style> tag when the user activates
        a custom theme."""
        try:
            # Sanitize — only allow plain filenames, no path traversal
            name = Path(css_filename).name
            if not name.endswith(".css"):
                return ""
            p = THEMES_DIR / name
            if not p.exists():
                return ""
            # Resolve and confirm the file is actually inside THEMES_DIR
            # (paranoia — Path(name).name should already prevent traversal)
            if THEMES_DIR.resolve() not in p.resolve().parents:
                return ""
            return p.read_text(encoding="utf-8")
        except Exception:
            return ""

    @Slot()
    def openThemesFolder(self):
        """Open the user's themes folder in File Explorer (or platform
        equivalent). Called by the 'Open themes folder' button in
        Settings → Appearance."""
        try:
            import os, sys, subprocess
            path = str(THEMES_DIR.resolve())
            if sys.platform == "win32":
                # os.startfile is the standard way on Windows
                os.startfile(path)
            elif sys.platform == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception:
            pass

    @Slot()
    def openThemesGallery(self):
        """Open the public themes gallery in the user's default browser.
        Called by the 'More themes' button in Settings → Appearance."""
        try:
            import webbrowser
            webbrowser.open(THEMES_GALLERY_URL)
        except Exception:
            pass

    @Slot(result=str)
    def getThemesGalleryUrl(self):
        return THEMES_GALLERY_URL

    @Slot(str, str)
    def previewOverlayTheme(self, theme_id, customizations_json):
        """Apply a temporary theme to the floating overlay WITHOUT saving
        settings — used by the in-app theme picker so the overlay updates
        live as the user clicks through theme tiles, before they hit Save.

        Called from JS:
          bridge.previewOverlayTheme('retro', JSON.stringify(customs))

        Pass an empty/unknown theme_id to revert the overlay to its
        settings-based palette (e.g. when user clicks Cancel)."""
        try:
            if not (hasattr(self, "_overlay") and self._overlay is not None):
                return
            customs = None
            if customizations_json:
                try:
                    customs = json.loads(customizations_json)
                except Exception:
                    customs = None
            self._overlay.preview_theme(theme_id or "", customs)
        except Exception:
            pass

    @Slot(result=str)
    def getSettings(self):
        return json.dumps(self.settings.data)

    @Slot(str, result=bool)
    def saveSettings(self, json_str):
        try:
            new_data = json.loads(json_str)
            for k, v in new_data.items():
                if k in DEFAULT_SETTINGS:
                    self.settings.set(k, v)
            set_sound_enabled(self.settings.get("sound_enabled"))
            if self._on_hotkey_rebind:
                self._on_hotkey_rebind()
            # Apply runtime-affecting settings live
            try:
                self._stats_timer.setInterval(int(self.settings.get('stats_interval_ms')))
                self._apps_timer.setInterval(int(self.settings.get('apps_refresh_ms')))
            except Exception:
                pass
            try:
                if hasattr(self, "_screen_border") and self._screen_border:
                    self._screen_border.set_show_duration_ms(int(self.settings.get('screen_border_duration_ms')))
                    self._screen_border.set_feather(int(self.settings.get('screen_border_feather')))
            except Exception:
                pass
            # v3.0.2 — refresh overlay's palette so theme changes take effect
            # without restarting the app.
            try:
                if hasattr(self, "_overlay") and self._overlay is not None:
                    self._overlay.refresh_theme()
            except Exception:
                pass
            return True
        except Exception:
            return False

    @Slot(str, result=bool)
    def setTargetApp(self, app_name):
        try:
            with self.controller.config_lock:
                self.controller.config.target_name = app_name
                # Single-target sets target_names to just this one for consistency
                self.controller.config.target_names = [app_name] if app_name else []
            # Use the controller's helper which walks child processes too.
            # This ensures Discord helpers, Chrome renderers, etc. are
            # caught from the moment the user picks the app.
            self.controller._refresh_target_pids()
            with self.controller.config_lock:
                ok = bool(self.controller.config.target_pids)
            if not ok:
                with self.controller.config_lock:
                    self.controller.config.target_name = ""
                    self.controller.config.target_names = []
            return ok
        except Exception:
            return False

    # ============================================================
    # Phase 1 bridge slots
    # ============================================================

    @Slot(str, result=bool)
    def setTargetApps(self, json_names):
        """Multi-target: accept a JSON array of app names. The union of all
        their PIDs (plus child processes) becomes the target_pids set."""
        try:
            names = json.loads(json_names) if json_names else []
            if not isinstance(names, list):
                return False
            names = [str(n) for n in names if n]
            with self.controller.config_lock:
                self.controller.config.target_names = names
                # Display name: comma-joined for the title bar / overlay
                if len(names) == 0:
                    self.controller.config.target_name = ""
                elif len(names) == 1:
                    self.controller.config.target_name = names[0]
                else:
                    self.controller.config.target_name = " + ".join(names)
            self.controller._refresh_target_pids()
            with self.controller.config_lock:
                return bool(self.controller.config.target_pids)
        except Exception:
            return False

    @Slot(str)
    def addRecentApp(self, app_name):
        """Push an app to the front of the recent_apps list, dedupe, cap at 8."""
        try:
            if not app_name:
                return
            recent = list(self.settings.get('recent_apps') or [])
            recent = [a for a in recent if a != app_name]
            recent.insert(0, app_name)
            recent = recent[:8]
            self.settings.set('recent_apps', recent)
            self.settings.save()
        except Exception:
            pass

    @Slot(result=str)
    def getRecentApps(self):
        try:
            return json.dumps(list(self.settings.get('recent_apps') or []))
        except Exception:
            return "[]"

    @Slot(str, result=str)
    def getPerAppPreset(self, app_name):
        """Return saved per-app config as a JSON string, or "" if none."""
        try:
            presets = self.settings.get('per_app_presets') or {}
            cfg = presets.get(app_name)
            return json.dumps(cfg) if cfg else ""
        except Exception:
            return ""

    @Slot(str, str, result=bool)
    def setPerAppPreset(self, app_name, json_cfg):
        """Save the supplied config as the per-app preset for app_name."""
        try:
            if not app_name:
                return False
            cfg = json.loads(json_cfg) if json_cfg else {}
            presets = dict(self.settings.get('per_app_presets') or {})
            presets[app_name] = cfg
            self.settings.set('per_app_presets', presets)
            self.settings.save()
            return True
        except Exception:
            return False

    @Slot(str, result=bool)
    def deletePerAppPreset(self, app_name):
        try:
            presets = dict(self.settings.get('per_app_presets') or {})
            if app_name in presets:
                del presets[app_name]
                self.settings.set('per_app_presets', presets)
                self.settings.save()
            return True
        except Exception:
            return False

    @Slot(bool)
    def setOverlayGhostMode(self, on):
        """Apply / remove the WDA_EXCLUDEFROMCAPTURE flag on the overlay
        window so it disappears from screen-recording tools."""
        try:
            self.settings.set('overlay_ghost_mode', bool(on))
            self.settings.save()
            ov = getattr(self, '_overlay', None)
            if ov is not None:
                _apply_ghost_mode(ov, bool(on))
        except Exception:
            pass

    @Slot(bool)
    def setOverlayStreamSafe(self, on):
        """Toggle stream-safe overlay rendering (chunky fonts + opaque bg)."""
        try:
            self.settings.set('overlay_stream_safe', bool(on))
            self.settings.save()
            ov = getattr(self, '_overlay', None)
            if ov is not None and hasattr(ov, 'set_stream_safe'):
                ov.set_stream_safe(bool(on))
        except Exception:
            pass

    @Slot(str)
    def applyMidnightCustomColor(self, hex_color):
        """Persist the user's custom Midnight accent color."""
        try:
            self.settings.set('midnight_custom_color', hex_color or "")
            self.settings.save()
        except Exception:
            pass

    @Slot(str)
    def unlockAchievement(self, name):
        """Record an achievement unlock with timestamp. No-op if already
        unlocked. Plays a unique tone."""
        try:
            unlocked = dict(self.settings.get('achievements_unlocked') or {})
            if name in unlocked:
                return
            from datetime import datetime
            unlocked[name] = datetime.now().isoformat()
            self.settings.set('achievements_unlocked', unlocked)
            self.settings.save()
            # Distinctive 4-note arpeggio for an achievement
            play_tones((523, 70), (659, 70), (784, 70), (1047, 130))
        except Exception:
            pass

    @Slot(str)
    def playSoundEffect(self, kind):
        """Play one of the per-function sound effects. Honors the
        sound_effects_enabled and sound_effects_volume settings."""
        try:
            if not self.settings.get('sound_effects_enabled'):
                return
            kind = (kind or "").lower()
            sequences = {
                'lag':      [(660, 80), (440, 120)],                  # downward warble
                'drop':     [(1500, 30), (700, 30), (300, 80)],       # laser zap
                'throttle': [(880, 80), (660, 80), (440, 80)],        # squeezed-down
                'freeze':   [(1200, 40), (1000, 40), (800, 40), (600, 80)],  # crystallize
                'block':    [(220, 200)],                             # heavy thump
                'fun':      [(440, 30), (880, 30), (220, 30), (1100, 30), (550, 60)],  # glitch chaos
                'preset':   [(523, 50), (784, 80)],                   # quick chime
                'achievement': [(523, 70), (659, 70), (784, 70), (1047, 130)],
            }
            seq = sequences.get(kind)
            if seq:
                play_tones(*seq)
        except Exception:
            pass

    @Slot(result=str)
    def getAchievements(self):
        try:
            return json.dumps(self.settings.get('achievements_unlocked') or {})
        except Exception:
            return "{}"

    @Slot(str, result=bool)
    def addUserPreset(self, json_preset):
        """Save a user-defined quick preset."""
        try:
            preset = json.loads(json_preset) if json_preset else None
            if not isinstance(preset, dict) or 'name' not in preset:
                return False
            existing = list(self.settings.get('user_quick_presets') or [])
            existing = [p for p in existing if p.get('name') != preset['name']]
            existing.insert(0, preset)
            existing = existing[:24]
            self.settings.set('user_quick_presets', existing)
            self.settings.save()
            return True
        except Exception:
            return False

    @Slot(str, result=bool)
    def deleteUserPreset(self, name):
        try:
            existing = list(self.settings.get('user_quick_presets') or [])
            existing = [p for p in existing if p.get('name') != name]
            self.settings.set('user_quick_presets', existing)
            self.settings.save()
            return True
        except Exception:
            return False

    @Slot(result=str)
    def getUserPresets(self):
        try:
            return json.dumps(list(self.settings.get('user_quick_presets') or []))
        except Exception:
            return "[]"

    # ============================================================
    # Phase 2 bridge slots — Connection Inspector, Recording,
    # Domain blocklist, Geo blocking, Practice ping
    # ============================================================

    @Slot(result=str)
    def getConnections(self):
        """Snapshot of the rich per-connection table for the Inspector."""
        try:
            with self.controller.conn_lock:
                items = list(self.controller.connection_table.values())
            now = time.monotonic()
            with self.controller.config_lock:
                target_pids = set(self.controller.config.target_pids)
            out = []
            for info in items:
                # Only show our targeted app's connections — Inspector is
                # specifically about understanding the targeted app
                if target_pids and info.pid not in target_pids:
                    continue
                age = max(0, now - info.established_at)
                idle = max(0, now - info.last_seen)
                out.append({
                    "pid": info.pid,
                    "proto": info.proto,
                    "local": f"{info.local_addr}:{info.local_port}" if info.local_addr else f":{info.local_port}",
                    "remote": f"{info.remote_addr}:{info.remote_port}" if info.remote_addr else "",
                    "remote_addr": info.remote_addr,
                    "remote_port": info.remote_port,
                    "bytes_in": info.bytes_in,
                    "bytes_out": info.bytes_out,
                    "packets_in": info.packets_in,
                    "packets_out": info.packets_out,
                    "age_s": round(age, 1),
                    "idle_s": round(idle, 1),
                    "hostname": info.hostname,
                    "country": info.country or "",
                })
            # Sort: most recently active first
            out.sort(key=lambda r: r["idle_s"])
            return json.dumps(out)
        except Exception:
            return "[]"

    @Slot(result=str)
    def exportConnectionsCSV(self):
        """v2.5.2 — Export the current connection list as CSV via a Save dialog.
        Returns JSON {ok, path, count, error}.

        CSV columns mirror the Inspector table plus the extra fields shown in
        the v2.5.2 detail modal — process ID, full local/remote address, proto,
        country, hostname, bytes/packets in/out, age, idle, established time."""
        try:
            from PySide6.QtWidgets import QFileDialog
            import csv as _csv

            # Snapshot the connection table (same logic as getConnections)
            with self.controller.conn_lock:
                items = list(self.controller.connection_table.values())
            now = time.monotonic()
            with self.controller.config_lock:
                target_pids = set(self.controller.config.target_pids)
            rows = []
            for info in items:
                if target_pids and info.pid not in target_pids:
                    continue
                rows.append(info)
            rows.sort(key=lambda i: max(0, now - i.last_seen))

            default_name = f"throttlr-connections-{datetime.now().strftime('%Y-%m-%d_%H-%M')}.csv"
            path, _ = QFileDialog.getSaveFileName(
                None,
                "Export Connections to CSV",
                default_name,
                "CSV File (*.csv);;All Files (*)"
            )
            if not path:
                return json.dumps({"ok": False, "cancelled": True, "error": ""})

            # Pick a sensible export timestamp once; per-row times are derived from it
            export_time = datetime.now().isoformat(timespec='seconds')

            with open(path, "w", encoding="utf-8", newline="") as f:
                writer = _csv.writer(f)
                writer.writerow([
                    "hostname", "remote_addr", "remote_port",
                    "local_addr", "local_port",
                    "country", "proto", "pid",
                    "bytes_in", "bytes_out", "total_bytes",
                    "packets_in", "packets_out",
                    "age_seconds", "idle_seconds",
                    "exported_at",
                ])
                for info in rows:
                    age = max(0, now - info.established_at)
                    idle = max(0, now - info.last_seen)
                    total = info.bytes_in + info.bytes_out
                    writer.writerow([
                        info.hostname or "",
                        info.remote_addr or "",
                        info.remote_port or 0,
                        info.local_addr or "",
                        info.local_port or 0,
                        info.country or "",
                        info.proto or "",
                        info.pid or 0,
                        info.bytes_in or 0,
                        info.bytes_out or 0,
                        total,
                        info.packets_in or 0,
                        info.packets_out or 0,
                        round(age, 2),
                        round(idle, 2),
                        export_time,
                    ])
            return json.dumps({
                "ok": True, "path": path, "count": len(rows), "error": ""
            })
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    # ---- Domain blocklist ----
    @Slot(bool)
    def setDomainBlockOn(self, on):
        with self.controller.config_lock:
            self.controller.config.domain_block_on = bool(on)

    @Slot(str)
    def setDomainBlockLists(self, json_lists):
        """Active built-in lists, e.g. ["ads","trackers"]."""
        try:
            lst = json.loads(json_lists) if json_lists else []
            if not isinstance(lst, list):
                return
            with self.controller.config_lock:
                self.controller.config.domain_block_lists = [str(x) for x in lst]
        except Exception:
            pass

    @Slot(str)
    def setDomainBlockCustom(self, json_domains):
        try:
            lst = json.loads(json_domains) if json_domains else []
            if not isinstance(lst, list):
                return
            with self.controller.config_lock:
                self.controller.config.domain_block_custom = [str(x) for x in lst]
        except Exception:
            pass

    @Slot(result=str)
    def getDomainBlocklistInfo(self):
        """Return both the available built-in lists (with sample domains)
        and the user's current selection/customs."""
        try:
            avail = {}
            for name, items in BUILTIN_BLOCKLISTS.items():
                avail[name] = {
                    "count": len(items),
                    "sample": list(items[:5]),
                }
            with self.controller.config_lock:
                cfg = self.controller.config
                state = {
                    "available": avail,
                    "active_lists": list(cfg.domain_block_lists),
                    "custom": list(cfg.domain_block_custom),
                    "on": bool(cfg.domain_block_on),
                }
            return json.dumps(state)
        except Exception:
            return "{}"

    # ---- Geo blocking ----
    @Slot(bool)
    def setGeoBlockOn(self, on):
        with self.controller.config_lock:
            self.controller.config.geo_block_on = bool(on)

    @Slot(str)
    def setGeoBlockCountries(self, json_codes):
        try:
            lst = json.loads(json_codes) if json_codes else []
            if not isinstance(lst, list):
                return
            with self.controller.config_lock:
                self.controller.config.geo_block_countries = [str(x).upper() for x in lst]
        except Exception:
            pass

    @Slot(result=str)
    def getGeoBlockState(self):
        try:
            with self.controller.config_lock:
                cfg = self.controller.config
                return json.dumps({
                    "on": bool(cfg.geo_block_on),
                    "countries": list(cfg.geo_block_countries),
                })
        except Exception:
            return "{}"

    # ---- Practice ping ----
    @Slot(int)
    def applyPracticePing(self, target_ms):
        """Apply the practice-ping target by configuring the lag function."""
        try:
            target_ms = max(0, min(2000, int(target_ms)))
            with self.controller.config_lock:
                cfg = self.controller.config
                cfg.practice_ping_on = target_ms > 0
                cfg.practice_ping_target_ms = target_ms
                cfg.lag_on = target_ms > 0
                cfg.lag_inbound = True
                cfg.lag_outbound = True
                cfg.lag_ms = target_ms
                # Add a small jitter (~10% of target, max 30ms) for realism
                cfg.lag_jitter_ms = min(30, target_ms // 10)
        except Exception:
            pass

    # ---- Recording / Replay ----
    @Slot(result=bool)
    def startRecording(self):
        try:
            target = self.controller.config.target_name
            self.recorder.start(target)
            return True
        except Exception:
            return False

    @Slot(result=str)
    def stopRecording(self):
        """Stop and persist. Returns the saved file path or "" on failure."""
        try:
            return self.recorder.stop()
        except Exception:
            return ""

    @Slot(result=bool)
    def isRecording(self):
        return bool(self.recorder.recording)

    @Slot(result=str)
    def listRecordings(self):
        try:
            return json.dumps(self.recorder.list_recordings())
        except Exception:
            return "[]"

    @Slot(str, result=str)
    def loadRecording(self, path):
        try:
            return json.dumps(self.recorder.load_recording(path))
        except Exception:
            return "{}"

    @Slot(str, result=bool)
    def deleteRecording(self, path):
        try:
            return self.recorder.delete_recording(path)
        except Exception:
            return False

    # ============================================================
    # Phase 4 (v2.7.0) — Throttlr Studio
    # ============================================================

    @Slot(str, result=str)
    def getStudioTimeline(self, path):
        """Load a recording and return its editable event-list shape.
        Returns JSON: {ok, duration_ms, target, started, events, error}."""
        try:
            data = self.recorder.load_recording(path)
            if not data:
                return json.dumps({"ok": False, "error": "Could not read recording"})
            tl = self.recorder.frames_to_events(data.get("frames", []) or [])
            return json.dumps({
                "ok":          True,
                "duration_ms": tl["duration_ms"],
                "events":      tl["events"],
                "target":      data.get("target", ""),
                "started":     data.get("started", ""),
                "ended":       data.get("ended",   ""),
                "edited":      data.get("edited",  ""),
            })
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(str, str, str, int, result=str)
    def saveStudioTimeline(self, src_path, dest_path, events_json, duration_ms):
        """Save edited events back to a .thrtlrec file.
        - src_path: original recording path (for stats lookup + metadata)
        - dest_path: where to write the new file (same as src for overwrite,
                     or a new path for 'Save as')
        - events_json: JSON-encoded event list
        - duration_ms: total recording duration in milliseconds
        Returns JSON: {ok, path, count, error}."""
        try:
            events = json.loads(events_json) if events_json else []
            if not isinstance(events, list):
                return json.dumps({"ok": False, "error": "events must be a JSON array"})
            # If dest_path is empty/relative, default to overwriting source
            if not dest_path or not dest_path.strip():
                dest_path = src_path
            # Safety: only allow writing inside RECORDINGS_DIR
            try:
                if Path(dest_path).resolve().parent != RECORDINGS_DIR.resolve():
                    return json.dumps({"ok": False, "error": "Destination must be inside the recordings folder"})
            except Exception:
                pass
            ok, err = self.recorder.save_edited_recording(
                src_path, dest_path, events, int(duration_ms))
            return json.dumps({
                "ok":    ok,
                "path":  dest_path if ok else "",
                "count": len(events),
                "error": err,
            })
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(str, result=str)
    def cloneRecordingForEdit(self, src_path):
        """Make a 'Save as' copy of the source path with '-edited' suffix.
        Returns JSON: {ok, new_path, error}."""
        try:
            p = Path(src_path)
            if not p.exists():
                return json.dumps({"ok": False, "error": "source not found"})
            stem = p.stem
            base = f"{stem}-edited"
            new_p = p.parent / f"{base}.thrtlrec"
            i = 2
            while new_p.exists():
                new_p = p.parent / f"{base}-{i}.thrtlrec"
                i += 1
            shutil.copy2(p, new_p)
            return json.dumps({"ok": True, "new_path": str(new_p)})
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(result=str)
    def getRecordingsFolder(self):
        try:
            return str(RECORDINGS_DIR)
        except Exception:
            return ""

    @Slot(result=bool)
    def openRecordingsFolder(self):
        """Open the recordings folder in the OS file browser."""
        try:
            path = str(RECORDINGS_DIR)
            if sys.platform == "win32":
                os.startfile(path)
            elif sys.platform == "darwin":
                import subprocess
                subprocess.Popen(["open", path])
            else:
                import subprocess
                subprocess.Popen(["xdg-open", path])
            return True
        except Exception:
            return False

    # ============================================================
    # Phase 3 bridge slots — Topology, PCAP, Filter scripting
    # ============================================================

    @Slot(result=str)
    def getTopology(self):
        """Snapshot of the connection table, aggregated for the topology
        graph: groups connections by remote IP and tallies bytes/count
        per remote endpoint."""
        try:
            with self.controller.conn_lock:
                items = list(self.controller.connection_table.values())
            with self.controller.config_lock:
                target_pids = set(self.controller.config.target_pids)
                target_name = self.controller.config.target_name
            agg = {}
            for info in items:
                if target_pids and info.pid not in target_pids:
                    continue
                if not info.remote_addr:
                    continue
                key = info.remote_addr
                slot = agg.setdefault(key, {
                    "addr": info.remote_addr,
                    "host": info.hostname or "",
                    "country": info.country or "",
                    "ports": set(),
                    "bytes_in": 0,
                    "bytes_out": 0,
                    "conns": 0,
                    "proto": info.proto,
                })
                slot["ports"].add(info.remote_port)
                slot["bytes_in"] += info.bytes_in
                slot["bytes_out"] += info.bytes_out
                slot["conns"] += 1
                # Prefer hostnames as we discover them
                if info.hostname and not slot["host"]:
                    slot["host"] = info.hostname
            nodes = []
            for k, v in agg.items():
                v["ports"] = sorted(list(v["ports"]))[:6]
                nodes.append(v)
            return json.dumps({
                "target": target_name or "",
                "nodes": nodes,
            })
        except Exception:
            return json.dumps({"target": "", "nodes": []})

    # ---- PCAP recording ----
    @Slot(result=bool)
    def startPcap(self):
        try:
            target = self.controller.config.target_name
            return bool(self.controller.pcap_writer.start(target))
        except Exception:
            return False

    @Slot(result=str)
    def stopPcap(self):
        try:
            return self.controller.pcap_writer.stop()
        except Exception:
            return ""

    @Slot(result=bool)
    def isPcapRecording(self):
        return bool(self.controller.pcap_writer.recording)

    @Slot(result=str)
    def getPcapStats(self):
        try:
            pw = self.controller.pcap_writer
            return json.dumps({
                "recording": pw.recording,
                "path": pw.path,
                "packets": pw.packet_count,
                "bytes": pw.byte_count,
            })
        except Exception:
            return "{}"

    @Slot(result=str)
    def listPcaps(self):
        try:
            return json.dumps(self.controller.pcap_writer.list_pcaps())
        except Exception:
            return "[]"

    @Slot(str, result=bool)
    def deletePcap(self, path):
        try:
            return self.controller.pcap_writer.delete_pcap(path)
        except Exception:
            return False

    @Slot(result=bool)
    def openPcapFolder(self):
        try:
            path = str(PCAP_DIR)
            if sys.platform == "win32":
                os.startfile(path)
            elif sys.platform == "darwin":
                import subprocess; subprocess.Popen(["open", path])
            else:
                import subprocess; subprocess.Popen(["xdg-open", path])
            return True
        except Exception:
            return False

    # ---- Filter scripting ----
    @Slot(str, result=str)
    def compileFilterScript(self, source):
        """Compile a filter expression. Returns JSON {ok, error}."""
        try:
            fs = FilterScript(source or "")
            if fs.compiled or not source.strip():
                self.controller.filter_script = fs if fs.compiled else None
                return json.dumps({"ok": True, "error": ""})
            return json.dumps({"ok": False, "error": fs.error})
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})

    @Slot(bool)
    def setFilterScriptOn(self, on):
        with self.controller.config_lock:
            self.controller.config.script_on = bool(on)

    @Slot(str)
    def setFilterScriptAction(self, action):
        if action in ("drop", "keep_only", "lag", "log"):
            with self.controller.config_lock:
                self.controller.config.script_action = action

    @Slot(str)
    def setFilterScriptSource(self, source):
        """Save the source string to config (for persistence/display).
        Compilation is separate via compileFilterScript."""
        with self.controller.config_lock:
            self.controller.config.script_source = source or ""

    @Slot(result=str)
    def getFilterScriptState(self):
        try:
            with self.controller.config_lock:
                cfg = self.controller.config
                fs = self.controller.filter_script
                return json.dumps({
                    "source": cfg.script_source,
                    "action": cfg.script_action,
                    "on": cfg.script_on,
                    "compiled": bool(fs and fs.compiled),
                    "error": fs.error if fs else "",
                })
        except Exception:
            return "{}"

    # ============================================================
    # Onboarding — first-launch tutorial + update log
    # ============================================================

    @Slot(result=str)
    def getOnboardingState(self):
        """Return what onboarding flow (if any) should fire on this launch.
        - If the user has never seen the tutorial → mode = 'tutorial'
        - Else if last_seen_version differs from current → mode = 'changelog'
        - Else → mode = 'none'
        Tutorial trumps changelog — first-time users get the tutorial only,
        and tutorial completion records current version as seen so they
        don't double-prompt."""
        try:
            seen = bool(self.settings.get('tutorial_seen'))
            last_v = str(self.settings.get('last_seen_version') or "")
            cur_v = __version__
            if not seen:
                mode = 'tutorial'
            elif last_v != cur_v:
                mode = 'changelog'
            else:
                mode = 'none'
            return json.dumps({
                "mode": mode,
                "tutorial_seen": seen,
                "last_seen_version": last_v,
                "current_version": cur_v,
            })
        except Exception:
            return json.dumps({"mode": "none", "current_version": __version__})

    @Slot()
    def markTutorialSeen(self):
        """Mark the tutorial as completed. Does NOT touch last_seen_version
        — first-time users see the tutorial AND THEN the changelog right
        after, so they get a full intro to what's already in the app."""
        try:
            self.settings.set('tutorial_seen', True)
        except Exception:
            pass

    @Slot()
    def markVersionSeen(self):
        """User dismissed the changelog — record current version."""
        try:
            self.settings.set('last_seen_version', __version__)
        except Exception:
            pass

    @Slot()
    def resetTutorial(self):
        """Re-trigger the tutorial on next launch. Wired from Settings."""
        try:
            self.settings.set('tutorial_seen', False)
        except Exception:
            pass

    @Slot(result=str)
    def getChangelog(self):
        """Return the bundled changelog as JSON for the update-log modal."""
        try:
            return json.dumps(CHANGELOG)
        except Exception:
            return "[]"

    @Slot(result=str)
    def getCurrentVersion(self):
        return __version__

    # ============================================================
    # Auto-update — bridge slots
    # ============================================================

    @Slot(result=str)
    def getUpdateInfo(self):
        """Return current update-check state as JSON for the UI.
        Includes the user's previously-dismissed version so the UI can
        decide whether to show the modal proactively or just badge the
        Settings → Info tab."""
        try:
            state = update_checker.get_state() if update_checker else {
                "checked": False, "available": False, "current": __version__,
                "latest": "", "body": "", "html_url": GITHUB_RELEASES_URL,
                "zip_url": "", "error": "checker not initialized",
            }
            state["dismissed_version"] = str(self.settings.get('dismissed_update_version') or "")
            # The "should we prompt now?" flag — true only if there IS an update
            # AND the user hasn't already dismissed THIS specific version.
            state["should_prompt"] = bool(
                state.get("available") and state.get("latest")
                and state["latest"] != state["dismissed_version"]
            )
            return json.dumps(state)
        except Exception as e:
            return json.dumps({
                "checked": False, "available": False, "should_prompt": False,
                "current": __version__, "error": f"{type(e).__name__}: {e}",
            })

    @Slot()
    def recheckUpdate(self):
        """Manually re-trigger the GitHub check (e.g. user clicks "Check now"
        in Settings → Info). No-op if a check is already in flight."""
        try:
            if update_checker:
                update_checker.kick_off()
        except Exception:
            pass

    @Slot(str)
    def dismissUpdate(self, version):
        """User chose 'Not now' — remember which version they skipped so we
        don't prompt again for THIS version. Newer releases will still prompt."""
        try:
            v = str(version or "").strip()
            if v:
                self.settings.set('dismissed_update_version', v)
        except Exception:
            pass

    @Slot()
    def applyUpdate(self):
        """Kick off the update in a background thread so the UI stays responsive.
        Progress messages and the final result are emitted via the
        updateStatus signal — JS subscribes to that signal to update the
        modal text and trigger app exit when ready.

        Phases emitted: 'starting', 'downloading', 'extracting',
        'preparing', 'ready' (=> JS should call quitForUpdate), 'error'."""
        try:
            state = update_checker.get_state() if update_checker else {}
            zip_url = state.get("zip_url") or ""
            tag = state.get("latest") or ""
            if not zip_url:
                self.updateStatus.emit(json.dumps({
                    "phase": "error",
                    "ok": False,
                    "error": "No download URL is available for this release.",
                }))
                return

            # Spawn worker thread — applyUpdate returns immediately so the
            # JS event loop and Qt UI thread stay free
            self.updateStatus.emit(json.dumps({
                "phase": "starting",
                "message": "Starting…",
            }))
            t = threading.Thread(
                target=self._do_apply_update,
                args=(zip_url, tag),
                daemon=True,
            )
            t.start()
        except Exception as e:
            self.updateStatus.emit(json.dumps({
                "phase": "error",
                "ok": False,
                "error": f"{type(e).__name__}: {e}",
            }))

    def _do_apply_update(self, zip_url, tag):
        """Worker: downloads + extracts + spawns helper batch. Runs in a
        background thread. Emits updateStatus signals at each milestone.

        v2.5.1 — progress_cb now accepts an optional extras dict so download
        progress can include byte counts, transfer speed, and ETA. The full
        payload gets forwarded to the JS UI via the updateStatus signal."""
        def progress_cb(phase, message, extras=None):
            try:
                payload = {"phase": phase, "message": message}
                if extras and isinstance(extras, dict):
                    payload.update(extras)
                self.updateStatus.emit(json.dumps(payload))
            except Exception:
                pass

        try:
            ok, err = install_update_and_relaunch(zip_url, tag, progress_cb=progress_cb)
            if ok:
                self.updateStatus.emit(json.dumps({
                    "phase": "ready",
                    "message": "Restarting…",
                    "ok": True,
                }))
            else:
                self.updateStatus.emit(json.dumps({
                    "phase": "error",
                    "ok": False,
                    "error": err,
                }))
        except Exception as e:
            self.updateStatus.emit(json.dumps({
                "phase": "error",
                "ok": False,
                "error": f"{type(e).__name__}: {e}",
            }))

    @Slot()
    def quitForUpdate(self):
        """JS calls this after applyUpdate() returned ok=true so the app
        exits cleanly and the helper batch can swap the files."""
        try:
            QApplication.instance().quit()
        except Exception:
            pass

    @Slot(result=str)
    def getSystemInfo(self):
        """Return system/runtime diagnostics for the Settings → Info tab.
        Useful for users to confirm their environment looks correct, and
        for bug reports."""
        try:
            import platform
            # Windows version — try a friendly format first, fall back to platform.platform()
            try:
                wv = sys.getwindowsversion()
                win_str = f"Windows {wv.major}.{wv.minor} (build {wv.build})"
            except Exception:
                win_str = platform.platform()

            # Admin status — uses existing helper from the module
            try:
                admin_ok = bool(is_admin())
            except Exception:
                admin_ok = False

            # WinDivert driver — already detected at import time
            pydivert_ok = bool(HAS_PYDIVERT)
            pydivert_err = "" if pydivert_ok else (PYDIVERT_ERROR or "not installed")

            # Engine state — is capture currently running?
            engine_running = False
            try:
                engine_running = bool(getattr(self.controller, 'running', False))
            except Exception:
                pass

            return json.dumps({
                "windows":      win_str,
                "python":       sys.version.split()[0],
                "admin":        admin_ok,
                "pydivert":     pydivert_ok,
                "pydivert_err": pydivert_err,
                "engine":       "running" if engine_running else "idle",
                "frozen":       bool(getattr(sys, 'frozen', False)),
            })
        except Exception as e:
            return json.dumps({
                "error": f"{type(e).__name__}: {e}",
            })

    @Slot(str, result=bool)
    def updateConfig(self, json_str):
        try:
            data = json.loads(json_str)
            self._apply_filter_config(data)
            return True
        except Exception as e:
            self.errorMessage.emit(f"Config error: {e}")
            return False

    def _apply_filter_config(self, data: dict):
        """Apply a filter-config dict to the running engine. Used by
        updateConfig (JS-driven) and also by AutomationEngine when a rule
        action requests a preset application. Phase-2 and Phase-3 fields
        (domain block, geo block, practice ping, filter script) are preserved
        from the existing config — they have dedicated bridge slots and don't
        belong in the generic 6-function preset payload."""
        if not isinstance(data, dict):
            raise ValueError("filter config must be a dict")
        with self.controller.config_lock:
            cfg = self.controller.config
            new_cfg = FilterConfig(
                target_pids=set(cfg.target_pids),
                target_name=cfg.target_name,
                target_names=list(cfg.target_names),
                lag_on=data.get("lag_on", False),
                lag_inbound=data.get("lag_in", True),
                lag_outbound=data.get("lag_out", True),
                lag_ms=int(data.get("lag_ms", 500)),
                lag_jitter_ms=int(data.get("lag_jitter_ms", 0)),
                drop_on=data.get("drop_on", False),
                drop_inbound=data.get("drop_in", True),
                drop_outbound=data.get("drop_out", True),
                drop_chance=int(data.get("drop_chance", 60)),
                drop_dns_only=bool(data.get("drop_dns_only", False)),
                throttle_on=data.get("throttle_on", False),
                throttle_inbound=data.get("throttle_in", True),
                throttle_outbound=data.get("throttle_out", True),
                throttle_kbps=int(data.get("throttle_kbps", 100)),
                freeze_on=data.get("freeze_on", False),
                freeze_inbound=data.get("freeze_in", True),
                freeze_outbound=data.get("freeze_out", True),
                freeze_replay_ms=int(data.get("freeze_replay_ms", 0)),
                block_on=data.get("block_on", False),
                block_inbound=data.get("block_in", True),
                block_outbound=data.get("block_out", True),
                fun_mode=data.get("fun_on", False),
                fun_intensity=int(data.get("fun_intensity", 50)),
                domain_block_on=cfg.domain_block_on,
                domain_block_lists=list(cfg.domain_block_lists),
                domain_block_custom=list(cfg.domain_block_custom),
                geo_block_on=cfg.geo_block_on,
                geo_block_countries=list(cfg.geo_block_countries),
                practice_ping_on=cfg.practice_ping_on,
                practice_ping_target_ms=cfg.practice_ping_target_ms,
                script_source=cfg.script_source,
                script_action=cfg.script_action,
                script_on=cfg.script_on,
            )
        self.controller.update_config(new_cfg)

    @Slot()
    def startCapture(self):
        # Re-resolve target_pids right now in case the target app spawned
        # or restarted since selection. This prevents the very common case
        # where Discord/Chrome/games launch helper processes between when
        # the user picks the app and when they hit Start.
        try:
            self.controller._refresh_target_pids()
        except Exception:
            pass

        if not self.controller.config.target_pids:
            self.errorMessage.emit("No app selected — pick one from the list.")
            return
        play_tones((523, 60), (659, 60), (784, 90))
        # Always reset stats on Start — every run is a fresh measurement.
        # The reset_stats_on_start setting is kept for backward-compat but
        # we always reset; preserving stale stats across runs is confusing
        # (sent/dropped/delayed/held don't mean anything from a previous app).
        self.controller.reset_stats()
        self.controller.start()

    @Slot()
    def stopCapture(self):
        play_tones((784, 60), (659, 60), (523, 90))
        # v2.5.2 — run stop on a background thread so the GUI stays responsive.
        # _finalize_stop closes WinDivert handles which can briefly block the
        # caller (kernel drains its receive buffer); doing it inline on the Qt
        # main thread caused ~1s UI freeze right after clicking Stop.
        threading.Thread(target=self.controller.stop, daemon=True).start()

    @Slot()
    def resetStats(self):
        self.controller.reset_stats()

    @Slot(bool)
    def toggleFreeze(self, on):
        play_tones((880, 90)) if on else play_tones((440, 90))
        if not on and self.settings.get("auto_clear_freeze_queue"):
            self.controller.clear_freeze_queue()

    @Slot(bool)
    def toggleBlock(self, on):
        play_tones((1100, 80)) if on else play_tones((550, 80))

    @Slot(bool)
    def toggleFun(self, on):
        play_tones((660, 60), (880, 60), (1100, 80)) if on else play_tones((440, 80))

    @Slot(result=int)
    def clearFreezeQueue(self):
        return self.controller.clear_freeze_queue()

    @Slot(result=str)
    def listProfiles(self):
        try:
            files = sorted(p.stem for p in PROFILE_DIR.glob("*.json")
                           if p.name != "settings.json")
            return json.dumps(files)
        except Exception:
            return "[]"

    @Slot(str, str, result=bool)
    def saveProfile(self, name, json_str):
        try:
            safe = "".join(c for c in name if c.isalnum() or c in "-_ ").strip()
            if not safe:
                return False
            (PROFILE_DIR / f"{safe}.json").write_text(json_str)
            return True
        except Exception:
            return False

    @Slot(str, result=str)
    def loadProfile(self, name):
        try:
            safe = "".join(c for c in name if c.isalnum() or c in "-_ ").strip()
            return (PROFILE_DIR / f"{safe}.json").read_text()
        except Exception:
            return ""

    @Slot(str, result=bool)
    def deleteProfile(self, name):
        try:
            safe = "".join(c for c in name if c.isalnum() or c in "-_ ").strip()
            (PROFILE_DIR / f"{safe}.json").unlink()
            return True
        except Exception:
            return False

    @Slot(result=bool)
    def isAdmin(self):
        return is_admin()

    @Slot(int, int)
    def playTone(self, freq, dur_ms):
        play_tones((freq, dur_ms))

    # -------- Window controls (frameless support) --------

    def set_window(self, window):
        """Called by MainWindow after construction so Bridge can drive window."""
        self._window = window

    @Slot()
    def minimizeWindow(self):
        if hasattr(self, "_window") and self._window:
            self._window.showMinimized()

    @Slot()
    def toggleMaximizeWindow(self):
        if hasattr(self, "_window") and self._window:
            if self._window.isMaximized():
                self._window.showNormal()
            else:
                self._window.showMaximized()

    @Slot()
    def closeWindow(self):
        if hasattr(self, "_window") and self._window:
            self._window.close()

    @Slot()
    def startDragWindow(self):
        if hasattr(self, "_window") and self._window:
            handle = self._window.windowHandle()
            if handle:
                handle.startSystemMove()

    @Slot(str)
    def startResizeWindow(self, edges_str):
        """edges_str like 'right', 'bottom', 'right,bottom', 'top,left', etc."""
        if not (hasattr(self, "_window") and self._window):
            return
        handle = self._window.windowHandle()
        if not handle:
            return
        # PySide6's Qt.Edge enum can't be constructed from 0 — must build int and cast
        e = 0
        if "top" in edges_str:    e |= Qt.TopEdge.value
        if "bottom" in edges_str: e |= Qt.BottomEdge.value
        if "left" in edges_str:   e |= Qt.LeftEdge.value
        if "right" in edges_str:  e |= Qt.RightEdge.value
        if e:
            handle.startSystemResize(Qt.Edges(e))

    @Slot(result=bool)
    def isMaximized(self):
        if hasattr(self, "_window") and self._window:
            return self._window.isMaximized()
        return False

    # -------- Overlay window (live preview — NOT persisted) --------
    # These slots only update runtime state. Persistence happens via
    # saveSettings (the Save button) so Cancel can revert without disk writes.

    def set_overlay(self, overlay):
        self._overlay = overlay

    @Slot(bool)
    def setOverlayVisible(self, visible):
        if hasattr(self, "_overlay") and self._overlay:
            if visible:
                self._overlay.show()
                self._overlay.raise_()
            else:
                self._overlay.hide()

    @Slot(str)
    def setOverlayMode(self, mode):
        if hasattr(self, "_overlay") and self._overlay:
            self._overlay.set_mode(mode)

    @Slot(bool)
    def setOverlayAdvanced(self, advanced):
        # Back-compat path
        if hasattr(self, "_overlay") and self._overlay:
            self._overlay.set_advanced(bool(advanced))

    @Slot(str)
    def setOverlayLayout(self, layout_json):
        """Apply a custom layout (list of {type, visible})."""
        if not (hasattr(self, "_overlay") and self._overlay):
            return
        try:
            layout = json.loads(layout_json)
            self._overlay.set_custom_layout(layout)
        except Exception:
            pass

    @Slot(int)
    def setOverlayOpacity(self, pct):
        if hasattr(self, "_overlay") and self._overlay:
            self._overlay.set_opacity_pct(int(pct))

    @Slot(bool)
    def setOverlayLocked(self, locked):
        if hasattr(self, "_overlay") and self._overlay:
            self._overlay.set_locked(bool(locked))

    @Slot(bool)
    def setScreenBorderEnabled(self, enabled):
        # Hide immediately if disabled (live preview)
        if not enabled and hasattr(self, "_screen_border") and self._screen_border:
            self._screen_border.hide_now()

    @Slot(int)
    def setScreenBorderDuration(self, ms):
        if hasattr(self, "_screen_border") and self._screen_border:
            self._screen_border.set_show_duration_ms(int(ms))

    @Slot(int)
    def setScreenBorderFeather(self, px):
        if hasattr(self, "_screen_border") and self._screen_border:
            self._screen_border.set_feather(int(px))

    @Slot()
    def previewScreenBorderRunning(self):
        """Trigger green border for preview (used by Apply preview button)."""
        if hasattr(self, "_screen_border") and self._screen_border:
            self._screen_border.show_running()

    @Slot()
    def previewScreenBorderStopped(self):
        if hasattr(self, "_screen_border") and self._screen_border:
            self._screen_border.show_stopped()

    def set_screen_border(self, sb):
        self._screen_border = sb

    @Slot(bool)
    def setMainAlwaysOnTop(self, on):
        """Toggle always-on-top on the main window. Live."""
        if hasattr(self, "_window") and self._window:
            flags = self._window.windowFlags()
            if on:
                flags |= Qt.WindowStaysOnTopHint
            else:
                flags &= ~Qt.WindowStaysOnTopHint
            # setWindowFlags hides the window — re-show it
            was_visible = self._window.isVisible()
            self._window.setWindowFlags(flags)
            if was_visible:
                self._window.show()

    @Slot(int)
    def setStatsInterval(self, ms):
        ms = max(50, min(2000, int(ms)))
        self._stats_timer.setInterval(ms)

    @Slot(int)
    def setAppsRefreshInterval(self, ms):
        ms = max(500, min(30000, int(ms)))
        self._apps_timer.setInterval(ms)

    # -------- Settings I/O --------

    @Slot(result=str)
    def exportSettingsJson(self):
        """Return all settings as a JSON string (caller can save to file)."""
        try:
            return json.dumps(self.settings.data, indent=2)
        except Exception:
            return "{}"

    # ============================================================
    # PROFILES — full app-state snapshot (target apps, function
    # settings, presets, filter script). Persists as a .throttlr
    # JSON file the user can share or back up.
    # ============================================================

    @Slot(result=str)
    def exportProfileJson(self):
        """Build a Profile JSON: target apps + current function config +
        custom presets + filter script. Returns indented JSON string."""
        try:
            with self.controller.config_lock:
                cfg = self.controller.config
                func_cfg = {
                    "lag_on": cfg.lag_on, "lag_ms": cfg.lag_ms, "lag_jitter_ms": cfg.lag_jitter_ms,
                    "lag_in": cfg.lag_in, "lag_out": cfg.lag_out,
                    "drop_on": cfg.drop_on, "drop_pct": cfg.drop_pct,
                    "drop_in": cfg.drop_in, "drop_out": cfg.drop_out,
                    "throttle_on": cfg.throttle_on, "throttle_kbps": cfg.throttle_kbps,
                    "throttle_in": cfg.throttle_in, "throttle_out": cfg.throttle_out,
                    "freeze_on": cfg.freeze_on, "freeze_in": cfg.freeze_in, "freeze_out": cfg.freeze_out,
                    "block_on": cfg.block_on, "block_in": cfg.block_in, "block_out": cfg.block_out,
                    "fun_on": cfg.fun_on, "fun_in": cfg.fun_in, "fun_out": cfg.fun_out,
                    "fun_corruption_pct": getattr(cfg, 'fun_corruption_pct', 5),
                    "fun_reorder_pct": getattr(cfg, 'fun_reorder_pct', 3),
                    "fun_duplicate_pct": getattr(cfg, 'fun_duplicate_pct', 2),
                }
                target_apps_data = list(self.settings.get('target_apps') or [])

            profile = {
                "throttlr_profile_version": 1,
                "throttlr_app_version":     __version__,
                "exported_at":              int(time.time()),
                "name":                     "Throttlr Profile",
                # The actual snapshot
                "target_apps":              target_apps_data,
                "function_config":          func_cfg,
                "custom_presets":           list(self.settings.get('user_quick_presets') or []),
                "filter_script":            self.settings.get('filter_script') or "",
                # Visual prefs (optional but nice for sharing complete vibes)
                "ui_design":                self.settings.get('ui_design'),
                "midnight_accent":          self.settings.get('midnight_accent'),
            }
            return json.dumps(profile, indent=2)
        except Exception as e:
            return json.dumps({"error": f"{type(e).__name__}: {e}"})

    @Slot(str, result=str)
    def importProfileJson(self, json_str):
        """Apply a Profile JSON. Returns JSON {ok, error, name}."""
        try:
            data = json.loads(json_str)
            if not isinstance(data, dict):
                return json.dumps({"ok": False, "error": "Not a valid profile (root must be a JSON object)."})

            # Reject obviously-wrong files
            if "function_config" not in data and "target_apps" not in data:
                return json.dumps({"ok": False, "error": "This doesn't look like a Throttlr profile — missing required fields."})

            # 1. Apply visual prefs first (before functions, so the UI re-renders correctly)
            if data.get("ui_design") in ("industrial", "midnight", "windows7", "optimised"):
                self.settings.set('ui_design', data["ui_design"])
            if data.get("midnight_accent"):
                self.settings.set('midnight_accent', data["midnight_accent"])

            # 2. Apply target apps
            if isinstance(data.get("target_apps"), list):
                self.settings.set('target_apps', data["target_apps"])

            # 3. Apply custom presets
            if isinstance(data.get("custom_presets"), list):
                self.settings.set('user_quick_presets', data["custom_presets"])

            # 4. Apply filter script
            if isinstance(data.get("filter_script"), str):
                self.settings.set('filter_script', data["filter_script"])

            # 5. Apply function config — push into the live controller config
            fc = data.get("function_config") or {}
            if isinstance(fc, dict):
                with self.controller.config_lock:
                    cfg = self.controller.config
                    for key, value in fc.items():
                        if hasattr(cfg, key):
                            try:
                                setattr(cfg, key, value)
                            except Exception:
                                pass
                # Tell the UI to re-read everything
                try:
                    self.statsChanged.emit(json.dumps({"_force_refresh": True}))
                except Exception:
                    pass

            return json.dumps({
                "ok": True,
                "error": "",
                "name": data.get("name", "Throttlr Profile"),
            })
        except json.JSONDecodeError as e:
            return json.dumps({"ok": False, "error": f"Not a valid JSON file: {e}"})
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(result=str)
    def saveProfileToFile(self):
        """Open a Save dialog, write profile JSON to chosen path. Returns
        JSON {ok, path, error}."""
        try:
            from PySide6.QtWidgets import QFileDialog
            default_name = f"throttlr-profile-{datetime.now().strftime('%Y-%m-%d')}.throttlr"
            path, _ = QFileDialog.getSaveFileName(
                None,
                "Export Throttlr Profile",
                default_name,
                "Throttlr Profile (*.throttlr);;JSON (*.json);;All Files (*)"
            )
            if not path:
                return json.dumps({"ok": False, "cancelled": True, "error": ""})
            profile_json = self.exportProfileJson()
            with open(path, "w", encoding="utf-8") as f:
                f.write(profile_json)
            return json.dumps({"ok": True, "path": path, "error": ""})
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(result=str)
    def loadProfileFromFile(self):
        """Open an Open dialog, read .throttlr file, apply it. Returns
        JSON {ok, path, name, error}."""
        try:
            from PySide6.QtWidgets import QFileDialog
            path, _ = QFileDialog.getOpenFileName(
                None,
                "Import Throttlr Profile",
                "",
                "Throttlr Profile (*.throttlr);;JSON (*.json);;All Files (*)"
            )
            if not path:
                return json.dumps({"ok": False, "cancelled": True, "error": ""})
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            apply_result = json.loads(self.importProfileJson(content))
            apply_result["path"] = path
            return json.dumps(apply_result)
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(str, result=str)
    def loadProfileFromPath(self, path):
        """Apply a .throttlr file from a given path (used for drag-drop).
        Returns JSON {ok, path, name, error}."""
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
            apply_result = json.loads(self.importProfileJson(content))
            apply_result["path"] = path
            return json.dumps(apply_result)
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(str, result=bool)
    def importSettingsJson(self, json_str):
        """Apply settings from a JSON string. Returns success bool."""
        try:
            data = json.loads(json_str)
            if not isinstance(data, dict):
                return False
            for k, v in data.items():
                if k in DEFAULT_SETTINGS:
                    self.settings.set(k, v)
            self.settings.save()
            return True
        except Exception:
            return False

    @Slot(result=bool)
    def resetSettingsToDefaults(self):
        try:
            self.settings.data = dict(DEFAULT_SETTINGS)
            self.settings.save()
            return True
        except Exception:
            return False

    @Slot(result=bool)
    def isOverlayVisible(self):
        if hasattr(self, "_overlay") and self._overlay:
            return self._overlay.isVisible()
        return False

    @Slot(result=str)
    def getDiagnostics(self):
        """Snapshot of the current capture state — for the user to verify
        the app is wired up correctly. Returned as JSON for the JS side
        to format and show."""
        try:
            cfg = self.controller.config
            with self.controller.freeze_lock:
                fq = len(self.controller.freeze_queue)
            with self.controller.delay_lock:
                dq = len(self.controller.delay_queue)
            with self.controller.conn_lock:
                cmap_size = len(self.controller.conn_map)
            data = {
                "target_name": cfg.target_name or "",
                "target_pid_count": len(cfg.target_pids),
                "running": bool(self.controller.running),
                "flow_listener": bool(self.controller.flow_handle is not None),
                "conn_map_size": cmap_size,
                "lag_on": bool(cfg.lag_on),  "lag_ms": int(cfg.lag_ms),
                "drop_on": bool(cfg.drop_on), "drop_chance": int(cfg.drop_chance),
                "throttle_on": bool(cfg.throttle_on), "throttle_kbps": int(cfg.throttle_kbps),
                "freeze_on": bool(cfg.freeze_on), "freeze_queue_len": fq,
                "block_on": bool(cfg.block_on),
                "fun_mode": bool(cfg.fun_mode),
                "delay_queue_len": dq,
                "packets_seen": int(cfg.packets_seen),
                "packets_dropped": int(cfg.packets_dropped),
                "packets_delayed": int(cfg.packets_delayed),
                "packets_held": int(cfg.packets_held),
            }
            return json.dumps(data)
        except Exception as e:
            return json.dumps({"error": str(e)})

    # ============================================================
    # AUTOMATION RULES — Phase 3 (v2.6.0)
    # ============================================================

    @Slot(result=str)
    def getAutomationRules(self):
        """Return the rule list as JSON. Each rule:
        {id, name, enabled, condition: {type, ...}, action: {type, ...}}"""
        try:
            rules = self.settings.get("automation_rules", []) or []
            engine_on = bool(self.settings.get("automation_enabled", True))
            return json.dumps({
                "engine_enabled": engine_on,
                "rules": rules,
            })
        except Exception as e:
            return json.dumps({"engine_enabled": True, "rules": [], "error": str(e)})

    @Slot(str, result=str)
    def saveAutomationRule(self, json_str):
        """Insert or update one rule. If rule has an id matching an existing
        rule, replaces it. Otherwise appends. Returns {ok, rule_id, error}."""
        try:
            rule = json.loads(json_str) if json_str else None
            if not isinstance(rule, dict):
                return json.dumps({"ok": False, "error": "rule must be a JSON object"})
            # Required fields
            if not rule.get("name"):
                return json.dumps({"ok": False, "error": "rule needs a name"})
            if not isinstance(rule.get("condition"), dict):
                return json.dumps({"ok": False, "error": "rule needs a condition"})
            if not isinstance(rule.get("action"), dict):
                return json.dumps({"ok": False, "error": "rule needs an action"})
            # Generate id if missing
            if not rule.get("id"):
                rule["id"] = uuid.uuid4().hex[:12]
            rule.setdefault("enabled", True)

            existing = list(self.settings.get("automation_rules", []) or [])
            replaced = False
            for i, r in enumerate(existing):
                if r.get("id") == rule["id"]:
                    existing[i] = rule
                    replaced = True
                    break
            if not replaced:
                existing.append(rule)
            # Cap to 50 rules to keep settings.json sane
            existing = existing[:50]
            self.settings.set("automation_rules", existing)
            self.settings.save()
            return json.dumps({"ok": True, "rule_id": rule["id"]})
        except Exception as e:
            return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(str, result=bool)
    def deleteAutomationRule(self, rule_id):
        """Remove the rule with the given id. Returns True on success."""
        try:
            if not rule_id:
                return False
            existing = list(self.settings.get("automation_rules", []) or [])
            new_list = [r for r in existing if r.get("id") != rule_id]
            if len(new_list) == len(existing):
                return False  # not found
            self.settings.set("automation_rules", new_list)
            self.settings.save()
            # Drop any cached state for the deleted rule
            try:
                if hasattr(self, "_automation") and self._automation:
                    self._automation._rule_state.pop(rule_id, None)
            except Exception:
                pass
            return True
        except Exception:
            return False

    @Slot(str, bool, result=bool)
    def setAutomationRuleEnabled(self, rule_id, on):
        """Toggle a single rule's enabled state."""
        try:
            existing = list(self.settings.get("automation_rules", []) or [])
            changed = False
            for r in existing:
                if r.get("id") == rule_id:
                    r["enabled"] = bool(on)
                    changed = True
                    break
            if not changed:
                return False
            self.settings.set("automation_rules", existing)
            self.settings.save()
            # If we just disabled a rule, reset its cached active state so it
            # doesn't immediately re-fire when re-enabled
            try:
                if hasattr(self, "_automation") and self._automation:
                    if not on:
                        self._automation._rule_state.pop(rule_id, None)
            except Exception:
                pass
            return True
        except Exception:
            return False

    @Slot(bool, result=bool)
    def setAutomationEngineEnabled(self, on):
        """Master switch for the whole automation engine."""
        try:
            self.settings.set("automation_enabled", bool(on))
            self.settings.save()
            return True
        except Exception:
            return False

    @Slot(str, result=str)
    def testAutomationCondition(self, json_str):
        """Evaluate a condition right now without saving the rule. Used by
        the rule editor for a 'Test condition' button. Returns {active, error}."""
        try:
            cond = json.loads(json_str) if json_str else {}
            if not isinstance(cond, dict):
                return json.dumps({"active": False, "error": "condition must be a JSON object"})
            if hasattr(self, "_automation") and self._automation:
                # Refresh proc cache for accurate app_running result
                self._automation._proc_cache = self._automation._snapshot_processes()
                active = bool(self._automation._check_condition(cond))
                return json.dumps({"active": active, "error": ""})
            return json.dumps({"active": False, "error": "automation engine not initialised"})
        except Exception as e:
            return json.dumps({"active": False, "error": f"{type(e).__name__}: {e}"})

    @Slot(result=str)
    def listRunningProcesses(self):
        """Return a sorted list of unique running process names — used by the
        rule editor to populate the 'app_running' condition's process picker."""
        try:
            names = set()
            for p in psutil.process_iter(['name']):
                try:
                    n = (p.info.get('name') or '').strip()
                    if n:
                        names.add(n)
                except Exception:
                    continue
            return json.dumps(sorted(names, key=lambda s: s.lower()))
        except Exception:
            return "[]"

    # ============================================================
    # LAN coordination — Phase 5 (v3.0.0)
    # ============================================================

    @Slot(result=str)
    def lanGetState(self):
        """Return current LAN state: enabled, my_name, peer list, pending pairings."""
        try:
            enabled = bool(self.settings.get("lan_sync_enabled", False))
            data = {
                "enabled":  enabled,
                "my_name":  self._lan._my_name if self._lan else "",
                "my_id":    self._lan._my_id if self._lan else "",
                "peers":    self._lan.list_peers() if (self._lan and enabled) else [],
                "pending":  self._lan.list_pending_pairings() if (self._lan and enabled) else [],
                "trusted":  self.settings.get("lan_trusted_peers", []) or [],
                "pairing_window_open": bool(self._lan and self._lan._pairing_outgoing) if enabled else False,
            }
            return json.dumps(data)
        except Exception as e:
            return json.dumps({"enabled": False, "error": str(e)})

    @Slot(bool, result=bool)
    def lanSetEnabled(self, on):
        """Master toggle for LAN sync. Starts/stops discovery threads."""
        try:
            self.settings.set("lan_sync_enabled", bool(on))
            self.settings.save()
            if not self._lan:
                return False
            if on:
                self._lan.start()
            else:
                self._lan.stop()
            return True
        except Exception:
            return False

    @Slot(str, result=bool)
    def lanSetDisplayName(self, name):
        try:
            n = (name or "").strip()[:48]
            self.settings.set("lan_display_name", n)
            self.settings.save()
            if self._lan:
                self._lan._my_name = n or self._lan._hostname()
            return True
        except Exception:
            return False

    @Slot(result=str)
    def lanOpenPairingWindow(self):
        """Open a 60s window for incoming pairing requests, return the 6-digit code."""
        try:
            if not self._lan:
                return json.dumps({"ok": False, "error": "LAN not initialised"})
            code = self._lan.open_pairing_window()
            return json.dumps({"ok": True, "code": code, "expires_s": LANCoordinator.PAIRING_WINDOW_S})
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})

    @Slot()
    def lanClosePairingWindow(self):
        try:
            if self._lan:
                self._lan.close_pairing_window()
        except Exception:
            pass

    @Slot(str, str, result=str)
    def lanRequestPair(self, target_peer_id, code):
        """Initiate pairing with a discovered peer using a 6-digit code."""
        try:
            if not self._lan:
                return json.dumps({"ok": False, "error": "LAN not initialised"})
            ok, err = self._lan.request_pair(target_peer_id, code)
            return json.dumps({"ok": ok, "error": err})
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})

    @Slot(str, result=bool)
    def lanAcceptPairing(self, peer_id):
        try:
            return bool(self._lan and self._lan.accept_pairing(peer_id))
        except Exception:
            return False

    @Slot(str, result=bool)
    def lanRejectPairing(self, peer_id):
        try:
            return bool(self._lan and self._lan.reject_pairing(peer_id))
        except Exception:
            return False

    @Slot(str, result=bool)
    def lanUnpair(self, peer_id):
        try:
            return bool(self._lan and self._lan.unpair(peer_id))
        except Exception:
            return False

    @Slot(str, str, str, result=str)
    def lanSendCommand(self, peer_id, method, params_json):
        """Send a command to a single paired peer. Returns {ok, result}."""
        try:
            if not self._lan:
                return json.dumps({"ok": False, "error": "LAN not initialised"})
            params = json.loads(params_json) if params_json else {}
            ok, result = self._lan.send_command(peer_id, method, params)
            return json.dumps({"ok": ok, "result": result})
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})

    @Slot(str, str, result=str)
    def lanBroadcastCommand(self, method, params_json):
        """Send a command to ALL paired peers. Returns dict of peer_id → result."""
        try:
            if not self._lan:
                return json.dumps({"ok": False, "error": "LAN not initialised"})
            params = json.loads(params_json) if params_json else {}
            results = self._lan.broadcast_command(method, params)
            # Convert tuples to JSON-serializable dicts
            out = {}
            for pid, (ok, result) in results.items():
                out[pid] = {"ok": ok, "result": result}
            return json.dumps({"ok": True, "results": out})
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})

    # ============================================================
    # Plugins — Phase 5 (v3.0.0)
    # ============================================================

    @Slot(result=str)
    def pluginsList(self):
        """Discover plugins in the plugins folder, return their metadata."""
        try:
            if not self._plugins:
                return json.dumps([])
            return json.dumps(self._plugins.discover())
        except Exception:
            return "[]"

    @Slot(str, result=str)
    def pluginsEnable(self, name):
        try:
            if not self._plugins:
                return json.dumps({"ok": False, "error": "plugin manager not initialised"})
            ok, err = self._plugins.enable(name)
            return json.dumps({"ok": ok, "error": err})
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})

    @Slot(str, result=bool)
    def pluginsDisable(self, name):
        try:
            return bool(self._plugins and self._plugins.disable(name))
        except Exception:
            return False

    @Slot(result=bool)
    def pluginsOpenFolder(self):
        try:
            return bool(self._plugins and self._plugins.open_folder())
        except Exception:
            return False

    @Slot(result=str)
    def pluginsGetFolder(self):
        try:
            return str(PluginManager.plugins_dir())
        except Exception:
            return ""


# ============================================================
# ============================================================
# Overlay window — small always-on-top status HUD
# ============================================================

class OverlayWindow(QWidget):
    """Floating, always-on-top status display.

    Layout-driven: an ordered list of rows each rendering a piece of state.
    Built-in presets (compact / advanced) map to specific layouts; users can
    also define custom layouts via the settings UI.
    """

    DEFAULT_WIDTH = 340
    MIN_HEIGHT = 80
    TAPE_H = 8
    PAD_TOP = 12
    PAD_BOTTOM = 10

    # Row types and their heights (in painted pixels, not including spacing)
    ROW_HEIGHT = {
        'status_row':      32,
        'status_row_kbps': 32,   # status row with KB/s on the right
        'app_row':         22,
        'stats3':          38,
        'stats4':          38,
        'kbps_row':        20,
        'volume_row':      18,
        'funcs_row':       22,
    }
    ROW_GAP = 6

    LAYOUT_COMPACT = [
        {'type': 'status_row', 'visible': True},
        {'type': 'app_row',    'visible': True},
        {'type': 'stats3',     'visible': True},
    ]
    LAYOUT_ADVANCED = [
        {'type': 'status_row_kbps', 'visible': True},
        {'type': 'app_row',         'visible': True},
        {'type': 'stats4',          'visible': True},
        {'type': 'volume_row',      'visible': True},
        {'type': 'funcs_row',       'visible': True},
    ]

    # ============================================================
    # Theme palette — Phase 5.1 (v3.0.2)
    # ============================================================
    # The overlay was previously hardcoded with industrial colors. Now it
    # mirrors the main app's theme. Each "role" maps to a concrete color
    # that depends on (ui_design, midnight_accent) settings. The palette is
    # rebuilt whenever the theme changes via refresh_theme().
    #
    # Status colors (drop=red, running=green, replay=cyan) stay CONSTANT
    # across themes — they have semantic meaning (red = bad, green = good)
    # and themeing them would actually hurt usability.

    # Industrial palette (default, hazard yellow + warm grey)
    # chrome_style: 'industrial' = sharp 1px border + zigzag hazard tape
    _INDUSTRIAL_PALETTE = {
        'chrome_style':    'industrial',
        'bg':              "#07090a",
        'bg_streamsafe':   "#020304",
        'bg_top':          None,             # only used by gradient styles
        'accent':          "#ffb800",
        'accent_dim':      "#aa7a00",
        'border_idle':     "#1d1e18",
        'tape_a':          "#ffb800",
        'tape_b':          "#000000",
        'text':            "#e8e6d8",
        'text_dim':        "#5a5e5a",
        'text_dim2':       "#aaa6a0",
        # Status colors (don't theme — semantic meaning)
        'status_running':  "#7fff6a",
        'status_running_ring': "#3aa030",
        'status_replay':   "#66ddff",
        'status_drop':     "#c41e3a",
        'status_held':     "#66ddff",
        'status_fun':      "#7fff6a",
    }
    # Midnight palette — v3.0.3 redesigned to actually feel like the main app's
    # midnight theme: deep navy, no zigzag tape (replaced with a soft accent
    # bar that fades horizontally), softer text, subtle glow on the border.
    # chrome_style: 'midnight' = soft 2px glow border, gradient tape bar
    _MIDNIGHT_BASE = {
        'chrome_style':    'midnight',
        'bg':              "#0a0e1a",        # matches main app --bg
        'bg_streamsafe':   "#04060d",
        'bg_top':          "#11162a",        # subtle top→bottom panel gradient
        'accent_dim':      None,             # derived from accent at runtime
        'border_idle':     "#1f264a",        # main app --steel
        'tape_b':          None,             # no zigzag tape — see chrome_style
        'text':            "#e6ebf6",        # main app --bone
        'text_dim':        "#5a6a8a",
        'text_dim2':       "#a0b0d0",
        'status_running':  "#66e5b8",        # main app --term (mint)
        'status_running_ring': "#4ab590",    # main app --term-dim
        'status_replay':   "#7fbfff",
        'status_drop':     "#ff7b8a",        # main app --blood
        'status_held':     "#7fbfff",
        'status_fun':      "#a78bfa",
    }
    _MIDNIGHT_ACCENTS = {
        'aurora':  "#7fbfff",
        'sunset':  "#ff9e7a",
        'forest':  "#66e5b8",
        'amber':   "#ffc66e",
        'rose':    "#ff8ab2",
        'ocean':   "#5da9ff",
    }
    # Windows 7 palette — v3.0.3. The classic "Aero glass" look: light grey
    # background, cornflower blue accents, subtle gradients, rounded edges.
    # chrome_style: 'windows7' = glass-blue gradient bar + 1px subtle border
    _WINDOWS7_PALETTE = {
        'chrome_style':    'windows7',
        'bg':              "#eaf3fc",        # very pale frost-blue (Aero panel)
        'bg_streamsafe':   "#dde8f5",
        'bg_top':          "#ffffff",        # subtle white-to-frost-blue gradient
        'accent':          "#1a6cb6",        # Aero cornflower-deep
        'accent_dim':      "#3380bd",
        'border_idle':     "#9bb6d4",        # soft slate-blue
        'tape_a':          "#79b3eb",        # light Aero blue
        'tape_b':          "#3380bd",        # mid Aero blue (gradient stops)
        'text':            "#1c1c1c",        # dark grey on light bg
        'text_dim':        "#7a8a99",
        'text_dim2':       "#3a4a5c",
        # Status colors retained
        'status_running':  "#1f9c2f",        # Aero green (slightly darker for contrast on light bg)
        'status_running_ring': "#1f7c25",
        'status_replay':   "#2070b8",        # Aero blue
        'status_drop':     "#c52b2b",
        'status_held':     "#2070b8",
        'status_fun':      "#a040b8",
    }
    # Optimised palette — v3.0.4. Maximum performance: solid colors, no
    # gradients, no glow effects. Designed for low-end systems / older
    # hardware / users who want the most efficient render.
    # chrome_style: 'optimised' = solid 1px border, solid 2px accent line at top
    _OPTIMISED_PALETTE = {
        'chrome_style':    'optimised',
        'bg':              "#1e1e1e",        # neutral dark grey
        'bg_streamsafe':   "#0c0c0c",
        'bg_top':          None,             # no gradient
        'accent':          "#4ec9b0",        # VS Code-ish teal — readable, doesn't flicker
        'accent_dim':      "#3a8c7c",
        'border_idle':     "#3c3c3c",
        'tape_a':          "#4ec9b0",
        'tape_b':          None,             # no zigzag — chrome paints solid line
        'text':            "#d4d4d4",
        'text_dim':        "#808080",
        'text_dim2':       "#a0a0a0",
        'status_running':  "#4ec94e",
        'status_running_ring': "#3a8c3a",
        'status_replay':   "#4ec9c9",
        'status_drop':     "#f44747",
        'status_held':     "#4ec9c9",
        'status_fun':      "#c586c0",
    }

    # ============================================================
    # Custom theme palettes — v3.0.6 (theme overlay parity)
    # ============================================================
    # When a user activates a custom theme (Liquid Glass, Frutiger Aero,
    # Cyberpunk, Terminal, Retro, etc.), the overlay should match its vibe
    # rather than fall through to Industrial. These palettes map each
    # built-in custom theme to its overlay colors. Custom themes the user
    # installs from the gallery that aren't listed here still fall back to
    # Industrial gracefully.

    # Liquid Glass — frosted dark with the customizable accent
    _CUSTOM_LIQUID_GLASS_PALETTE = {
        'chrome_style':    'midnight',          # soft glow border, gradient bar
        'bg':              "#0d1018",
        'bg_streamsafe':   "#05070c",
        'bg_top':          "#161a26",
        'accent':          "#7fbfff",            # sky blue default
        'accent_dim':      "#3f6fa0",
        'border_idle':     "#2a3148",
        'tape_a':          "#7fbfff",
        'tape_b':          None,
        'text':            "#f0f4ff",
        'text_dim':        "#6878a0",
        'text_dim2':       "#a8b8d0",
        'status_running':  "#66e5b8",
        'status_running_ring': "#4ab590",
        'status_replay':   "#7fbfff",
        'status_drop':     "#ff7b8a",
        'status_held':     "#7fbfff",
        'status_fun':      "#a78bfa",
    }
    # Frutiger Aero — light sky/glass with cyan accent
    _CUSTOM_FRUTIGER_AERO_PALETTE = {
        'chrome_style':    'windows7',           # the Aero glass paint style fits perfectly
        'bg':              "#dff0fa",
        'bg_streamsafe':   "#cfe5f3",
        'bg_top':          "#ffffff",
        'accent':          "#5fd5f5",            # default cyan from frutiger-aero.json
        'accent_dim':      "#3aa8c8",
        'border_idle':     "#9bc5d8",
        'tape_a':          "#9fffe5",            # aurora green
        'tape_b':          "#5fd5f5",            # accent cyan
        'text':            "#0a2030",
        'text_dim':        "#5a6e7a",
        'text_dim2':       "#1c4258",
        'status_running':  "#3aa080",
        'status_running_ring': "#2a8068",
        'status_replay':   "#3a8cb0",
        'status_drop':     "#c52b2b",
        'status_held':     "#3a8cb0",
        'status_fun':      "#9050b8",
    }
    # Cyberpunk — neon magenta/cyan on void
    _CUSTOM_CYBERPUNK_PALETTE = {
        'chrome_style':    'midnight',           # use soft glow bar for that neon feel
        'bg':              "#0a0014",
        'bg_streamsafe':   "#040008",
        'bg_top':          "#15001f",
        'accent':          "#ff0080",            # magenta default
        'accent_dim':      "#a30050",
        'border_idle':     "#3a0a28",
        'tape_a':          "#ff0080",
        'tape_b':          None,
        'text':            "#e6e6ff",
        'text_dim':        "#705a78",
        'text_dim2':       "#b0a0c0",
        'status_running':  "#aaff44",
        'status_running_ring': "#6dba2a",
        'status_replay':   "#00f5ff",
        'status_drop':     "#ff3344",
        'status_held':     "#00f5ff",
        'status_fun':      "#ff80c8",
    }
    # Terminal — phosphor green CRT
    _CUSTOM_TERMINAL_PALETTE = {
        'chrome_style':    'optimised',          # solid lines fit the CRT aesthetic
        'bg':              "#000000",
        'bg_streamsafe':   "#000000",
        'bg_top':          None,
        'accent':          "#00ff66",            # phosphor green default
        'accent_dim':      "#00803a",
        'border_idle':     "#003820",
        'tape_a':          "#00ff66",
        'tape_b':          None,
        'text':            "#00ff66",
        'text_dim':        "#008a3a",
        'text_dim2':       "#3aff8a",
        'status_running':  "#00ff66",
        'status_running_ring': "#008a3a",
        'status_replay':   "#aaffaa",
        'status_drop':     "#ff5050",
        'status_held':     "#aaffaa",
        'status_fun':      "#aaffaa",
    }
    # Retro Y2K — cream + coral pink + sky blue, kidcore aesthetic
    _CUSTOM_RETRO_PALETTE = {
        'chrome_style':    'optimised',          # solid borders fit the chunky Y2K look
        'bg':              "#fdf4ed",            # cream
        'bg_streamsafe':   "#ecd9c5",
        'bg_top':          None,
        'accent':          "#ff7a9c",            # coral pink default
        'accent_dim':      "#c44a6c",
        'border_idle':     "#1a0f1d",            # almost-black border
        'tape_a':          "#ff7a9c",
        'tape_b':          None,
        'text':            "#1a0f1d",            # near-black ink on cream
        'text_dim':        "#4a3340",
        'text_dim2':       "#2d1f2a",
        'status_running':  "#6dd9a0",
        'status_running_ring': "#3f9f70",
        'status_replay':   "#7fc8e8",
        'status_drop':     "#ff5a6e",
        'status_held':     "#7fc8e8",
        'status_fun':      "#ff7a9c",
    }
    # Lookup — id (from theme manifest) → palette dict
    _CUSTOM_THEME_PALETTES = {
        'liquid-glass':  _CUSTOM_LIQUID_GLASS_PALETTE,
        'frutiger-aero': _CUSTOM_FRUTIGER_AERO_PALETTE,
        'cyberpunk':     _CUSTOM_CYBERPUNK_PALETTE,
        'terminal':      _CUSTOM_TERMINAL_PALETTE,
        'retro':         _CUSTOM_RETRO_PALETTE,
    }
    # Per-custom-theme keys for picking up customized accent colors that
    # the user dialed in via the in-app theme customizer
    _CUSTOM_ACCENT_KEYS = {
        'liquid-glass':  'accent',     # theme.customizable key 'accent' → overlay accent
        'frutiger-aero': 'accent',
        'cyberpunk':     'neon-0',     # theme.customizable key 'neon' first stop
        'terminal':      'phosphor',
        'retro':         'pink',
    }

    def _build_palette(self) -> dict:
        """Read current theme settings and return the role → hex-color map."""
        # v3.0.6: custom theme takes precedence over ui_design when active.
        # The whole custom-theme branch is wrapped in try/except so a malformed
        # settings dict (e.g. theme_customizations gone weird) can NEVER abort
        # OverlayWindow.__init__ — that would kill the rest of MainWindow init,
        # including hotkey registration. Found this the hard way.
        try:
            custom_id = (self.settings.get('active_custom_theme') or '').strip().lower()
            if custom_id and custom_id in self._CUSTOM_THEME_PALETTES:
                pal = dict(self._CUSTOM_THEME_PALETTES[custom_id])
                # Pick up the user's customized accent if they've set one. The
                # main app stores theme_customizations[theme_id][key] = "#hex" for
                # color-type customizables, [hex, hex, ...] for gradients.
                customs = self.settings.get('theme_customizations') or {}
                if isinstance(customs, dict):
                    theme_customs = customs.get(custom_id) or {}
                    if isinstance(theme_customs, dict):
                        accent_key = self._CUSTOM_ACCENT_KEYS.get(custom_id)
                        if accent_key:
                            val = theme_customs.get(accent_key)
                            if isinstance(val, list) and val:
                                val = val[0]   # gradient first stop
                            # Some keys are gradient stops like 'neon-0' meaning gradient 'neon' first stop
                            elif accent_key.endswith(('-0', '-1', '-2', '-3')):
                                base, idx = accent_key.rsplit('-', 1)
                                grad = theme_customs.get(base)
                                if isinstance(grad, list) and len(grad) > int(idx):
                                    val = grad[int(idx)]
                            if isinstance(val, str) and val.startswith('#') and len(val) in (4, 7, 9):
                                pal['accent']     = val
                                pal['accent_dim'] = self._darken(val, 0.55)
                                pal['tape_a']     = val
                return pal
        except Exception:
            # Any malformed settings shape — fall through to design-based palette
            pass

        # Fall through to design-based palette
        ui_design = (self.settings.get('ui_design') or 'industrial').lower()
        if ui_design == 'midnight':
            accent_name = (self.settings.get('midnight_accent') or 'aurora').lower()
            custom = (self.settings.get('midnight_custom_color') or '').strip()
            # Custom overrides accent_name if provided + valid-looking
            if custom and custom.startswith('#') and len(custom) in (4, 7, 9):
                accent = custom
            else:
                accent = self._MIDNIGHT_ACCENTS.get(accent_name, self._MIDNIGHT_ACCENTS['aurora'])
            pal = dict(self._MIDNIGHT_BASE)
            pal['accent']     = accent
            pal['accent_dim'] = self._darken(accent, 0.55)
            pal['tape_a']     = accent
            return pal
        if ui_design == 'windows7':
            return dict(self._WINDOWS7_PALETTE)
        if ui_design == 'optimised':
            return dict(self._OPTIMISED_PALETTE)
        # Default to industrial
        return dict(self._INDUSTRIAL_PALETTE)

    def preview_theme(self, custom_id: str, customizations=None):
        """Apply a temporary palette WITHOUT reading from settings — used by
        the main app's settings UI to preview a theme before the user clicks
        Save. Pass `customizations` as a dict matching the same shape as
        settings['theme_customizations'][theme_id] (so {'accent': '#hex'} for
        color types, {'sunset': ['#hex', '#hex', '#hex']} for gradients)."""
        try:
            custom_id = (custom_id or '').strip().lower()
            if not custom_id or custom_id not in self._CUSTOM_THEME_PALETTES:
                # Asked to preview a theme we don't have a palette for —
                # rebuild from settings to restore baseline
                self._palette = self._build_palette()
                self.update()
                return
            pal = dict(self._CUSTOM_THEME_PALETTES[custom_id])
            if isinstance(customizations, dict):
                accent_key = self._CUSTOM_ACCENT_KEYS.get(custom_id)
                if accent_key:
                    val = customizations.get(accent_key)
                    if isinstance(val, list) and val:
                        val = val[0]
                    elif accent_key.endswith(('-0', '-1', '-2', '-3')):
                        base, idx = accent_key.rsplit('-', 1)
                        grad = customizations.get(base)
                        if isinstance(grad, list) and len(grad) > int(idx):
                            val = grad[int(idx)]
                    if isinstance(val, str) and val.startswith('#') and len(val) in (4, 7, 9):
                        pal['accent']     = val
                        pal['accent_dim'] = self._darken(val, 0.55)
                        pal['tape_a']     = val
            self._palette = pal
            self.update()
        except Exception:
            pass

    @staticmethod
    def _darken(hex_color: str, factor: float = 0.5) -> str:
        """Return a darker version of a #rrggbb hex color (factor 0..1, 0=black)."""
        try:
            h = hex_color.lstrip('#')
            if len(h) == 3:
                h = ''.join(c*2 for c in h)
            r = int(h[0:2], 16)
            g = int(h[2:4], 16)
            b = int(h[4:6], 16)
            r = max(0, min(255, int(r * factor)))
            g = max(0, min(255, int(g * factor)))
            b = max(0, min(255, int(b * factor)))
            return f"#{r:02x}{g:02x}{b:02x}"
        except Exception:
            return hex_color

    def _qc(self, role: str) -> 'QColor':
        """Look up a palette role and return a QColor."""
        return QColor(self._palette.get(role, '#ffffff'))

    def refresh_theme(self):
        """Rebuild palette + repaint. Called when the user changes theme
        in the main app — connected via signal in MainWindow."""
        try:
            self._palette = self._build_palette()
            self.update()
        except Exception:
            pass

    def __init__(self, settings: 'SettingsManager'):
        super().__init__()
        self.settings = settings
        # Build the theme palette from current settings — gets refreshed when
        # the user changes themes via refresh_theme()
        self._palette = self._build_palette()

        self.setWindowFlags(
            Qt.Window
            | Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | Qt.Tool
        )
        self._opacity_pct = int(self.settings.get('overlay_opacity') or 95)
        self._locked = bool(self.settings.get('overlay_locked'))
        self._mode = self.settings.get('overlay_mode') or (
            'advanced' if self.settings.get('overlay_advanced') else 'compact'
        )
        self._custom_layout = self._load_layout()
        self._apply_size()
        self.setWindowTitle("Throttlr Overlay")
        self.setWindowOpacity(max(0.30, min(1.0, self._opacity_pct / 100.0)))

        x = int(self.settings.get('overlay_x') or 30)
        y = int(self.settings.get('overlay_y') or 30)
        self.move(x, y)

        self._drag_offset = None
        self._running = False
        self._replaying = False
        self._app_name = ""
        self._sent = 0
        self._dropped = 0
        self._delayed = 0
        self._held = 0
        self._bytes = 0
        self._kbps = 0.0
        self._funcs = {
            'lag': False, 'drop': False, 'throttle': False,
            'freeze': False, 'block': False, 'fun': False,
        }
        self._pulse = 0
        self._stream_safe = bool(settings.get('overlay_stream_safe'))

        self._pulse_timer = QTimer(self)
        self._pulse_timer.setInterval(80)
        self._pulse_timer.timeout.connect(self._on_pulse)

    # ---- layout helpers ----
    def _load_layout(self):
        """Load custom layout from settings, fallback to compact preset."""
        raw = self.settings.get('overlay_layout')
        if isinstance(raw, list) and raw:
            # Validate row types
            valid = []
            for row in raw:
                if isinstance(row, dict) and row.get('type') in self.ROW_HEIGHT:
                    valid.append({'type': row['type'],
                                  'visible': row.get('visible', True)})
            if valid:
                return valid
        return [dict(r) for r in self.LAYOUT_COMPACT]

    def _active_layout(self):
        """Return the layout actually being painted right now."""
        if self._mode == 'compact':   return self.LAYOUT_COMPACT
        if self._mode == 'advanced':  return self.LAYOUT_ADVANCED
        return self._custom_layout

    def _compute_height(self, layout):
        h = self.TAPE_H + self.PAD_TOP
        first = True
        for row in layout:
            if not row.get('visible', True): continue
            rh = self.ROW_HEIGHT.get(row.get('type'), 22)
            if not first:
                h += self.ROW_GAP
            h += rh
            first = False
        h += self.PAD_BOTTOM
        return max(self.MIN_HEIGHT, h)

    def _apply_size(self):
        layout = self._active_layout()
        h = self._compute_height(layout)
        self.setFixedSize(self.DEFAULT_WIDTH, h)

    # ---- public setters ----
    def set_mode(self, mode: str):
        """mode: 'compact' | 'advanced' | 'custom'"""
        if mode not in ('compact', 'advanced', 'custom'):
            mode = 'compact'
        if mode == self._mode:
            return
        self._mode = mode
        self._apply_size()
        self.update()

    # Backward-compat: set_advanced toggles between compact and advanced
    def set_advanced(self, advanced: bool):
        self.set_mode('advanced' if advanced else 'compact')

    def set_custom_layout(self, layout):
        """Apply a user-defined layout (list of {type, visible}) and switch
        to custom mode."""
        if isinstance(layout, list):
            valid = []
            for row in layout:
                if isinstance(row, dict) and row.get('type') in self.ROW_HEIGHT:
                    valid.append({'type': row['type'],
                                  'visible': bool(row.get('visible', True))})
            if valid:
                self._custom_layout = valid
                self._mode = 'custom'
                self._apply_size()
                self.update()

    def set_opacity_pct(self, pct: int):
        self._opacity_pct = max(30, min(100, int(pct)))
        self.setWindowOpacity(self._opacity_pct / 100.0)

    def set_locked(self, locked: bool):
        self._locked = bool(locked)

    # ---- pulse ----
    def _on_pulse(self):
        self._pulse = (self._pulse + 1) % 24
        self.update()

    # ---- state ----
    def set_state(self, running, app_name, sent, dropped, delayed, held,
                  bytes_total=0, kbps=0.0, funcs=None, replaying=False):
        if running and not self._running:
            self._pulse_timer.start()
        elif not running and self._running:
            self._pulse_timer.stop()
        self._running = bool(running)
        self._replaying = bool(replaying)
        self._app_name = app_name or ""
        self._sent = int(sent or 0)
        self._dropped = int(dropped or 0)
        self._delayed = int(delayed or 0)
        self._held = int(held or 0)
        self._bytes = int(bytes_total or 0)
        self._kbps = float(kbps or 0.0)
        if funcs:
            for k in self._funcs:
                if k in funcs:
                    self._funcs[k] = bool(funcs[k])
        # Keep the pulse animation running while replaying so the user
        # has a visible "something is happening" cue even when freeze is
        # technically off.
        if self._replaying and not self._pulse_timer.isActive():
            self._pulse_timer.start()
        self.update()

    # ---- paint dispatcher ----
    def paintEvent(self, ev):
        layout = self._active_layout()
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        self._paint_chrome(p, w, h)

        y = self.TAPE_H + self.PAD_TOP - 8
        first = True
        for row in layout:
            if not row.get('visible', True):
                continue
            rt = row.get('type')
            if not first:
                y += self.ROW_GAP
            self._paint_row(p, rt, y, w)
            y += self.ROW_HEIGHT.get(rt, 22)
            first = False
        p.end()

    # ---- chrome ----
    def set_stream_safe(self, on: bool):
        """Toggle stream-safe rendering. When on, the overlay renders with a
        fully-opaque dark background and slightly bolder outlines so it
        captures cleanly through OBS/Discord screen-share without alpha
        compositing weirdness."""
        self._stream_safe = bool(on)
        # Force a full repaint
        self.update()

    def _paint_chrome(self, p, w, h):
        """Paint background, hazard tape, and outer border. Chrome style is
        chosen by the active palette: 'industrial' (zigzag tape + sharp border),
        'midnight' (gradient bar + soft glow border), 'windows7' (Aero glass
        gradient bar + frost-blue subtle border)."""
        style = self._palette.get('chrome_style', 'industrial')
        bg = self._qc('bg_streamsafe' if self._stream_safe else 'bg')

        # Background — solid for industrial, vertical gradient for midnight + win7
        bg_top_hex = self._palette.get('bg_top')
        if bg_top_hex and style in ('midnight', 'windows7'):
            grad = QLinearGradient(0, 0, 0, h)
            grad.setColorAt(0.0, QColor(bg_top_hex))
            grad.setColorAt(1.0, bg)
            p.fillRect(0, 0, w, h, QBrush(grad))
        else:
            p.fillRect(0, 0, w, h, bg)

        if style == 'industrial':
            self._paint_chrome_industrial(p, w, h)
        elif style == 'midnight':
            self._paint_chrome_midnight(p, w, h)
        elif style == 'windows7':
            self._paint_chrome_windows7(p, w, h)
        elif style == 'optimised':
            self._paint_chrome_optimised(p, w, h)
        else:
            self._paint_chrome_industrial(p, w, h)

    def _paint_chrome_industrial(self, p, w, h):
        """Original zigzag hazard-tape + sharp border."""
        seg = 12
        x = -16
        toggle = 0
        tape_a = self._qc('tape_a')
        tape_b = self._qc('tape_b')
        while x < w:
            color = tape_a if toggle == 0 else tape_b
            poly = QPolygon([
                QPoint(x, 0), QPoint(x + seg, 0),
                QPoint(x + seg + self.TAPE_H, self.TAPE_H),
                QPoint(x + self.TAPE_H, self.TAPE_H),
            ])
            p.setBrush(QBrush(color))
            p.setPen(Qt.NoPen)
            p.drawPolygon(poly)
            x += seg
            toggle = 1 - toggle
        # Sharp 1px border, accent when running
        border = self._qc('accent') if self._running else self._qc('border_idle')
        p.setPen(QPen(border, 2 if self._stream_safe else 1))
        p.setBrush(Qt.NoBrush)
        p.drawRect(0, 0, w - 1, h - 1)

    def _paint_chrome_midnight(self, p, w, h):
        """Soft accent bar (no zigzag) with subtle glow border. Feels closer
        to the main app's midnight aesthetic — smooth, no harsh edges."""
        accent = self._qc('accent')
        # Top bar: horizontal gradient that fades from transparent → accent →
        # transparent. Looks like a soft accent strip rather than hazard tape.
        bar_grad = QLinearGradient(0, 0, w, 0)
        transparent = QColor(accent)
        transparent.setAlpha(0)
        mid = QColor(accent)
        mid.setAlpha(220)
        bar_grad.setColorAt(0.0,  transparent)
        bar_grad.setColorAt(0.15, mid)
        bar_grad.setColorAt(0.85, mid)
        bar_grad.setColorAt(1.0,  transparent)
        p.setBrush(QBrush(bar_grad))
        p.setPen(Qt.NoPen)
        p.drawRect(0, 0, w, self.TAPE_H)

        # Outer border — soft 2px when running (gives a glow feel),
        # very subtle when idle
        if self._running:
            # Inner glow ring — semi-transparent accent
            glow = QColor(accent)
            glow.setAlpha(140)
            p.setPen(QPen(glow, 2))
        else:
            p.setPen(QPen(self._qc('border_idle'), 1))
        p.setBrush(Qt.NoBrush)
        p.drawRect(0, 0, w - 1, h - 1)

    def _paint_chrome_windows7(self, p, w, h):
        """Aero glass gradient bar across the top — light Aero blue fading
        into mid Aero blue. Subtle frost-blue 1px border. Distinctive Win7
        visual language."""
        light = self._qc('tape_a')
        deep  = self._qc('tape_b')
        # Top bar — vertical gradient (light → deep) with a thin highlight
        # at the very top to suggest the Aero glass shine
        bar_grad = QLinearGradient(0, 0, 0, self.TAPE_H + 4)
        bar_grad.setColorAt(0.0, QColor("#cfe2f5"))   # near-white frost top
        bar_grad.setColorAt(0.4, light)
        bar_grad.setColorAt(1.0, deep)
        p.setBrush(QBrush(bar_grad))
        p.setPen(Qt.NoPen)
        p.drawRect(0, 0, w, self.TAPE_H + 4)
        # Hairline highlight at the top edge (Aero glass top reflection)
        hl = QColor("#ffffff")
        hl.setAlpha(160)
        p.setPen(QPen(hl, 1))
        p.drawLine(0, 0, w, 0)

        # Subtle blue border — Aero windows had a thin frost-blue outline
        if self._running:
            p.setPen(QPen(self._qc('accent'), 1))
        else:
            p.setPen(QPen(self._qc('border_idle'), 1))
        p.setBrush(Qt.NoBrush)
        p.drawRect(0, 0, w - 1, h - 1)

    def _paint_chrome_optimised(self, p, w, h):
        """v3.0.4 — minimal/optimised chrome. Solid colors only, no
        gradients, no glow. Designed for low-end systems."""
        # Solid 2px accent line at the top instead of zigzag tape
        p.setBrush(QBrush(self._qc('tape_a')))
        p.setPen(Qt.NoPen)
        p.drawRect(0, 0, w, 2)
        # Plain 1px border, accent when running
        border = self._qc('accent') if self._running else self._qc('border_idle')
        p.setPen(QPen(border, 1))
        p.setBrush(Qt.NoBrush)
        p.drawRect(0, 0, w - 1, h - 1)

    # ---- row dispatcher ----
    def _paint_row(self, p, rt, y, w):
        if rt == 'status_row':
            self._row_status(p, y, w, with_kbps=False)
        elif rt == 'status_row_kbps':
            self._row_status(p, y, w, with_kbps=True)
        elif rt == 'app_row':
            self._row_app(p, y, w)
        elif rt == 'stats3':
            self._row_stats(p, y, w, [
                ("SENT", self._sent,    self._qc('text_dim2')),
                ("DROP", self._dropped, self._qc('status_drop')),
                ("HELD", self._held,    self._qc('status_held')),
            ])
        elif rt == 'stats4':
            self._row_stats(p, y, w, [
                ("SENT",  self._sent,    self._qc('text_dim2')),
                ("DROP",  self._dropped, self._qc('status_drop')),
                ("DELAY", self._delayed, self._qc('accent')),
                ("HELD",  self._held,    self._qc('status_held')),
            ])
        elif rt == 'kbps_row':
            self._row_kbps(p, y, w)
        elif rt == 'volume_row':
            self._row_volume(p, y, w)
        elif rt == 'funcs_row':
            self._row_funcs(p, y, w)

    # ---- individual rows (each takes care of its own internal layout
    #      relative to the y baseline passed in) ----
    def _row_status(self, p, y, w, with_kbps=False):
        """Status dot + RUNNING/STOPPED/REPLAYING label, optional KB/s on the right."""
        cy = y + 16
        # Replaying takes visual priority over running — same active capture
        # but the user is watching a held-queue drain back into the network.
        if self._replaying:
            # Cyan pulse — distinct from running's green (status colors don't
            # theme — semantic meaning takes priority over visual coherence)
            pulse_r = 12 + (self._pulse % 8)
            replay = self._qc('status_replay')
            glow = QColor(replay)
            glow.setAlpha(max(15, 90 - self._pulse * 3))
            p.setBrush(QBrush(glow)); p.setPen(Qt.NoPen)
            p.drawEllipse(QPoint(20, cy), pulse_r, pulse_r)
            p.setBrush(QBrush(replay))
            p.drawEllipse(QPoint(20, cy), 7, 7)
            label = f"REPLAY  {self._held:,}"
            label_color = replay
        elif self._running:
            pulse_r = 12 + (self._pulse % 8)
            run = self._qc('status_running')
            glow = QColor(run)
            glow.setAlpha(max(15, 90 - self._pulse * 3))
            p.setBrush(QBrush(glow))
            p.setPen(Qt.NoPen)
            p.drawEllipse(QPoint(20, cy), pulse_r, pulse_r)
            p.setBrush(QBrush(run))
            p.drawEllipse(QPoint(20, cy), 7, 7)
            label = "RUNNING"
            label_color = run
        else:
            ring_base = self._qc('status_running_ring')
            ring = QColor(ring_base)
            ring.setAlpha(70)
            p.setBrush(QBrush(ring)); p.setPen(Qt.NoPen)
            p.drawEllipse(QPoint(20, cy), 10, 10)
            p.setBrush(QBrush(ring_base))
            p.drawEllipse(QPoint(20, cy), 7, 7)
            label = "STOPPED"
            label_color = self._qc('text_dim2')

        f = QFont("Impact" if sys.platform == "win32" else "Arial", 12)
        f.setBold(True)
        p.setFont(f)
        p.setPen(label_color)
        p.drawText(QRect(40, y + 4, 240, 24),
                   Qt.AlignLeft | Qt.AlignVCenter, label)

        # Right side: KB/s or brand
        f2 = QFont("Consolas" if sys.platform == "win32" else "Courier New", 9)
        if with_kbps:
            f2.setBold(True)
            p.setFont(f2)
            p.setPen(self._qc('accent'))
            p.drawText(QRect(0, y + 4, w - 14, 24),
                       Qt.AlignRight | Qt.AlignVCenter,
                       f"{self._kbps:.1f} KB/s")
        else:
            p.setFont(f2)
            p.setPen(self._qc('text_dim'))
            p.drawText(QRect(0, y + 4, w - 14, 24),
                       Qt.AlignRight | Qt.AlignVCenter, "throttlr")

    def _row_app(self, p, y, w):
        f = QFont("Consolas" if sys.platform == "win32" else "Courier New", 9)
        f.setBold(True)
        p.setFont(f)
        p.setPen(self._qc('accent'))
        text = self._app_name or "(no target)"
        if len(text) > 42:
            text = text[:39] + "..."
        p.drawText(QRect(14, y + 2, w - 28, 18),
                   Qt.AlignLeft | Qt.AlignVCenter, text)

    def _row_stats(self, p, y, w, cells):
        n = len(cells)
        x0 = 14
        total_w = w - 28
        cell_w = total_w // n
        for i, (lab, val, col) in enumerate(cells):
            cx = x0 + i * cell_w
            f = QFont("Consolas" if sys.platform == "win32" else "Courier New", 8)
            p.setFont(f)
            p.setPen(self._qc('text_dim'))
            p.drawText(QRect(cx, y, cell_w, 12), Qt.AlignLeft, lab)
            f2 = QFont("Impact" if sys.platform == "win32" else "Arial", 12)
            f2.setBold(True)
            p.setFont(f2)
            p.setPen(col)
            val_str = f"{val:,}"
            if len(val_str) > 9:
                val_str = f"{val/1000:.0f}K"
            p.drawText(QRect(cx, y + 12, cell_w, 22),
                       Qt.AlignLeft, val_str)

    def _row_kbps(self, p, y, w):
        f = QFont("Consolas" if sys.platform == "win32" else "Courier New", 9)
        f.setBold(True)
        p.setFont(f)
        p.setPen(self._qc('text_dim'))
        p.drawText(QRect(14, y, 60, 18), Qt.AlignLeft | Qt.AlignVCenter, "RATE")
        p.setPen(self._qc('accent'))
        p.drawText(QRect(50, y, w - 64, 18),
                   Qt.AlignLeft | Qt.AlignVCenter, f"{self._kbps:.1f} KB/s")

    def _row_volume(self, p, y, w):
        f = QFont("Consolas" if sys.platform == "win32" else "Courier New", 8)
        p.setFont(f)
        p.setPen(self._qc('text_dim'))
        kb = self._bytes / 1024.0
        if kb < 1024:
            text = f"VOL  {kb:,.1f} KB"
        else:
            text = f"VOL  {kb/1024:,.2f} MB"
        p.drawText(QRect(14, y, w - 28, 18), Qt.AlignLeft, text)

    def _row_funcs(self, p, y, w):
        # Function chips — use accent for "neutral" funcs (lag/throttle) so
        # they tint with the active theme. drop/block stay red, freeze stays
        # cyan, fun stays green — those are semantic.
        accent = self._qc('accent')
        drop_c = self._qc('status_drop')
        held_c = self._qc('status_held')
        fun_c  = self._qc('status_fun')
        chips = [
            ('lag',      'LAG',   accent),
            ('drop',     'DROP',  drop_c),
            ('throttle', 'THROT', accent),
            ('freeze',   'FRZ',   held_c),
            ('block',    'BLOCK', drop_c),
            ('fun',      'FUN',   fun_c),
        ]
        chip_h = 16
        f = QFont("Consolas" if sys.platform == "win32" else "Courier New", 7)
        f.setBold(True)
        p.setFont(f)
        cell_w = (w - 28 - 5 * 4) // 6
        for i, (key, lab, col) in enumerate(chips):
            x = 14 + i * (cell_w + 4)
            active = self._funcs.get(key, False)
            if active:
                p.setBrush(QBrush(col))
                p.setPen(QPen(col, 1))
                p.drawRect(x, y, cell_w, chip_h)
                # Black text on most, white on the red chips for contrast
                p.setPen(QColor("#000000")
                         if col != drop_c
                         else QColor("#ffffff"))
            else:
                p.setBrush(Qt.NoBrush)
                p.setPen(QPen(self._qc('border_idle'), 1))
                p.drawRect(x, y, cell_w, chip_h)
                p.setPen(self._qc('text_dim'))
            p.drawText(QRect(x, y, cell_w, chip_h), Qt.AlignCenter, lab)

    # ---- drag (skip when locked) ----
    def mousePressEvent(self, e):
        if self._locked:
            return
        if e.button() == Qt.LeftButton:
            self._drag_offset = e.globalPosition().toPoint() - self.pos()
            e.accept()

    def mouseMoveEvent(self, e):
        if self._locked or self._drag_offset is None:
            return
        self.move(e.globalPosition().toPoint() - self._drag_offset)
        e.accept()

    def mouseReleaseEvent(self, e):
        if self._drag_offset is not None:
            self._drag_offset = None
            self.settings.set('overlay_x', self.x())
            self.settings.set('overlay_y', self.y())
            self.settings.save()
            e.accept()

    def contextMenuEvent(self, e):
        menu = QMenu(self)
        hide_act = menu.addAction("Hide overlay")
        modes_menu = menu.addMenu("Mode")
        compact_act = modes_menu.addAction("Compact")
        advanced_act = modes_menu.addAction("Advanced")
        custom_act = modes_menu.addAction("Custom")
        compact_act.setCheckable(True); compact_act.setChecked(self._mode == 'compact')
        advanced_act.setCheckable(True); advanced_act.setChecked(self._mode == 'advanced')
        custom_act.setCheckable(True);   custom_act.setChecked(self._mode == 'custom')
        toggle_lock = menu.addAction(
            "Unlock position" if self._locked else "Lock position"
        )
        action = menu.exec(e.globalPos())
        if action == hide_act:
            self.hide()
            self.settings.set('show_overlay', False)
            self.settings.save()
        elif action == compact_act:
            self.set_mode('compact')
            self.settings.set('overlay_mode', 'compact')
            self.settings.save()
        elif action == advanced_act:
            self.set_mode('advanced')
            self.settings.set('overlay_mode', 'advanced')
            self.settings.save()
        elif action == custom_act:
            self.set_mode('custom')
            self.settings.set('overlay_mode', 'custom')
            self.settings.save()
        elif action == toggle_lock:
            self.set_locked(not self._locked)
            self.settings.set('overlay_locked', self._locked)
            self.settings.save()


# ============================================================
# Screen-edge border indicator
# ============================================================

class ScreenBorderOverlay(QWidget):
    """Fullscreen click-through transparent window that paints a colored
    gradient frame around the primary monitor's edges.

    Uses CompositionMode_Lighten with four full-screen edge gradients so the
    final alpha at each pixel equals the maximum of the four 'closeness to
    edge' values — i.e. 1 minus the normalized distance to the nearest
    screen edge. This guarantees no seams or hard cut-off lines anywhere.
    """

    def __init__(self, settings: 'SettingsManager' = None):
        super().__init__()
        self.settings = settings
        self.setWindowFlags(
            Qt.Window
            | Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | Qt.Tool
            | Qt.WindowTransparentForInput   # click-through
        )
        self.setAttribute(Qt.WA_TranslucentBackground, True)
        self.setAttribute(Qt.WA_NoSystemBackground, True)
        self.setAttribute(Qt.WA_ShowWithoutActivating, True)

        screen = QGuiApplication.primaryScreen()
        if screen:
            self.setGeometry(screen.geometry())

        self._color = QColor("#7fff6a")
        self._opacity = 0.0
        self._target_opacity = 0.0

        # Read defaults from settings if available — so the saved values
        # actually take effect on launch, not just when the slider moves.
        if settings:
            self._show_duration_ms = int(settings.get('screen_border_duration_ms') or 2000)
            self._feather = int(settings.get('screen_border_feather') or 90)
        else:
            self._show_duration_ms = 2000
            self._feather = 90

        self._anim = QTimer(self)
        self._anim.setInterval(16)
        self._anim.timeout.connect(self._tick)

    # ---- configuration ----
    def set_show_duration_ms(self, ms: int):
        self._show_duration_ms = max(0, int(ms))

    def set_feather(self, px: int):
        self._feather = max(20, min(400, int(px)))
        self.update()

    # ---- show with auto fade-out ----
    def show_running(self):
        self._show_with_color(QColor("#7fff6a"))

    def show_stopped(self):
        self._show_with_color(QColor("#c41e3a"))

    def _show_with_color(self, color):
        self._color = color
        self._target_opacity = 0.85
        self.show()
        self.raise_()
        # IMPORTANT: always (re-)start the timer here. It may have stopped
        # itself earlier when a previous fade reached its target.
        self._anim.start()
        if self._show_duration_ms > 0:
            QTimer.singleShot(self._show_duration_ms, self._begin_fadeout)

    def hide_now(self):
        self._target_opacity = 0.0
        self._anim.start()

    def _begin_fadeout(self):
        self._target_opacity = 0.0
        # Restart the timer — without this the fade never happens because
        # the timer auto-stopped when fade-in completed.
        self._anim.start()

    def _tick(self):
        diff = self._target_opacity - self._opacity
        if abs(diff) < 0.01:
            self._opacity = self._target_opacity
            self.update()
            self._anim.stop()
            if self._opacity <= 0.001:
                self.hide()
            return
        # Smooth easing toward target
        self._opacity += diff * 0.12
        self.update()

    # ---- paint: 4 full-screen edge gradients combined with Lighten ----
    def paintEvent(self, ev):
        if self._opacity <= 0.001:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        w, h = self.width(), self.height()
        f = self._feather

        c = QColor(self._color)
        c.setAlphaF(self._opacity)
        zero = QColor(c.red(), c.green(), c.blue(), 0)

        # Each edge gradient is painted over the entire screen but only
        # produces non-zero alpha within `f` pixels of its edge. Subsequent
        # gradients use CompositionMode_Lighten so the final pixel takes the
        # MAX of the four overlapping alphas — equivalent to "1 minus the
        # normalized distance to the nearest edge", which is smooth
        # everywhere and has no seams at corners.

        # First edge — paints over transparent canvas with default SourceOver
        g = QLinearGradient(0, 0, 0, f)            # top
        g.setColorAt(0, c); g.setColorAt(1, zero)
        p.fillRect(0, 0, w, h, QBrush(g))

        # Switch to Lighten so the remaining gradients blend by max-channel
        p.setCompositionMode(QPainter.CompositionMode_Lighten)

        g = QLinearGradient(0, h, 0, h - f)        # bottom
        g.setColorAt(0, c); g.setColorAt(1, zero)
        p.fillRect(0, 0, w, h, QBrush(g))

        g = QLinearGradient(0, 0, f, 0)            # left
        g.setColorAt(0, c); g.setColorAt(1, zero)
        p.fillRect(0, 0, w, h, QBrush(g))

        g = QLinearGradient(w, 0, w - f, 0)        # right
        g.setColorAt(0, c); g.setColorAt(1, zero)
        p.fillRect(0, 0, w, h, QBrush(g))

        p.end()


# ============================================================
# Main window — embedded webview
# ============================================================

class MainWindow(QMainWindow):
    """Hosts the QWebEngineView. UI runs as HTML/CSS/JS inside."""

    def __init__(self, controller: NetworkController, settings: SettingsManager):
        super().__init__()
        self.controller = controller
        self.settings = settings

        self.setWindowTitle("Throttlr — by Billy's Matrix")
        # Frameless: HTML provides its own title bar + window controls
        self.setWindowFlags(Qt.Window | Qt.FramelessWindowHint)
        # Allow the window to be transparent at the corners if HTML wants
        # (we don't actually use it but this keeps options open)
        # self.setAttribute(Qt.WA_TranslucentBackground, True)

        w = int(self.settings.get("window_w") or 1100)
        h = int(self.settings.get("window_h") or 920)
        self.resize(w, h)

        self.view = QWebEngineView(self)
        self.setCentralWidget(self.view)

        s = self.view.settings()
        s.setAttribute(QWebEngineSettings.JavascriptEnabled, True)
        s.setAttribute(QWebEngineSettings.LocalStorageEnabled, True)
        s.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        s.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QWebEngineSettings.AllowRunningInsecureContent, True)
        s.setAttribute(QWebEngineSettings.ErrorPageEnabled, True)

        self.channel = QWebChannel(self.view.page())
        self.bridge = Bridge(controller, settings,
                             on_hotkey_rebind=self._rebind_hotkeys)
        # Give the bridge a reference to this window so it can do window-control ops
        self.bridge.set_window(self)

        # Create the floating overlay
        self.overlay = OverlayWindow(settings)
        self.bridge.set_overlay(self.overlay)
        if settings.get('show_overlay'):
            self.overlay.show()

        # Screen-edge border indicator
        self.screen_border = ScreenBorderOverlay(settings)
        self.screen_border.set_show_duration_ms(int(settings.get('screen_border_duration_ms') or 2000))
        self.screen_border.set_feather(int(settings.get('screen_border_feather') or 90))
        self.bridge.set_screen_border(self.screen_border)
        # Listen to controller running state to flash green/red on transitions
        self.controller.status_changed.connect(self._on_controller_status)

        # Apply main-window always-on-top if configured
        if settings.get('main_always_on_top'):
            self.setWindowFlag(Qt.WindowStaysOnTopHint, True)

        self.channel.registerObject("bridge", self.bridge)
        self.view.page().setWebChannel(self.channel)

        html_path = self._find_ui_path()
        if html_path is None:
            QMessageBox.critical(
                self, "Missing UI",
                "Could not find ui/index.html — UI files missing."
            )
            sys.exit(1)

        # Make sure qwebchannel.js exists next to index.html
        if not ensure_qwebchannel_js(html_path.parent):
            QMessageBox.warning(
                self, "QWebChannel missing",
                "Could not extract qwebchannel.js — the UI may not respond.\n"
                "Try reinstalling PySide6."
            )

        self.view.load(QUrl.fromLocalFile(str(html_path)))

        self.hotkey_startstop = None
        self.hotkey_freeze = None
        self.hotkey_block = None
        self.hotkey_fun = None
        self.hotkey_killswitch = None
        self._rebind_hotkeys()

    def _find_ui_path(self):
        candidates = [
            Path(__file__).parent / "ui" / "index.html",
            Path(getattr(sys, "_MEIPASS", "")) / "ui" / "index.html",
            Path.cwd() / "ui" / "index.html",
        ]
        for p in candidates:
            if p.exists():
                return p.resolve()
        return None

    def _vk_for(self, key_name, default):
        return KEY_NAMES.get(key_name, default)

    def _rebind_hotkeys(self):
        # v3.0.4 — use new stop() API which routes through the shared LL hook
        # rather than poking the old per-thread _stop event that no longer exists
        for hk in [self.hotkey_startstop, self.hotkey_freeze,
                   self.hotkey_block, self.hotkey_fun,
                   self.hotkey_killswitch]:
            if hk is not None:
                try:
                    hk.stop()
                except Exception:
                    pass

        ss_vk = self._vk_for(self.settings.get("hotkey_startstop"), VK_F5)
        fz_vk = self._vk_for(self.settings.get("hotkey_freeze"), VK_F8)
        bl_vk = self._vk_for(self.settings.get("hotkey_block"), VK_F9)
        fn_vk = self._vk_for(self.settings.get("hotkey_fun"), VK_F10)
        # Killswitch — None if no key bound (default — don't register)
        ks_key = self.settings.get("hotkey_killswitch") or ""
        ks_vk = KEY_NAMES.get(ks_key) if ks_key else None

        self.hotkey_startstop = GlobalHotkey(ss_vk, 0xB00C)
        self.hotkey_startstop.pressed.connect(
            lambda: self.bridge.hotkeyFired.emit("startstop"))
        self.hotkey_startstop.start()

        self.hotkey_freeze = GlobalHotkey(fz_vk, 0xB00B)
        self.hotkey_freeze.pressed.connect(
            lambda: self.bridge.hotkeyFired.emit("freeze"))
        self.hotkey_freeze.start()

        self.hotkey_block = GlobalHotkey(bl_vk, 0xB00D)
        self.hotkey_block.pressed.connect(
            lambda: self.bridge.hotkeyFired.emit("block"))
        self.hotkey_block.start()

        self.hotkey_fun = GlobalHotkey(fn_vk, 0xB00E)
        self.hotkey_fun.pressed.connect(
            lambda: self.bridge.hotkeyFired.emit("fun"))
        self.hotkey_fun.start()

        # Killswitch is optional — only register if a key is bound
        if ks_vk is not None:
            self.hotkey_killswitch = GlobalHotkey(ks_vk, 0xB00F)
            self.hotkey_killswitch.pressed.connect(
                lambda: self.bridge.hotkeyFired.emit("killswitch"))
            self.hotkey_killswitch.start()
        else:
            self.hotkey_killswitch = None

    def _on_controller_status(self, status):
        """Flash screen border green when capture starts, red when it stops.
        Also drives the auto-stop timer.
        """
        # Auto-stop timer: starts when capture starts, cancels when it stops
        mins = int(self.settings.get('auto_stop_minutes') or 0)
        if status == 'running' and mins > 0:
            if not hasattr(self, '_auto_stop_timer') or self._auto_stop_timer is None:
                self._auto_stop_timer = QTimer(self)
                self._auto_stop_timer.setSingleShot(True)
                self._auto_stop_timer.timeout.connect(self._auto_stop_fire)
            self._auto_stop_timer.start(mins * 60 * 1000)
        elif status != 'running':
            if hasattr(self, '_auto_stop_timer') and self._auto_stop_timer:
                self._auto_stop_timer.stop()

        # Screen border indicator
        if not self.settings.get('screen_border_enabled'):
            return
        if not hasattr(self, 'screen_border') or self.screen_border is None:
            return
        if status == 'running':
            self.screen_border.show_running()
        else:
            self.screen_border.show_stopped()

    def _auto_stop_fire(self):
        """Auto-stop timer fired — stop capture."""
        try:
            self.controller.stop()
            self.bridge.errorMessage.emit("Auto-stopped — time limit reached.")
        except Exception:
            pass

    def closeEvent(self, e):
        # Confirm before closing if running and the setting is on
        if (self.controller.running
                and self.settings.get('confirm_before_quit')):
            r = QMessageBox.question(
                self, "Quit Throttlr?",
                "Capture is currently running. Quit anyway?",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No
            )
            if r != QMessageBox.Yes:
                e.ignore()
                return
        try:
            self.controller.stop()
        except Exception:
            pass
        try:
            if hasattr(self, "overlay") and self.overlay is not None:
                self.overlay.close()
        except Exception:
            pass
        try:
            if hasattr(self, "screen_border") and self.screen_border is not None:
                self.screen_border.close()
        except Exception:
            pass
        self.settings.set("window_w", self.width())
        self.settings.set("window_h", self.height())
        super().closeEvent(e)


# ============================================================
# Splash screen
# ============================================================

def _resource_path(rel: str) -> str:
    """Resolve a path that works both when running from source and from a
    PyInstaller --onefile bundle (which extracts data files to sys._MEIPASS)."""
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, rel)


def _make_splash_pixmap() -> QPixmap:
    """Industrial / hazard themed splash, with the actual Throttlr logo."""
    w, h = 560, 320
    pm = QPixmap(w, h)
    pm.fill(QColor("#07090a"))
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.SmoothPixmapTransform)

    # Background — flat dark with subtle vignette
    bg = QLinearGradient(0, 0, 0, h)
    bg.setColorAt(0, QColor("#10120e"))
    bg.setColorAt(1, QColor("#07090a"))
    p.setBrush(QBrush(bg))
    p.setPen(Qt.NoPen)
    p.drawRect(0, 0, w, h)

    # Top hazard stripe
    stripe_h = 18
    stripe_w = 22
    from PySide6.QtGui import QPolygon
    for i in range(-2, w // stripe_w + 4):
        x = i * stripe_w
        path_pts = [QPoint(x, 0), QPoint(x + stripe_w, 0),
                    QPoint(x + stripe_w + stripe_h, stripe_h),
                    QPoint(x + stripe_h, stripe_h)]
        p.setBrush(QBrush(QColor("#ffb800")))
        p.setPen(Qt.NoPen)
        p.drawPolygon(QPolygon(path_pts))
        x2 = x + stripe_w
        path_pts2 = [QPoint(x2, 0), QPoint(x2 + stripe_w, 0),
                     QPoint(x2 + stripe_w + stripe_h, stripe_h),
                     QPoint(x2 + stripe_h, stripe_h)]
        p.setBrush(QBrush(QColor("#000000")))
        p.drawPolygon(QPolygon(path_pts2))

    # Bottom hazard stripe (mirrored)
    for i in range(-2, w // stripe_w + 4):
        x = i * stripe_w
        path_pts = [QPoint(x, h - stripe_h), QPoint(x + stripe_w, h - stripe_h),
                    QPoint(x + stripe_w + stripe_h, h),
                    QPoint(x + stripe_h, h)]
        p.setBrush(QBrush(QColor("#ffb800")))
        p.setPen(Qt.NoPen)
        p.drawPolygon(QPolygon(path_pts))
        x2 = x + stripe_w
        path_pts2 = [QPoint(x2, h - stripe_h), QPoint(x2 + stripe_w, h - stripe_h),
                     QPoint(x2 + stripe_w + stripe_h, h),
                     QPoint(x2 + stripe_h, h)]
        p.setBrush(QBrush(QColor("#000000")))
        p.drawPolygon(QPolygon(path_pts2))

    # Side bracket marks
    p.setPen(QPen(QColor("#ffb800"), 2))
    p.setBrush(Qt.NoBrush)
    bracket_size = 18
    p.drawLine(20, 36, 20 + bracket_size, 36)
    p.drawLine(20, 36, 20, 36 + bracket_size)
    p.drawLine(w - 20 - bracket_size, 36, w - 20, 36)
    p.drawLine(w - 20, 36, w - 20, 36 + bracket_size)
    p.drawLine(20, h - 36 - bracket_size, 20, h - 36)
    p.drawLine(20, h - 36, 20 + bracket_size, h - 36)
    p.drawLine(w - 20, h - 36 - bracket_size, w - 20, h - 36)
    p.drawLine(w - 20, h - 36, w - 20 - bracket_size, h - 36)

    # === Throttlr logo image, left-aligned ===
    logo_size = 100
    logo_x = 40
    logo_y = (h - logo_size) // 2
    try:
        logo = QPixmap(_resource_path(os.path.join("ui", "throttlr-logo.png")))
        if not logo.isNull():
            scaled = logo.scaled(
                logo_size, logo_size,
                Qt.KeepAspectRatio,
                Qt.SmoothTransformation,
            )
            p.drawPixmap(logo_x, logo_y, scaled)
    except Exception:
        pass

    # === Right side: text block ===
    text_x = logo_x + logo_size + 22
    text_w = w - text_x - 25

    # "THROTTLR" title
    f = p.font()
    f.setFamily("Impact")
    f.setPointSize(40)
    f.setBold(True)
    p.setFont(f)
    p.setPen(QColor("#e8e6d8"))
    p.drawText(QRect(text_x, logo_y + 8, text_w, 60),
               Qt.AlignLeft | Qt.AlignTop, "THROTTLR")

    # "BY BILLY'S MATRIX" tag — pushed well below the descenders of THROTTLR
    f.setFamily("Consolas")
    f.setPointSize(10)
    f.setBold(True)
    p.setFont(f)
    p.setPen(QColor("#ffb800"))
    p.drawText(QRect(text_x, logo_y + 78, text_w, 20),
               Qt.AlignLeft | Qt.AlignTop, "[ BY  BILLY'S  MATRIX ]")

    # Tagline
    f.setPointSize(9)
    f.setBold(False)
    p.setFont(f)
    p.setPen(QColor("#7fff6a"))
    p.drawText(QRect(text_x, logo_y + 108, text_w, 20),
               Qt.AlignLeft | Qt.AlignTop, "PER-APPLICATION  NETWORK  THROTTLER")

    # Status line
    p.setPen(QColor("#3aa030"))
    p.drawText(QRect(text_x, logo_y + 132, text_w, 20),
               Qt.AlignLeft | Qt.AlignTop, ">> SYSTEM   INITIALIZING . . .")

    p.end()
    return pm


# ============================================================
# Phase 1 helpers — ghost mode, animated icon, crash reporter
# ============================================================

def _apply_ghost_mode(window, on: bool) -> None:
    """Toggle WDA_EXCLUDEFROMCAPTURE on a Qt window's HWND so screen-capture
    tools (OBS, Win+G, Discord screen-share, etc.) see a hole where the
    window is. Windows-only — silently no-op elsewhere."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        WDA_NONE = 0x00
        WDA_EXCLUDEFROMCAPTURE = 0x11   # Win10 2004+ — also Win11
        hwnd = int(window.winId())
        affinity = WDA_EXCLUDEFROMCAPTURE if on else WDA_NONE
        ctypes.windll.user32.SetWindowDisplayAffinity(hwnd, affinity)
    except Exception:
        pass


def _make_running_icon_variant(base_pixmap):
    """Build a brighter 'running' variant of the app icon for the animated
    taskbar pulse. We composite a green tint on top of the base pixmap."""
    try:
        from PySide6.QtGui import QPixmap, QPainter, QColor
        if not base_pixmap or base_pixmap.isNull():
            return None
        pm = QPixmap(base_pixmap)
        p = QPainter(pm)
        p.setCompositionMode(QPainter.CompositionMode_Plus)
        # Subtle green wash: not so much it changes the icon shape, just
        # enough to register as a "live" pulse in peripheral vision.
        p.fillRect(pm.rect(), QColor(120, 220, 90, 70))
        p.end()
        return pm
    except Exception:
        return None


class _AnimatedIcon(QObject):
    """Drives a 2-frame icon animation on the QApplication while capture is
    running. Frame A = base icon, Frame B = brighter variant. Cycles every
    ~700ms. Stops cleanly when capture stops."""
    def __init__(self, app, settings):
        super().__init__()
        self.app = app
        self.settings = settings
        self.running = False
        self.frame = 0
        self._base = None
        self._bright = None
        self._timer = QTimer(self)
        self._timer.setInterval(700)
        self._timer.timeout.connect(self._tick)

    def setup(self):
        try:
            from PySide6.QtGui import QIcon, QPixmap
            ip = _resource_path("throttlr.ico")
            if not os.path.exists(ip):
                ip = _resource_path(os.path.join("ui", "throttlr-logo.png"))
            self._base = QPixmap(ip) if os.path.exists(ip) else None
            self._bright = _make_running_icon_variant(self._base)
        except Exception:
            pass

    def start(self):
        if not self.settings.get('animated_icon'):
            return
        if not self._base or not self._bright:
            return
        self.running = True
        self.frame = 0
        self._timer.start()

    def stop(self):
        self.running = False
        self._timer.stop()
        try:
            from PySide6.QtGui import QIcon
            if self._base:
                self.app.setWindowIcon(QIcon(self._base))
        except Exception:
            pass

    def _tick(self):
        try:
            from PySide6.QtGui import QIcon
            self.frame = 1 - self.frame
            pm = self._bright if self.frame else self._base
            if pm:
                self.app.setWindowIcon(QIcon(pm))
        except Exception:
            pass


def _write_crash_report(exc_type, exc_value, exc_tb):
    """Persist a crash report under ~/.throttlr/crashes/ for later debugging."""
    try:
        import traceback
        from datetime import datetime
        crash_dir = PROFILE_DIR / "crashes"
        crash_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        path = crash_dir / f"crash-{ts}.txt"
        body = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        header = (
            f"Throttlr crash report\n"
            f"Time: {datetime.now().isoformat()}\n"
            f"Python: {sys.version.split()[0]}\n"
            f"Platform: {sys.platform}\n"
            f"\n"
        )
        path.write_text(header + body, encoding='utf-8')
        return str(path)
    except Exception:
        return None


# ============================================================
# Main
# ============================================================

def main():
    os.environ.setdefault("QTWEBENGINE_REMOTE_DEBUGGING", "0")

    app = QApplication(sys.argv)
    app.setApplicationName("Throttlr")
    app.setOrganizationName("BillysMatrix")

    # Set the global app icon — propagates to taskbar, Alt+Tab, every
    # window without its own icon, and the splash screen.
    try:
        from PySide6.QtGui import QIcon
        icon_paths = [
            _resource_path("throttlr.ico"),
            _resource_path(os.path.join("ui", "throttlr-logo.png")),
        ]
        for ip in icon_paths:
            if os.path.exists(ip):
                app.setWindowIcon(QIcon(ip))
                break
    except Exception:
        pass

    settings = SettingsManager()
    set_sound_enabled(settings.get("sound_enabled"))

    # Kick off background GitHub release check. Non-blocking — startup proceeds
    # immediately; the check completes in the background and the result is
    # picked up when the JS UI calls bridge.getUpdateInfo() after init.
    global update_checker
    update_checker = UpdateChecker()
    update_checker.kick_off()

    try:
        splash = QSplashScreen(
            _make_splash_pixmap(),
            Qt.WindowStaysOnTopHint | Qt.FramelessWindowHint
        )
        splash.show()
        splash.raise_()
        splash.activateWindow()
        # Pump the event loop a few times to make sure the splash actually
        # paints before we get into the heavy MainWindow construction.
        for _ in range(8):
            app.processEvents()
    except Exception:
        splash = None

    if not is_admin():
        QMessageBox.warning(
            None, "Admin required",
            "Throttlr needs Administrator privileges to capture packets.\n\n"
            "Close this and re-launch via 'Run as administrator', or use\n"
            "run_as_admin.bat in the install folder."
        )

    controller = NetworkController()
    win = MainWindow(controller, settings)

    # Animated taskbar icon while capture is running
    anim_icon = _AnimatedIcon(app, settings)
    anim_icon.setup()
    def _on_status(status):
        if status == "running":
            anim_icon.start()
        else:
            anim_icon.stop()
    try:
        controller.status_changed.connect(_on_status)
    except Exception:
        pass

    # If the user has ghost mode enabled and the overlay is up, apply it
    # immediately so the very first frame is already excluded from capture
    try:
        ov = getattr(win, '_overlay', None) or getattr(win.bridge, '_overlay', None)
        if ov is not None and settings.get('overlay_ghost_mode'):
            _apply_ghost_mode(ov, True)
    except Exception:
        pass

    play_tones((523, 40), (659, 40), (784, 60))

    if splash:
        # Hold the splash for a clearly visible moment, then swap to the
        # main window. splash.finish(win) waits for win to be shown to
        # close the splash, so call show() right after.
        def _swap():
            splash.finish(win)
            win.show()
            win.raise_()
            win.activateWindow()
        QTimer.singleShot(1800, _swap)
    else:
        win.show()

    # Run the event loop. Wrap in try/except so any unhandled exception
    # (Qt bug, missing module, malformed setting) is captured to disk
    # rather than just vanishing without a trace.
    try:
        sys.exit(app.exec())
    except SystemExit:
        raise
    except Exception:
        path = _write_crash_report(*sys.exc_info())
        try:
            QMessageBox.critical(
                None, "Throttlr crashed",
                "Something went wrong and Throttlr had to close.\n\n"
                f"A crash report was saved to:\n{path or '~/.throttlr/crashes/'}\n\n"
                "You can attach it when reporting the issue."
            )
        except Exception:
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
