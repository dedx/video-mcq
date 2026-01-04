# Contributing to video-mcq

Thanks for your interest in contributing! 🎉  
This project welcomes educators, developers, and students who want to improve interactive video quizzes.

---

## 📜 License & contributor agreement

- The **software in this repository** is licensed under **GNU GPL v3 (or later)**.
- By contributing code here, you agree that your contributions are released under **GPLv3-or-later**.
- **Quiz content** lives in a separate repository and has a different license:
  - 👉 https://github.com/dedx/video-mcq-quizzes (licensed **CC BY-NC 4.0**)

Please do not submit quiz content to this repository.

---

## 🛠 Development setup

```bash
git clone https://github.com/dedx/video-mcq.git
cd video-mcq/backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python3 app.py
```

Open the frontend in a browser:

- `index.html` – multi-quiz mode  
- `index-simple.html` – single-player mode  
- `dashboard.html` – instructor dashboard  

---

## 🧪 Testing & validation

Run the snapshot validator:

```bash
python validate_snapshot.py
```

This checks:

- quiz JSON structure
- HTML element IDs
- manifest alignment
- SQLite schema
- basic API expectations

If you add tests, `pytest` is recommended.

---

## 🎨 Code style

### Python
- Follow **PEP 8**
- Prefer clarity over cleverness
- Validate and sanitize all user input

### JavaScript
- ES6+
- Use `const` / `let`
- Avoid unused variables
- Do not rename existing DOM IDs

### CSS
- Keep selectors scoped
- Prefer CSS variables (`--accent`, `--bg`, etc.)

---

## 🚀 How to contribute

1. **Fork** the repository
2. Create a feature branch:
   ```bash
   git checkout -b feature/my-new-feature
   ```
3. Make your changes and commit with a clear message:
   ```bash
   git commit -m "Add XYZ support to dashboard"
   ```
4. Push your branch and open a **Pull Request**

Your PR should explain:
- what the change does
- why it’s useful
- how you tested it

Screenshots are encouraged for UI changes.

---

## 🧩 Quiz authoring (important)

Quiz authoring **does not happen in this repository**.

To contribute or modify quizzes, use:
👉 https://github.com/dedx/video-mcq-quizzes

That repository contains:

- `pp_quizzes.csv` (authoritative source)
- `quiz_template.csv`
- JSON quiz exports

Please do **not** submit quiz CSVs or large JSON quiz banks here.

---

## 🔐 Security & secrets

- **Never commit secrets**
- Do not commit `.env` or credentials
- Use `.env.example` as a template only

If you discover a security issue, please report it privately.

---

## 🙏 Code of conduct

Be respectful and collaborative.  
This project supports educators and learners from all backgrounds.

Focus on constructive feedback and improving tools for learning.
