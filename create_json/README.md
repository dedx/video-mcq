# Quizzes

This folder contains **quiz definitions** for the Video-MCQ project.

## 📂 File Types

* **`.csv`** – Source spreadsheets (editable by instructors).
* **`.json`** – Generated quiz files consumed by the frontend (`index.html`, `index-simple.html`).

Each `.csv` can produce one or more `.json` files, grouped by the `quiz_id` column.

---

## 🧩 Template

Use [`quiz_template.csv`](./quiz_template.csv) as a starting point.
It demonstrates all supported item types:

* Multiple choice (MCQ)
* Checkbox (check-all-that-apply)
* Fill in blank (FIB)
* Free response (FR)
* Poll
* Pause

---

## 🔄 Converting CSV → JSON

Run the converter from the project root (or backend folder):

```bash
python csv_to_quizzes.py quiz_template.csv --out quizzes/
```

* Produces `quizzes/<quiz_id>.json` for each distinct quiz.
* Use `--dry-run` to preview JSON without writing files.
* Use `--id-col` if your grouping column header differs (e.g. `video_tag`).

---

## ✅ Validation

After generating JSON, check consistency:

```bash
python validate_snapshot.py
```

This verifies:

* Quiz JSON schema
* Manifest alignment
* HTML IDs
* SQLite schema (for attempts)

---

## 📖 Best Practices

* Keep `quiz_id` URL/filename safe (e.g., `course1_week2`).
* Commit both `.csv` (editable source) and `.json` (runtime files).
* Use one CSV per course/module to stay organized.
* Test each quiz in **both** single-player (`index-simple.html`) and multi-player (`index.html`) modes.

### Top-level quiz fields (optional)
- **endAt** – cut-off time for the video (seconds or `hh:mm:ss`).  
  If present, the player treats this as the real end of the video.  
  - Watch % and gating are measured against this time, not the video’s full length.  
  - Useful when you only want students to view a segment of a longer video.
