// Floating Feedback button. Include on any app page; set data-page on the script tag.
(function () {
  var page = (document.currentScript && document.currentScript.getAttribute('data-page')) || location.pathname;
  function token() { try { return window.TL_TOKEN || localStorage.getItem('tl_token') || ''; } catch (e) { return ''; } }
  var btn = document.createElement('button');
  btn.className = 'fb-btn'; btn.type = 'button'; btn.textContent = 'Feedback';
  document.body.appendChild(btn);
  btn.onclick = function () {
    var rating = 0;
    var bg = document.createElement('div'); bg.className = 'sheet-bg';
    bg.innerHTML = '<div class="sheet" role="dialog" aria-label="Feedback"><h3>How is TeenLedger?</h3><p class="small">Tell us what to fix or add. We read every one.</p>' +
      '<div class="faces"><button type="button" data-r="1" aria-label="Bad">😞</button><button type="button" data-r="2" aria-label="Meh">😕</button><button type="button" data-r="3" aria-label="Okay">😐</button><button type="button" data-r="4" aria-label="Good">🙂</button><button type="button" data-r="5" aria-label="Love it">😍</button></div>' +
      '<textarea maxlength="1000" placeholder="What should we fix or add? (optional)"></textarea>' +
      '<div class="error" style="margin-top:10px"></div>' +
      '<button type="button" class="btn btn-primary btn-block mt-1 send">Send</button><button type="button" class="btn btn-ghost btn-block mt-1 close">Close</button></div>';
    document.body.appendChild(bg);
    var faces = bg.querySelectorAll('.faces button');
    faces.forEach(function (f) { f.onclick = function () { rating = +f.getAttribute('data-r'); faces.forEach(function (x) { x.classList.toggle('on', x === f); }); }; });
    function close() { bg.remove(); }
    bg.onclick = function (e) { if (e.target === bg) close(); };
    bg.querySelector('.close').onclick = close;
    bg.querySelector('.send').onclick = function () {
      var msg = bg.querySelector('textarea').value.trim(), err = bg.querySelector('.error');
      if (!rating && !msg) { err.textContent = 'Pick a face or write a note.'; err.style.display = 'block'; return; }
      var s = bg.querySelector('.send'); s.disabled = true; s.textContent = 'Sending...';
      fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token(), rating: rating || null, message: msg, page: page }) })
        .then(function (r) { if (!r.ok) throw new Error(); bg.querySelector('.sheet').innerHTML = '<h3>Thank you!</h3><p class="small">Got it. We use this to make TeenLedger better.</p><button type="button" class="btn btn-primary btn-block mt-2">Done</button>'; bg.querySelector('.sheet .btn').onclick = close; })
        .catch(function () { s.disabled = false; s.textContent = 'Send'; err.textContent = 'Could not send. Try again.'; err.style.display = 'block'; });
    };
  };
})();
