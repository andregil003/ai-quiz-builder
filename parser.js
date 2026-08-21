(function (global) {
  'use strict';

  var BULLET_RE = /^\s*[*•+-]\s+/;
  var ITEM_LETTER_RE = /^\s*[A-Za-z]\s*[.)]\s+\S/;
  var TEXTO_LABEL_RE = /^\s*\*{0,2}\s*texto\s*:{0,2}/i;
  var BLANK_ITEM_RE = /^\s*BLANK[-_ ]?(\d+)\s*[:\-]?\s*(.*)$/i;
  var CORRECT_RE = /\(\s*correcta/i;
  var HEADER_RE = /^[ \t]*(?:#{1,4}\s*)?(?:\*\*)?\s*Pregunta\s*\d+(?:\*\*)?\s*:?\s*$/i;
  var EXPL_LABEL_RE = /^\s*\*{0,2}\s*explicaci[oó]n\s*\*{0,2}\s*:/i;

  function pickExpl(obj) {
    var e = '';
    if (obj && typeof obj === 'object') {
      if (obj.explicacion != null) e = obj.explicacion;
      else if (obj['explicación'] != null) e = obj['explicación'];
      else if (obj.explanation != null) e = obj.explanation;
      else if (obj.justificacion != null) e = obj.justificacion;
    }
    return cleanInline(e);
  }

  function cleanInline(s) {
    return String(s == null ? '' : s)
      .replace(/\r/g, '')
      .replace(/\*\*/g, '')
      .replace(/^\*+|\*+$/g, '')
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeAnswer(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripTrailingMarkers(s) {
    var out = s;
    while (true) {
      var next = out.replace(/\s*\*\([^)]*\)\*\s*$/i, '').trim();
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function isFullBold(s) {
    var core = stripTrailingMarkers(s.trim());
    core = core.replace(/[.\s]+$/, '');
    return /^\*\*[\s\S]+\*\*$/.test(core);
  }

  function parseOptionLine(raw) {
    var inner = raw.replace(BULLET_RE, '').trim();
    var correct = CORRECT_RE.test(inner);
    var fullBold = isFullBold(inner);
    var text = stripTrailingMarkers(inner).replace(/\*\*/g, '').trim();
    text = text.replace(/\s*\(\s*correcta[^)]*\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
    text = text.replace(/[.\s]+$/, '');
    var key = null;
    var m = text.match(/^([A-Za-z])\s*[.)]\s*/);
    if (m) {
      key = m[1].toUpperCase();
      text = text.slice(m[0].length).trim();
    }
    return { key: key, text: text, correct: correct || fullBold };
  }

  function tokenizeBlanks(frase) {
    var parts = [];
    var answers = [];
    var re = /\*\*\[([^\]]+)\]\*\*|\[([^\]]+)\]/g;
    var last = 0;
    var m;
    while ((m = re.exec(frase)) !== null) {
      parts.push(frase.slice(last, m.index));
      answers.push(String(m[1] !== undefined ? m[1] : m[2]).trim());
      last = m.index + m[0].length;
    }
    parts.push(frase.slice(last));
    return { parts: parts.map(function (p) { return p.replace(/\*\*/g, '').trim(); }), answers: answers };
  }

  function parseBlanksSentence(raw) {
    var inner = raw.replace(BULLET_RE, '').trim();
    inner = inner.replace(/^\*{0,2}\s*texto\s*:\s*\*{0,2}\s*/i, '');
    var quoted = inner.match(/["\u201c]([\s\S]*)["\u201d]/);
    if (quoted) inner = quoted[1];
    return tokenizeBlanks(inner);
  }

  function isItemLine(line) {
    if (BULLET_RE.test(line)) return true;
    var t = line.replace(BULLET_RE, '');
    return ITEM_LETTER_RE.test(t) || BLANK_ITEM_RE.test(t) || TEXTO_LABEL_RE.test(t);
  }

  function splitBlocks(text) {
    var lines = text.split('\n');
    var blocks = [];
    var current = null;
    for (var i = 0; i < lines.length; i++) {
      if (HEADER_RE.test(lines[i])) {
        if (current) blocks.push(current);
        current = [];
      } else if (current) {
        current.push(lines[i]);
      }
    }
    if (current) blocks.push(current);
    if (blocks.length) return blocks;

    var chunks = text.split(/^\s*-{3,}\s*$/m);
    for (var j = 0; j < chunks.length; j++) {
      if (isItemLine(chunks[j])) blocks.push(chunks[j].split('\n'));
    }
    return blocks;
  }

  function looksLikeTemplate(q) {
    if (/enunciado de la pregunta/i.test(q.text)) return true;
    if (q.options && q.options.length >= 3) {
      var tmpl = q.options.filter(function (o) {
        return /^(opción|opcion|respuesta)\s+(incorrecta|correcta)$/i.test(o.text);
      }).length;
      if (tmpl >= Math.ceil(q.options.length * 0.6)) return true;
    }
    return false;
  }

  function parseBlock(lines, index) {
    var paragraphs = [];
    var groups = [];
    var currentGroup = null;
    var paraBuffer = [];
    var explLines = [];

    function flushPara() {
      if (paraBuffer.length) {
        paragraphs.push(paraBuffer.join(' ').trim());
        paraBuffer = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim()) { flushPara(); continue; }
      if (/^\s*-{3,}\s*$/.test(line)) { flushPara(); continue; }
      if (EXPL_LABEL_RE.test(line)) {
        flushPara();
        currentGroup = null;
        explLines.push(line.replace(/^[^:]*:\s*/, '').replace(/\*\*/g, '').trim());
        continue;
      }
      if (isItemLine(line)) {
        flushPara();
        if (!currentGroup) { currentGroup = []; groups.push(currentGroup); }
        currentGroup.push(line);
      } else {
        currentGroup = null;
        paraBuffer.push(line.trim());
      }
    }
    flushPara();

    if (!groups.length && !paragraphs.length) return null;

    var blanksGroup = null;
    var letteredGroups = [];
    for (var g = 0; g < groups.length; g++) {
      var grp = groups[g];
      var hasBlank = grp.some(function (l) { return BLANK_ITEM_RE.test(l.replace(BULLET_RE, '')); });
      if (hasBlank && !blanksGroup) blanksGroup = grp;
      var lettered = grp.filter(function (l) {
        var t = l.replace(BULLET_RE, '').replace(/\*\*/g, '').trim();
        return /^[A-Za-z]\s*[.)]\s*/.test(t);
      }).length;
      if (grp.length >= 2 && lettered >= Math.ceil(grp.length * 0.6)) letteredGroups.push(grp);
    }

    var contextLines = [];
    var optionsGroup = null;
    if (letteredGroups.length) {
      optionsGroup = letteredGroups[letteredGroups.length - 1];
    } else if (!blanksGroup && groups.length) {
      optionsGroup = groups[groups.length - 1];
    }
    for (var c = 0; c < groups.length; c++) {
      if (groups[c] !== optionsGroup && groups[c] !== blanksGroup) {
        for (var k = 0; k < groups[c].length; k++) contextLines.push(cleanInline(groups[c][k]));
      }
    }

    var qText = paragraphs.join('\n').trim();
    if (contextLines.length) qText += (qText ? '\n' : '') + contextLines.join('\n');

    if (!qText && !optionsGroup && !blanksGroup) return null;

    var question = { type: 'single', text: qText || ('Pregunta ' + (index + 1)), options: [], blanks: [], sentenceParts: [] };
    if (explLines.length) question.explicacion = cleanInline(explLines.join(' '));

    if (blanksGroup) {
      question.type = 'blanks';
      var blankAnswers = [];
      var sentenceRaw = null;
      for (var b = 0; b < blanksGroup.length; b++) {
        var stripped = blanksGroup[b].replace(BULLET_RE, '');
        var bm = stripped.match(BLANK_ITEM_RE);
        if (bm) {
          blankAnswers.push({ n: parseInt(bm[1], 10), answer: cleanInline(stripTrailingMarkers(bm[2])).replace(/[.\s]+$/, '') });
        } else if (TEXTO_LABEL_RE.test(stripped) || /\[[^\]]+\]/.test(stripped)) {
          sentenceRaw = stripped;
        }
      }
      blankAnswers.sort(function (x, y) { return x.n - y.n; });
      question.blanks = blankAnswers.map(function (x) { return x.answer; }).filter(Boolean);
      if (sentenceRaw) {
        var parsed = parseBlanksSentence(sentenceRaw);
        question.sentenceParts = parsed.parts;
        if (parsed.answers.length > question.blanks.length) question.blanks = parsed.answers;
      }
      if (!question.blanks.length) return null;
      return question;
    }

    if (!optionsGroup || !optionsGroup.length) return null;

    for (var o = 0; o < optionsGroup.length; o++) {
      var opt = parseOptionLine(optionsGroup[o]);
      if (!opt.text) continue;
      question.options.push(opt);
    }
    if (!question.options.length) return null;
    if (question.options.length === 1) question.options[0].correct = true;

    var correctCount = question.options.filter(function (op) { return op.correct; }).length;
    question.type = correctCount > 1 ? 'multiple' : 'single';
    return question;
  }

  function sliceToLastQuizName(text) {
    var re = /^\s*Nombre del cuestionario\s*[:\-–]/gim;
    var lastIdx = -1;
    var m;
    while ((m = re.exec(text)) !== null) lastIdx = m.index;
    return lastIdx > -1 ? text.slice(lastIdx) : text;
  }

  function parseQuiz(rawInput) {
    var warnings = [];
    var text = String(rawInput || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    text = sliceToLastQuizName(text);

    var name = '';
    var nameMatch = text.match(/nombre\s+del\s+cuestionario\s*[:\-–]\s*(.+)/i);
    if (nameMatch) {
      name = cleanInline(nameMatch[1]);
      if (/^t[íi]tulo del cuestionario$/i.test(name)) name = '';
    }

    var blocks = splitBlocks(text);
    var questions = [];

    for (var i = 0; i < blocks.length; i++) {
      var q = parseBlock(blocks[i], questions.length);
      if (!q) continue;
      if (looksLikeTemplate(q)) continue;
      if (q.type !== 'blanks') {
        var cc = q.options.filter(function (op) { return op.correct; }).length;
        if (cc === 0) warnings.push('Pregunta ' + (questions.length + 1) + ': sin respuesta marcada como correcta.');
      }
      questions.push(q);
    }

    if (!name) name = 'Cuestionario sin título';
    if (!questions.length) warnings.push('No se detectaron preguntas. Verifica el formato.');

    return { name: name, questions: questions, warnings: warnings };
  }

  function extractJson(raw) {
    var text = String(raw || '').trim();
    var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1].trim()) text = fence[1].trim();
    var attempts = [];
    var s = text.indexOf('{');
    var e = text.lastIndexOf('}');
    if (s !== -1 && e > s) attempts.push(text.slice(s, e + 1));
    s = text.indexOf('[');
    e = text.lastIndexOf(']');
    if (s !== -1 && e > s) attempts.push(text.slice(s, e + 1));
    for (var i = 0; i < attempts.length; i++) {
      try { return JSON.parse(attempts[i]); } catch (err) { /* next */ }
    }
    return null;
  }

  function parseJsonQuiz(raw) {
    var data = extractJson(raw);
    if (!data || typeof data !== 'object') return null;
    var arr = Array.isArray(data) ? data : (Array.isArray(data.preguntas) ? data.preguntas : null);
    if (!arr) return null;

    var warnings = [];
    var questions = [];

    arr.forEach(function (it, idx) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) {
        warnings.push('Ítem ' + (idx + 1) + ': formato inválido, se omitió.');
        return;
      }
      var enun = cleanInline(it.enunciado != null ? it.enunciado : (it.pregunta != null ? it.pregunta : (it.texto != null ? it.texto : '')));
      var tipo = String(it.tipo == null ? '' : it.tipo).toLowerCase();
      var resp = it.respuestas || it.blanks || it.espacios;
      var frase = it.frase != null ? it.frase : (it.oracion != null ? it.oracion : '');
      var isBlanks = tipo.indexOf('complet') !== -1 || tipo === 'blanks' || tipo === 'blank' || ((!tipo || tipo === 'completar') && (resp || frase));

      if (isBlanks) {
        var tok = tokenizeBlanks(String(frase).replace(/\*\*/g, ''));
        var answers = Array.isArray(resp) ? resp.map(function (x) { return cleanInline(x); }).filter(Boolean) : [];
        if (!answers.length) answers = tok.answers.slice();
        else if (tok.answers.length > answers.length) answers = tok.answers;
        if (!answers.length) {
          warnings.push('Pregunta ' + (questions.length + 1) + ': completar espacios sin respuestas, se omitió.');
          return;
        }
        var jq = {
          type: 'blanks',
          text: enun,
          options: [],
          blanks: answers,
          sentenceParts: tok.parts.length > 1 ? tok.parts : []
        };
        var jex1 = pickExpl(it);
        if (jex1) jq.explicacion = jex1;
        questions.push(jq);
        return;
      }

      var optsIn = it.opciones || it.alternativas;
      if (!Array.isArray(optsIn) || optsIn.length < 2) {
        warnings.push('Pregunta ' + (questions.length + 1) + ': opciones insuficientes, se omitió.');
        return;
      }
      var opts = [];
      optsIn.forEach(function (o) {
        var t = (o && typeof o === 'object') ? cleanInline(o.texto != null ? o.texto : (o.text != null ? o.text : '')) : cleanInline(o);
        var c = (o && typeof o === 'object') ? (o.correcta === true || o.correct === true || o.es_correcta === true) : false;
        if (t) opts.push({ key: null, text: t, correct: c });
      });
      if (opts.length < 2) {
        warnings.push('Pregunta ' + (questions.length + 1) + ': opciones vacías, se omitió.');
        return;
      }
      var cc = opts.filter(function (o) { return o.correct; }).length;
      if (cc === 0) {
        warnings.push('Pregunta ' + (questions.length + 1) + ': sin respuesta correcta marcada.');
      }
      var jq2 = { type: cc > 1 ? 'multiple' : 'single', text: enun || ('Pregunta ' + (questions.length + 1)), options: opts, blanks: [], sentenceParts: [] };
      var jex2 = pickExpl(it);
      if (jex2) jq2.explicacion = jex2;
      questions.push(jq2);
    });

    var name = cleanInline(data.nombre || data.titulo || data.title || '') || 'Cuestionario sin título';
    var category = cleanInline(data.categoria || data.categoría || data.category || '');
    if (!questions.length) warnings.push('El JSON no contenía preguntas válidas.');
    return { name: name, category: category, questions: questions, warnings: warnings };
  }

  function detectAndParse(raw) {
    var j = parseJsonQuiz(raw);
    if (j && j.questions.length) return j;
    return parseQuiz(raw);
  }

  function splitFrase(str) {
    var s = String(str || '');
    var parts = [];
    var blanks = [];
    var re = /\[([^\[\]]+)\]/g;
    var last = 0, m;
    while ((m = re.exec(s)) !== null) {
      parts.push(s.slice(last, m.index));
      blanks.push(m[1].trim());
      last = m.index + m[0].length;
    }
    parts.push(s.slice(last));
    return { parts: parts, blanks: blanks };
  }

  function joinFrase(parts, blanks) {
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      out += parts[i];
      if (i < parts.length - 1 && i < blanks.length) out += '[' + blanks[i] + ']';
    }
    return out;
  }

  global.QuizParser = {
    parseQuiz: parseQuiz,
    parseJsonQuiz: parseJsonQuiz,
    detectAndParse: detectAndParse,
    normalizeAnswer: normalizeAnswer,
    cleanInline: cleanInline,
    splitFrase: splitFrase,
    joinFrase: joinFrase
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.QuizParser;
})(typeof window !== 'undefined' ? window : globalThis);
