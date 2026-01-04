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

  player.js — identity submit is the final submit when requireIdentity=true.
   All previous features preserved: gating, per-choice feedback, watch coverage,
   one-time seek warning/bounce, idempotent submit protection.

   Elements required in index.html:
     #player, #overlay, #prompt, #choices, #submit, #continue, #feedback
     footer: #progress, #finish, #status
*/

(function () {
  'use strict';

  // ======================================================================                           
  // Video loader & utilities                                                                       
  // Loader for YouTube IFrame API and small helpers.                                                 
  // ======================================================================                           
  /* Loader for YouTube IFrame API and small helpers. */
    
  // ---------- YouTube loader ----------
  function loadYouTubeAPIThen(fn) {
    if (window.YT && YT.Player) { fn(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = function () {
      try { prev && prev(); } catch (e) { console.error(e); }
      try { fn(); } catch (e) { console.error(e); }
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      document.head.appendChild(s);
    }
  }

  // ---------- utils ----------
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fmt = (n) => (Math.round(n * 100) / 100).toFixed((n % 1) ? 2 : 0);
    
  // ---------- state ----------
  let quiz = null, player = null, tickTimer = null;

  const ID_KEY = '__viewer'; // reserved key for the identity overlay

  let overlayOpen = false;
  let currentItem = null;
  let watchedToEnd = false;

  let answered = new Map();
  let reviewedThisPass = new Set();
  let lastNow = 0;

  // optional review flow (off unless quiz.reviewOnRewatch === true)
  let reviewMode = false;
  let peakTime = 0;
  let reviewExitTime = 0;

  // watch coverage (non-skipped segments)
  let watching = false, segStart = 0;
  const segments = [];
  let warnedSeekOnce = false;

  // submit idempotency
  let submitting = false;
  let submittedOnce = false;
  let ATTEMPT_NONCE = (Math.random().toString(36).slice(2) + '-' + Date.now());

  const SCORABLE = new Set(['mcq', 'checkbox', 'fib']);

  // per-choice feedback helpers
  let revealChoiceFeedback = false;


  // ======================================================================                           
  // Coverage helpers                                                                                 
  // Track watch coverage segments and compute stats.                                                 
  // ======================================================================                           
  /* Track watch coverage segments and compute stats. */
    
  function effectiveEnd(dur) {
    const end = Number(quiz?.endAt);
    if (Number.isFinite(end) && end > 0 && dur > 0) return Math.min(end, dur);
    return dur || 0;
  }

  // ---------- coverage helpers ----------
  function addSegment(a, b) {
    if (!(b > a)) return;
    const tol = 0.25;
    segments.push([a, b]);
    segments.sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const s of segments) {
      if (!merged.length) { merged.push(s); continue; }
      const last = merged[merged.length - 1];
      if (s[0] <= last[1] + tol) last[1] = Math.max(last[1], s[1]);
      else merged.push(s);
    }
    segments.length = 0; merged.forEach(s => segments.push(s));
  }

  function startWatch(at) { if (!watching) { watching = true; segStart = at; } }

  function stopWatch(at)  { if (watching)  { addSegment(segStart, at); watching = false; } }
    
  function watchedSeconds(now, dur) {
    let total = 0; for (const [a, b] of segments) total += Math.max(0, b - a);
    if (watching) total += Math.max(0, now - segStart);
    if (dur) total = Math.min(total, dur);
    return total;
  }
    
  function watchedPercent(now, dur) {
    const denom = effectiveEnd(dur);
    if (!denom || denom <= 0) return 0;

    const sec = watchedSeconds(now, denom);
    const pct = (sec / denom) * 100;

    // Round up when "close enough"
    if ((denom - sec) <= 1.0 || pct >= 97) {
      return 100;
    }
    return Math.max(0, Math.min(100, pct));
  }


  // ======================================================================                                
  // Choice & overlay UI builders                                                                          
  // Helpers to build overlay choices and UI elements.                                                     
  // ======================================================================                                
  /* Helpers to build overlay choices and UI elements. */
  
  function arraysEq(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return [...a].sort().join('|') === [...b].sort().join('|');
  }
    
  function markReviewed(item) { if (item && item.id) reviewedThisPass.add(item.id); }

  // Ensure #choices is a div (not a form) for layout/click stacking
  function ensureChoicesIsDiv(){
    const root = $('choices'); if (!root) return;
    if (root.tagName && root.tagName.toUpperCase() === 'FORM') {
      const div = document.createElement('div');
      div.id = 'choices'; div.className = root.className || 'choices';
      while (root.firstChild) div.appendChild(root.firstChild);
      root.replaceWith(div);
    }
  }

  // Build one choice row with a chip + optional per-choice feedback line
  function addChoiceRow({labelText,inputType,name,value,isCorrect,container}){
    const wrap = document.createElement('label');
    wrap.className = 'choice';
    wrap.style.display='flex'; wrap.style.alignItems='center'; wrap.style.gap='10px';
    wrap.style.margin='8px 0'; wrap.style.padding='10px';
    wrap.style.border='1px solid #33406a'; wrap.style.borderRadius='10px';

    const inp = document.createElement('input');
    inp.type = inputType; inp.name = name; inp.value = String(value);

    const text = document.createElement('span'); text.textContent = String(labelText);

    const chip = document.createElement('span');
    chip.style.marginLeft='auto'; chip.style.opacity='.9'; chip.style.fontWeight='600';
    chip.textContent='';

    const fb = document.createElement('div'); // per-choice feedback
    fb.style.fontSize='.9rem'; fb.style.opacity='.95'; fb.style.marginTop='6px';

    wrap.appendChild(inp); wrap.appendChild(text); wrap.appendChild(chip);
    container.appendChild(wrap);
    container.appendChild(fb);

    function updateChip(selectedId, isCheckbox, feedbackMap){
      if (!revealChoiceFeedback) { chip.textContent = ''; fb.textContent = ''; return; }
      const selected = (inp.checked === true);
      const idStr = String(value);
      const chosen = (selectedId != null && String(selectedId) === idStr);

      if (isCheckbox) {
        if (isCorrect && selected) chip.textContent = '✓';
        else if (isCorrect && !selected) chip.textContent = '✓';      // styled amber by CSS
        else if (!isCorrect && selected) chip.textContent = '✗';
        else chip.textContent = '';
        const msg = feedbackMap && typeof feedbackMap[idStr] === 'string' ? feedbackMap[idStr] : '';
        if ((selected && msg) || (!selected && isCorrect && msg)) fb.textContent = msg; else fb.textContent = '';
      } else {
        if (isCorrect) chip.textContent = '✓';
        if (!isCorrect && chosen) chip.textContent = '✗';
        const msg = (chosen && feedbackMap && typeof feedbackMap[idStr] === 'string') ? feedbackMap[idStr] : '';
        fb.textContent = msg || '';
      }
    }

    return { inp, isCorrect, labelEl:text, chipEl:chip, fbEl:fb, updateChip };
  }


  // ======================================================================                                
  // Overlay handling                                                                                      
  // Show, hide, and manage overlays for questions and thanks.                                             
  // ======================================================================                                
  /* Show, hide, and manage overlays for questions and thanks. */
    
  // ---------- overlay builders ----------
  let currentNodes = null;
  let currentFeedbackMap = null;

  function normalizeAnswer(item, dom) {
    const t = (item.type || '').toLowerCase();
    if (t === 'mcq') {
      const sel = dom.querySelector('input[type=radio]:checked');
      return { kind: 'mcq', selected: sel ? [sel.value] : [] };
    }
    if (t === 'checkbox') {
      const selected = Array.from(dom.querySelectorAll('input[type=checkbox]:checked')).map(i => i.value);
      return { kind: 'checkbox', selected };
    }
    if (t === 'fib') {
      const inp = dom.querySelector('input[type=text]');
      return { kind: 'fib', text: (inp?.value || '').trim() };
    }
    if (t === 'poll') {
      const sel = dom.querySelector('input[type=radio]:checked');
      return { kind: 'poll', selected: sel ? [sel.value] : [] };
    }
    if (t === 'fr' || t === 'free' || t === 'free_response') {
      const inp = dom.querySelector('textarea, input[type=text]');
      return { kind: 'fr', text: (inp?.value || '').trim(), maxLen: (item.maxLen || undefined) };
    }
    if (t === 'pause') return { kind: 'pause' };
    return { kind: t || 'unknown' };
  }

  function fillAndLockReview(item) {
    const t = (item.type || '').toLowerCase();
    const ans = answered.get(item.id);
    if (!ans) return;
    const box = $('choices');

    if (t === 'mcq' || t === 'poll') {
      const sel = (ans.selected || [])[0];
      box.querySelectorAll('input[type=radio]').forEach(r => { r.disabled = true; if (r.value === sel) r.checked = true; });
      $('submit').classList.add('hidden'); $('continue').classList.remove('hidden');
    } else if (t === 'checkbox') {
      const set = new Set(ans.selected || []);
      box.querySelectorAll('input[type=checkbox]').forEach(c => { c.disabled = true; c.checked = set.has(c.value); });
      $('submit').classList.add('hidden'); $('continue').classList.remove('hidden');
    } else if (t === 'fib' || t === 'fr' || t === 'free' || t === 'free_response') {
	const inp = box.querySelector('textarea, input[type=text]'); if (inp) { inp.value = (ans.text || ''); inp.readOnly = true; }
      $('submit').classList.add('hidden'); $('continue').classList.remove('hidden');
    } else if (t === 'pause') {
      $('submit').classList.add('hidden'); $('continue').classList.remove('hidden');
    }
  }

  function showOverlay(item, { review = false } = {}) {
    currentItem = item;
    overlayOpen = true;

    // reset buttons on every overlay open
    const submitBtn = document.getElementById('submit');
    const contBtn = document.getElementById('continue');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('hidden'); }
    if (contBtn) contBtn.classList.add('hidden');

    $('prompt').textContent = item.prompt || '';
    $('feedback').textContent = '';
    ensureChoicesIsDiv();
    const box = $('choices'); box.innerHTML = '';

    currentNodes = null; currentFeedbackMap = null; revealChoiceFeedback = false;

    const t = (item.type || '').toLowerCase();
    if (t === 'mcq') {
      const corr = new Set((item.correct || []).map(String));
      currentFeedbackMap = item.feedback || {};
      const name = `mcq_${item.id}`, nodes = [];
      (item.choices || []).forEach(opt => {
        nodes.push(addChoiceRow({
          labelText: String(opt.text ?? opt.id),
          inputType: 'radio',
          name,
          value: String(opt.id),
          isCorrect: corr.has(String(opt.id)),
          container: box
        }));
      });
      currentNodes = nodes;
      $('submit').classList.remove('hidden'); $('continue').classList.add('hidden');

    } else if (t === 'checkbox') {
      const corr = new Set((item.correct || []).map(String));
      currentFeedbackMap = item.feedback || {};
      const name = `cb_${item.id}`, nodes = [];
      (item.choices || []).forEach(opt => {
        nodes.push(addChoiceRow({
          labelText: String(opt.text ?? opt.id),
          inputType: 'checkbox',
          name,
          value: String(opt.id),
          isCorrect: corr.has(String(opt.id)),
          container: box
        }));
      });
      currentNodes = nodes;
      $('submit').classList.remove('hidden'); $('continue').classList.add('hidden');

    } else if (t === 'fib') {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.placeholder = item.placeholder || ''; inp.autocomplete = 'off'; inp.spellcheck = false;
      inp.readOnly = false;
      document.getElementById('submit')?.classList.remove('hidden');
      document.getElementById('submit').disabled = false;
      document.getElementById('continue')?.classList.add('hidden');
      box.appendChild(inp);
      inp.focus();

      $('submit').classList.remove('hidden'); $('continue').classList.add('hidden');

    } else if (t === 'poll') {
      const name = `poll_${item.id}`;
      (item.choices || []).forEach(opt => {
        addChoiceRow({
          labelText: String(opt.text ?? opt.id),
          inputType: 'radio',
          name,
          value: String(opt.id),
          isCorrect: false,
          container: box
        });
      });
      $('submit').classList.remove('hidden'); $('continue').classList.add('hidden');

    } else if (t === 'fr' || t === 'free' || t === 'free_response') {
	const inp = document.createElement('textarea');
	if (item.maxLen) inp.maxLength = +item.maxLen;
	inp.placeholder = item.placeholder || '';
	inp.autocomplete = 'off';
	inp.spellcheck = false;
	inp.setAttribute('data-lpignore','true');
	inp.setAttribute('data-1p-ignore','true');
	inp.setAttribute('data-form-type','other');
	inp.rows = Math.max(3, Math.min(8, Number(item.rows || 4)));
	inp.style.width = '100%';
	inp.style.minHeight = '80px';
	inp.readOnly = false;
        document.getElementById('submit')?.classList.remove('hidden');
        document.getElementById('submit').disabled = false;
        document.getElementById('continue')?.classList.add('hidden');
        box.appendChild(inp);
        inp.focus();
	
      $('submit').classList.remove('hidden'); $('continue').classList.add('hidden');

    } else if (t === 'pause') {
      if (item.note) { const note = document.createElement('div'); note.className = 'note'; note.textContent = item.note; box.appendChild(note); }
      $('submit').classList.add('hidden'); $('continue').classList.remove('hidden');
    }

    if (review) fillAndLockReview(item);

    $('overlay').classList.remove('hidden');
    try { player.pauseVideo(); } catch {}
  }

  async function closeOverlayAndResume() {
    $('overlay').classList.add('hidden');
    overlayOpen = false;
    await sleep(100);
    try { player.playVideo(); } catch {}
  }

  function closeOverlay() {
    const o = document.getElementById('overlay');
    if (o) o.classList.add('hidden');
    overlayOpen = false;
  }

  function showThanksOverlay(wPct) {
    // reuse the same overlay element, but as a clean “thanks” view
    const box = document.getElementById('choices');
    if (box) box.innerHTML = '';
    document.getElementById('prompt').textContent = 'Thanks for watching!';
    document.getElementById('feedback').textContent = 'Your submission has been recorded.';
    const submitBtn = document.getElementById('submit');
    if (submitBtn) { submitBtn.classList.add('hidden'); submitBtn.disabled = true; }
    const cont = document.getElementById('continue');
    if (cont) {
      cont.textContent = 'Close';
      cont.classList.remove('hidden');
      cont.onclick = () => { closeOverlay(); };
    }
    const s = document.getElementById('status');
    if (s && typeof wPct === 'number') s.textContent = `Submitted! Watched ${fmt(wPct)}%.`;
    document.getElementById('overlay').classList.remove('hidden');
    overlayOpen = true;
  }


  // ======================================================================                                
  // Grading & progress                                                                                    
  // Grade answers and update progress UI.                                                                 
  // ======================================================================                                
  /* Grade answers and update progress UI. */
    
  // ---------- grading ----------
  function gradeItem(item, ans) {
    const t = (item.type || '').toLowerCase();
    if (!SCORABLE.has(t)) return { points: 0, max: 0, correct: true };

    // Every scorable question is worth 1 point max.
    if (t === 'mcq') {
      const ok = arraysEq(ans.selected || [], item.correct || []);
      return { points: ok ? 1 : 0, max: 1, correct: ok };
    }

    if (t === 'checkbox') {
      const corr = new Set((item.correct || []).map(String));
      const sel  = new Set((ans.selected || []).map(String));

      let correctSel = 0, incorrectSel = 0;
      sel.forEach(v => { if (corr.has(v)) correctSel++; else incorrectSel++; });

      // Scoring:
      // 1.0  => all correct AND no extra wrongs
      // 0.5  => some correct but not perfect (missing any correct and/or includes wrongs)
      // 0.0  => selected none of the correct options
      let pts = 0;
      if (correctSel === corr.size && incorrectSel === 0 && corr.size > 0) pts = 1;
      else if (correctSel > 0) pts = 0.5;
      else pts = 0;

      return { points: pts, max: 1, correct: pts === 1 };
    }

    if (t === 'fib') {
      const accepts = (item.accept || []).map(String);
      const cs = (item.caseSensitive === true);
      const user = String((ans.text || '')).trim();
      const norm = (s) => cs ? s : s.toLowerCase().trim();
      const ok = accepts.length ? accepts.map(norm).includes(norm(user)) : false;
      return { points: ok ? 1 : 0, max: 1, correct: ok };
    }

    return { points: 0, max: 0, correct: true };
  }

  function computeTotals() {
    let pts = 0, max = 0, correctCount = 0;

    for (const it of quiz.items) {
      const t = (it.type || '').toLowerCase();
      if (!SCORABLE.has(t)) continue;

      // Each scorable question contributes 1 to the denominator.
      max += 1;

      const ans = answered.get(it.id);
      if (ans) {
        const g = gradeItem(it, ans);
        pts += g.points;
        // "Number of correct answers" = full-credit items only.
        if (g.points === 1) correctCount += 1;
      }
    }

    const pct = max ? Math.round((pts / max) * 10000) / 100 : 0;
    return { pts, max, pct, correct: correctCount };
  }

  // progress text + finish visibility (finish hidden if identity path)
  function updateProgress(now = 0, dur = 0) {
    const total = quiz.items.filter(it => SCORABLE.has((it.type || '').toLowerCase())).length;
    const done  = quiz.items.filter(it => SCORABLE.has((it.type || '').toLowerCase()) && answered.has(it.id)).length;
    const { pts, max, pct, correct } = computeTotals();
    const p = $('progress');
    if (p) p.textContent = `${correct}/${total} • ${fmt(pts)}/${fmt(max)} (${fmt(pct)}%)`;

    const fin = $('finish');
    if (fin) {
      if (quiz.requireIdentity === true) {
        fin.classList.add('hidden'); // identity overlay will handle the submit
      } else {
        const ok = (done >= total) && (!quiz.requireWatchToEnd || watchedToEnd);
        if (ok) fin.classList.remove('hidden'); else fin.classList.add('hidden');
      }
    }
  }


  // ======================================================================                                
  // Gating logic                                                                                          
  // Decide when to trigger overlays based on timing.                                                      
  // ======================================================================                                
  /* Decide when to trigger overlays based on timing. */
    
  // ---------- gating ----------
  function nextGateTimeAfter(now) {
    let best = Infinity;
    const reviewing = (quiz && quiz.reviewOnRewatch === true) && reviewMode;
    for (const it of (quiz?.items || [])) {
      const t = Number(it.t || 0);
      const isAnswered = answered.has(it.id);
      if (!reviewing && isAnswered) continue;
      if (t >= now && t < best) best = t;
    }
    return best;
  }

  function maybeTrigger(now) {
    const reviewing = (quiz && quiz.reviewOnRewatch === true) && reviewMode;
    for (const it of (quiz?.items || [])) {
      const t = Number(it.t || 0);
      if (now >= t) {
        const isAnswered = answered.has(it.id);
        if (!isAnswered) { showOverlay(it, { review: false }); return true; }
        if (reviewing && !reviewedThisPass.has(it.id)) {
          reviewedThisPass.add(it.id);
          showOverlay(it, { review: true });
          return true;
        }
      }
    }
    return false;
  }


  // ======================================================================                                
  // Handlers                                                                                              
  // Handle submit/continue/finish actions and identity flow.                                              
  // ======================================================================                                
  /* Handle submit/continue/finish actions and identity flow. */
  
  // ---------- handlers ----------
  async function handleSubmit() {
    if (!currentItem) return;
    const t = (currentItem.type || '').toLowerCase();
    const box = $('choices');
    const ans = normalizeAnswer(currentItem, box);

    if ((t === 'mcq' || t === 'poll') && (!ans.selected || ans.selected.length === 0)) {
      $('feedback').textContent = 'Please select an option.'; return;
    }

    // store
    answered.set(currentItem.id, ans);
    markReviewed(currentItem);

    // feedback & chips
    let fb = '';
    if (SCORABLE.has(t)) {
      const g = gradeItem(currentItem, ans);
      if (t === 'mcq') {
        const selected = (ans.selected || [])[0] ?? null;
        revealChoiceFeedback = true;
        if (currentNodes) currentNodes.forEach(n => n.updateChip(selected, false, currentFeedbackMap || {}));
        if (!g.correct) {
          const ids = (currentItem.correct || []);
          const texts = (currentItem.choices || []).filter(c => ids.includes(c.id)).map(c => c.text);
          fb = `Incorrect. Correct: ${texts.join(', ')}`;
        } else {
          fb = 'Correct.';
        }
      } else if (t === 'checkbox') {
        const selectedSet = new Set(ans.selected || []);
        revealChoiceFeedback = true;
        if (currentNodes) currentNodes.forEach(n => n.updateChip(null, true, currentFeedbackMap || {}));
        const corr = new Set((currentItem.correct || []).map(String));
        let correctSel = 0, incorrectSel = 0;
        selectedSet.forEach(v => { if (corr.has(v)) correctSel++; else incorrectSel++; });
        fb = (correctSel === corr.size && incorrectSel === 0) ? 'All correct.'
           : (correctSel > 0) ? 'Partially correct.'
           : 'Not correct.';
        const star = (currentItem.feedback && currentItem.feedback['*']) ? ` ${currentItem.feedback['*']}` : '';
        fb += star;
      } else if (t === 'fib') {
        fb = g.correct ? 'Correct.' : 'Not quite.';
      }
    } else if (t === 'poll') {
      fb = 'Thanks for your response.';
      revealChoiceFeedback = true;
      const selected = (ans.selected || [])[0] ?? null;
      if (currentNodes) currentNodes.forEach(n => n.updateChip(selected, false, currentFeedbackMap || {}));
    } else if (t === 'fr' || t === 'free' || t === 'free_response') {
      fb = 'Recorded.';
    }
    $('feedback').textContent = fb;

    const delay = Number(quiz.feedbackDelaySeconds || 0);
    if (quiz.requireContinue === true) {
      $('submit').classList.add('hidden'); $('continue').classList.remove('hidden');
    } else {
      $('submit').disabled = true;
      if (delay > 0) await sleep(delay * 1000);
      $('submit').disabled = false;
      await closeOverlayAndResume();
    }
  }
    
  async function handleContinue() {
    if (currentItem) {
      const t = (currentItem.type || '').toLowerCase();

      // For non-scorable "pause" interactions, mark them as answered so gating releases.
      if (t === 'pause' && !answered.has(currentItem.id)) {
        answered.set(currentItem.id, { kind: 'pause', cont: true });
      }

      // Preserve prior “don’t re-trigger in this pass” behavior
      markReviewed(currentItem);
    }

    // close overlay and resume playback
    await closeOverlayAndResume();

    // refresh progress text/finish visibility
    try {
      const now = player?.getCurrentTime?.() || 0;
      const dur = player?.getDuration?.() || 0;
      updateProgress(now, dur);
    } catch {}
  }

  // ---- Identity overlay: SUBMIT HERE posts the attempt and finishes the flow ----
  async function submitAttemptNow(viewerText) {
    if (submitting || submittedOnce) return;
    submitting = true;

    // record the identity as the final answer
    answered.set(ID_KEY, { kind:'fr', text: viewerText });

    // watch stats
    let now = 0, dur = 0;
    try { now = player.getCurrentTime() || 0; dur = player.getDuration() || 0; } catch {}
    const wSecs = watchedSeconds(now, dur);
    const wPct  = watchedPercent(now, dur);
    answered.set('__meta', { watchSeconds: Math.round(wSecs * 100) / 100, watchPercent: Math.round(wPct * 100) / 100 });

    // totals & payload
    const totals = computeTotals();
    const payload = {
      viewer: viewerText,
      points: totals.pts,
      max_points: totals.max,
      answers: Object.fromEntries(answered),
      category: quiz.category || undefined,
      nonce: ATTEMPT_NONCE
    };

    try {
      const r = await fetch(`/api/attempt/${encodeURIComponent(quiz.id || window.QUIZ_ID || 'unknown')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      if (r.status === 409) {
        submittedOnce = true; // already counted
      } else if (!r.ok) {
        throw new Error('HTTP ' + r.status);
      } else {
        submittedOnce = true;
      }
    } catch (e) {
      submitting = false;
      document.getElementById('feedback').textContent = 'Submit failed. Please try again.';
      return;
    }

    // success: first close the identity overlay, then show a clean “thanks” overlay
    closeOverlay();
    setTimeout(() => showThanksOverlay(wPct), 120);
  }

  function renderIdentity() {
    const box = $('choices');
    ensureChoicesIsDiv(); box.innerHTML = '';
    $('prompt').textContent = quiz.identityPrompt || 'Enter your course username';
    $('feedback').textContent = 'Press Enter or click Submit to finish.';

    const input = document.createElement('input');
    input.type = 'text'; input.id = 'identityInput'; input.name = 'viewer_plain';
    input.placeholder = 'e.g., jdoe'; input.required = true; input.style.width = '260px';
    input.autocomplete = 'off'; input.autocapitalize = 'none'; input.autocorrect = 'off'; input.spellcheck = false;
    input.setAttribute('data-lpignore','true'); input.setAttribute('data-1p-ignore','true'); input.setAttribute('data-form-type','other');
    input.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); ev.stopPropagation(); $('submit')?.click(); }});
    box.appendChild(input);

    const cont = $('continue');
    cont.textContent = 'Close';
    cont.classList.add('hidden');

    const btn = $('submit');
    btn.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Submit';
    btn.onclick = async () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      await submitAttemptNow(v);
    };

    $('overlay').classList.remove('hidden');
    overlayOpen = true;
    try { player.pauseVideo(); } catch {}
    input.focus();
  }

  async function handleFinish() {
    // Only used when requireIdentity is false; preserved for backwards compatibility
    if (quiz && quiz.requireIdentity === true) return;
    if (submitting || submittedOnce) return;
    submitting = true;
    const finBtn = $('finish');
    if (finBtn) { finBtn.disabled = true; finBtn.textContent = 'Submitting…'; }

    // derive viewer if any FR exists
    let viewer = '';
    for (let i = quiz.items.length - 1; i >= 0; i--) {
      const it = quiz.items[i], t = (it.type || '').toLowerCase();
      if (t === 'fr' || t === 'free' || t === 'free_response') {
        const ans = answered.get(it.id);
        if (ans && ans.text) { viewer = ans.text.trim(); break; }
      }
    }

    // watch stats
    let now = 0, dur = 0;
    try { now = player.getCurrentTime() || 0; dur = player.getDuration() || 0; } catch {}
    const wSecs = watchedSeconds(now, dur);
    const wPct  = watchedPercent(now, dur);
    answered.set('__meta', { watchSeconds: Math.round(wSecs * 100) / 100, watchPercent: Math.round(wPct * 100) / 100 });

    const totals = computeTotals();
    const payload = {
      viewer,
      points: totals.pts,
      max_points: totals.max,
      answers: Object.fromEntries(answered),
      category: quiz.category || undefined,
      nonce: ATTEMPT_NONCE
    };

    try {
      const r = await fetch(`/api/attempt/${encodeURIComponent(quiz.id || window.QUIZ_ID || 'unknown')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      if (r.status === 409) { submittedOnce = true; }
      else if (!r.ok) { throw new Error('HTTP ' + r.status); }
      else { submittedOnce = true; }
    } catch (e) {
      submitting = false;
      if (finBtn) { finBtn.disabled = false; finBtn.textContent = 'Finish & Submit'; }
      const s = $('status'); if (s) s.textContent = 'Submit failed. Try again.';
      return;
    }

    if (finBtn) { finBtn.disabled = true; finBtn.textContent = 'Submitted'; }
    const s = $('status'); if (s) s.textContent = `Submitted! Watched ${fmt(wPct)}%.`;
    setTimeout(() => { if (s) s.textContent = ''; }, 2000);
  }


  // ======================================================================                                
  // Boot & tick                                                                                           
  // Initialize player and periodic tick loop.                                                             
  // ======================================================================                                
  /* Initialize player and periodic tick loop. */

  // ---------- boot ----------
  async function boot() {
    let qid = window.QUIZ_ID;
    if (!qid) {
      try {
        const d = await fetch('/api/quizzes', { credentials: 'include' }).then(r => r.ok ? r.json() : null);
        if (d && d.quizzes && d.quizzes.length) qid = d.quizzes[0].id;
      } catch {}
    }
    if (!qid) { const s = $('status'); if (s) s.textContent = 'No quiz available.'; return; }

    const res = await fetch(`/api/quiz/${encodeURIComponent(qid)}`, { credentials: 'include' });
    if (!res.ok) { const s = $('status'); if (s) s.textContent = 'Failed to load quiz.'; return; }
    quiz = await res.json();
    if ($('title')) $('title').textContent = quiz.title || 'Interactive Video';

    player = new YT.Player('player', {
      videoId: quiz.videoId,
      playerVars: { controls: 1, disablekb: 1, modestbranding: 1, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1 },
      events: {
        onReady: () => { tickTimer && clearInterval(tickTimer); tickTimer = setInterval(tick, 250); },
	onStateChange: (e) => {
          if (e.data === YT.PlayerState.ENDED) {
            // Match mcq-multi behavior: treat ENDED as finished
            watchedToEnd = true;

            // Close the final coverage segment and refresh UI
            try {
               const now = player.getCurrentTime() || 0;
	       const dur = player.getDuration() || 0;
	       stopWatch(now);
	       updateProgress(now, dur);
            } catch {}

            // Prompt for identity if required
            if (quiz.requireIdentity && !answered.has(ID_KEY) && !overlayOpen && !submitting && !submittedOnce) {
              renderIdentity();
            } else {
              updateProgress();
            }
          }

          if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.BUFFERING) {
            try {
              const now = player.getCurrentTime() || 0;
              stopWatch(now);
            } catch {}
          }
        }  
      }
    });

    document.getElementById('theater')?.addEventListener('click', () => {
      document.body.classList.toggle('theater');
      const btn = document.getElementById('theater');
      if (btn) btn.textContent = document.body.classList.contains('theater') ? 'Exit Theater' : 'Theater';
      });
      $('submit')?.addEventListener('click', handleSubmit);
      $('continue')?.addEventListener('click', handleContinue);
      $('finish')?.addEventListener('click', handleFinish);
    }

    loadYouTubeAPIThen(boot);

  // ======================================================================                              
  // Tick loop                                                                                           
  // Periodic tick loop for coverage and gating.                                                         
  // ======================================================================                              
  /* Periodic tick loop for coverage and gating. */

  // ---------- tick ----------
  function tick() {
    if (!player || typeof player.getCurrentTime !== 'function' || !quiz) return;

    let now = 0, dur = 0, st = null;
    try {
      now = player.getCurrentTime() || 0;
      dur = player.getDuration ? (player.getDuration() || 0) : 0;
      st  = player.getPlayerState ? player.getPlayerState() : null;
    } catch {}

    const isPlaying = (st === YT.PlayerState.PLAYING);

    // coverage
    if (isPlaying && !overlayOpen) {
      if (!watching) startWatch(now);
      const jumpFwd  = (now > lastNow + 1.25);
      const jumpBack = (now + 0.75 < lastNow);
      if (jumpFwd || jumpBack) { stopWatch(lastNow); startWatch(now); }
    } else {
      stopWatch(now);
    }

    if (now > peakTime) peakTime = now;

    // one-time forward seek bounce (no overlay on this tick)
    if (!warnedSeekOnce && (now > lastNow + 2.0) && !overlayOpen) {
      warnedSeekOnce = true;
      try { player.seekTo(Math.max(0, lastNow), true); } catch {}
      const s = $('status');
      if (s) {
        const msg = (quiz && quiz.seekWarningText)
          ? String(quiz.seekWarningText)
          : 'Heads up: seeking ahead won’t count toward watch %. You also can’t skip interactions.';
        s.textContent = msg;
        setTimeout(() => { s.textContent = ''; }, 3500);
      }
      return;
    }

    if ((quiz && quiz.reviewOnRewatch === true) && (now + 0.75 < lastNow)) {
      reviewMode = true;
      reviewedThisPass.clear();
      reviewExitTime = peakTime;
    }
    if (reviewMode && now >= reviewExitTime - 0.1) reviewMode = false;

    const cap = nextGateTimeAfter(lastNow);
    if (isFinite(cap) && now > cap + 0.4) {
      try { player.seekTo(Math.max(0, cap - 0.05), true); } catch {}
      return;
    }

    if (!overlayOpen && maybeTrigger(now)) {
	stopWatch(now);
	updateProgress(now, dur);
      return;
    }
      
   // Mark complete based on *coverage* (not playhead position)
   const effEnd = effectiveEnd(dur);
	if (effEnd && !watchedToEnd) {
     const secCovered = watchedSeconds(now, effEnd);
     const remaining  = effEnd - secCovered;
     // “Close enough”: within 1s or ≥97% coverage
     if (remaining <= 1.0 || (secCovered / effEnd) >= 0.97) {
       stopWatch(now); 	   
	 watchedToEnd = true;
       updateProgress(now, dur);

	 // If we trimmed the end (endAt) and require identity, prompt now
	 // Only open identity if required AND not already answered,
         // and avoid reopening if an overlay is up or we've already submitted.
       if (quiz.requireIdentity && !answered.has(ID_KEY) && !overlayOpen && !submitting && !submittedOnce) {
         try { player.pauseVideo(); } catch {}
           renderIdentity();
	   return;
       }
     }
   }
    lastNow = now;
    updateProgress(now, dur);
  }
})();
