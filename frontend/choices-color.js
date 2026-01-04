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

   choices-color.js — colorizer for MCQ/checkbox options
   MCQ:   selected wrong → red; correct (even if not selected) → green.
   Check: selected correct → green; selected wrong → red; missed-correct → amber.
*/
(function(){
  function colorize(container){
    if (!container) return;
    const labels = container.querySelectorAll('#choices label');
    labels.forEach(label=>{
      label.classList.remove('choice-correct','choice-incorrect','choice-missed');

      const input = label.querySelector('input');
      if (!input) return;
      const isRadio = input.type === 'radio';
      const checked = !!input.checked;

      // In your markup order: input, text <span>, chip <span>
      const chip = label.querySelector('span:last-of-type');
      if (!chip) return;
      chip.classList.add('choice-chip');

      const mark = (chip.textContent || '').trim();

      if (mark === '✓') {
        if (isRadio) {
          // MCQ: always green for the correct choice (selected or not)
          label.classList.add('choice-correct');
        } else {
          // Checkbox: selected-correct → green; missed-correct → amber
          label.classList.add(checked ? 'choice-correct' : 'choice-missed');
        }
      } else if (mark === '✗') {
        if (isRadio) {
          // MCQ: only the selected wrong option will have ✗ → red
          label.classList.add('choice-incorrect');
        } else {
          // Checkbox: selected-wrong → red; unselected-wrong (shouldn’t show a chip) → amber if it ever appears
          label.classList.add(checked ? 'choice-incorrect' : 'choice-missed');
        }
      }
    });
  }

  function findChoicesRoot(){
    return document.getElementById('choices') || document.querySelector('#overlay #choices');
  }

  const mo = new MutationObserver(()=> colorize(findChoicesRoot()));

  window.addEventListener('DOMContentLoaded', ()=>{
    const root = findChoicesRoot();
    if (root){
      mo.observe(root, { childList:true, subtree:true, characterData:true });
    }
    const submit = document.getElementById('submit');
    const cont   = document.getElementById('continue');
    submit && submit.addEventListener('click', ()=> setTimeout(()=>colorize(findChoicesRoot()), 0));
    cont   && cont.addEventListener('click',   ()=> setTimeout(()=>colorize(findChoicesRoot()), 0));
  });

  // Safety pass in case chips are set synchronously
  setInterval(()=> colorize(findChoicesRoot()), 500);
})();
