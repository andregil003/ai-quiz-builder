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

  var CFG_KEY = 'ai_quiz_builder_prompt_cfg_v1';

  var DIFF_TEXT = {
    facil: 'Nivel de dificultad FÁCIL: preguntas de memorización y reconocimiento directo de conceptos, definiciones y datos explícitos del material.',
    media: 'Nivel de dificultad MEDIA: preguntas de comprensión y aplicación de conceptos a situaciones sencillas.',
    dificil: 'Nivel de dificultad DIFÍCIL: preguntas de análisis y resolución de casos que exijan razonamiento; las opciones incorrectas deben ser muy similares entre sí.',
    mixta: 'Nivel de dificultad MIXTO: combina preguntas fáciles de reconocimiento, medias de aplicación y difíciles de análisis, en proporciones similares.'
  };

  var defaultCfg = {
    count: 20,
    types: { single: true, multiple: true, blanks: true },
    difficulty: 'media',
    explicaciones: true,
    notas: ''
  };

  function buildPrompt(cfg) {
    var L = [];
    L.push('Actúa como un creador experto de cuestionarios de estudio. Voy a darte material de estudio y debes generar un cuestionario devuelto EXCLUSIVAMENTE como JSON válido.');
    L.push('');
    L.push('TU RESPUESTA DEBE SER: únicamente el objeto JSON, empezando con { y terminando con }. Sin explicaciones envolventes, sin introducciones, sin despedidas, sin texto antes ni después.');
    L.push('');

    var examples = [];
    var exMulti = [
      '    {',
      '      "tipo": "opcion_multiple",',
      '      "enunciado": "Enunciado de la pregunta",',
      '      "opciones": [',
      '        { "texto": "Opción incorrecta", "correcta": false },',
      '        { "texto": "Opción correcta", "correcta": true },',
      '        { "texto": "Otra opción incorrecta", "correcta": false }',
      '      ]' + (cfg.explicaciones ? ',' : '')
    ];
    if (cfg.explicaciones) exMulti.push('      "explicacion": "Breve justificación de por qué la respuesta correcta lo es"');
    exMulti.push('    }');
    examples.push(exMulti.join('\n'));

    if (cfg.types.blanks) {
      var exBlanks = [
        '    {',
        '      "tipo": "completar",',
        '      "enunciado": "Complete los espacios en blanco:",',
        '      "frase": "Frase con la [palabra1] a completar y otra [palabra2].",',
        '      "respuestas": ["palabra1", "palabra2"]' + (cfg.explicaciones ? ',' : '')
      ];
      if (cfg.explicaciones) exBlanks.push('      "explicacion": "Breve justificación"');
      exBlanks.push('    }');
      examples.push(exBlanks.join('\n'));
    }

    L.push('ESQUEMA EXACTO (ejemplo de estructura):');
    L.push('');
    L.push('{');
    L.push('  "nombre": "Título del cuestionario",');
    L.push('  "preguntas": [');
    L.push(examples.join(',\n'));
    L.push('  ]');
    L.push('');
    L.push('REGLAS OBLIGATORIAS:');

    var n = 1;
    function rule(t) { L.push(n + '. ' + t); n++; }

    rule('Devuelve SOLO el objeto JSON válido. Nada más.');
    rule('"nombre": título corto del cuestionario.');
    rule('Todas las preguntas van dentro del arreglo "preguntas".');
    if (cfg.types.single || cfg.types.multiple) {
      rule('Tipo "opcion_multiple": campo "opciones" con entre 3 y 6 objetos {texto, correcta}. Usa comillas dobles en todas las claves y valores.');
    }
    if (cfg.types.single && cfg.types.multiple) {
      rule('Preguntas de una sola respuesta correcta: exactamente una opción con "correcta": true.');
      rule('Preguntas de varias respuestas correctas: dos o más opciones con "correcta": true.');
    } else if (cfg.types.single) {
      rule('Todas las preguntas de opción múltiple deben tener exactamente UNA opción con "correcta": true.');
    } else if (cfg.types.multiple) {
      rule('Todas las preguntas deben tener DOS o MÁS opciones con "correcta": true.');
    }
    if (cfg.types.blanks) {
      rule('Tipo "completar": la "frase" contiene las respuestas entre corchetes [así], y el arreglo "respuestas" lista cada respuesta en el MISMO orden, sin corchetes.');
    }

    var active = [];
    if (cfg.types.single) active.push('opción múltiple con 1 sola respuesta correcta');
    if (cfg.types.multiple) active.push('preguntas con 2 o más respuestas correctas');
    if (cfg.types.blanks) active.push('de completar espacios');
    if (active.length > 1) {
      rule('Mezcla los tipos: incluye ' + active.join(', ') + '.');
    } else {
      rule('TODAS las preguntas deben ser ' + active[0] + '.');
    }

    rule('Genera EXACTAMENTE ' + cfg.count + ' preguntas cubriendo el material de forma equilibrada.');
    rule(DIFF_TEXT[cfg.difficulty]);
    if (cfg.explicaciones) {
      rule('Cada pregunta debe incluir la clave "explicacion": texto breve (1 o 2 frases) que justifique por qué la respuesta correcta es correcta.');
    }
    rule('Los distractores deben ser plausibles y coherentes con el material.' + (cfg.difficulty === 'dificil' ? ' En este nivel deben ser muy similares entre sí.' : ''));
    rule('No agregues comentarios, ni claves fuera del esquema, ni bloques de código markdown.');

    if (cfg.notas && cfg.notas.trim()) {
      L.push('');
      L.push('INSTRUCCIONES ADICIONALES DEL USUARIO (cúmplelas obligatoriamente):');
      L.push(cfg.notas.trim());
    }

    L.push('');
    L.push('MATERIAL DE ESTUDIO:');
    L.push('[PEGA AQUÍ TU MATERIAL O ADJUNTA LOS ARCHIVOS]');
    return L.join('\n');
  }

  function loadCfg() {
    var cfg = JSON.parse(JSON.stringify(defaultCfg));
    try {
      var raw = localStorage.getItem(CFG_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && typeof saved === 'object') {
          if (Number.isFinite(saved.count)) cfg.count = Math.min(50, Math.max(5, Math.round(saved.count)));
          if (saved.types && typeof saved.types === 'object') {
            ['single', 'multiple', 'blanks'].forEach(function (k) {
              if (typeof saved.types[k] === 'boolean') cfg.types[k] = saved.types[k];
            });
          }
          if (DIFF_TEXT[saved.difficulty]) cfg.difficulty = saved.difficulty;
          if (typeof saved.explicaciones === 'boolean') cfg.explicaciones = saved.explicaciones;
          if (typeof saved.notas === 'string') cfg.notas = saved.notas;
        }
      }
    } catch (e) {}
    if (!cfg.types.single && !cfg.types.multiple && !cfg.types.blanks) cfg.types.single = true;
    return cfg;
  }

  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(state.cfg)); } catch (e) {}
  }

  var state = {
    quizzes: [],
    session: null,
    pendingQuiz: null,
    cfg: defaultCfg
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
    var parsed = QuizParser.detectAndParse(text);
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
      var segs = q.sentenceParts && q.sentenceParts.length ? q.sentenceParts : [''];
      var total = Math.max(segs.length - 1, q.blanks.length);
      for (var si = 0; si < total; si++) {
        html += rich(si < segs.length ? segs[si] : '');
        if (si < q.blanks.length) {
          html += '<input type="text" class="blank-input" data-blank="' + si + '" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Espacio ' + (si + 1) + '">';
        }
      }
      html += rich(total < segs.length ? segs[total] : '');
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
      if (q.explicacion) box.innerHTML += '<span class="fb-expl">' + rich(q.explicacion) + '</span>';
    } else if (revealed) {
      box.className = 'feedback reveal';
      if (q.type === 'blanks') {
        box.innerHTML = 'Respuesta revelada<small>Esta pregunta no suma puntos.</small>';
      } else {
        var labels = [];
        q.options.forEach(function (op, oi) { if (op.correct) labels.push(optionLabel(q, oi)); });
        box.innerHTML = 'Respuesta correcta: ' + labels.join(', ') + '<small>Esta pregunta no suma puntos.</small>';
      }
      if (q.explicacion) box.innerHTML += '<span class="fb-expl">' + rich(q.explicacion) + '</span>';
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
      if (q.explicacion) body += '<span class="review-expl">Explicación: ' + rich(q.explicacion) + '</span>';
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
      await copyText(buildPrompt(state.cfg));
      toast('Texto copiado · Abriendo ' + aiName + '…');
      toggleAiMenu(false);
      setTimeout(function () { window.open(url, '_blank', 'noopener'); }, 450);
    } catch (e) {
      toast('No se pudo copiar automáticamente');
    }
  }

  function applyCfgToControls() {
    $('#q-count').value = state.cfg.count;
    document.querySelectorAll('#type-chips .chip-toggle').forEach(function (ch) {
      ch.classList.toggle('active', !!state.cfg.types[ch.dataset.type]);
    });
    document.querySelectorAll('#difficulty-seg button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.diff === state.cfg.difficulty);
    });
    $('#explicaciones-toggle').checked = state.cfg.explicaciones;
    $('#extra-notes').value = state.cfg.notas;
  }

  function updatePromptPreview() {
    var el = $('#prompt-preview-text');
    if (el) el.textContent = buildPrompt(state.cfg);
  }

  function setCfgCount(v) {
    state.cfg.count = Math.min(50, Math.max(5, Math.round(Number(v) || 20)));
    $('#q-count').value = state.cfg.count;
    saveCfg();
    updatePromptPreview();
  }

  function bindCfgEvents() {
    $('#q-minus').addEventListener('click', function () { setCfgCount(state.cfg.count - 1); });
    $('#q-plus').addEventListener('click', function () { setCfgCount(state.cfg.count + 1); });
    $('#q-count').addEventListener('change', function () { setCfgCount(this.value); });

    document.querySelectorAll('#type-chips .chip-toggle').forEach(function (ch) {
      ch.addEventListener('click', function () {
        var t = ch.dataset.type;
        var willBeActive = !state.cfg.types[t];
        if (!willBeActive) {
          var anyOther = Object.keys(state.cfg.types).some(function (k) { return k !== t && state.cfg.types[k]; });
          if (!anyOther) { toast('Debe quedar al menos un tipo activo'); return; }
        }
        state.cfg.types[t] = willBeActive;
        ch.classList.toggle('active', willBeActive);
        saveCfg();
        updatePromptPreview();
      });
    });

    document.querySelectorAll('#difficulty-seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.cfg.difficulty = b.dataset.diff;
        document.querySelectorAll('#difficulty-seg button').forEach(function (x) {
          x.classList.toggle('active', x === b);
        });
        saveCfg();
        updatePromptPreview();
      });
    });

    $('#explicaciones-toggle').addEventListener('change', function () {
      state.cfg.explicaciones = this.checked;
      saveCfg();
      updatePromptPreview();
    });

    $('#extra-notes').addEventListener('input', function () {
      state.cfg.notas = this.value;
      saveCfg();
      updatePromptPreview();
    });
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
        await copyText(buildPrompt(state.cfg));
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
  state.cfg = loadCfg();
  applyCfgToControls();
  bindCfgEvents();
  updatePromptPreview();
  buildAiMenu();
  bindEvents();
  renderHome();
  showView('home');
})();
