(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var STORE_KEY = 'ai_quiz_builder_quizzes_v1';

  var AI_LIST = [
    { name: 'ChatGPT', url: 'https://chatgpt.com/', color: '#10a37f' },
    { name: 'Gemini', url: 'https://gemini.google.com/', color: '#4e8cf0' },
    { name: 'Claude', url: 'https://claude.ai/new', color: '#d97757' },
    { name: 'Kimi', url: 'https://www.kimi.com/', color: '#8b5cf6' }
  ];

  var AI_PROMPT = [
    'Actúa como un creador experto de cuestionarios de estudio. Voy a darte material de estudio y debes generar un cuestionario de opción múltiple siguiendo EXACTAMENTE este formato de salida. No escribas introducciones, despedidas ni explicaciones: SOLO el cuestionario.',
    '',
    'FORMATO DE SALIDA (ejemplo):',
    '',
    'Nombre del cuestionario : Título del cuestionario',
    '### **Pregunta 1**',
    '',
    '**1.1 Enunciado de la pregunta en negrita:**',
    '',
    '* A. Opción incorrecta',
    '* **B. Opción correcta** *(Correcta)*',
    '* C. Opción incorrecta',
    '* D. Opción incorrecta',
    '',
    '---',
    '',
    '### **Pregunta 2**',
    '',
    '**2.1 Pregunta con VARIAS respuestas correctas:**',
    '',
    '* **A. Respuesta correcta** *(Correcta)*',
    '* B. Opción incorrecta',
    '* **C. Respuesta correcta** *(Correcta)*',
    '',
    '---',
    '',
    '### **Pregunta 3**',
    '',
    '**3.1 Complete los espacios en blanco:**',
    '',
    '* **Texto:** "Frase con las **[palabra1]** a completar y otra **[palabra2]**."',
    '* BLANK-1: **palabra1**',
    '* BLANK-2: **palabra2**',
    '',
    '---',
    '',
    'REGLAS OBLIGATORIAS:',
    '1. La primera línea debe ser exactamente: "Nombre del cuestionario : <título>".',
    '2. Cada pregunta inicia con el encabezado: ### **Pregunta N** (N consecutivo desde 1).',
    '3. El enunciado va en una sola línea envuelto en **negrita**.',
    '4. Cada opción va en su propia línea empezando con "* " seguido de letra mayúscula y punto (A. B. C. ...).',
    '5. TODA respuesta correcta debe estar envuelta en **negrita** Y terminar con *(Correcta)*.',
    '6. Si una pregunta tiene varias respuestas correctas, márcalas TODAS con la regla anterior.',
    '7. Entre pregunta y pregunta incluye una línea solo con: ---',
    '8. Para preguntas de completar espacios usa el formato del ejemplo (línea **Texto:** con las respuestas entre corchetes y negrita, y luego BLANK-1, BLANK-2... con cada respuesta).',
    '9. Incluye una mezcla de preguntas: mayoría de opción múltiple con 1 respuesta correcta, varias con 2 o más respuestas correctas, y 2 o 3 de completar espacios.',
    '10. Genera entre 15 y 40 preguntas cubriendo TODO el material de forma equilibrada.',
    '11. Las opciones incorrectas deben ser plausibles y coherentes con el material.',
    '12. NO uses tablas, imágenes ni formato distinto al indicado.',
    '',
    'MATERIAL DE ESTUDIO:',
    '[PEGA AQUÍ TU MATERIAL O ADJUNTA LOS ARCHIVOS]'
  ].join('\n');

  var state = {
    quizzes: [],
    session: null,
    pendingQuiz: null
  };

  function loadQuizzes() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      state.quizzes = raw ? JSON.parse(raw) : [];
    } catch (e) { state.quizzes = []; }
  }

  function saveQuizzes() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.quizzes)); } catch (e) {}
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function rich(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy') ? resolve() : reject(new Error('copy failed'));
      } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  var VIEW_TITLES = { home: 'Mis cuestionarios', new: 'Nuevo cuestionario', ai: 'Generar con IA', quiz: '', result: 'Resultados' };

  function showView(name) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var view = $('#view-' + name);
    if (view) view.classList.add('active');
    $('#topbar-title').textContent = VIEW_TITLES[name] || '';
    var isFlow = name === 'quiz' || name === 'result';
    $('#bottomnav').classList.toggle('hidden', isFlow);
    $('#btn-back').classList.toggle('hidden', !isFlow);
    $('#quiz-progress-track').classList.toggle('hidden', name !== 'quiz');
    document.querySelectorAll('.bottomnav button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.nav === name);
    });
    window.scrollTo({ top: 0 });
  }

  function bestScore(quiz) {
    if (!quiz.attempts || !quiz.attempts.length) return null;
    return quiz.attempts.reduce(function (a, b) { return b.score > a.score ? b : a; });
  }

  function renderHome() {
    var list = $('#quiz-list');
    list.innerHTML = '';
    $('#home-empty').classList.toggle('hidden', state.quizzes.length > 0);
    state.quizzes.forEach(function (quiz) {
      var li = document.createElement('li');
      li.className = 'quiz-item';
      var best = bestScore(quiz);
      var attempts = quiz.attempts ? quiz.attempts.length : 0;
      li.innerHTML =
        '<button class="quiz-item-main" data-play="' + quiz.id + '">' +
          '<div class="quiz-item-name">' + esc(quiz.name) + '</div>' +
          '<div class="quiz-item-meta">' +
            '<span>' + quiz.questions.length + ' preguntas</span>' +
            '<span>·</span>' +
            '<span>' + (attempts ? attempts + (attempts === 1 ? ' intento' : ' intentos') : 'Sin intentos') + '</span>' +
            (best ? '<span class="badge ok">Mejor: ' + best.score + '/' + quiz.questions.length + '</span>' : '') +
          '</div>' +
        '</button>' +
        '<button class="quiz-delete" data-del="' + quiz.id + '" aria-label="Eliminar">' +
          '<svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14Z"/></svg>' +
        '</button>';
      list.appendChild(li);
    });
  }

  function deleteQuiz(id) {
    var quiz = state.quizzes.find(function (q) { return q.id === id; });
    if (!quiz) return;
    if (!confirm('¿Eliminar "' + quiz.name + '"? Esta acción no se puede deshacer.')) return;
    state.quizzes = state.quizzes.filter(function (q) { return q.id !== id; });
    saveQuizzes();
    renderHome();
    toast('Cuestionario eliminado');
  }

  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      $('#paste-area').value = String(reader.result || '');
      toast('Archivo cargado: ' + file.name);
    };
    reader.readAsText(file, 'utf-8');
  }

  function countTypes(questions) {
    var c = { single: 0, multiple: 0, blanks: 0 };
    questions.forEach(function (q) { c[q.type]++; });
    return c;
  }

  function showPreview(parsed) {
    state.pendingQuiz = parsed;
    $('#preview-panel').classList.remove('hidden');
    $('#preview-name').value = parsed.name;
    var c = countTypes(parsed.questions);
    $('#preview-chips').innerHTML =
      '<span class="chip"><b>' + parsed.questions.length + '</b> preguntas</span>' +
      '<span class="chip"><b>' + c.single + '</b> de 1 respuesta</span>' +
      '<span class="chip"><b>' + c.multiple + '</b> de varias</span>' +
      '<span class="chip"><b>' + c.blanks + '</b> de espacios</span>';
    var warnBox = $('#preview-warnings');
    if (parsed.warnings.length) {
      warnBox.innerHTML = '<strong>Avisos:</strong><br>' + parsed.warnings.map(esc).join('<br>');
      warnBox.classList.remove('hidden');
    } else {
      warnBox.classList.add('hidden');
    }
    $('#preview-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function handleParse() {
    var text = $('#paste-area').value;
    if (!text.trim()) { toast('Sube un archivo o pega el texto primero'); return; }
    var parsed = QuizParser.parseQuiz(text);
    if (!parsed.questions.length) {
      toast('No se detectaron preguntas válidas');
      $('#preview-panel').classList.add('hidden');
      return;
    }
    showPreview(parsed);
  }

  function persistPending(startNow) {
    if (!state.pendingQuiz) return;
    var name = $('#preview-name').value.trim() || state.pendingQuiz.name || 'Cuestionario sin título';
    var quiz = {
      id: uid(),
      name: name,
      createdAt: new Date().toISOString(),
      questions: state.pendingQuiz.questions,
      attempts: []
    };
    state.quizzes.unshift(quiz);
    saveQuizzes();
    renderHome();
    state.pendingQuiz = null;
    $('#preview-panel').classList.add('hidden');
    $('#paste-area').value = '';
    toast('Cuestionario guardado');
    if (startNow) startQuiz(quiz.id);
    else showView('home');
  }

  function startQuiz(id) {
    var quiz = state.quizzes.find(function (q) { return q.id === id; });
    if (!quiz) return;
    state.session = {
      quizId: id,
      idx: 0,
      answers: quiz.questions.map(function () { return null; }),
      checked: quiz.questions.map(function () { return false; }),
      revealed: quiz.questions.map(function () { return false; }),
      flags: quiz.questions.map(function () { return false; })
    };
    renderQuestion();
    showView('quiz');
  }

  function currentSession() {
    if (!state.session) return null;
    var quiz = state.quizzes.find(function (q) { return q.id === state.session.quizId; });
    if (!quiz) return null;
    return { quiz: quiz, s: state.session };
  }

  function optionLabel(q, i) {
    return q.options[i].key || String.fromCharCode(65 + i);
  }

  function renderQuestion() {
    var ctx = currentSession();
    if (!ctx) return;
    var quiz = ctx.quiz, s = ctx.s;
    var i = s.idx;
    var q = quiz.questions[i];

    $('#quiz-counter').textContent = (i + 1) + ' / ' + quiz.questions.length;
    var score = s.flags.filter(Boolean).length;
    $('#quiz-live-score').textContent = score + ' pts';
    $('#quiz-progress-fill').style.width = ((i) / quiz.questions.length * 100) + '%';

    var card = $('#question-card');
    var html = '';

    if (q.type === 'blanks') {
      html += '<span class="q-type-tag">Completar espacios</span>';
    } else if (q.type === 'multiple') {
      html += '<span class="q-type-tag">Selecciona todas las que apliquen</span>';
    } else {
      html += '<span class="q-type-tag">Selecciona una respuesta</span>';
    }

    if (q.text) html += '<div class="q-text">' + rich(q.text) + '</div>';

    if (q.type === 'blanks') {
      html += '<div class="blanks-sentence">';
      var parts = q.sentenceParts && q.sentenceParts.length ? q.sentenceParts : [''].concat(q.blanks.map(function (_, x) { return '{' + x + '}'; }));
      parts.forEach(function (p, pi) {
        html += rich(p);
        if (pi < q.blanks.length) {
          html += '<input type="text" class="blank-input" data-blank="' + pi + '" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Espacio ' + (pi + 1) + '">';
        }
      });
      html += '</div>';
    } else {
      html += '<ul class="options">';
      q.options.forEach(function (opt, oi) {
        var inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
        html +=
          '<li><label class="option" data-opt="' + oi + '">' +
            '<input type="' + inputType + '" name="q' + i + '" value="' + oi + '">' +
            '<span class="opt-key">' + esc(optionLabel(q, oi)) + '</span>' +
            '<span>' + rich(opt.text) + '</span>' +
          '</label></li>';
      });
      html += '</ul>';
    }

    card.innerHTML = html;

    var checked = s.checked[i];
    var revealed = s.revealed[i];

    if (!checked) {
      card.querySelectorAll('.option input').forEach(function (input) {
        input.addEventListener('change', onOptionChange);
      });
      card.querySelectorAll('.blank-input').forEach(function (inp) {
        inp.addEventListener('input', onBlankInput);
        if (s.answers[i]) inp.value = s.answers[i][parseInt(inp.dataset.blank, 10)] || '';
      });
    }

    if (s.answers[i] && !checked) {
      if (q.type !== 'blanks') {
        card.querySelectorAll('.option').forEach(function (label) {
          var oi = parseInt(label.dataset.opt, 10);
          if (s.answers[i].has(oi)) label.classList.add('selected');
        });
      }
    }

    if (checked || revealed) applyFeedbackStyles();

    updateActionButtons();
    updateNavButtons();
  }

  function getSelection(i) {
    var ctx = currentSession(); if (!ctx) return null;
    var q = ctx.quiz.questions[i];
    if (q.type === 'blanks') return null;
    var sel = new Set();
    document.querySelectorAll('#question-card .option input:checked').forEach(function (inp) {
      sel.add(parseInt(inp.value, 10));
    });
    return sel;
  }

  function onOptionChange() {
    var ctx = currentSession(); if (!ctx) return;
    var i = ctx.s.idx;
    var q = ctx.quiz.questions[i];
    var sel = getSelection(i);
    s_storeAnswer(i, sel);
    document.querySelectorAll('#question-card .option').forEach(function (label) {
      var oi = parseInt(label.dataset.opt, 10);
      label.classList.toggle('selected', sel.has(oi));
    });
    $('#btn-check').disabled = sel.size === 0;
  }

  function s_storeAnswer(i, val) { state.session.answers[i] = val; }

  function onBlankInput() {
    var ctx = currentSession(); if (!ctx) return;
    var i = ctx.s.idx;
    var vals = [];
    document.querySelectorAll('#question-card .blank-input').forEach(function (inp) {
      vals[parseInt(inp.dataset.blank, 10)] = inp.value;
    });
    s_storeAnswer(i, vals);
    var filled = vals.length > 0 && vals.every(function (v) { return v && v.trim(); });
    $('#btn-check').disabled = !filled;
  }

  function checkCurrent() {
    var ctx = currentSession(); if (!ctx) return;
    var i = ctx.s.idx;
    var q = ctx.quiz.questions[i];
    if (q.type === 'blanks') {
      var vals = state.session.answers[i] || [];
      var filled = vals.length >= q.blanks.length && q.blanks.every(function (_, bi) { return vals[bi] && vals[bi].trim(); });
      if (!filled) { toast('Completa todos los espacios'); return; }
    } else {
      var sel = getSelection(i);
      if (!sel || !sel.size) { toast('Selecciona al menos una opción'); return; }
      state.session.answers[i] = sel;
    }
    state.session.checked[i] = true;
    gradeCurrent();
    applyFeedbackStyles();
    updateActionButtons();
    updateNavButtons();
  }

  function isCorrectAnswer(q, ans) {
    if (q.type === 'blanks') {
      return q.blanks.every(function (b, bi) {
        return QuizParser.normalizeAnswer(ans[bi] || '') === QuizParser.normalizeAnswer(b);
      });
    }
    var correctSet = new Set();
    q.options.forEach(function (op, oi) { if (op.correct) correctSet.add(oi); });
    if (correctSet.size !== ans.size) return false;
    for (var item of correctSet) { if (!ans.has(item)) return false; }
    return true;
  }

  function gradeCurrent() {
    var ctx = currentSession(); if (!ctx) return;
    var i = ctx.s.idx;
    var q = ctx.quiz.questions[i];
    ctx.s.flags[i] = !ctx.s.revealed[i] && isCorrectAnswer(q, ctx.s.answers[i]);
  }

  function revealCurrent() {
    var ctx = currentSession(); if (!ctx) return;
    var i = ctx.s.idx;
    if (ctx.s.checked[i]) return;
    ctx.s.revealed[i] = true;
    ctx.s.flags[i] = false;
    applyFeedbackStyles(true);
    updateActionButtons();
    updateNavButtons();
  }

  function feedbackData(q, ans) {
    if (q.type === 'blanks') {
      var wrong = [];
      q.blanks.forEach(function (b, bi) {
        if (QuizParser.normalizeAnswer((ans && ans[bi]) || '') !== QuizParser.normalizeAnswer(b)) wrong.push(b);
      });
      return { ok: !wrong.length, wrong: wrong };
    }
    var correctLabels = [];
    q.options.forEach(function (op, oi) { if (op.correct) correctLabels.push(optionLabel(q, oi)); });
    return { ok: isCorrectAnswer(q, ans), correctLabels: correctLabels };
  }

  function applyFeedbackStyles(isRevealOnly) {
    var ctx = currentSession(); if (!ctx) return;
    var i = ctx.s.idx;
    var q = ctx.quiz.questions[i];
    var ans = ctx.s.answers[i];
    var checked = ctx.s.checked[i];
    var revealed = ctx.s.revealed[i];
    var box = $('#feedback-box');

    if (q.type !== 'blanks') {
      document.querySelectorAll('#question-card .option').forEach(function (label) {
        var oi = parseInt(label.dataset.opt, 10);
        label.classList.add('locked');
        var inp = label.querySelector('input');
        if (inp) inp.disabled = true;
        if (checked) {
          var isCorr = q.options[oi].correct;
          var picked = ans && ans.has(oi);
          if (isCorr) label.classList.add('correct');
          else if (picked) label.classList.add('wrong');
        } else if (revealed && q.options[oi].correct) {
          label.classList.add('missed');
        }
      });
    } else {
      document.querySelectorAll('#question-card .blank-input').forEach(function (inp) {
        inp.disabled = true;
        var bi = parseInt(inp.dataset.blank, 10);
        if (checked) {
          var good = QuizParser.normalizeAnswer(inp.value) === QuizParser.normalizeAnswer(q.blanks[bi]);
          inp.classList.add(good ? 'correct' : 'wrong');
          if (!good) {
            var hint = document.createElement('div');
            hint.className = 'blank-answer';
            hint.textContent = '→ ' + q.blanks[bi];
            inp.insertAdjacentElement('afterend', hint);
          }
        } else if (revealed) {
          inp.placeholder = q.blanks[bi];
        }
      });
    }

    box.classList.remove('hidden');
    if (checked) {
      var fd = feedbackData(q, ans);
      box.className = 'feedback ' + (fd.ok ? 'ok' : 'bad');
      if (fd.ok) {
        box.innerHTML = '¡Correcto! +' + (state.session.flags[i] ? 1 : 0) + ' punto';
      } else if (q.type === 'blanks') {
        box.innerHTML = 'Incorrecto.<small>Respuestas correctas: ' + fd.wrong.map(esc).join(' · ') + '</small>';
      } else {
        box.innerHTML = 'Incorrecto.<small>La(s) respuesta(s) correcta(s): ' + fd.correctLabels.join(', ') + '</small>';
      }
    } else if (revealed) {
      box.className = 'feedback reveal';
      if (q.type === 'blanks') {
        box.innerHTML = 'Respuesta revelada<small>Esta pregunta no suma puntos.</small>';
      } else {
        var labels = [];
        q.options.forEach(function (op, oi) { if (op.correct) labels.push(optionLabel(q, oi)); });
        box.innerHTML = 'Respuesta correcta: ' + labels.join(', ') + '<small>Esta pregunta no suma puntos.</small>';
      }
    } else {
      box.classList.add('hidden');
    }
  }

  function updateActionButtons() {
    var ctx = currentSession(); if (!ctx) return;
    var i = ctx.s.idx;
    var checked = ctx.s.checked[i];
    var revealed = ctx.s.revealed[i];
    $('#btn-check').classList.toggle('hidden', checked || revealed);
    $('#btn-reveal').classList.toggle('hidden', checked || revealed);
    var q = ctx.quiz.questions[i];
    var hasAns = false;
    if (ctx.s.answers[i]) {
      if (q.type === 'blanks') {
        var v = ctx.s.answers[i];
        hasAns = v.length >= q.blanks.length && q.blanks.every(function (_, bi) { return v[bi] && v[bi].trim(); });
      } else {
        hasAns = ctx.s.answers[i].size > 0;
      }
    }
    $('#btn-check').disabled = !hasAns;
  }

  function updateNavButtons() {
    var ctx = currentSession(); if (!ctx) return;
    var s = ctx.s, total = ctx.quiz.questions.length;
    $('#btn-prev').disabled = s.idx === 0;
    var last = s.idx === total - 1;
    $('#btn-next').textContent = last ? 'Ver resultados' : 'Siguiente';
    var answeredCount = s.checked.filter(Boolean).length;
    $('#quiz-progress-fill').style.width = (answeredCount / total * 100) + '%';
    var score = s.flags.filter(Boolean).length;
    $('#quiz-live-score').textContent = score + ' pts';
  }

  function goNext() {
    var ctx = currentSession(); if (!ctx) return;
    if (ctx.s.idx < ctx.quiz.questions.length - 1) {
      ctx.s.idx++;
      renderQuestion();
    } else {
      finishQuiz();
    }
  }

  function goPrev() {
    var ctx = currentSession(); if (!ctx) return;
    if (ctx.s.idx > 0) {
      ctx.s.idx--;
      renderQuestion();
    }
  }

  function finishQuiz() {
    var ctx = currentSession(); if (!ctx) return;
    var quiz = ctx.quiz, s = ctx.s;
    var total = quiz.questions.length;
    var score = s.flags.filter(Boolean).length;
    var pct = total ? Math.round(score / total * 100) : 0;

    quiz.attempts.push({ date: new Date().toISOString(), score: score, total: total });
    saveQuizzes();

    var ringColor = pct >= 70 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';
    var ring = $('#score-ring');
    ring.style.setProperty('--p', pct);
    ring.style.setProperty('--ring-color', ringColor);
    $('#score-num').textContent = score + '/' + total;
    $('#score-pct').textContent = pct + '%';
    $('#result-msg').textContent =
      pct === 100 ? '¡Perfecto!' :
      pct >= 70 ? '¡Excelente trabajo!' :
      pct >= 50 ? 'Bien, sigue practicando' : 'Necesitas repasar más';
    var unanswered = s.checked.filter(function (c) { return !c; }).length;
    $('#result-detail').textContent =
      score + ' de ' + total + ' correctas (' + pct + '%)' +
      (unanswered ? ' · ' + unanswered + ' sin responder' : '');

    var review = $('#review-list');
    review.innerHTML = '';
    quiz.questions.forEach(function (q, qi) {
      var ans = s.answers[qi];
      var checked = s.checked[qi];
      var revealed = s.revealed[qi];
      var ok = s.flags[qi];
      var badgeCls = checked ? (ok ? 'ok' : 'bad') : 'skip';
      var badgeTxt = checked ? (ok ? '✓' : '✗') : (revealed ? '?' : '–');
      var div = document.createElement('div');
      div.className = 'card review-item';
      var body = '';
      if (q.type === 'blanks') {
        var yours = q.blanks.map(function (b, bi) {
          var v = ans && ans[bi] ? String(ans[bi]).trim() : '(vacío)';
          var good = checked && QuizParser.normalizeAnswer(v) === QuizParser.normalizeAnswer(b);
          return '<b class="' + (good ? 'you-ok' : 'you-bad') + '">' + esc(v) + '</b>';
        }).join(' · ');
        body += 'Tus respuestas: ' + yours + '<br>';
        body += 'Correctas: <b class="right">' + q.blanks.map(esc).join(' · ') + '</b>';
      } else {
        var pickedLabels = [];
        if (ans && ans.size) {
          ans.forEach(function (oi) { pickedLabels.push(optionLabel(q, oi)); });
        }
        var corrLabels = [];
        q.options.forEach(function (op, oi) { if (op.correct) corrLabels.push(optionLabel(q, oi)); });
        if (pickedLabels.length) {
          var allGood = checked && ok;
          body += 'Elegiste: <b class="' + (allGood ? 'you-ok' : 'you-bad') + '">' + esc(pickedLabels.join(', ')) + '</b><br>';
        } else {
          body += 'No respondiste<br>';
        }
        body += 'Correctas: <b class="right">' + esc(corrLabels.join(', ')) + '</b>';
      }
      div.innerHTML =
        '<div class="review-head">' +
          '<span class="review-badge ' + badgeCls + '">' + badgeTxt + '</span>' +
          '<div class="review-q">' + (qi + 1) + '. ' + rich(q.text.split('\n')[0]) + '</div>' +
        '</div>' +
        '<div class="review-body">' + body + '</div>';
      review.appendChild(div);
    });

    showView('result');
  }

  function exitQuiz() {
    var ctx = currentSession();
    if (ctx && !ctx.s.checked.every(Boolean) && ctx.s.checked.some(function (c) { return c; })) {
      if (!confirm('¿Salir del cuestionario? Se perderá tu progreso actual.')) return;
    }
    state.session = null;
    renderHome();
    showView('home');
  }

  function buildAiMenu() {
    var menu = $('#ai-menu');
    menu.innerHTML = '';
    AI_LIST.forEach(function (ai) {
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.innerHTML =
        '<button data-url="' + ai.url + '" data-name="' + ai.name + '">' +
          '<span class="ai-dot" style="background:' + ai.color + '"></span>' +
          ai.name +
          '<span class="ai-ext">' + esc(ai.url.replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</span>' +
        '</button>';
      menu.appendChild(li);
    });
  }

  function toggleAiMenu(force) {
    var dd = $('#ai-dropdown');
    var menu = $('#ai-menu');
    var open = force !== undefined ? force : menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    dd.classList.toggle('open', open);
    $('#ai-toggle').setAttribute('aria-expanded', String(open));
  }

  async function copyPromptAndOpen(url, aiName) {
    try {
      await copyText(AI_PROMPT);
      toast('Texto copiado · Abriendo ' + aiName + '…');
      toggleAiMenu(false);
      setTimeout(function () { window.open(url, '_blank', 'noopener'); }, 450);
    } catch (e) {
      toast('No se pudo copiar automáticamente');
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.session = null;
        renderHome();
        showView(btn.dataset.nav);
      });
    });

    $('#btn-back').addEventListener('click', exitQuiz);

    $('#quiz-list').addEventListener('click', function (e) {
      var play = e.target.closest('[data-play]');
      if (play) { startQuiz(play.dataset.play); return; }
      var del = e.target.closest('[data-del]');
      if (del) deleteQuiz(del.dataset.del);
    });

    var dz = $('#dropzone');
    var fi = $('#file-input');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer.files && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
    });
    fi.addEventListener('change', function () { readFile(fi.files[0]); fi.value = ''; });

    $('#btn-parse').addEventListener('click', handleParse);
    $('#btn-clear-paste').addEventListener('click', function () {
      $('#paste-area').value = '';
      $('#preview-panel').classList.add('hidden');
      state.pendingQuiz = null;
    });
    $('#btn-save-quiz').addEventListener('click', function () { persistPending(false); });
    $('#btn-save-start').addEventListener('click', function () { persistPending(true); });

    $('#btn-copy-prompt').addEventListener('click', async function () {
      try {
        await copyText(AI_PROMPT);
        toast('¡Texto copiado!');
      } catch (e) {
        toast('No se pudo copiar automáticamente');
      }
    });

    $('#ai-toggle').addEventListener('click', function (e) { e.stopPropagation(); toggleAiMenu(); });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#ai-dropdown')) toggleAiMenu(false);
    });
    $('#ai-menu').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-url]');
      if (btn) copyPromptAndOpen(btn.dataset.url, btn.dataset.name);
    });

    $('#btn-check').addEventListener('click', checkCurrent);
    $('#btn-reveal').addEventListener('click', revealCurrent);
    $('#btn-next').addEventListener('click', goNext);
    $('#btn-prev').addEventListener('click', goPrev);

    $('#btn-retry').addEventListener('click', function () {
      if (state.session) startQuiz(state.session.quizId);
    });
    $('#btn-home').addEventListener('click', function () {
      state.session = null;
      renderHome();
      showView('home');
    });
  }

  loadQuizzes();
  buildAiMenu();
  bindEvents();
  renderHome();
  showView('home');
})();
