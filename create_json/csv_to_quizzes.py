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

"""
csv_to_quizzes.py
-----------------
Convert a single CSV (rows = items) into one or more quiz JSON files compatible with your Video-MCQ app.

• Grouping: by a quiz id column (default: "quiz_id"). You can override with --id-col.
  Common alternative header names like "video_tag" are recognized automatically.

Supported item types (column 'type', case-insensitive):
  - mcq        : multiple choice (single or multiple correct allowed)
  - checkbox   : check-all-that-apply (scored with partial credit/penalties if provided)
  - fib        : fill-in-blank (string match; optional caseSensitive; accepted answers in 'accept')
  - pause      : informational pause (no points)
  - poll       : non-scored selection(s), recorded for aggregation (no correct key)
  - fr         : free response (short text), stored but not scored (limit via maxLen)

CSV schema (header names, case-insensitive)
Top-level quiz fields (may repeat on each row; the last non-blank wins per quiz):
  - endAt (optional; seconds or mm:ss or hh:mm:ss)
  - quiz_id (or: video_tag, tag, quiz, id)   ← grouping key & output filename
  - title
  - category
  - group ← by week
  - videoId (or: video_id, videoid)          ← REQUIRED for each quiz
  - allowSeeking (true/false)
  - requireContinue (true/false)
  - requireWatchToEnd (true/false)
  - requireIdentity (true/false)
  - identityPrompt
  - feedbackDelaySeconds (number)

Per-item fields:
  - type        (mcq | checkbox | fib | pause | poll | fr)    ← REQUIRED
  - t           (timestamp seconds or mm:ss or hh:mm:ss)      ← REQUIRED for most items
  - item_id     (optional; if blank, auto-generated)
  - prompt      (text)
  - note        (pause-only: small note under prompt)
  - points      (numeric; default 1 for mcq/fib; 0 for pause/poll/fr)

Choices (mcq/checkbox/poll):
  - correct     (comma-separated ids like: a,c,d)  ← not used for poll
  - choice_a, choice_b, choice_c, ...             ← visible text for each option
  - feedback_a, feedback_b, feedback_c, ...       ← optional per-option feedback (shown after submit)

Checkbox scoring (optional):
  - pointsPerCorrect (numeric)                     ← if set, max points = len(correct)*pointsPerCorrect
  - penaltyPerWrong  (numeric)                     ← per incorrect selected
  - capAtMax         (true/false, default true)    ← cap score at max

FIB (fill in blank):
  - accept        (comma-separated accepted answers)
  - caseSensitive (true/false; default false)
  - placeholder   (optional UI hint)

Free response (fr):
  - maxLen       (integer char limit, default 280)
  - placeholder  (optional UI hint)
"""

import csv, json, re, sys, argparse
from pathlib import Path
from typing import Dict, Any, List

BOOL_TRUE = {'1','true','yes','y','on','t'}
BOOL_FALSE = {'0','false','no','n','off','f',''}


# ======================================================================
# Type coercion helpers
# Convert CSV values into bool, float, or int.
# ======================================================================
"""Convert CSV values into bool, float, or int."""

def as_bool(s):
    if s is None:
        return None
    s = str(s).strip().lower()
    if s in BOOL_TRUE: return True
    if s in BOOL_FALSE: return False
    return None


def as_float(s, default=None):
    if s is None or str(s).strip()=='':
        return default
    try:
        return float(str(s).strip())
    except ValueError:
        return default


def as_int(s, default=None):
    f = as_float(s, None)
    if f is None:
        return default
    try:
        return int(round(f))
    except Exception:
        return default


# ======================================================================
# Time parsing helpers
# Parse timestamps into seconds.
# ======================================================================
"""Parse timestamps into seconds."""

def parse_time(s):
    """Accept seconds or mm:ss or hh:mm:ss; returns int seconds."""
    if s is None or str(s).strip()=='':
        raise ValueError("blank timestamp")
    s = str(s).strip()
    # plain seconds
    try:
        if re.fullmatch(r'\d+(\.\d+)?', s):
            return int(round(float(s)))
    except ValueError:
        pass
    # mm:ss or hh:mm:ss
    parts = s.split(':')
    if not all(p.isdigit() for p in parts):
        raise ValueError(f"Invalid time format: {s}")
    if len(parts) == 2:
        m, sec = map(int, parts)
        return m*60 + sec
    elif len(parts) == 3:
        h, m, sec = map(int, parts)
        return h*3600 + m*60 + sec
    else:
        raise ValueError(f"Invalid time format: {s}")


def parse_time_safe(s):
    try:
        return parse_time(s)
    except Exception:
        return None


# ======================================================================
# Header/string helpers
# Normalize headers, split strings, and generate IDs.
# ======================================================================
"""Normalize headers, split strings, and generate IDs."""

def norm_header(h: str) -> str:
    h = (h or '').replace('\ufeff', '')  # remove BOM if present
    return re.sub(r'\s+', '', h.strip().lower())


ALT_ID_COLS = ['quiz_id','video_tag','videotag','tag','quiz','id']


def pick_id_col(fieldnames: List[str], preferred: str = None) -> str:
    if preferred:
        return preferred
    normed = [norm_header(h) for h in (fieldnames or [])]
    for cand in ALT_ID_COLS:
        if cand in normed:
            return cand
    # fallback: first header
    return normed[0] if normed else 'quiz_id'


def clean(v):
    if v is None:
        return ''
    if isinstance(v, list):
        return " ".join(str(x) for x in v)
    return str(v).strip()


def split_list(s):
    if s is None: return []
    s = str(s).strip()
    if not s: return []
    return [x.strip() for x in re.split(r'[,\|;]', s) if x.strip()]


def next_id(n):
    # a, b, c, ..., z, aa, ab, ...
    letters = "abcdefghijklmnopqrstuvwxyz"
    base = len(letters)
    out = ""
    n0 = n
    n += 1
    while n > 0:
        n, rem = divmod(n-1, base)
        out = letters[rem] + out
    return out


# ======================================================================
# Quiz choice helpers
# Collect choice/feedback columns into quiz items.
# ======================================================================
"""Collect choice/feedback columns into quiz items."""

def collect_choices(nrow: Dict[str,str]):
    # gather choice_a... and feedback_a...
    choices = []
    feedback = {}
    # scan a..z safely
    for i in range(26):
        cid = chr(ord('a') + i)
        txt = nrow.get(f'choice_{cid}') or ''
        if txt:
            choices.append({"id": cid, "text": txt})
        ftxt = nrow.get(f'feedback_{cid}') or ''
        if ftxt:
            feedback[cid] = ftxt
    # wildcard feedback
    if (nrow.get('feedback') or '').strip():
        feedback['*'] = nrow.get('feedback').strip()
    return choices, (feedback if feedback else None)


# ======================================================================
# Main entrypoint
# Command-line interface to convert CSV into quiz JSON files.
# ======================================================================
"""Command-line interface to convert CSV into quiz JSON files."""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", help="Input CSV path")
    ap.add_argument("--out", default="./quizzes", help="Output directory for JSON")
    ap.add_argument("--id-col", default=None, help="Override grouping column (normalized name)")
    ap.add_argument("--dry-run", action="store_true", help="Print JSON instead of writing files")
    args = ap.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"[ERR] CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(2)

    with csv_path.open(newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        id_col = args.id_col or pick_id_col(headers)
        quizzes: Dict[str, Dict[str, Any]] = {}
        quiz_meta: Dict[str, Dict[str, Any]] = {}

        for rown, row in enumerate(reader, start=2):
            # normalize headers → values
            nrow = { norm_header(k): clean(v) for k,v in row.items() }

            qid = nrow.get(id_col) or ''
            if not qid:
                # If no group id, skip quietly
                continue
            # Ensure bucket
            if qid not in quizzes:
                quizzes[qid] = {"id": qid, "items": []}
                quiz_meta[qid] = {}

            # per-quiz fields (last non-blank wins)
            def set_meta(key_norm, out_key, conv=lambda x: x):
                v = nrow.get(key_norm)
                if v is not None and v != '':
                    try:
                        quiz_meta[qid][out_key] = conv(v)
                    except Exception:
                        pass

            set_meta('title','title', str)
            set_meta('category','category', str)
            set_meta('group','group', str)
            # videoId aliases
            vid = nrow.get('videoid') or nrow.get('video_id') or nrow.get('videoid')
            if not vid:
                vid = nrow.get('videoid')  # normalized version already tried; keep redundancy harmless
            if not vid:
                vid = nrow.get('videoid')
            # better: try via headers map
            vid = nrow.get('videoid') or nrow.get('video_id') or nrow.get('videoid')
            if nrow.get('videoid') or nrow.get('video_id'):
                quiz_meta[qid]['videoId'] = nrow.get('videoid') or nrow.get('video_id')

            # Generic meta flags
            for k_norm, out_key, conv in [
                ('allowseeking','allowSeeking', lambda x: bool(as_bool(x)) if as_bool(x) is not None else None),
                ('requirecontinue','requireContinue', lambda x: bool(as_bool(x)) if as_bool(x) is not None else None),
                ('requirewatchtoend','requireWatchToEnd', lambda x: bool(as_bool(x)) if as_bool(x) is not None else None),
                ('requireidentity','requireIdentity', lambda x: bool(as_bool(x)) if as_bool(x) is not None else None),
                ('identityprompt','identityPrompt', str),
                ('feedbackdelayseconds','feedbackDelaySeconds', lambda x: as_int(x)),
                ('endat','endAt', parse_time_safe),
            ]:
                v = nrow.get(k_norm)
                if v not in (None, ''):
                    val = conv(v)
                    if val is not None:
                        quiz_meta[qid][out_key] = val

            # item type
            typ = (nrow.get('type') or '').lower()
            if not typ:
                continue  # skip
            # timestamp
            try:
                tval = parse_time(nrow.get('t'))
            except Exception as e:
                print(f"[WARN] Row {rown}: bad t='{nrow.get('t')}' → {e}", file=sys.stderr)
                continue

            # item id
            item_id = (nrow.get('item_id') or '').strip()
            if not item_id:
                # auto id: per-quiz running count
                item_id = f"i{len(quizzes[qid]['items'])+1}"

            prompt = nrow.get('prompt') or ''
            note = nrow.get('note') or ''
            points = as_float(nrow.get('points'), None)

            item: Dict[str, Any] = {"id": item_id, "t": tval, "type": typ}
            if prompt: item["prompt"] = prompt
            if points is not None: item["points"] = points
            if typ == 'pause':
                if note: item['note'] = note

            if typ in ('mcq','checkbox','poll'):
                choices, fb = collect_choices(nrow)
                if choices:
                    item['choices'] = choices
                # correct only for mcq/checkbox
                if typ != 'poll':
                    corr = split_list(nrow.get('correct'))
                    if corr:
                        item['correct'] = corr
                # per-option feedback
                if fb:
                    item['feedback'] = fb
                # checkbox scoring knobs
                if typ == 'checkbox':
                    ppc = as_float(nrow.get('pointspercorrect'), None)
                    ppw = as_float(nrow.get('penaltyperwrong'), None)
                    cam = as_bool(nrow.get('capatmax'))
                    if ppc is not None: item['pointsPerCorrect'] = ppc
                    if ppw is not None: item['penaltyPerWrong'] = ppw
                    if cam is not None: item['capAtMax'] = bool(cam)

            elif typ == 'fib':
                acc = split_list(nrow.get('accept'))
                if acc: item['accept'] = acc
                cs = as_bool(nrow.get('casesensitive'))
                if cs is not None: item['caseSensitive'] = bool(cs)
                ph = nrow.get('placeholder') or ''
                if ph: item['placeholder'] = ph

            elif typ in ('fr','free','free_response'):
                mx = as_int(nrow.get('maxlen'), None)
                if mx is not None: item['maxLen'] = mx
                ph = nrow.get('placeholder') or ''
                if ph: item['placeholder'] = ph
                # by convention, free response is unscored unless explicitly given points

            # Add to quiz
            quizzes[qid]["items"].append(item)

        # finalize and write files
        outdir = Path(args.out)
        outdir.mkdir(parents=True, exist_ok=True)
        wrote = 0
        for qid, q in quizzes.items():
            meta = quiz_meta.get(qid, {})
            # videoId is required
            if not meta.get('videoId'):
                print(f"[ERR] Quiz '{qid}' missing videoId; skipping.", file=sys.stderr)
                continue
            # merge meta into quiz
            q.update(meta)
            # sort items by t then id for stability
            q['items'] = sorted(q['items'], key=lambda it: (it.get('t', 0), str(it.get('id'))))
            js = json.dumps(q, ensure_ascii=False, indent=2)
            if args.dry_run:
                print(f"\n=== {qid}.json ===\n{js}\n")
            else:
                out_path = outdir / f"{qid}.json"
                out_path.write_text(js, encoding='utf-8')
                wrote += 1
        if not args.dry_run:
            print(f"Wrote {wrote} quiz file(s) to {outdir.resolve()}")
        else:
            print("Dry run complete.")

if __name__ == "__main__":
    main()
