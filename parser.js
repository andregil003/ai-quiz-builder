(function (global) {
  'use strict';

  var BULLET_RE = /^\s*[*•+-]\s+/;
  var LETTER_RE = /^([A-Za-z])\s*[.)]\s*/;
  var BLANK_ITEM_RE = /^\s*BLANK[-_ ]?(\d+)\s*[:\-]?\s*(.*)$/i;
  var CORRECT_RE = /\(\s*correcta/i;
  var HEADER_RE = /^[ \t]*#{2,4}[^\n]*pregunta\s*\d+/i;

  function cleanInline(s) {
    return String(s || '')
      .replace(/\r/g, '')
      .replace(/\*\*/g, '')
      .replace(/^\*+|\*+$/g, '')
      .replace(/`/g, '')
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

  function normalizeAnswer(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9ñ\s]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseOptionLine(raw) {
    var inner = raw.replace(BULLET_RE, '').trim();
    var correct = CORRECT_RE.test(inner);
    var fullBold = isFullBold(inner);
    var text = stripTrailingMarkers(inner).replace(/\*\*/g, '').trim();
    text = text.replace(/[.\s]+$/, '');
    var key = null;
    var m = text.match(LETTER_RE);
    if (m) {
      key = m[1].toUpperCase();
      text = text.slice(m[0].length).trim();
    }
    return { key: key, text: text, correct: correct || fullBold };
  }

  function parseBlanksSentence(raw) {
    var inner = raw.replace(BULLET_RE, '').trim();
    inner = inner.replace(/^\*?\*?\s*texto\s*:?\*?\*?\s*/i, '');
    var quoted = inner.match(/["\u201c]([\s\S]*)["\u201d]/);
    if (quoted) inner = quoted[1];
    var parts = [];
    var answers = [];
    var re = /\*\*\[([^\]]+)\]\*\*|\[([^\]]+)\]/g;
    var last = 0, m;
    while ((m = re.exec(inner)) !== null) {
      parts.push(inner.slice(last, m.index));
      answers.push(m[1] !== undefined ? m[1] : m[2]);
      last = m.index + m[0].length;
    }
    parts.push(inner.slice(last));
    parts = parts.map(function (p) { return p.replace(/\*\*/g, '').trim(); });
    return { parts: parts, answers: answers };
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
      if (BULLET_RE.test(chunks[j])) blocks.push(chunks[j].split('\n'));
    }
    return blocks;
  }

  function parseBlock(lines, index) {
    var paragraphs = [];
    var groups = [];
    var currentGroup = null;
    var paraBuffer = [];

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
      if (BULLET_RE.test(line)) {
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
        return LETTER_RE.test(t);
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

    var question = { type: 'single', text: qText || ('Pregunta ' + (index + 1)), context: '', options: [], blanks: [], sentenceParts: [] };

    if (blanksGroup) {
      question.type = 'blanks';
      var blankAnswers = [];
      var sentenceRaw = null;
      for (var b = 0; b < blanksGroup.length; b++) {
        var bm = blanksGroup[b].replace(BULLET_RE, '').match(BLANK_ITEM_RE);
        if (bm) {
          blankAnswers.push({ n: parseInt(bm[1], 10), answer: cleanInline(stripTrailingMarkers(bm[2])).replace(/[.\s]+$/, '') });
        } else if (/texto/i.test(blanksGroup[b]) || /\[[^\]]+\]/.test(blanksGroup[b])) {
          sentenceRaw = blanksGroup[b];
        }
      }
      blankAnswers.sort(function (x, y) { return x.n - y.n; });
      question.blanks = blankAnswers.map(function (x) { return x.answer; });
      if (sentenceRaw) {
        var parsed = parseBlanksSentence(sentenceRaw);
        question.sentenceParts = parsed.parts;
        if (parsed.answers.length >= question.blanks.length) question.blanks = parsed.answers;
      } else {
        question.sentenceParts = question.blanks.map(function (_, idx2) { return '{' + idx2 + '}'; });
        question.sentenceParts.unshift('');
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
    if (question.options.length < 2) {
      if (question.options.length === 1) question.options[0].correct = true;
      else return null;
    }

    var correctCount = question.options.filter(function (op) { return op.correct; }).length;
    if (correctCount === 0 && question.options.length === 1) question.options[0].correct = true;
    question.type = correctCount > 1 ? 'multiple' : 'single';
    return question;
  }

  function parseQuiz(raw) {
    var warnings = [];
    var text = String(raw || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
    var name = '';
    var nameMatch = text.match(/nombre\s+del\s+cuestionario\s*[:\-–]\s*(.+)/i);
    if (nameMatch) name = cleanInline(nameMatch[1]);

    var blocks = splitBlocks(text);
    var questions = [];

    for (var i = 0; i < blocks.length; i++) {
      var q = parseBlock(blocks[i], questions.length);
      if (!q) continue;
      if (q.type !== 'blanks') {
        var cc = q.options.filter(function (op) { return op.correct; }).length;
        if (cc === 0) warnings.push('Pregunta ' + (questions.length + 1) + ': sin respuesta marcada como correcta.');
      } else if (!q.sentenceParts.length) {
        warnings.push('Pregunta ' + (questions.length + 1) + ': texto de completar espacios no detectado.');
      }
      questions.push(q);
    }

    if (!name) name = 'Cuestionario sin título';
    if (!questions.length) warnings.push('No se detectaron preguntas. Verifica el formato.');

    return { name: name, questions: questions, warnings: warnings };
  }

  global.QuizParser = {
    parseQuiz: parseQuiz,
    normalizeAnswer: normalizeAnswer,
    cleanInline: cleanInline
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.QuizParser;
})(typeof window !== 'undefined' ? window : globalThis);
