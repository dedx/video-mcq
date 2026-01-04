/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
Video-MCQ Project
-------------------
An interactive video quiz system for generating and delivering MCQs from online video content.

Authors:
  - J.L. Klay (Cal Poly San Luis Obispo)
  - ChatGPT (OpenAI)

License:
  This file is part of the Video-MCQ Project.

  The Video-MCQ Project is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  The Video-MCQ Project is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this project. If not, see <https://www.gnu.org/licenses/>.

  dashboard.js — matches dashboard.html IDs exactly
   - Attempts panel (list, delete row, delete by viewer, delete all, CSV export)
   - Poll & Free-Response panel (list, aggregate, wide CSV)
   - Admin key stored in localStorage and sent on destructive calls
*/

(function () {
  'use strict';

  let PANELS_WIRED = false;
  let RESP_WIRED = false;
    
  // ========= dashboard admin keys =========
  const LS_DEL = 'dashboard_delete_key';
  const LS_KEY = 'dashboard_view_key';

  // ======================================================================
  // Key management
  // Manage delete/view keys in localStorage and UI.
  // ======================================================================
  /* Manage delete/view keys in localStorage and UI. */
    
  function loadDeleteKey() {
    try {
      return localStorage.getItem(LS_DEL) || '';
    } catch { return ''; }
  }

  function saveDeleteKey(val) {
    try { localStorage.setItem(LS_DEL, val || ''); } catch {}
  }

  function currentDeleteKey() {
    const input = document.getElementById('deleteKey');
    return (input?.value?.trim()) || loadDeleteKey() || '';
  }

  function loadViewKey() {
    try {
      return localStorage.getItem(LS_KEY) || '';
    } catch { return ''; }
  }

  function saveViewKey(val) {
    try { localStorage.setItem(LS_KEY, val || ''); } catch {}
  }

  function currentViewKey() {
    const input = document.getElementById('viewKey');
    return (input?.value?.trim()) || loadViewKey() || '';
  }

  function quietPasswordManagers() {
    const ids = ['viewKey', 'deleteKey'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      // enforce the attributes in case HTML missed them
      el.type = 'text';
        el.classList.add('text-secure');
        el.style.webkitTextSecurity = 'disc'; // inline fallback if CSS didn’t load yet
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('spellcheck', 'false');
      el.setAttribute('inputmode', 'text');
      el.setAttribute('data-1p-ignore', '');
      el.setAttribute('data-lpignore', 'true');
      el.setAttribute('data-bwignore', 'true');
      // readonly until user interacts
      if (!el.hasAttribute('readonly')) el.setAttribute('readonly', 'readonly');
      el.addEventListener('pointerdown', () => {
        el.removeAttribute('readonly');
        // focus after the click to avoid early PM hooks
        setTimeout(() => el.focus({ preventScroll: true }), 0);
      }, { once: true });
    });
  }
    
  // Hide an input+save button and show a "saved" pill with a Change button.
  // ids: the input id and save-button id to hide; blockId: container we create.
  function showSavedKeyUI(inputId, saveBtnId, blockId, labelText, onChange) {
    const input = document.getElementById(inputId);
    const btn   = document.getElementById(saveBtnId);
    if (!input || !btn) return;
    // hide the real input+button to avoid password managers
    input.style.display = 'none';
    btn.style.display   = 'none';

    let block = document.getElementById(blockId);
    if (!block) {
      const row = input.parentElement || document.body;
      block = document.createElement('span');
      block.id = blockId;
      block.style.display = 'inline-flex';
      block.style.gap = '8px';
      block.style.alignItems = 'center';
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = labelText;
      const edit = document.createElement('button');
      edit.className = 'secondary';
      edit.textContent = 'Change';
      edit.addEventListener('click', () => {
        // remove the pill+button and bring back the real input+save
        block.remove();
        input.style.display = '';
        btn.style.display   = '';
        // discourage PMs still: keep all ignore hints
        input.setAttribute('autocomplete', 'new-password');
        input.setAttribute('data-1p-ignore', '');
        input.setAttribute('data-lpignore', 'true');
        input.setAttribute('data-bwignore', 'true');
        input.setAttribute('data-form-type', 'other');
        onChange && onChange(input, btn);
        input.focus({ preventScroll: true });
      });
      block.appendChild(pill);
      block.appendChild(edit);
      row.appendChild(block);
    }
  }

  function hideSavedKeyUI(blockId) {
    const block = document.getElementById(blockId);
    if (block) block.remove();
  }

  // Validate a candidate view key by calling a read-protected endpoint.
  // Returns true if accepted, false if 401/forbidden.
  async function validateViewKeyOnce(val) {
    try {
      const r = await fetch('/api/quizzes', {
        method: 'GET',
        headers: { 'X-View-Key': val },
        credentials: 'include'
      });
      if (r.status === 401) return false;
      return r.ok;
    } catch {
      // On network errors, treat as invalid (don’t save)
      return false;
    }
  }

  // Wire the tiny key UI
  function initViewKeyUI() {
    const input = document.getElementById('viewKey');
    const btn = document.getElementById('saveViewKey') || document.getElementById('saveKey');
    const line = document.getElementById('keyStatus') || document.getElementById('viewKeyStatus');
    const existing = loadViewKey();
    if (existing && input) input.value = existing;
      // If a key already exists, hide the real input to avoid PM focus
      if (existing) {
	  showSavedKeyUI('viewKey', 'saveViewKey', 'viewKeySavedBlock', 'View key saved', () => {});
      }    

      btn?.addEventListener('click', async () => {
	  const inputEl = input; // keep your original variable
	  const statusEl = line; // keep your original variable
	  const raw = inputEl?.value ?? '';
	  const val = raw.trim();
	   // Case 1: user cleared the field -> clear key and UI (no "invalid")
      if (!val) {
        saveViewKey('');
        if (statusEl) { statusEl.textContent = 'Cleared.'; setTimeout(() => statusEl.textContent = '', 1200); }
        hideSavedKeyUI && hideSavedKeyUI('viewKeySavedBlock');
        if (inputEl) { inputEl.style.display = ''; inputEl.value = ''; }
        if (btn) btn.style.display = '';
        clearAttemptsUI && clearAttemptsUI();
        return;
      }

      // Case 2: non-empty — validate BEFORE saving
      if (statusEl) statusEl.textContent = 'Checking key…';
      btn.disabled = true;
      const ok = await validateViewKeyOnce(val);
      btn.disabled = false;

      if (!ok) {
        // Invalid: do NOT save, revert UI to cleared state
        saveViewKey('');
        if (statusEl) { statusEl.textContent = 'Invalid view key'; setTimeout(() => statusEl.textContent = '', 1500); }
        hideSavedKeyUI && hideSavedKeyUI('viewKeySavedBlock');
        if (inputEl) { inputEl.style.display = ''; inputEl.value = ''; }
        if (btn) btn.style.display = '';
        clearAttemptsUI && clearAttemptsUI();
        return;
      }

      // Valid: save and load
      saveViewKey(val);
      if (statusEl) { statusEl.textContent = 'Saved.'; setTimeout(() => statusEl.textContent = '', 1200); }

      // If panels aren’t wired yet, wire once; otherwise just reload attempts
      if (typeof PANELS_WIRED !== 'undefined' && !PANELS_WIRED) {
        await (wirePanelsOnce?.() || Promise.resolve());
      } else {
      try { await (loadAttempts?.() || Promise.resolve()); } catch {}
      }

      // Hide the input to keep password managers quiet (if you’re using this UI)
      showSavedKeyUI && showSavedKeyUI('viewKey', 'saveViewKey', 'viewKeySavedBlock', 'View key saved', () => {});
    });  
  }

  // Validate a candidate delete key by calling a DELETE endpoint that requires it.
  // We use an impossible id (0). Auth passes -> 404/400/204/200 (treat as valid).
  // Auth fails -> 401 (invalid).
  async function validateDeleteKeyOnce(val) {
    try {
      const r = await fetch('/api/attempt/0', {
        method: 'DELETE',
        headers: { 'X-Delete-Key': val, 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      if (r.status === 401) return false;  // bad key
      return true;                          // any non-401 means auth ok
    } catch {
      return false; // network error: don't save
    }
  }
  
  function initDeleteKeyUI() {
    const delInput = document.getElementById('deleteKey');
    const delBtn   = document.getElementById('saveDeleteKey');
    const line  = document.getElementById('deleteKeyStatus');
    const delSaved = loadDeleteKey(); if (delSaved && delInput) delInput.value = delSaved;
    // If a key already exists, hide the real input to avoid PM focus
    if (delSaved) {
       showSavedKeyUI('deleteKey', 'saveDeleteKey', 'deleteKeySavedBlock', 'Delete key saved', () => {
	  updateDeleteButtonsEnabled();
       });
    }
      
    delBtn?.addEventListener('click', async (e) => {
       e?.preventDefault?.();

    // Support either id in your markup
    const inputEl  = document.getElementById('deleteKey');
    const statusEl = document.getElementById('deleteKeyStatus')
                   || document.getElementById('delKeyStatus');

    const raw = inputEl?.value ?? '';
    const val = raw.trim();

    // Case 1: cleared by user → clear and disable deletes (no "invalid")
    if (!val) {
      saveDeleteKey('');
      if (statusEl) { statusEl.textContent = 'Delete key cleared.'; setTimeout(() => statusEl.textContent = '', 1200); }
      updateDeleteButtonsEnabled?.();
      // (optional) show the input in case it was in "saved pill" mode
      hideSavedKeyUI?.('deleteKeySavedBlock');
      if (inputEl) { inputEl.style.display = ''; inputEl.value = ''; }
      if (delBtn) delBtn.style.display = '';
      return;
    }

    // Case 2: non-empty — validate BEFORE saving
    if (statusEl) statusEl.textContent = 'Checking delete key…';
    delBtn.disabled = true;
    const ok = await validateDeleteKeyOnce(val);
    delBtn.disabled = false;

    if (!ok) {
      // Invalid: do NOT save; revert to cleared state and keep deletes disabled
      saveDeleteKey('');
      if (statusEl) { statusEl.textContent = 'Invalid delete key'; setTimeout(() => statusEl.textContent = '', 1500); }
      updateDeleteButtonsEnabled?.();
      hideSavedKeyUI?.('deleteKeySavedBlock');
      if (inputEl) { inputEl.style.display = ''; /* keep what user typed or clear: */ /* inputEl.value='' */ }
      if (delBtn) delBtn.style.display = '';
      return;
    }

    // Valid: save and enable delete actions
    saveDeleteKey(val);
    if (statusEl) { statusEl.textContent = 'Delete key saved.'; setTimeout(() => statusEl.textContent = '', 1200); }
    updateDeleteButtonsEnabled?.();

    // Optional: hide the input to avoid password managers (if you use the pill UI)
    const inputId = inputEl?.id || 'deleteKey';
    showSavedKeyUI?.(inputId, 'saveDeleteKey', 'deleteKeySavedBlock', 'Delete key saved', () => {
      updateDeleteButtonsEnabled?.();
    });
   });
  }

  // Enable/disable all delete buttons based on whether a delete key exists
  function updateDeleteButtonsEnabled() {
    const has = !!currentDeleteKey();
    document.querySelectorAll('button[data-action="delete"], button.del, .btn-delete, #deleteByViewer, #deleteAll').forEach(btn => {
    btn.disabled = !has;
    if (!has) btn.title = 'Enter Delete key to enable';
    else btn.removeAttribute('title');
   });
  }


  // ======================================================================                           
  // Confirmation & security                                                                          
  // Confirm destructive actions (custom dialog).                                                     
  // ======================================================================                           
  /* Confirm destructive actions (custom dialog). */
  
  // Minimal in-page confirm using <dialog>; falls back to native confirm().
  async function uiConfirm(message) {
    // fallback if <dialog>.showModal not supported
    if (typeof HTMLDialogElement === 'undefined' ||
        typeof document.createElement('dialog').showModal !== 'function') {
      return Promise.resolve(window.confirm(message));
    }
    let dlg = document.getElementById('cfmDlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'cfmDlg';
      dlg.innerHTML = `
        <form method="dialog">
          <p id="cfmMsg"></p>
          <menu>
            <button value="cancel" type="submit">Cancel</button>
            <button value="ok"     type="submit">OK</button>
          </menu>
        </form>`;
      document.body.appendChild(dlg);
    }
    dlg.querySelector('#cfmMsg').textContent = message || '';
    dlg.showModal();
    return new Promise(res => dlg.addEventListener('close', () => res(dlg.returnValue === 'ok'), { once:true }));
  }


  // ======================================================================                           
  // Headers & fetch wrappers                                                                         
  // HTTP headers and fetch wrappers with keys.                                                       
  // ======================================================================                           
  /* HTTP headers and fetch wrappers with keys. */
    
  // VIEW header (used for GET/list/export)
  function viewHeaders(base = {}) {
    const k = currentViewKey ? currentViewKey() : '';   
    return k ? { ...base, 'X-View-Key': k } : base;
  }

  // DELETE header (used for deletes)
  function deleteHeaders(base = {}) {
    const k = currentDeleteKey ? currentDeleteKey() : '';
    return k ? { ...base, 'X-Delete-Key': k } : base;
  }

  // create a safe filename and download a CSV while sending the view header
  function safeFilePart(s) {
    return (s || 'all').toString().trim().replace(/[^a-zA-Z0-9._@-]+/g, '_');
  }
  
  async function downloadCsvWithHeaders(url, fallbackName) {
    const r = await fetch(url, { headers: viewHeaders(), credentials: 'include' });
    if (r.status === 401) { alert('Invalid view key.'); return; }
    if (!r.ok)        { alert('Export failed: HTTP ' + r.status); return; }
    const blob = await r.blob();
    // ALWAYS prefer the caller-provided name when present
    let filename = fallbackName;
        if (!filename) {
	  // Only look at Content-Disposition if no fallback was given
          const cd = r.headers.get('Content-Disposition') || '';
          const m = /filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i.exec(cd);
          filename = m ? (() => { try { return decodeURIComponent(m[2]); } catch { return m[2]; } })()
             : 'export.csv';
        }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 250);
  }

  // ---- CSV helpers (define only if missing) ----
  if (typeof window.safeFilePart !== 'function') {
    window.safeFilePart = function safeFilePart(s) {
      return (s || 'all').toString().trim().replace(/[^a-zA-Z0-9._@-]+/g, '_');
    };
  }
    
  if (typeof window.downloadCsvWithHeaders !== 'function') {
    window.downloadCsvWithHeaders = async function downloadCsvWithHeaders(url, fallbackName) {
      const r = await fetch(url, { headers: viewHeaders(), credentials: 'include' });
      if (r.status === 401) { alert('Invalid view key.'); return; }
      if (!r.ok)          { alert('Export failed: HTTP ' + r.status); return; }
      const blob = await r.blob();
      let filename = fallbackName || 'export.csv';
      const cd = r.headers.get('Content-Disposition') || '';
      const m = /filename\*?=(?:UTF-8'')?("?)([^";]+)\1/i.exec(cd);
      if (m) { try { filename = decodeURIComponent(m[2]); } catch {} }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
    };
  } 

  // GET JSON (requires view key; shows 401 nicely)
  async function fetchJSON(url) {
    const r = await fetch(url, { headers: viewHeaders(), credentials: 'include' });
    if (r.status === 401) { setText('keyStatus', 'Invalid view key'); throw new Error('HTTP 401'); }
    if (!r.ok) { const e = new Error('HTTP '+r.status); e.status=r.status; throw e; }
    return r.json();
  }

  async function postJSON(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: viewHeaders({ 'Content-Type': 'application/json' }),
      credentials: 'include',
      body: JSON.stringify(body || {})
    });
    if (r.status === 401) { setText('keyStatus', 'Invalid view key'); const e=new Error('HTTP 401'); e.status=401; throw e; }
    if (!r.ok) { const e=new Error('HTTP '+r.status); e.status=r.status; throw e; }
    try { return await r.json(); } catch { return {}; }
  }

  // POST with delete key (for destructive POST endpoints)
  async function postDeleteJSON(url, body) {
    const dk = currentDeleteKey && currentDeleteKey();
    if (!dk) { alert('Enter Delete key first.'); throw new Error('NO_DELETE_KEY'); }
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...viewHeaders(),            // ok to include view key too
        ...deleteHeaders()           // <-- sends X-Delete-Key
      },
      credentials: 'include',
      body: JSON.stringify(body || {})
    });
    if (r.status === 401) { setText('deleteKeyStatus', 'Invalid delete key'); const e=new Error('HTTP 401'); e.status=401; throw e; }
    if (!r.ok) { const e=new Error('HTTP '+r.status); e.status=r.status; throw e; }
    try { return await r.json(); } catch { return {}; }
  }


  // DELETE (requires delete key; we also include view key just in case)
  async function del(url) {
    const dk = currentDeleteKey && currentDeleteKey();
    if (!dk) { alert('Enter Delete key first.'); throw new Error('NO_DELETE_KEY'); }
    const r = await fetch(url, {
      method: 'DELETE',
      headers: { ...viewHeaders(), ...deleteHeaders({ 'Content-Type': 'application/json' }) },
      credentials: 'include'
    });
    if (r.status === 401) { setText('deleteKeyStatus', 'Invalid delete key'); const e=new Error('HTTP 401'); e.status=401; throw e; }
    if (!r.ok) { const e=new Error('HTTP '+r.status); e.status=r.status; throw e; }
    try { return await r.json(); } catch { return {}; }
  }
    
  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt || '';
  }

  async function populateQuizSelect(selectEl, includeAll = false) {
    if (!currentViewKey()) return;
    if (!selectEl) return;
    selectEl.innerHTML = '';
    if (includeAll) {
      const all = document.createElement('option');
      all.value = '';                 // empty = no filtering
      all.textContent = '— All quizzes —';
      selectEl.appendChild(all);
    }
    try {
      const data = await fetchJSON('/api/quizzes');
      const list = (data && data.quizzes) || [];
      list.forEach(q => {
        const o = document.createElement('option');
	o.value = q.id;
	o.textContent = q.title ? `${q.title} (${q.id})` : q.id;
	selectEl.appendChild(o);
      });
    } catch (e) {
      console.error('populateQuizSelect', e);
    }
  }

    
  // ======================================================================                           
  // Attempts panel                                                                                   
  // UI and API logic for attempts list, delete, export.                                              
  // ======================================================================                           
  /* UI and API logic for attempts list, delete, export. */
   
  // Gate: wire panels only once, and only after a key exists
  async function wirePanelsOnce() {
    if (PANELS_WIRED) return;
    PANELS_WIRED = true;
    await initAttemptsPanel();   // existing
    initRespPanel();             // existing
  }

  function clearAttemptsUI() {
    // Attempts table
    const tb = document.querySelector('#attemptsTable tbody');
    if (tb) tb.innerHTML = '';
    setText('count', '0');
    setText('listStatus', 'Enter view key and click Save to load.');

    // (Optional) also clear responses/polls widgets if you use them
    const respTb = document.querySelector('#responsesTable tbody');
    if (respTb) respTb.innerHTML = '';
    const pollAgg = document.getElementById('pollAgg');
    if (pollAgg) pollAgg.innerHTML = '';
    setText('respStatus', '');
  }


  // =========================================================
  // Attempts panel (IDs match dashboard.html)
  // =========================================================
  async function initAttemptsPanel() {
    // Wire buttons
    document.getElementById('refresh')?.addEventListener('click', loadAttempts);
    document.getElementById('deleteByViewer')?.addEventListener('click', deleteByViewer);
    document.getElementById('deleteAll')?.addEventListener('click', deleteAllForQuiz);
      
    document.getElementById('exportRows')?.addEventListener('click', () => exportRows(false));
    document.getElementById('exportAnswers')?.addEventListener('click', () => exportRows(true));

    // if no key yet, show hint and bail (no network)
    if (!currentViewKey()) {
      setText('listStatus', 'Enter key and click Save to load.');
      PANELS_WIRED = true; // wired, but not loaded
      return;
    }

    const btnExportByViewer = document.getElementById('exportByViewer');
    if (btnExportByViewer) {
      btnExportByViewer.addEventListener('click', (e) => {
        e.preventDefault();  // in case the button lives inside a <form>
        try { exportByViewer(); } catch (err) { console.error('exportByViewer error', err); }
      });
    }
      
    // Add All-quizzes option to both selects
    await populateQuizSelect(document.getElementById('quizFilter'), true);
    await populateQuizSelect(document.getElementById('quizDeleteScope'), true);
      
    // Default to All for the main list
    const sel = document.getElementById('quizFilter');
    if (sel) sel.value = '';
      
    // Initial load + change handlers
    await loadAttempts();
    document.getElementById('viewerFilter')?.addEventListener('change', loadAttempts);
    document.getElementById('aggMode')?.addEventListener('change', loadAttempts);
    document.getElementById('applyAgg')?.addEventListener('change', loadAttempts);
    sel?.addEventListener('change', loadAttempts);

    PANELS_WIRED = true;
  }
  
  async function loadAttempts() {
    const quizSel = document.getElementById('quizFilter');
    const viewerIn = document.getElementById('viewerFilter');
    const aggSel = document.getElementById('aggMode');
    const applyAgg = document.getElementById('applyAgg');

    // Map UI aggregation to backend attempt param
    let attemptMode = 'all';
    if (applyAgg && applyAgg.checked && aggSel && aggSel.value) {
      const v = aggSel.value;
      attemptMode = (v === 'latest' || v === 'best') ? v : 'all'; // 'weighted' → 'all'
    }

    const qs = new URLSearchParams();
    if (quizSel && quizSel.value) qs.set('quiz_id', quizSel.value);
    if (viewerIn && viewerIn.value.trim()) qs.set('viewer', viewerIn.value.trim());
    qs.set('attempt', attemptMode); // all|latest|best
    qs.set('include_answers', '1');

    setText('listStatus', 'Loading…');
    try {
      const data = await fetchJSON(`/api/attempts?${qs.toString()}`);
      let  rows = Array.isArray(data) ? data : ((data && data.attempts) || []);
      // 🔽 Sort newest first by created_at
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
	
      renderAttemptsTable(rows);
      setText('count', String(rows.length));
      setText('listStatus', rows.length ? '' : 'No attempts found.');
    } catch (e) {
      console.error('/api/attempts failed', e);
      setText('listStatus',
        e.status === 404
          ? 'Attempts API not found. Is the backend running the right version?'
          : 'Failed to load attempts.'
      );
    }
      updateDeleteButtonsEnabled();
  }

  function renderAttemptsTable(rows) {
    const getWatchPct = (r) => {
    // 1) direct numeric column
    if (typeof r.watch_percent === 'number') return r.watch_percent;
    // 2) answers provided as an object
    if (r.answers && typeof r.answers === 'object') {
      const p = r.answers.__meta && r.answers.__meta.watchPercent;
      if (typeof p === 'number') return p;
    }
    // 3) answers provided as a JSON string
    try {
        if (r.answers_json) {
          const a = JSON.parse(r.answers_json);
          const p = a && a.__meta && a.__meta.watchPercent;
          if (typeof p === 'number') return p;
        }
      } catch {}
      return null;
    };
	
    const tb = document.querySelector('#attemptsTable tbody');
    if (!tb) return;
      tb.innerHTML = '';
      rows.forEach((r, i) => { r._seq = i + 1; });
      rows.forEach(r => {
        const tr = document.createElement('tr');

        // Column order per dashboard.html header:
        // ID | Quiz | Viewer | Score | Watch% | Created | Actions
        const tdId = document.createElement('td');
	// keep the real database id somewhere less prominent (title/tooltip or a hidden column)
	// idCell.textContent = r.id; // or move this to a tooltip if you prefer
	tdId.textContent = String(r._seq);
	
        const tdQuiz = document.createElement('td');
        tdQuiz.textContent = r.quiz_id || '';

        const tdViewer = document.createElement('td');
        tdViewer.textContent = r.viewer || '';

        const pts = (r.points ?? 0);
        const max = (r.max_points ?? 0);
        const pct = (r.score_percent != null ? Number(r.score_percent) : 0);
        const tdScore = document.createElement('td');
        tdScore.textContent = `${pts}/${max} (${pct}%)`;

        const tdWatch = document.createElement('td');
        const wPct = getWatchPct(r);
        tdWatch.textContent = (wPct == null) ? '' : `${Number(wPct).toFixed(2)}%`;
	
        const tdWhen = document.createElement('td');
        tdWhen.textContent = r.created_at || '';

        const tdAct = document.createElement('td');
        const btnDel = document.createElement('button');
        btnDel.textContent = 'Delete';
	// add a stable class + data attribute so updateDeleteButtonsEnabled() can find it
	btnDel.className = 'danger btn-delete';
	btnDel.setAttribute('data-action', 'delete');
	
        btnDel.addEventListener('click', async () => {
	  const ok = await uiConfirm(`Delete attempt #${r.id} by ${r.viewer}?`);
          if (!ok) return;
          try {
            await del(`/api/attempt/${encodeURIComponent(r.id)}`);
            await loadAttempts();
          } catch (e) {
            alert('Delete failed: ' + e.message);
          }
        });
        if (!currentDeleteKey || !currentDeleteKey()) {
          btnDel.disabled = true;
          btnDel.title = 'Enter Delete key to enable';
        }
        tdAct.appendChild(btnDel);

        [tdId, tdQuiz, tdViewer, tdScore, tdWatch, tdWhen, tdAct].forEach(td => {
          td.style.borderTop = '1px solid #33406a';
          td.style.padding = '6px 8px';
        });

        tr.appendChild(tdId);
        tr.appendChild(tdQuiz);
        tr.appendChild(tdViewer);
        tr.appendChild(tdScore);
        tr.appendChild(tdWatch);	
        tr.appendChild(tdWhen);
        tr.appendChild(tdAct);
        tb.appendChild(tr);
     });
  }

  async function deleteByViewer() {
    const quizSel = document.getElementById('quizDeleteScope'); // from the "Delete by viewer" card
    const viewerIn = document.getElementById('viewerDelete');
    const quiz_id = quizSel?.value || '';
    const viewer = viewerIn?.value.trim() || '';
    if (!viewer) { alert('Enter a viewer.'); return; }
    const scope = quiz_id ? `quiz "${quiz_id}"` : 'ALL quizzes';
    const ok = await uiConfirm(`Delete ALL attempts for viewer "${viewer}" in ${scope}?`);
      
    if (!ok) return;
    try {
      if (quiz_id) {
        await postDeleteJSON('/api/attempts/delete_by_viewer', { quiz_id, viewer });
      } else {
        // no quiz selected: delete across all quizzes by iterating
        const data = await fetchJSON('/api/quizzes');
        const list = (data && data.quizzes) || [];
        for (const q of list) {
          await postDeleteJSON('/api/attempts/delete_by_viewer', { quiz_id: q.id, viewer });
        }
      }
      await loadAttempts();
    } catch (e) { alert('Delete-by-viewer failed: ' + e.message); }
  }

  async function deleteAllForQuiz() {
    const quizSel = document.getElementById('quizDeleteScope') || document.getElementById('quizFilter');
    const quiz_id = quizSel?.value || '';
    if (!quiz_id) { alert('Select a quiz to delete its attempts.'); return; }
       const ok = await uiConfirm(`Delete ALL attempts for quiz "${quiz_id}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await postDeleteJSON('/api/attempts/delete_all', { quiz_id });
      await loadAttempts();
    } catch (e) { alert('Delete-all failed: ' + e.message); }
  }


  // ======================================================================                           
  // CSV helpers                                                                                      
  // Utilities to download CSV exports safely.                                                        
  // ======================================================================                           
  /* Utilities to download CSV exports safely. */
  
  function exportRows(includeAnswers = false) {
    const quizSel = document.getElementById('quizFilter');
    const aggSel = document.getElementById('aggMode');
    const applyAgg = document.getElementById('applyAgg');
    let attemptMode = 'all';
    if (applyAgg && applyAgg.checked && aggSel && aggSel.value) {
      const v = aggSel.value;
      attemptMode = (v === 'latest' || v === 'best') ? v : 'all';
    }
    const qs = new URLSearchParams();
    if (quizSel && quizSel.value) qs.set('quiz_id', quizSel.value);
    qs.set('attempt', attemptMode);
    qs.set('group_by', 'none');
      if (includeAnswers) qs.set('include_answers', '1');
      const k = currentViewKey();
      if (!k) { alert('Enter view key first.'); return; }
      const url = `/api/export/attempts?${qs.toString()}`;
      const name = `attempts_${attemptMode || 'all'}.csv`;
      downloadCsvWithHeaders(url, name);
  }

  function exportByViewer() {
    const quizSel  = document.getElementById('quizFilter');
    const viewerSel = document.getElementById('viewerFilter');
    const aggSel   = document.getElementById('aggMode');
    const applyAgg = document.getElementById('applyAgg');

    // Match your existing attempt aggregation mapping
    let attemptMode = 'all';
    if (applyAgg && applyAgg.checked && aggSel && aggSel.value) {
      const v = aggSel.value;
      attemptMode = (v === 'latest' || v === 'best') ? v : 'all';
    }

    const qs = new URLSearchParams();
        if (quizSel && quizSel.value) qs.set('quiz_id', quizSel.value);
        if (viewerSel && viewerSel.value && viewerSel.value.trim()) qs.set('viewer', viewerSel.value.trim());
    qs.set('attempt', attemptMode);
    qs.set('group_by', 'viewer');   // <-- key difference

    const k = currentViewKey();
    if (!k) { alert('Enter view key first.'); return; }

    const url = `/api/export/attempts?${qs.toString()}`;
    // filename with selected viewer (or 'all' when blank)
    const viewerPart = safeFilePart(viewerSel && viewerSel.value && viewerSel.value.trim());
    const fname = `attempts_by_viewer_${viewerPart}.csv`;
    downloadCsvWithHeaders(url, fname);
  }

  function exportPollFrCSV() {
    const quiz = document.getElementById('respQuiz')?.value || '';
      if (!quiz) { alert('Pick a quiz.'); return; }
      const attempt = document.getElementById('respAttempt')?.value || 'all';
    const nameMode = document.getElementById('exportNameMode')?.value || 'id';
      const qs = new URLSearchParams({ quiz_id: quiz, attempt: attempt, name_mode: nameMode, exclude_identity: '1' });
      const k = currentViewKey();
      if (!k) { alert('Enter view key first.'); return; }
      const url = `/api/export/poll_fr?${qs.toString()}`;
      downloadCsvWithHeaders(url, `poll_fr_${quiz || 'all'}.csv`);
  }


  // ======================================================================                           
  // Poll/Free-response panel                                                                         
  // UI and API logic for polls and free-response.                                                    
  // ======================================================================                           
  /* UI and API logic for polls and free-response. */
  async function loadRespQuizzes() {
    const sel = document.getElementById('respQuiz');
    if (!sel) return;
    await populateQuizSelect(sel);
  }

  async function renderPollAgg(quizId) {
    const el = document.getElementById('pollAgg');
    if (!el || !quizId) return;
    el.innerHTML = '';
    try {
      const agg = await fetchJSON(`/api/polls/aggregate?quiz_id=${encodeURIComponent(quizId)}&attempt=latest`);
      const polls = agg.polls || {};
      if (!Object.keys(polls).length) { el.textContent = 'No polls in this quiz.'; return; }

      const wrap = document.createElement('div');
      wrap.innerHTML = '<h3>Poll summary (latest per student)</h3>';
      for (const pid of Object.keys(polls)) {
        const p = polls[pid];
        const div = document.createElement('div');
        div.style.margin = '6px 0 10px';
        const title = document.createElement('div'); title.style.fontWeight = '600'; title.textContent = `• ${p.prompt}`;
        const ul = document.createElement('ul'); ul.style.margin = '6px 0';
        Object.entries(p.choices).forEach(([cid, info]) => {
          const li = document.createElement('li'); li.textContent = `${info.text}: ${info.count}`;
          ul.appendChild(li);
        });
        div.appendChild(title); div.appendChild(ul); wrap.appendChild(div);
      }
      el.appendChild(wrap);
    } catch (e) {
      console.warn('polls/aggregate not available?', e);
      el.textContent = (e.status === 404) ? 'Poll summary API not installed on backend.' : 'Unable to load poll summary.';
    }
  }

  async function loadResponses() {
    const quiz = document.getElementById('respQuiz')?.value || '';
    const typ = document.getElementById('respType')?.value || 'all';
    const mode = document.getElementById('respAttempt')?.value || 'all';

    const tb = document.querySelector('#respTable tbody');
    if (tb) tb.innerHTML = '';

    const qs = new URLSearchParams();
    if (quiz) qs.set('quiz_id', quiz);
    if (typ) qs.set('type', typ);
    if (mode) qs.set('attempt', mode);

    try {
      const data = await fetchJSON(`/api/responses?${qs.toString()}`);
	let rows = (data && data.responses) || [];
	// Hide the end-of-video identity prompt from FR listings
	const ID_KEY = 'identity';
	rows = rows.filter(r => !(
	    String(r.item_type || '').toLowerCase() === 'fr' &&
	    String(r.item_id   || '').toLowerCase() === ID_KEY
	));
      if (tb) {
        rows.forEach(r => {
          const tr = document.createElement('tr');
          const tdWhen = document.createElement('td'); tdWhen.textContent = r.created_at || '';
          const tdViewer = document.createElement('td'); tdViewer.textContent = r.viewer || '';
          const tdQuiz = document.createElement('td'); tdQuiz.textContent = r.quiz_id || '';
          const tdItem = document.createElement('td'); tdItem.textContent = r.item_id || '';
          const tdType = document.createElement('td'); tdType.textContent = r.item_type || '';
          const tdVal = document.createElement('td'); tdVal.textContent = (r.item_type === 'poll') ? (r.selected || []).join(' | ') : (r.text || '');
          [tdWhen, tdViewer, tdQuiz, tdItem, tdType, tdVal].forEach(td => {
            td.style.borderTop = '1px solid #33406a'; td.style.padding = '6px 8px';
          });
          tr.appendChild(tdWhen); tr.appendChild(tdViewer); tr.appendChild(tdQuiz);
          tr.appendChild(tdItem); tr.appendChild(tdType); tr.appendChild(tdVal);
          tb.appendChild(tr);
        });
      }
      const respType = document.getElementById('respType')?.value || 'all';
      if (respType === 'all' || respType === 'poll') { await renderPollAgg(quiz); }
      else { const el = document.getElementById('pollAgg'); if (el) el.innerHTML = ''; }
    } catch (e) {
      console.warn('/api/responses not available?', e);
      if (tb) {
        const tr = document.createElement('tr');
        const td = document.createElement('td'); td.colSpan = 6;
        td.textContent = (e.status === 404) ? 'Responses API not installed on backend.' : 'Failed to load responses.';
        tr.appendChild(td); tb.appendChild(tr);
      }
      const el = document.getElementById('pollAgg'); if (el) el.innerHTML = '';
    }
  }

  function initRespPanel() {
    //wire buttons (idempotent)
    document.getElementById('btnLoadResp')?.addEventListener('click', loadResponses);
    document.getElementById('btnExportPollFr')?.addEventListener('click', exportPollFrCSV);

    if (!currentViewKey()) { RESP_WIRED = true; return; }

    loadRespQuizzes().then(() => {
      const sel = document.getElementById('respQuiz');
      const first = sel?.options?.[0]?.value;
      if (first && sel) { sel.value = first; loadResponses(); }
    });

    RESP_WIRED = true;
  }



    
  // ========= boot =========
  document.addEventListener('DOMContentLoaded', async () => {
    quietPasswordManagers();
    initViewKeyUI();
    initDeleteKeyUI();
    updateDeleteButtonsEnabled();
    if (!currentViewKey || !currentViewKey()) {
      setText('listStatus', 'Enter view key and click Save to load.');
      return; // ⬅ stop: do not fetch attempts/responses yet
    }

    // wire and load panels only after a key exists
    await initAttemptsPanel();
    initRespPanel();
  });

})();
