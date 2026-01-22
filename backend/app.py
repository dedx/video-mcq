#!/usr/bin/env python3
# -*- coding: utf-8 -*-
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

import os
import re
import json
import sqlite3
import datetime as dt
from pathlib import Path
from io import StringIO
import csv

from flask import (
    Flask, request, jsonify, send_from_directory, Response
)

# ------------------------------------------------------------------------------
# Paths / Config
# ------------------------------------------------------------------------------
MANIFEST_FILE = os.environ.get("MCQ_MANIFEST", str(Path(__file__).resolve().parent.parent / "mcq-manifest.json"))
try:
    _M = json.loads(Path(MANIFEST_FILE).read_text(encoding="utf-8"))
except Exception:
    _M = {}

# Use manifest values with safe defaults
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = PROJECT_ROOT / _M.get("paths", {}).get("frontend_dir", "frontend")
CONTENT_DIR  = PROJECT_ROOT / _M.get("paths", {}).get("quizzes_dir",  "quizzes")
#DB_PATH      = PROJECT_ROOT / _M.get("paths", {}).get("db_path",      "backend/data.sqlite3")
# DB path resolution order:                                                                         
# 1) DB_PATH env var (systemd recommended)                                                          
# 2) mcq-manifest.json paths.db_path                                                                
# 3) fallback: backend/data.sqlite3 (relative to PROJECT_ROOT)                                      
_db_env = os.getenv("DB_PATH")
if _db_env:
    DB_PATH = Path(_db_env).expanduser()
else:
    DB_PATH = PROJECT_ROOT / _M.get("paths", {}).get("db_path", "backend/data.sqlite3")

DB_PATH = DB_PATH.resolve()

STATIC_DIRS  = [ PROJECT_ROOT / m.get("dir","frontend") for m in _M.get("static",{}).get("mounts",[]) if m.get("url_prefix")=="/static" ] or [FRONTEND_DIR]

# Load .env/.flaskenv on startup, even if we run via `python app.py`
try:
    from dotenv import load_dotenv, find_dotenv
    # load .flaskenv first (dev overrides), then .env
    load_dotenv(find_dotenv(".flaskenv"), override=True)
    load_dotenv(find_dotenv(".env"), override=False)
except Exception:
    pass


def _env_key(name: str) -> str:
    v = (os.environ.get(name) or "").strip()
    # strip a single pair of surrounding quotes if present
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        v = v[1:-1]
    return v

#Admin key. Required for destructive routes
DELETE_KEY = _env_key("DELETE_KEY")
#Admin password to view db info on the dashboard page
VIEW_KEY = _env_key("VIEW_KEY")


# ------------------------------------------------------------------------------
# Flask app
# ------------------------------------------------------------------------------

app = Flask(__name__, static_folder=None)


# ======================================================================
# DB setup & helpers
# SQLite connection and schema helpers.
# ======================================================================
"""SQLite connection and schema helpers."""

def _connect():
    cx = sqlite3.connect(DB_PATH)
    cx.row_factory = sqlite3.Row
    return cx


def _table_has_column(cx, table, col):
    try:
        cur = cx.execute(f"PRAGMA table_info({table})")
        cols = [r["name"] for r in cur.fetchall()]
        return col in cols
    except Exception:
        return False


def _ensure_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as cx:
        # create table if not exists (base schema)
        cx.execute("""
            CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id TEXT NOT NULL,
                viewer TEXT,
                points REAL DEFAULT 0,
                max_points REAL DEFAULT 0
            )
        """)
        # ensure expected columns exist (no-ops if already there)
        cur = cx.execute("PRAGMA table_info(attempts)")
        cols = {r["name"] for r in cur.fetchall()}
        if "score_percent" not in cols:
            cx.execute("ALTER TABLE attempts ADD COLUMN score_percent REAL DEFAULT 0")
        if "answers_json" not in cols and "answers" not in cols:
            cx.execute("ALTER TABLE attempts ADD COLUMN answers_json TEXT")
        if "category" not in cols:
            cx.execute("ALTER TABLE attempts ADD COLUMN category TEXT")
        if "created_at" not in cols:
            cx.execute("ALTER TABLE attempts ADD COLUMN created_at TEXT")
        cx.commit()


def _answers_col_name(cx):
    # prefer answers_json if present; else fall back to answers if that exists
    if _table_has_column(cx, "attempts", "answers_json"):
        return "answers_json"
    if _table_has_column(cx, "attempts", "answers"):
        return "answers"
    # ensure answers_json exists for new installs
    try:
        cx.execute("ALTER TABLE attempts ADD COLUMN answers_json TEXT")
        cx.commit()
        return "answers_json"
    except Exception:
        # last-resort: no column available (should not happen)
        return "answers_json"

_ensure_db()

# ------------------------------------------------------------------------------
# Sanitization
# ------------------------------------------------------------------------------

SAFE_TEXT_RE = re.compile(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]')  # keep \t \n


# ======================================================================
# Sanitization & validation
# Clean inputs and viewer identifiers.
# ======================================================================
"""Clean inputs and viewer identifiers."""

def sanitize_text(s: str, limit: int = 500) -> str:
    s = '' if s is None else str(s)
    s = SAFE_TEXT_RE.sub('', s)
    return s[:max(1, int(limit))]


def sanitize_viewer(s: str) -> str:
    # Keep alnum, dot, underscore, hyphen; trim to 120 chars
    s = sanitize_text(s, 120)
    return re.sub(r'[^A-Za-z0-9._-]+', '', s)


# ======================================================================
# Quiz loading & utilities
# Load and manipulate quiz JSON and metadata.
# ======================================================================
"""Load and manipulate quiz JSON and metadata."""

def _load_quiz_json(quiz_id: str) -> dict:
    fp = CONTENT_DIR / f"{quiz_id}.json"
    return json.loads(fp.read_text(encoding='utf-8'))


def _load_quiz_maxlens(quiz_id: str):
    """Return {item_id: maxLen} for free-response items; default 500 if absent."""
    try:
        data = _load_quiz_json(quiz_id)
    except Exception:
        return {}
    out = {}
    for it in data.get('items', []):
        typ = str(it.get('type','')).lower()
        if typ in ('fr','free','free_response'):
            out[str(it.get('id'))] = int(it.get('maxLen') or 500)
    return out


def _quiz_items_by_type(qz: dict, types: set[str]) -> list[dict]:
    return [it for it in qz.get('items', []) if str(it.get('type','')).lower() in types]


def _extract_watch_meta(ans):
    """Return (watch_percent, watch_seconds) from answers JSON."""
    try:
        if isinstance(ans, str):
            ans = json.loads(ans)
    except Exception:
        ans = {}
    meta = ans.get('__meta', {}) if isinstance(ans, dict) else {}
    wp = meta.get('watchPercent', None)
    ws = meta.get('watchSeconds', None)
    # normalize to strings to avoid 'None' in CSV; keep 2 decimals when present
    fmt = lambda v: (f"{float(v):.2f}" if isinstance(v, (int, float)) else ("{:.2f}".format(float(v)) if v is not None else ""))
    return fmt(wp), fmt(ws)


# ======================================================================
# Access control (view/delete)
# Authorization checks for viewing/deleting quizzes.
# ======================================================================
"""Authorization checks for viewing/deleting quizzes."""

def delete_ok(req: request) -> bool:
    """enforce: deletes only wth key set"""
    if not DELETE_KEY:
        return False
    # header takes precedence
    hdr = req.headers.get("X-Delete-Key", "").strip()
    if hdr and hdr == DELETE_KEY:
        return True
    # query/body fallback (be tolerant about missing/invalid JSON)
    body = req.get_json(silent=True) or {}
    q = (req.args.get("delete_key") or body.get("delete_key") or "").strip()
    return q == DELETE_KEY


def view_ok(req: request) -> bool:
    """enforce: if no VIEW_KEY set, deny viewing (UI will still load; API returns 401)"""
    if not VIEW_KEY:
        return False
    # accept ONLY the X-View-Key header or ?view_key=...
    hdr = (req.headers.get("X-View-Key") or "").strip()
    if hdr == VIEW_KEY:
        return True
    # query/body fallback (be tolerant about missing/invalid JSON)
    body = req.get_json(silent=True) or {}
    q = (req.args.get("view_key") or body.get("view_key") or "").strip()
    return q == VIEW_KEY



# ======================================================================
# Frontend/static routing
# Serve frontend pages and static files.
# ======================================================================
'''Serve frontend pages and static files.'''

# ------------------------------------------------------------------------------
# Static / Index
# ------------------------------------------------------------------------------

def _frontend_path(*parts) -> Path:
    p = FRONTEND_DIR.joinpath(*parts)
    return p

@app.get("/")
def index():
    # Serve the multi-player page by default
    fp = _frontend_path("index.html")
    if fp.exists():
        return send_from_directory(fp.parent.as_posix(), fp.name)
    return jsonify({"ok": False, "error": "index.html not found"}), 404

    # Serve the single-player page, if desired
@app.get("/index-simple")
def index_simple():
    fp = _frontend_path("index-simple.html")
    if fp.exists():
        return send_from_directory(fp.parent.as_posix(), fp.name)
    return jsonify({"ok": False, "error": "index-simple.html not found"}), 404

@app.get("/dashboard")
def dashboard():
    fp = FRONTEND_DIR / "dashboard.html"
    if fp.exists():
        return send_from_directory(fp.parent.as_posix(), fp.name)
    return jsonify({"ok": False, "error": "dashboard.html not found"}), 404

@app.get("/static/<path:subpath>")
def static_files(subpath):
    # Serve first match across the configured roots
    for root in STATIC_DIRS:
        if root.exists():
            candidate = root / subpath
            if candidate.exists():
                return send_from_directory(root.as_posix(), subpath)
    return jsonify({"ok": False, "error": f"static file not found: {subpath}"}), 404

# ======================================================================
# API endpoints (quizzes)
# Flask API endpoints that expose quizzes to frontend.
# ======================================================================
'''Flask API endpoints that expose quizzes to frontend.'''

# ------------------------------------------------------------------------------
# Quiz content
# ------------------------------------------------------------------------------

@app.get("/api/quizzes")
def list_quizzes():
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    items = []
    for fp in sorted(CONTENT_DIR.glob("*.json")):
        try:
            data = json.loads(fp.read_text(encoding='utf-8'))
        except Exception:
            continue
        qid = fp.stem
        title = data.get("title") or qid
        category = data.get("category")
        group = data.get("group")
        items.append({"id": qid, "title": title, "category": category, "group": group})
    return jsonify({"quizzes": items})

@app.get("/api/quiz/<quiz_id>")
def get_quiz(quiz_id):
    fp = CONTENT_DIR / f"{quiz_id}.json"
    if not fp.exists():
        return jsonify({"error": "quiz not found"}), 404
    try:
        data = json.loads(fp.read_text(encoding='utf-8'))
        data["id"] = quiz_id
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": f"failed to read quiz: {e}"}), 500


# ======================================================================
# Attempt handling
# Record and analyze quiz attempts in SQLite.
# ======================================================================
"""Record and analyze quiz attempts in SQLite."""

@app.post("/api/attempt/<quiz_id>")
def submit_attempt(quiz_id):
    data = request.get_json(force=True, silent=False) or {}

    raw_viewer = (data.get('viewer') or '').strip()
    points     = float(data.get('points') or 0)
    max_points = float(data.get('max_points') or 0)
    answers    = data.get('answers') or {}
    category   = data.get('category') or None

    # Sanitize viewer and free text
    viewer = sanitize_viewer(raw_viewer)

    maxlens = _load_quiz_maxlens(quiz_id)
    for item_id, val in list(answers.items()):
        if isinstance(val, dict):
            if 'text' in val:
                lim = int(maxlens.get(item_id, val.get('maxLen') or 500))
                val['text'] = sanitize_text(val.get('text', ''), lim)
                val['maxLen'] = lim
            if 'selected' in val and isinstance(val['selected'], list):
                val['selected'] = [str(x) for x in val['selected'] if x is not None]
            if 'accept' in val and isinstance(val['accept'], list):
                val['accept'] = [str(x) for x in val['accept'] if x is not None]

    created_at = dt.datetime.now(dt.timezone.utc).isoformat()
    score_percent = round((points / max_points) * 100, 2) if max_points else 0.0

    with _connect() as cx:
        ans_col = _answers_col_name(cx)
        cx.execute(f"""
            INSERT INTO attempts
                (quiz_id, viewer, points, max_points, score_percent, {ans_col}, category, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            quiz_id,
            viewer,
            points,
            max_points,
            score_percent,
            json.dumps(answers, ensure_ascii=False),
            category,
            created_at
        ))
        attempt_id = cx.execute('SELECT last_insert_rowid()').fetchone()[0]

    return jsonify({
        "ok": True,
        "id": attempt_id,
        "quiz_id": quiz_id,
        "viewer": viewer,
        "points": points,
        "max_points": max_points,
        "score_percent": score_percent,
        "created_at": created_at
    })


# ------------------------------------------------------------------------------
# Attempts listing / helpers
# ------------------------------------------------------------------------------

def _row_to_attempt_dict(row, answers_col_name: str):
    # Cope with either answers_json or answers column name
    answers_raw = row.get(answers_col_name, None)
    try:
        answers = json.loads(answers_raw) if answers_raw else {}
    except Exception:
        answers = {}
    points = float(row.get("points") or 0)
    max_points = float(row.get("max_points") or 0)
    score_percent = row.get("score_percent")
    if score_percent is None:
        score_percent = round((points / max_points) * 100, 2) if max_points else 0.0
    return {
        "id": row["id"],
        "quiz_id": row["quiz_id"],
        "viewer": row["viewer"],
        "points": points,
        "max_points": max_points,
        "score_percent": float(score_percent),
        "answers": answers,  # kept for compatibility if someone wants full JSON via API
        "category": row.get("category"),
        "created_at": row.get("created_at"),
    }

def _fetch_attempts(quiz_id=None, viewer=None):
    with _connect() as cx:
        ans_col = _answers_col_name(cx)
        sql = f"""
            SELECT id, quiz_id, viewer, points, max_points, score_percent, {ans_col} AS {ans_col}, category, created_at
            FROM attempts
            WHERE 1=1
        """
        params = []
        if quiz_id:
            sql += " AND quiz_id = ?"
            params.append(quiz_id)
        if viewer:
            sql += " AND viewer = ?"
            params.append(viewer)
        sql += " ORDER BY created_at ASC, id ASC"
        cur = cx.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        return [_row_to_attempt_dict(r, ans_col) for r in rows]

def _best_or_latest(rows, mode="latest"):
    """
    Group by (quiz_id, viewer) and pick 'latest' (by created_at then id) or 'best' (score_percent).
    """
    from collections import defaultdict
    buckets = defaultdict(list)
    for r in rows:
        buckets[(r['quiz_id'], r['viewer'])].append(r)
    out = []
    for (_, _), arr in buckets.items():
        if mode == "best":
            arr_sorted = sorted(arr, key=lambda x: ((x.get('score_percent') or 0.0), x['created_at'], x['id']))
        else:
            arr_sorted = sorted(arr, key=lambda x: (x['created_at'], x['id']))
        out.append(arr_sorted[-1])
    return out

@app.get("/api/attempts")
def list_attempts():
    quiz_id = request.args.get("quiz_id") or None
    viewer  = request.args.get("viewer") or None
    mode    = (request.args.get("attempt") or "all").lower()  # all|latest|best

    rows = _fetch_attempts(quiz_id, viewer)
    if mode in ("latest", "best"):
        rows = _best_or_latest(rows, mode=mode)

    return jsonify({"attempts": rows})


# ------------------------------------------------------------------------------
# Delete endpoints
# ------------------------------------------------------------------------------

@app.before_request
def _protect():
    p = request.path or ""
    m = request.method
    # --- Always allow the UI shell and static assets to load ---
    if m in ("GET", "HEAD", "OPTIONS"):
        if (
            p in ("/", "/dashboard") or                     # the HTML
            p.startswith("/static/") or                     # your static dir (adjust if different)
            p.endswith((".js", ".css", ".map", ".ico",      # common assets
                        ".png", ".jpg", ".svg",
                        ".woff", ".woff2", ".ttf", ".eot",
                        ".txt"))
        ):
            return  # allow UI to load so the user can enter a key

    # Public read APIs (needed by learners & public pages)
    if p.startswith("/api/quizzes") or p.startswith("/api/quiz/"):
        return None

    # View-only APIs (must have VIEW_KEY)
    if (
        (p.startswith("/api/attempts") and m == "GET") or
        (p.startswith("/api/responses") and m == "GET") or
        p.startswith("/api/export")
    ):
        if not view_ok(request):
            return jsonify({"error":"unauthorized"}), 401

    # destructive surfaces: need DELETE_KEY if set
    if (
        (p.startswith("/api/attempt/") and m == "DELETE") or
        p.startswith("/api/attempts/delete_")
    ):
        if not delete_ok(request):
            return jsonify({"error":"unauthorized"}), 401

@app.delete("/api/attempt/<int:attempt_id>")
def delete_attempt(attempt_id: int):
    if not delete_ok(request):
        return jsonify({"error": "unauthorized"}), 401
    with _connect() as cx:
        cx.execute("DELETE FROM attempts WHERE id = ?", (attempt_id,))
    return jsonify({"ok": True, "deleted": attempt_id})

@app.post("/api/attempts/delete_by_viewer")
def delete_by_viewer():
    if not delete_ok(request):
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    quiz_id = (request.args.get("quiz_id") or data.get("quiz_id") or "").strip()
    viewer  = (request.args.get("viewer")  or data.get("viewer") or "").strip()
    if not quiz_id or not viewer:
        return jsonify({"error": "quiz_id and viewer required"}), 400
    with _connect() as cx:
        cx.execute("DELETE FROM attempts WHERE quiz_id = ? AND viewer = ?", (quiz_id, viewer))
    return jsonify({"ok": True, "deleted_viewer": viewer, "quiz_id": quiz_id})

@app.post("/api/attempts/delete_all")
def delete_all_for_quiz():
    if not delete_ok(request):
        return jsonify({"error": "unauthorized"}), 401
    data = request.get_json(force=True, silent=True) or {}
    quiz_id = (data.get("quiz_id") or "").strip()
    if not quiz_id:
        return jsonify({"error": "quiz_id required"}), 400
    with _connect() as cx:
        cx.execute("DELETE FROM attempts WHERE quiz_id = ?", (quiz_id,))
    return jsonify({"ok": True, "deleted_quiz": quiz_id})

# ------------------------------------------------------------------------------
# Export attempts CSV (wide/long)
# ------------------------------------------------------------------------------

@app.get("/api/export/attempts")
def export_attempts_csv():
    """
    CSV export of attempts.
    Query params:
      - quiz_id (optional)
      - viewer  (optional)
      - attempt = latest|best|all   (default latest)
      - group_by = viewer|quiz|none (for future use; currently passthrough)
      - include_answers = 0|1       (adds a JSON column 'answers_json')
    """
    quiz_id = request.args.get("quiz_id") or None
    viewer  = request.args.get("viewer") or None
    mode    = (request.args.get("attempt") or "latest").lower()
    include_answers = (request.args.get("include_answers") or "0") in ("1", "true", "yes")

    rows = _fetch_attempts(quiz_id, viewer)
    if mode in ("latest", "best"):
        rows = _best_or_latest(rows, mode=mode)

    sio = StringIO()
    w = csv.writer(sio)
    base_cols = ['id', 'created_at', 'quiz_id', 'viewer', 'points', 'max_points', 'score_percent','watch_percent', 'watch_seconds']
    if include_answers:
        base_cols.append('answers_json')
    w.writerow(base_cols)

    
    for r in rows:
        wp, ws = _extract_watch_meta(r.get('answers') or {})
        line = [r['id'], r['created_at'], r['quiz_id'], r['viewer'], r['points'], r['max_points'], r['score_percent'], wp, ws]


        if include_answers:
            line.append(json.dumps(r.get('answers') or {}, ensure_ascii=False))
        w.writerow(line)

    csv_bytes = sio.getvalue().encode('utf-8')
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="attempts_{quiz_id or "all"}_{mode}.csv"'}
    )

# ------------------------------------------------------------------------------
# Poll & Free-Response APIs
# ------------------------------------------------------------------------------

@app.get("/api/responses")
def list_poll_fr():
    """
    List raw poll and/or free-response entries from attempts.
    Query params:
      - quiz_id (optional)
      - type = poll | fr | all (default all)
      - attempt = all | latest | best (default all)
    """
    quiz_id = request.args.get('quiz_id') or None
    typ = (request.args.get('type') or 'all').lower()
    mode = (request.args.get('attempt') or 'all').lower()

    rows = _fetch_attempts(quiz_id, viewer=None)
    if mode in ('latest','best'):
        rows = _best_or_latest(rows, mode=mode)

    # Cache quizzes to infer types if answer dict lacks 'kind'
    quiz_cache = {}
    def get_item_type(qid, item_id):
        if qid not in quiz_cache:
            try:
                quiz_cache[qid] = _load_quiz_json(qid)
            except Exception:
                quiz_cache[qid] = {"items":[]}
        for it in quiz_cache[qid].get('items',[]):
            if str(it.get('id')) == str(item_id):
                return str(it.get('type','')).lower(), it
        return None, None

    out = []
    for r in rows:
        qid = r['quiz_id']
        ans = r.get('answers') or {}
        for item_id, val in ans.items():
            k = None
            if isinstance(val, dict) and 'kind' in val:
                k = str(val['kind']).lower()
            if not k:
                k, _ = get_item_type(qid, item_id)
            if k not in ('poll','fr'):
                continue
            if typ != 'all' and k != typ:
                continue
            entry = {
                "attempt_id": r['id'],
                "quiz_id": qid,
                "viewer": r['viewer'],
                "item_id": item_id,
                "item_type": k,
                "created_at": r['created_at'],
            }
            if k == 'poll':
                sel = []
                if isinstance(val, dict) and isinstance(val.get('selected'), list):
                    sel = [str(x) for x in val['selected']]
                entry["selected"] = sel
            else:
                txt = ""
                if isinstance(val, dict):
                    txt = str(val.get('text',''))
                entry["text"] = txt
            out.append(entry)

    return jsonify({"responses": out})


@app.get("/api/polls/aggregate")
def aggregate_polls():
    """
    Aggregate counts per poll item for a given quiz.
    Query params: quiz_id (required), attempt=all|latest|best (default latest)
    """
    quiz_id = request.args.get('quiz_id')
    if not quiz_id:
        return jsonify({"error":"quiz_id required"}), 400

    mode = (request.args.get('attempt') or 'latest').lower()
    rows = _fetch_attempts(quiz_id, viewer=None)
    if mode in ('latest','best'):
        rows = _best_or_latest(rows, mode=mode)

    try:
        quiz = _load_quiz_json(quiz_id)
    except Exception:
        return jsonify({"quiz_id": quiz_id, "polls": {}})

    polls = _quiz_items_by_type(quiz, {'poll'})
    poll_map = { str(it.get('id')): it for it in polls }
    counts = {}
    for pid, it in poll_map.items():
        choices = it.get('choices', [])
        counts[pid] = {
            "prompt": it.get('prompt') or pid,
            "choices": { str(c.get('id')): {"text": c.get('text',str(c.get('id'))), "count": 0} for c in choices }
        }

    for r in rows:
        ans = r.get('answers') or {}
        for item_id, val in ans.items():
            if item_id not in poll_map:
                continue
            if not isinstance(val, dict):
                continue
            sel = val.get('selected') or []
            for v in sel:
                v = str(v)
                if v in counts[item_id]["choices"]:
                    counts[item_id]["choices"][v]["count"] += 1

    return jsonify({"quiz_id": quiz_id, "polls": counts})


@app.get("/api/export/poll_fr")
def export_poll_fr():
    """
    Export wide CSV: one row per (viewer, quiz_id), columns for each poll/FR item.
    Query params:
      - quiz_id (required)
      - attempt = latest|best|all  (default latest)
      - name_mode = id|prompt      (default id)
      - limit_prompt = int         (default 40)
    """
    quiz_id = request.args.get('quiz_id')
    if not quiz_id:
        return jsonify({"error":"quiz_id required"}), 400
    attempt_mode = (request.args.get('attempt') or 'latest').lower()
    name_mode = (request.args.get('name_mode') or 'id').lower()
    limit_prompt = int(request.args.get('limit_prompt') or 40)

    rows = _fetch_attempts(quiz_id, viewer=None)
    if attempt_mode in ('latest','best'):
        rows = _best_or_latest(rows, mode=attempt_mode)

    quiz = _load_quiz_json(quiz_id)
    polls = _quiz_items_by_type(quiz, {'poll'})
    frs   = _quiz_items_by_type(quiz, {'fr','free','free_response'})

    def col_name(it, prefix):
        if name_mode == 'prompt':
            p = (it.get('prompt') or it.get('id') or '').strip().replace('\n',' ')
            if len(p) > limit_prompt:
                p = p[:limit_prompt-1] + '…'
            return f"{prefix}:{p}"
        else:
            return f"{prefix}:{it.get('id')}"

    poll_cols = [(str(it.get('id')), col_name(it,'poll')) for it in polls]
    fr_cols   = [(str(it.get('id')), col_name(it,'fr'))   for it in frs]

    sio = StringIO()
    w = csv.writer(sio)
    header = ['viewer','quiz_id','created_at','points','max_points','score_percent', 'watch_percent','watch_seconds'] + [c for _,c in poll_cols] + [c for _,c in fr_cols]
    w.writerow(header)

    for r in rows:
        ans = r.get('answers') or {}
        wp, ws = _extract_watch_meta(ans)
        base = [r['viewer'], r['quiz_id'], r['created_at'], r['points'], r['max_points'], r['score_percent'], wp, ws]
        ans = r.get('answers') or {}
        poll_vals = []
        for item_id, cname in poll_cols:
            v = ans.get(item_id, {})
            if isinstance(v, dict) and isinstance(v.get('selected'), list):
                poll_vals.append('|'.join(str(x) for x in v['selected']))
            else:
                poll_vals.append('')
        fr_vals = []
        for item_id, cname in fr_cols:
            v = ans.get(item_id, {})
            txt = ''
            if isinstance(v, dict) and 'text' in v:
                txt = str(v['text'])
            fr_vals.append(txt)
        w.writerow(base + poll_vals + fr_vals)

    csv_bytes = sio.getvalue().encode('utf-8')
    return Response(
        csv_bytes,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="poll_fr_{quiz_id}_{attempt_mode}.csv"'}
    )


@app.get("/favicon.ico")
@app.get("/favicon.svg")
def favicon():
    for root in STATIC_DIRS:
        for name in ("favicon.svg", "favicon.ico"):
            fp = root / name
            if fp.exists():
                return send_from_directory(root.as_posix(), name)
    return Response(status=204)  # no favicon; stop the browser from retrying


# ------------------------------------------------------------------------------
# Health / self-test (optional)
# ------------------------------------------------------------------------------

@app.get("/api/selftest")
def selftest():
    ok = True
    notes = []

    # content dir
    if not CONTENT_DIR.exists():
        ok = False
        notes.append("CONTENT_DIR missing")
    else:
        jfs = list(CONTENT_DIR.glob("*.json"))
        notes.append(f"{len(jfs)} quiz file(s) visible")

    # DB table / columns
    with _connect() as cx:
        try:
            cur = cx.execute("PRAGMA table_info(attempts)")
            cols = [r["name"] for r in cur.fetchall()]
            for c in ("quiz_id","viewer","points","max_points","score_percent","created_at"):
                if c not in cols:
                    ok = False
                    notes.append(f"missing column: {c}")
            # ensure answers col presence check
            _ = _answers_col_name(cx)
        except Exception as e:
            ok = False
            notes.append(f"DB error: {e}")

    return jsonify({"ok": ok, "notes": notes})


@app.get("/api/debug/dbinfo")
def dbinfo():
    try:
        with _connect() as cx:
            cur = cx.execute("PRAGMA database_list")
            dblist = [dict(zip([d[0] for d in cur.description], row)) for row in cur.fetchall()]
            cur = cx.execute("PRAGMA table_info(attempts)")
            cols = [dict(zip([d[0] for d in cur.description], row)) for row in cur.fetchall()]
            cur = cx.execute("SELECT COUNT(*) FROM attempts")
            count = cur.fetchone()[0]
            cur = cx.execute("SELECT id, quiz_id, viewer, created_at FROM attempts ORDER BY id DESC LIMIT 5")
            recent = [dict(zip([d[0] for d in cur.description], row)) for row in cur.fetchall()]
        return jsonify({
            "ok": True,
            "db_path": str(DB_PATH),
            "database_list": dblist,
            "attempts_columns": cols,
            "attempts_count": count,
            "attempts_recent": recent
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "db_path": str(DB_PATH)}), 500





# ------------------------------------------------------------------------------
# Run (for local dev)
# ------------------------------------------------------------------------------

if __name__ == "__main__":
    # Bind host/port if provided; otherwise let Flask/werkzeug choose
    host = os.environ.get("HOST", "127.0.0.1")
    port_env = os.environ.get("PORT", "").strip()
    try:
        port = int(port_env) if port_env else 0  # 0 => dynamic port
    except Exception:
        port = 0
    debug = (os.environ.get("FLASK_DEBUG") in ("1","true","True"))

    print(f"Starting server on {host}:{'(dynamic)' if port==0 else port}  |  content={CONTENT_DIR}  db={DB_PATH}")
    print(f"FRONTEND_DIR = {FRONTEND_DIR}")
    print(f"CONTENT_DIR  = {CONTENT_DIR}")
    print("Static roots search order:")
    for p in STATIC_DIRS:
        print(" -", p)
    app.run(host=host, port=port, debug=debug)
