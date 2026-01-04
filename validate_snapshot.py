#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later                                                                  
#                                                                                                            
# Video-MCQ Project                                                                                          
# -------------------                                                                                        
# An interactive video quiz system for generating and delivering MCQs from online video content.             
#                                                                                                            
# Authors:                                                                                                   
#   - J.L. Klay (Cal Poly San Luis Obispo)                                                            
#   - ChatGPT (OpenAI)                                                                                       
#                                                                                                            
# License:                                                                                                   
#   This file is part of the Video-MCQ Project.                                                              
#                                                                                                            
#   The Video-MCQ Project is free software: you can redistribute it and/or modify                            
#   it under the terms of the GNU General Public License as published by                                     
#   the Free Software Foundation, either version 3 of the License, or                                        
#   (at your option) any later version.                                                                      
#                                                                                                            
#   The Video-MCQ Project is distributed in the hope that it will be useful,                                 
#   but WITHOUT ANY WARRANTY; without even the implied warranty of                                           
#   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the                                             
#   GNU General Public License for more details.                                                             
#                                                                                                            
#   You should have received a copy of the GNU General Public License                                        
#   along with this project. If not, see <https://www.gnu.org/licenses/>.
#
# Validates tree layout, filenames, HTML IDs, quiz JSON, SQLite schema,
# and (optionally) live API endpoints if you pass --url http://host:port

import argparse, json, os, re, sqlite3, sys
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

ROOT = Path(__file__).resolve().parent
DEFAULT_MANIFEST = ROOT / "mcq-manifest.json"

OK  = "\x1b[32m✔\x1b[0m"
WARN= "\x1b[33m⚠\x1b[0m"
ERR = "\x1b[31m✖\x1b[0m"

# ======================================================================
# Manifest & layout checks
# Check directory layout and manifest correctness.
# ======================================================================
"""Check directory layout and manifest correctness."""


def load_manifest(path: Path):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            msg(WARN, f"manifest parse failed ({path}): {e}")
    # sensible defaults matching our snapshot
    return {
        "paths": {
            "backend_dir": "backend",
            "frontend_dir": "frontend",
            "quizzes_dir":  "quizzes",
            "db_path":      "backend/data.sqlite3",
        },
        "pages": {
            "index":       "frontend/index.html",
            "index_simple": "frontend/index-simple.html",
            "dashboard":   "frontend/dashboard.html",
        },
        "static": {
            "mounts": [ { "url_prefix": "/static", "dir": "frontend" } ],
            "favicon_candidates": ["frontend/favicon.svg", "frontend/favicon.ico"]
        },
        "frontend_ids": {
            "index_simple": [
                "player","overlay","prompt","choices","submit","continue","feedback","progress","finish","status"
            ],
            "index": [
                "overlay","prompt","choices","submit","continue","feedback","progress","finish","status"
            ],
            "dashboard": [
                # attempts panel
                "attemptsTable","attemptQuiz","attemptViewer","attemptMode",
                "btnRefreshAttempts","btnDeleteByViewer","btnDeleteAll","btnExportAttempts","attemptsStatus",
                # poll/FR panel
                "respPanel","respQuiz","respType","respAttempt","btnLoadResp","btnExportPollFr"
            ]
        }
    }


# ======================================================================
# HTML & frontend validation
# Verify that frontend HTML IDs match manifest expectations.
# ======================================================================
"""Verify that frontend HTML IDs match manifest expectations."""

def check_html_ids(html_path: Path, required_ids, errors):
    if not html_path.exists():
        msg(WARN, f"skip id check (no file): {html_path}")
        return
    txt = read_text(html_path)
    missing = []
    for idv in required_ids or []:
        # lax check: look for id="idv"
        if not re.search(fr'id\s*=\s*["\']{re.escape(idv)}["\']', txt):
            missing.append(idv)
    if missing:
        msg(WARN, f"{html_path.name}: missing element IDs: {', '.join(missing)}")
    else:
        msg(OK, f"{html_path.name}: required element IDs present")


# ======================================================================
# Quiz & JSON validation
# Validate quiz JSON structure and content.
# ======================================================================
"""Validate quiz JSON structure and content."""

def load_quiz(path: Path, errors):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data
    except Exception as e:
        msg(ERR, f"quiz JSON invalid: {path.name}: {e}")
        errors.append(f"quiz invalid: {path}")
        return None

ALLOWED_TYPES = {"pause","mcq","checkbox","poll","fr","free","free_response","fib"}

def validate_quiz_schema(q: dict, name: str, errors):
    ok = True
    # top-level
    for k in ["videoId","items"]:
        if k not in q:
            msg(ERR, f"{name}: missing top-level field '{k}'")
            errors.append(f"{name}: missing {k}")
            ok = False
    # items
    seen_ids = set()
    for i, it in enumerate(q.get("items", [])):
        it_id = str(it.get("id", f"#idx{i}"))
        if it_id in seen_ids:
            msg(WARN, f"{name}: duplicate item id '{it_id}'")
        seen_ids.add(it_id)
        typ = str(it.get("type","")).lower()
        if typ not in ALLOWED_TYPES:
            msg(WARN, f"{name}:{it_id}: unknown type '{typ}'")
        # timestamp requirement (warn if missing t except for some cases)
        if "t" not in it:
            msg(WARN, f"{name}:{it_id}: missing 't' (timestamp)")
        # type-specific checks
        if typ == "mcq":
            if not it.get("choices"):
                msg(ERR, f"{name}:{it_id}: mcq without choices"); ok=False
            if not it.get("correct"):
                msg(ERR, f"{name}:{it_id}: mcq without correct[]"); ok=False
        if typ == "checkbox":
            if not it.get("choices"):
                msg(ERR, f"{name}:{it_id}: checkbox without choices"); ok=False
            if not it.get("correct"):
                msg(ERR, f"{name}:{it_id}: checkbox without correct[]"); ok=False
        if typ in ("poll",):
            if it.get("points", 0):
                msg(WARN, f"{name}:{it_id}: poll has points ({it.get('points')}); polls are typically unscored")
        if typ in ("fr","free","free_response"):
            mx = it.get("maxLen")
            if mx is not None and not isinstance(mx, int):
                msg(WARN, f"{name}:{it_id}: fr.maxLen should be integer")
            if it.get("points", 0):
                msg(WARN, f"{name}:{it_id}: free-response has points; usually unscored")
    if ok:
        msg(OK, f"{name}: quiz schema looks good")
    return ok


def try_http_json(url: str, timeout=5):
    try:
        with urlopen(Request(url, headers={"Accept":"application/json"}), timeout=timeout) as r:
            body = r.read()
            ctype = r.headers.get("Content-Type","")
            try:
                data = json.loads(body.decode("utf-8","ignore"))
            except Exception:
                data = None
            return data, r.status, ctype
    except HTTPError as e:
        return None, e.code, ""
    except URLError:
        return None, None, ""
    except Exception:
        return None, None, ""


# ======================================================================
# Database validation
# Check SQLite schema and integrity.
# ======================================================================
"""Check SQLite schema and integrity."""

def check_db(db_path: Path, errors):
    if not db_path.exists():
        msg(WARN, f"DB file does not exist yet (will be created by app): {db_path}")
        return
    try:
        cx = sqlite3.connect(db_path)
        cur = cx.execute("PRAGMA table_info(attempts)")
        cols = [r[1] for r in cur.fetchall()]
        required = ["id","quiz_id","viewer","points","max_points","score_percent","created_at"]
        missing = [c for c in required if c not in cols]
        if missing:
            msg(WARN, f"attempts table missing columns: {missing}")
        else:
            msg(OK, "attempts table columns OK")
        c2 = cx.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
        msg(OK if c2>0 else WARN, f"attempts rows: {c2}")
        cx.close()
    except Exception as e:
        msg(ERR, f"DB open failed: {e}")
        errors.append(f"db open failed: {e}")


# ======================================================================
# API endpoint validation
# Test live API endpoints against manifest contract.
# ======================================================================
"""Test live API endpoints against manifest contract."""

def check_live_api(base_url: str, errors):
    base = base_url.rstrip("/")
    tests = [
        ("/api/selftest", True),
        ("/api/quizzes", True),
        ("/api/attempts", True),
        ("/api/responses", False),          # optional
        ("/api/polls/aggregate?quiz_id=sample", False),  # optional
    ]
    for path, required in tests:
        url = base + path
        data, status, _ = try_http_json(url)
        if status == 200:
            msg(OK, f"GET {path} → 200")
            if isinstance(data, dict) and data.get('ok') is False:
                msg(WARN, f"{path} reported ok=false: {data}")
        elif status in (404, 405):
            if required:
                msg(ERR, f"GET {path} → {status} (required endpoint missing?)")
                errors.append(f"missing endpoint {path}")
            else:
                msg(WARN, f"GET {path} → {status} (optional endpoint not installed)")
        elif status is None:
            msg(ERR, f"GET {path} → no response (server not running?)")
            errors.append("server not reachable")
            break
        else:
            msg(ERR, f"GET {path} → {status}")
            errors.append(f"{path} status {status}")


# ======================================================================
# Other
# Miscellaneous helpers.
# ======================================================================
"""Miscellaneous helpers."""

def msg(kind, text):
    print(f"{kind} {text}")


def expect_exists(path: Path, label: str, errors=None):
    """Backward-compatible: errors is optional so callers can pass just (path, label)."""
    if path.exists():
        msg(OK, f"{label}: {path}")
        return True
    msg(ERR, f"missing {label}: {path}")
    if errors is not None:
        errors.append(f"missing {label}: {path}")
    return False


def warn_if_missing(path: Path, label: str, errors=None):
    """Optional errors param for interface symmetry (ignored)."""
    if path.exists():
        msg(OK, f"{label}: {path}")
        return True
    msg(WARN, f"optional missing {label}: {path}")
    return False


def read_text(path: Path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return ""

# ======================================================================
# CLI / entrypoint
# Command-line interface for validation script.
# ======================================================================
"""Command-line interface for validation script."""

def main():
    ap = argparse.ArgumentParser(description="Validate MCQ project snapshot")
    ap.add_argument("--manifest", default=str(DEFAULT_MANIFEST), help="path to mcq-manifest.json")
    ap.add_argument("--url", default="", help="optional base URL (e.g., http://127.0.0.1:5000) to check live APIs")
    args = ap.parse_args()

    errors = []

    manifest = load_manifest(Path(args.manifest))
    paths = manifest.get("paths", {})
    pages = manifest.get("pages", {})
    frontend_ids = manifest.get("frontend_ids", {})

    backend_dir = ROOT / paths.get("backend_dir", "backend")
    frontend_dir= ROOT / paths.get("frontend_dir", "frontend")
    quizzes_dir = ROOT / paths.get("quizzes_dir", "quizzes")
    db_path     = ROOT / paths.get("db_path", "backend/data.sqlite3")

    msg(OK, f"Project root: {ROOT}")
    msg(OK, f"Using manifest: {Path(args.manifest)}")

    # 1) Directories
    expect_exists(backend_dir, "backend_dir", errors)
    expect_exists(frontend_dir,"frontend_dir", errors)
    expect_exists(quizzes_dir, "quizzes_dir", errors)

    # 2) Pages
    idx   = ROOT / pages.get("index","frontend/index.html")
    idxm  = ROOT / pages.get("index_simple","frontend/index-simple.html")
    dash  = ROOT / pages.get("dashboard","frontend/dashboard.html")

    expect_exists(idx,  "index.html", errors)
    warn_if_missing(idxm,"index-simple.html")
    expect_exists(dash, "dashboard.html", errors)

    # 3) Static files (served from frontend/)
    for fname, required in [
        ("styles.css", True),
        ("player.js", True),
        ("mcq-multi.js", False),
        ("dashboard.js", True),
        ("choices-color.css", False),
        ("choices-color.js", False),
        ("favicon.svg", False),
    ]:
        p = frontend_dir / fname
        # errors arg is optional now, so the same call works for both functions
        (expect_exists if required else warn_if_missing)(p, f"static {fname}")

    # 4) HTML IDs
    check_html_ids(idx,  frontend_ids.get("index", []), errors)
    check_html_ids(idxm, frontend_ids.get("index_simple", []), errors)
    check_html_ids(dash, frontend_ids.get("dashboard", []), errors)

    # 5) Quizzes
    quiz_files = sorted(quizzes_dir.glob("*.json"))
    if not quiz_files:
        msg(WARN, f"no quiz JSON files found in {quizzes_dir}")
    else:
        msg(OK, f"{len(quiz_files)} quiz file(s) found")
    for qf in quiz_files:
        q = load_quiz(qf, errors)
        if q is not None:
            validate_quiz_schema(q, qf.name, errors)

    # 6) DB schema
    check_db(db_path, errors)

    # 7) Optional: live API checks
    if args.url:
        check_live_api(args.url, errors)

    # Summary
    if errors:
        msg(ERR, f"Validation completed with {len(errors)} issue(s).")
        for e in errors:
            print("   -", e)
        sys.exit(1)
    msg(OK, "Validation completed with no blocking issues.")
    sys.exit(0)

if __name__ == "__main__":
    main()




