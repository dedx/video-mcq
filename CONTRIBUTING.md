# Contributing to Video-MCQ

Thanks for your interest in contributing! 🎉
This project is open to educators, developers, and students who want to make interactive video quizzes better.

---

## 📜 License & Contributor Agreement

* The project is licensed under **GNU GPL v3 (or later)**.
* By contributing, you agree that your code will also be released under GPLv3-or-later.
* This ensures all derivatives stay open and accessible to educators.

---

## 🛠 Development Setup

1. Clone the repo and create a virtual environment:

   ```bash
   git clone https://github.com/yourname/video-mcq.git
   cd video-mcq/backend
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
2. Start the backend:

   ```bash
   flask run --app app.py
   ```
3. Open the frontend in a browser:

   * `index.html` for multi-quiz mode
   * `index-simple.html` for single-player mode
   * `dashboard.html` for instructor dashboard

---

## 🧪 Testing

* Run the validator:

  ```bash
  python validate_snapshot.py
  ```

  This checks quiz JSONs, HTML IDs, manifest, and SQLite schema.
* Add tests to `tests/` (pytest is recommended).
* Test frontend changes in **both single-player and multi-player modes**.

---

## 🎨 Code Style

* Python: follow **PEP 8**; use `ruff` or `flake8` for linting.
* JavaScript: prefer ES6+, consistent `const`/`let`, no unused vars.
* CSS: use variables (`--accent`, `--bg`) and keep selectors scoped (`.choices`, `.card`, etc.).

---

## 🚀 How to Contribute

1. **Fork** the repository and create your branch:

   ```bash
   git checkout -b feature/my-new-feature
   ```
2. Make your changes, commit with a clear message:

   ```bash
   git commit -m "Add support for XYZ in dashboard"
   ```
3. Push to your fork:

   ```bash
   git push origin feature/my-new-feature
   ```
4. Open a **Pull Request** with:

   * What the change does
   * Why it’s useful
   * How you tested it

---

## 🙏 Code of Conduct

Please be respectful and collaborative. Educators, developers, and learners from all backgrounds are welcome.
Keep the community constructive and focused on building tools for learning.

oice_c`, … (text)
  * `feedback_a`, `feedback_b`, … (optional)
  * **Optional flags** (bool-ish: `true/false`, `1/0`, `y/n`):

  * `required`, `gated`, `shuffle`, `show_solution`, etc. (only if supported)
  * **Free-response sizing** (optional):

  * `max_len` (int), `placeholder` (string)

> Headers are case/space insensitive; the converter normalizes (e.g., `Video ID` → `videoid`).

### 2) Item type rules (quick reference)

* **`mcq`**: single correct choice → set `answer` to the **choice letter**, e.g., `a`.
* **`checkbox`**: multiple correct choices → `answer` as comma list, e.g., `a,c,d`.
* **`poll`**: no right/wrong; omit `answer`.
* **`fib`** (fill-in-blank): `answer` is the expected text; can be case-insensitive.
* **`fr`** (free-response): no `answer`; use `max_len`/`placeholder` optionally.
* **`pause`**: just pauses/announces at `time`; no `answer`.

### 3) Example CSV (minimal)

```csv
quiz_id,title,videoId,type,time,prompt,choice_a,choice_b,choice_c,answer,feedback_a,feedback_b,feedback_c,required
sample,Sample Quiz,dQw4w9WgXcQ,mcq,00:01:23,What color is the sky?,Blue,Green,Red,a,Correct!,Nope,Nope,true
sample,,dQw4w9WgXcQ,checkbox,90,Select fruits:,Apple,Car,Orange,"a,c",Yum,Nope,Yum,false
sample,,dQw4w9WgXcQ,fib,120,Type the chemical symbol for water:,,,,H2O,,,,true
```

### 4) Convert CSV → quizzes JSON

From the repo root (or wherever the script lives):

```bash
python csv_to_quizzes.py path/to/your.csv --out quizzes/
```

* Produces `quizzes/<quiz_id>.json` for each distinct `quiz_id`.
* Use `--id-col` if your ID column has a custom header.
* Use `--dry-run` to preview without writing.

### 5) Validate the snapshot

After generating JSON:

```bash
python validate_snapshot.py
```

* Checks: JSON shape, HTML IDs, manifest alignment, SQLite schema, and (optionally) API.

### 6) Naming & versioning

* Keep `quiz_id` **URL/filename-safe** (e.g., `course1_week2`).
* Commit both the **CSV source** and the generated **JSON** so others can regenerate.
* One CSV per course/unit is a good pattern; avoid massive monoliths.

### 7) Common pitfalls

* **Missing `videoId`**: rows won’t attach to a video—ensure it’s present (column name can be `videoId` or `video_id`).
* **Choice letters**: for `mcq/checkbox`, `answer` must reference existing letters (`a`, `b`, …).
* **Times**: `hh:mm:ss` or seconds only; avoid mixed formats in the same column.
* **Whitespace**: leading/trailing spaces in answers will be trimmed but try to keep cells clean.

### 8) Review checklist

* Open `index.html` or `index-simple.html`, set `window.QUIZ_ID`, and try:

  * One MCQ (wrong and right), one checkbox, and one FR/FIB item.
    * Confirm color coding and chip marks (✓/✗) appear as expected.
      * Dashboard export shows your items and attempts.


## 🧩 Quiz Authoring (with `csv_to_quizzes.py`)

Author quizzes in a spreadsheet, export as **CSV**, then convert to JSON for the app.

### 1) CSV schema (headers)

Minimum metadata (per row is a quiz item; repeated quiz\_id groups items into one quiz):

* **`quiz_id`** (string) – groups items; becomes the JSON filename.
* **`title`** (string) – optional; set once per `quiz_id`.
* **`category`** (string) – optional; set once per `quiz_id`.
* **`videoId`** or **`video_id`** (string) – online video id.
* **`type`** (enum) – `mcq` | `checkbox` | `fib` | `fr` | `pause` | `poll`.
* **`prompt`** (string) – the question or instruction.
* **`time`** (hh\:mm\:ss or seconds) – when to trigger overlay (for video-based items).
* **`answer`** (string or list) – correct answer(s), format depends on type (see below).
* **Choices** (for `mcq`, `checkbox`, `poll`):

  * `choice_a`, `choice_b`, `choice_c`, … (text)
  * `feedback_a`, `feedback_b`, … (optional)
* **Optional flags** (bool-ish: `true/false`, `1/0`, `y/n`):

  * `required`, `gated`, `shuffle`, `show_solution`, etc. (only if supported)
* **Free-response sizing** (optional):

  * `max_len` (int), `placeholder` (string)
* **`endAt`**: cut-off time for the video (seconds or `hh:mm:ss`).
If present, the player treats this as the real end of the video.  
  - Watch % and gating are measured against this time, not the video’s full length.  
  - Useful when you only want students to view a segment of a longer video.
> Headers are case/space insensitive; the converter normalizes (e.g., `Video ID` → `videoid`).

### 2) Item type rules (quick reference)

* **`mcq`**: single correct choice → set `answer` to the **choice letter**, e.g., `a`.
* **`checkbox`**: multiple correct choices → `answer` as comma list, e.g., `a,c,d`.
* **`poll`**: no right/wrong; omit `answer`.
* **`fib`** (fill-in-blank): `answer` is the expected text; can be case-insensitive.
* **`fr`** (free-response): no `answer`; use `max_len`/`placeholder` optionally.
* **`pause`**: just pauses/announces at `time`; no `answer`.

### 3) Example CSV (minimal)

```csv
quiz_id,title,videoId,type,time,prompt,choice_a,choice_b,choice_c,answer,feedback_a,feedback_b,feedback_c,required
sample,Sample Quiz,dQw4w9WgXcQ,mcq,00:01:23,What color is the sky?,Blue,Green,Red,a,Correct!,Nope,Nope,true
sample,,dQw4w9WgXcQ,checkbox,90,Select fruits:,Apple,Car,Orange,"a,c",Yum,Nope,Yum,false
sample,,dQw4w9WgXcQ,fib,120,Type the chemical symbol for water:,,,,H2O,,,,true
```

### 4) Convert CSV → quizzes JSON

From the repo root (or wherever the script lives):

```bash
python csv_to_quizzes.py path/to/your.csv --out quizzes/
```

* Produces `quizzes/<quiz_id>.json` for each distinct `quiz_id`.
* Use `--id-col` if your ID column has a custom header.
* Use `--dry-run` to preview without writing.

### 5) Validate the snapshot

After generating JSON:

```bash
python validate_snapshot.py
```

* Checks: JSON shape, HTML IDs, manifest alignment, SQLite schema, and (optionally) API.

### 6) Naming & versioning

* Keep `quiz_id` **URL/filename-safe** (e.g., `course1_week2`).
* Commit both the **CSV source** and the generated **JSON** so others can regenerate.
* One CSV per course/unit is a good pattern; avoid massive monoliths.

### 7) Common pitfalls

* **Missing `videoId`**: rows won’t attach to a video—ensure it’s present (column name can be `videoId` or `video_id`).
* **Choice letters**: for `mcq/checkbox`, `answer` must reference existing letters (`a`, `b`, …).
* **Times**: `hh:mm:ss` or seconds only; avoid mixed formats in the same column.
* **Whitespace**: leading/trailing spaces in answers will be trimmed but try to keep cells clean.

### 8) Review checklist

* Open `index.html` or `index-simple.html`, set `window.QUIZ_ID`, and try:

  * One MCQ (wrong and right), one checkbox, and one FR/FIB item.
  * Confirm color coding and chip marks (✓/✗) appear as expected.
  * Dashboard export shows your items and attempts.

Where endAt is used

In csv_to_quizzes.py, endAt is parsed via parse_time_safe and added to quiz metadata if present.

In player.js and mcq-multi.js, the function effectiveEnd(dur) compares the actual video duration to quiz.endAt. If endAt is set, it trims playback so the player treats that as the “true end.”

player

mcq-multi

That means:

Watch coverage, gating, and progress are all measured relative to endAt rather than the full video length.

If the video is long but you only want a shorter segment for the quiz, you can specify endAt.

The “watched to end” condition triggers once the learner reaches endAt coverage (≥97% or within 1s).