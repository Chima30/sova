'use strict';

// Floating focus widget. It only displays state sent by SOVA's main window
// and sends back three actions. It never touches the camera itself.

(function () {
  const $ = (id) => document.getElementById(id);

  function draw(points, show) {
    const c = $('trace');
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!show || !points || points.length < 4) {
      // Nothing measured: a still grey line, never an invented breath.
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#86839b';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, c.height / 2); ctx.lineTo(c.width, c.height / 2); ctx.stroke();
      return;
    }
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff7442';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((v, i) => {
      const x = (i / (points.length - 1)) * c.width;
      const y = c.height - 4 - v * (c.height - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  window.sovaWidget.onState((s) => {
    document.documentElement.dataset.theme = s.theme === 'light' ? 'light' : 'dark';
    $('title').textContent = s.preset ? `SOVA · ${s.preset}` : 'SOVA';
    $('clock').textContent = s.clock;
    $('sub').textContent = s.line;
    $('cam-text').textContent = s.live ? (s.cameraPaused ? 'Camera paused' : 'Camera on') : 'Timer only';
    $('cam-dot').className = `dot${!s.live || s.cameraPaused ? ' warn' : ''}`;
    $('pause').textContent = s.paused ? 'Resume' : 'Pause';
    $('pause').setAttribute('aria-label', s.paused ? 'Resume session' : 'Pause session');
    draw(s.trace, s.live && !s.cameraPaused);
  });

  $('reset').addEventListener('click', () => window.sovaWidget.action('reset'));
  $('pause').addEventListener('click', () => window.sovaWidget.action('pause'));
  $('open').addEventListener('click', () => window.sovaWidget.action('open'));
  $('hide').addEventListener('click', () => window.sovaWidget.action('hide'));
})();
