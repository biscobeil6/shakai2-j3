'use strict';

const STORAGE_KEY = 'social.simpleProgress.v1';
const SETTINGS_KEY = 'social.simpleSettings.v1';
const TABLE_PROGRESS_KEY = 'social.historyKnowledgeProgress.v1';

const state = {
  data: [],
  bySubject: new Map(),
  progress: loadJSON(STORAGE_KEY, { results: {}, cycles: {} }),
  settings: loadJSON(SETTINGS_KEY, { sessionSize: 20 }),
  rewards: { interval: 10, images: [] },
  rewardDeck: [],
  lastRewardId: null,
  session: null,
  selectedSubject: null,
  selectedSubtag: null,
  issues: [],
  knowledgeTables: null,
  tableProgress: loadJSON(TABLE_PROGRESS_KEY, { results: {} }),
  tableSession: null
};

const main = document.getElementById('main');
const headerTitle = document.getElementById('headerTitle');
const headerSub = document.getElementById('headerSub');
document.getElementById('homeBtn').addEventListener('click', renderHome);
document.getElementById('statsBtn').addEventListener('click', renderStats);
document.getElementById('rewardContinue').addEventListener('click', closeRewardAndContinue);

init().catch(err => {
  console.error(err);
  state.issues.push(`起動エラー: ${err.message}`);
  renderHome();
});

async function init() {
  await Promise.all([loadQuestions(), loadRewards(), loadKnowledgeTables()]);
  renderHome();
}

async function loadQuestions() {
  const res = await fetch('social_questions.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`問題データを読み込めません（HTTP ${res.status}）`);
  const raw = await res.json();
  if (!raw || !Array.isArray(raw.questions)) throw new Error('questions配列がありません');

  const seen = new Set();
  for (const [index, q] of raw.questions.entries()) {
    const prefix = `${index + 1}番目`;
    if (!q || !q.id || !q.subject || !q.subtag || !q.question) {
      state.issues.push(`${prefix}: 必須項目不足`); continue;
    }
    if (seen.has(q.id)) { state.issues.push(`${prefix}: ID重複 ${q.id}`); continue; }
    seen.add(q.id);

    const isWritten = q.mode === 'written';
    let normalized;
    if (isWritten) {
      if (typeof q.answer !== 'string' || !q.answer.trim() || !q.learning_point) {
        state.issues.push(`${prefix}: 書答式の正答または学習ポイントが不正`); continue;
      }
      normalized = {
        ...q,
        alternatives: Array.isArray(q.alternatives) ? q.alternatives : [],
        answerText: q.answer
      };
    } else {
      if (!Array.isArray(q.choices) || q.choices.length < 2 || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
        state.issues.push(`${prefix}: 選択肢または正解番号が不正`); continue;
      }
      normalized = { ...q, mode: 'choice', answerText: q.choices[q.answer] };
    }

    state.data.push(normalized);
    if (!state.bySubject.has(q.subject)) state.bySubject.set(q.subject, new Map());
    const subMap = state.bySubject.get(q.subject);
    if (!subMap.has(q.subtag)) subMap.set(q.subtag, []);
    subMap.get(q.subtag).push(normalized);
  }
}


async function loadKnowledgeTables() {
  try {
    const res = await fetch('history_knowledge_tables.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.eras) || !data.problems) throw new Error('データ形式が不正です');
    state.knowledgeTables = data;
  } catch (e) {
    state.issues.push(`知識定着シート: ${e.message}`);
  }
}

async function loadRewards() {
  try {
    const res = await fetch('rewards.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.rewards.interval = Number.isInteger(data.interval) && data.interval > 0 ? data.interval : 10;
    state.rewards.images = Array.isArray(data.images) ? data.images.filter(x => x && x.id && x.file) : [];
  } catch (e) {
    state.issues.push(`rewards.json: ${e.message}`);
  }
}

function renderHome() {
  state.session = null;
  state.selectedSubject = null;
  state.selectedSubtag = null;
  state.tableSession = null;
  setHeader('中3社会 書答式', state.knowledgeTables ? '全1,206問＋歴史 知識定着シート' : '全1,206問・周回学習');
  main.innerHTML = `
    <section class="hero">
      <div class="settings-row">1回に解く問題数
        <div class="segmented" id="sizeSelector">
          ${[10,20,50].map(n => `<button data-size="${n}" class="${state.settings.sessionSize===n?'active':''}">${n}</button>`).join('')}
        </div>
      </div>
    </section>
    <section class="subject-group">
      <h2>分野を選んでください</h2>
      <div class="tile-grid">
        ${[...state.bySubject.entries()].map(([subject, subMap]) => `
          <article class="unit-tile" data-subject="${escapeAttr(subject)}">
            <h3>${escapeHTML(subject)}</h3>
            <p>${[...subMap.values()].reduce((a,b)=>a+b.length,0)}問</p>
            <p>${subMap.size}単元</p>
          </article>`).join('')}
      </div>
    </section>
    ${state.issues.length ? `<section class="panel"><h2>データ確認</h2>${state.issues.map(x=>`<div class="issue">${escapeHTML(x)}</div>`).join('')}</section>` : ''}
  `;
  document.querySelectorAll('#sizeSelector button').forEach(btn => btn.addEventListener('click', () => {
    state.settings.sessionSize = Number(btn.dataset.size);
    saveJSON(SETTINGS_KEY, state.settings);
    renderHome();
  }));
  document.querySelectorAll('[data-subject]').forEach(el => el.addEventListener('click', () => renderSubtags(el.dataset.subject)));
}

function renderSubtags(subject) {
  state.selectedSubject = subject;
  const subMap = state.bySubject.get(subject);
  setHeader(subject, '単元を選んでください');
  const allLabel = subject === '都道府県特訓' ? '全特訓' : '全単元';
  const knowledgeCard = subject === '歴史' && state.knowledgeTables ? `
      <article class="unit-tile knowledge-feature" id="knowledgeTableTile">
        <h3>知識定着シート</h3><p>${state.knowledgeTables.totalBlanks.toLocaleString()}空欄</p>
        <p>A/Bで抜く場所を変えて反復</p>
      </article>` : '';
  main.innerHTML = `<section class="subject-group">
    <div class="tile-grid">
      ${knowledgeCard}
      <article class="unit-tile featured" data-subtag="__ALL__">
        <h3>${allLabel}</h3><p>${scopeQuestions(subject, '__ALL__').length}問</p><p>すべて混ぜて出題</p>
      </article>
      ${[...subMap.entries()].map(([subtag, items]) => `
        <article class="unit-tile" data-subtag="${escapeAttr(subtag)}">
          <h3>${escapeHTML(subtag)}</h3><p>${items.length}問</p>
          <p>${cycleSummary(subject, subtag)}</p>
        </article>`).join('')}
    </div>
    <div class="button-row"><button class="secondary-btn" id="backHome">戻る</button></div>
  </section>`;
  document.querySelectorAll('[data-subtag]').forEach(el => el.addEventListener('click', () => renderModes(subject, el.dataset.subtag)));
  const knowledgeTile = document.getElementById('knowledgeTableTile');
  if (knowledgeTile) knowledgeTile.onclick = renderKnowledgeVariantSelect;
  document.getElementById('backHome').onclick = renderHome;
}

function renderModes(subject, subtag) {
  state.selectedSubject = subject;
  state.selectedSubtag = subtag;
  const label = scopeLabel(subject, subtag);
  const questions = scopeQuestions(subject, subtag);
  const wrong = questions.filter(q => state.progress.results[q.id]?.lastCorrect === false);
  const cycle = getCycle(subject, subtag);
  const done = cycle.doneIds.filter(id => questions.some(q => q.id === id)).length;
  setHeader(label, subject);
  main.innerHTML = `<section class="panel">
    <h2>学習モードを選んでください</h2>
    <div class="mode-grid">
      <button class="mode-card" id="cycleMode">
        <strong>周回モード</strong>
        <span>一周するまで同じ問題は出ません</span>
        <small>${done}/${questions.length}問 消化済み</small>
      </button>
      <button class="mode-card" id="wrongMode" ${wrong.length ? '' : 'disabled'}>
        <strong>間違い見直し</strong>
        <span>直近の回答が不正解の問題だけ</span>
        <small>${wrong.length}問</small>
      </button>
    </div>
    <div class="button-row">
      <button class="secondary-btn" id="backUnits">戻る</button>
      ${done > 0 ? '<button class="danger-outline-btn" id="resetCycle">この周回を最初から</button>' : ''}
    </div>
  </section>`;
  document.getElementById('cycleMode').onclick = () => startCycle(subject, subtag);
  document.getElementById('wrongMode').onclick = () => startWrongReview(subject, subtag);
  document.getElementById('backUnits').onclick = () => renderSubtags(subject);
  const reset = document.getElementById('resetCycle');
  if (reset) reset.onclick = () => {
    if (!confirm(`${label}の現在の周回記録を消して、最初から始めますか？`)) return;
    state.progress.cycles[scopeKey(subject, subtag)] = { doneIds: [], round: cycle.round || 1 };
    saveProgress();
    renderModes(subject, subtag);
  };
}

function startCycle(subject, subtag) {
  const questions = scopeQuestions(subject, subtag);
  const cycle = getCycle(subject, subtag);
  const validIds = new Set(questions.map(q => q.id));
  cycle.doneIds = cycle.doneIds.filter(id => validIds.has(id));
  let remaining = questions.filter(q => !cycle.doneIds.includes(q.id));
  if (!remaining.length) {
    const nextRound = (cycle.round || 1) + 1;
    if (!confirm(`1周完了しています。第${nextRound}周を始めますか？`)) return;
    cycle.doneIds = [];
    cycle.round = nextRound;
    remaining = [...questions];
  }
  saveProgress();
  beginSession(shuffle(remaining).slice(0, state.settings.sessionSize), {
    subject, subtag, mode: 'cycle', title: `${scopeLabel(subject, subtag)}・第${cycle.round || 1}周`
  });
}

function startWrongReview(subject, subtag) {
  const wrong = scopeQuestions(subject, subtag).filter(q => state.progress.results[q.id]?.lastCorrect === false);
  if (!wrong.length) { toast('見直す問題はありません'); return; }
  beginSession(shuffle(wrong).slice(0, state.settings.sessionSize), {
    subject, subtag, mode: 'wrong', title: `${scopeLabel(subject, subtag)}・間違い見直し`
  });
}

function beginSession(questions, meta) {
  if (!questions.length) { toast('出題できる問題がありません'); return; }
  state.rewardDeck = [];
  state.session = { questions, ...meta, index: 0, answered: 0, correct: 0, pendingNext: false, rewardPending: false, answerShown: false, pendingRating: null };
  strokes = [];
  renderQuestion();
}

function renderQuestion() {
  const s = state.session;
  if (!s || s.index >= s.questions.length) return renderResult();
  const q = s.questions[s.index];
  setHeader(s.title, `${s.index + 1}/${s.questions.length}`);
  if (q.mode === 'written') return renderWrittenQuestion(q);
  const order = shuffle(q.choices.map((text, originalIndex) => ({ text, originalIndex })));
  main.innerHTML = `<section class="panel">
    <div class="quiz-top">
      <div class="progress-track"><span style="width:${Math.round((s.index/s.questions.length)*100)}%"></span></div>
      <span class="muted">正解 ${s.correct}</span>
    </div>
    <div class="question">${escapeHTML(q.question)}</div>
    <div class="choice-list">
      ${order.map((c, i) => `<button class="choice-btn" data-index="${c.originalIndex}"><span class="choice-mark">${i+1}</span><span>${escapeHTML(c.text)}</span></button>`).join('')}
    </div>
    <div id="feedback" class="choice-feedback"></div>
    <div class="quiz-next-row">
      <button id="nextQuestionBtn" class="primary-btn quiz-next-btn hidden">次へ</button>
    </div>
  </section>`;
  document.querySelectorAll('.choice-btn').forEach(btn => btn.addEventListener('click', () => answerQuestion(q, Number(btn.dataset.index), btn)));
  document.getElementById('nextQuestionBtn').addEventListener('click', advanceAfterAnswer);
}

function renderWrittenQuestion(q) {
  const s = state.session;
  const alt = q.alternatives?.length ? `<div class="written-alt"><span>別解</span>${q.alternatives.map(escapeHTML).join(' ／ ')}</div>` : '';
  const metaParts = [q.answer_format, q.importance ? `重要度${q.importance}` : ''];
  if (q.subcategory) metaParts.push(q.subcategory);
  if (q.time_dependent === 'あり' && q.baseline_date) metaParts.push(`基準時点 ${q.baseline_date}`);
  const meta = metaParts.filter(Boolean).join(' ・ ');
  main.innerHTML = `<section class="panel written-panel ${s.answerShown ? 'answer-shown' : 'answer-hidden'}">
    <div class="quiz-top">
      <div class="progress-track"><span style="width:${Math.round((s.index/s.questions.length)*100)}%"></span></div>
      <span class="muted">○ ${s.correct}</span>
    </div>
    <div class="written-meta">${escapeHTML(meta)}</div>
    <div class="question written-question">${escapeHTML(q.question)}</div>
    ${s.answerShown ? `<div class="written-answer-block">
      <div class="written-answer-label">正答</div>
      <div class="written-answer">${escapeHTML(q.answerText)}</div>
      ${alt}
      <div class="learning-point"><span>学習ポイント</span>${escapeHTML(q.learning_point || '')}</div>
    </div>` : ''}
    <div class="hand-canvas-wrap">
      <canvas id="handCanvas" class="hand-canvas"></canvas>
      ${strokes.length ? '' : '<div class="canvas-hint">ここに手書きします</div>'}
    </div>
    <div class="canvas-actions">
      <button class="secondary-btn" id="undoStrokeBtn">一つ戻す</button>
      <button class="secondary-btn" id="clearCanvasBtn">全消去</button>
    </div>
    ${s.answerShown ? `<div class="written-ratings">
      <button data-rating="circle" class="judge-good ${s.pendingRating==='circle'?'selected':''}">○<small>できた</small></button>
      <button data-rating="triangle" class="judge-mid ${s.pendingRating==='triangle'?'selected':''}">△<small>迷った</small></button>
      <button data-rating="cross" class="judge-bad ${s.pendingRating==='cross'?'selected':''}">×<small>書けなかった</small></button>
    </div>
    <div class="quiz-next-row"><button id="writtenNextBtn" class="primary-btn quiz-next-btn" ${s.pendingRating?'':'disabled'}>${s.index >= s.questions.length - 1 ? '結果を見る' : '次へ'}</button></div>`
    : `<button id="showWrittenAnswerBtn" class="primary-btn written-answer-btn">答えを確認</button>`}
  </section>`;

  document.getElementById('undoStrokeBtn').onclick = undoStroke;
  document.getElementById('clearCanvasBtn').onclick = clearCanvas;
  if (!s.answerShown) {
    document.getElementById('showWrittenAnswerBtn').onclick = () => {
      s.answerShown = true;
      s.pendingRating = null;
      renderQuestion();
    };
  } else {
    document.querySelectorAll('[data-rating]').forEach(btn => btn.onclick = () => {
      s.pendingRating = btn.dataset.rating;
      renderQuestion();
    });
    document.getElementById('writtenNextBtn').onclick = commitWrittenAnswer;
  }
  setupHandCanvas();
}

function commitWrittenAnswer() {
  const s = state.session;
  if (!s || !s.pendingRating || s.pendingNext) return;
  const q = s.questions[s.index];
  s.pendingNext = true;
  const correct = s.pendingRating === 'circle';
  s.answered++;
  if (correct) s.correct++;

  const prev = state.progress.results[q.id] || { attempts: 0, correctCount: 0 };
  state.progress.results[q.id] = {
    attempts: prev.attempts + 1,
    correctCount: prev.correctCount + (correct ? 1 : 0),
    lastCorrect: correct,
    lastRating: s.pendingRating,
    lastAnsweredAt: new Date().toISOString()
  };
  if (s.mode === 'cycle') {
    const cycle = getCycle(s.subject, s.subtag);
    if (!cycle.doneIds.includes(q.id)) cycle.doneIds.push(q.id);
  }
  saveProgress();

  s.rewardPending = Boolean(
    s.answered % state.rewards.interval === 0 &&
    state.rewards.images.length
  );

  if (s.rewardPending) {
    s.rewardPending = false;
    showReward();
  } else {
    nextQuestion();
  }
}

let strokes = [], currentStroke = null, handCtx = null, handCanvas = null, activePointerId = null, lastPoint = null;

function setupHandCanvas() {
  handCanvas = document.getElementById('handCanvas');
  if (!handCanvas) return;
  const rect = handCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  handCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  handCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  handCtx = handCanvas.getContext('2d', { alpha: true, desynchronized: true });
  handCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawAllStrokes();

  // This input model mirrors the English app that is already stable on the
  // user's iPad.  iPad Safari can expose Apple Pencil through Pointer Events,
  // Touch Events, or both depending on gesture state, so we listen to both and
  // de-duplicate starts instead of disabling the touch path when PointerEvent
  // exists.
  let activeSource = null, touchId = null;
  let lastStart = { time: -Infinity, x: 0, y: 0, source: null };
  const pos = e => {
    const r = handCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 12;
  const eventPoint = e => ({ x: e.clientX, y: e.clientY });
  const configure = () => {
    handCtx.strokeStyle = '#1f2937';
    handCtx.fillStyle = '#1f2937';
    handCtx.lineWidth = 4;
    handCtx.lineCap = 'round';
    handCtx.lineJoin = 'round';
  };
  const segment = (a, b) => {
    configure();
    handCtx.beginPath();
    handCtx.moveTo(a.x, a.y);
    handCtx.lineTo(b.x, b.y);
    handCtx.stroke();
  };
  const dot = p => {
    configure();
    handCtx.beginPath();
    handCtx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    handCtx.fill();
  };
  const batch = e => typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents()?.length
    ? e.getCoalescedEvents() : [e];
  const append = e => {
    if (!currentStroke) return;
    for (const ev of batch(e)) {
      const p = pos(ev);
      if (!lastPoint) {
        currentStroke.push(p); lastPoint = p; dot(p); continue;
      }
      if (Math.abs(p.x - lastPoint.x) < .05 && Math.abs(p.y - lastPoint.y) < .05) continue;
      currentStroke.push(p); segment(lastPoint, p); lastPoint = p;
    }
  };
  const reset = () => { activePointerId = null; currentStroke = null; lastPoint = null; };
  const begin = e => {
    reset();
    activePointerId = e.pointerId;
    currentStroke = [];
    strokes.push(currentStroke);
    append(e);
    document.querySelector('.canvas-hint')?.remove();
  };
  const finish = e => {
    if (activePointerId === null || !currentStroke) return;
    if (e && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    if (e?.type === 'pointerup') append(e);
    reset();
  };
  const duplicate = (source, e) => {
    const now = performance.now(), p = eventPoint(e);
    const dup = source !== lastStart.source && now - lastStart.time < 120 && near(p, lastStart);
    if (!dup) lastStart = { time: now, x: p.x, y: p.y, source };
    return dup;
  };

  // Suppress Safari text selection / callouts that can steal Pencil strokes.
  handCanvas.oncontextmenu = e => e.preventDefault();
  for (const ev of ['selectstart', 'dragstart', 'gesturestart']) {
    handCanvas.addEventListener(ev, e => e.preventDefault(), { passive: false });
  }

  if ('PointerEvent' in window) {
    handCanvas.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (duplicate('pointer', e)) return;
      activeSource = 'pointer';
      begin(e);
    }, { passive: false });
    for (const ev of ['pointermove', 'pointerrawupdate']) {
      handCanvas.addEventListener(ev, e => {
        if (activeSource === 'touch') return;
        if ((activePointerId === null || !currentStroke) && e.pointerType === 'pen' && (e.pressure > 0 || e.buttons !== 0)) begin(e);
        if (e.pointerId !== activePointerId || !currentStroke) return;
        e.preventDefault();
        append(e);
      }, { passive: false });
    }
    for (const ev of ['pointerup', 'pointercancel']) {
      handCanvas.addEventListener(ev, e => {
        if (activeSource !== 'pointer') return;
        e.preventDefault();
        finish(e);
        activeSource = null;
      }, { passive: false });
    }
  }

  const findTouch = (list, id) => Array.from(list || []).find(t => t.identifier === id);
  handCanvas.addEventListener('touchstart', e => {
    const t = e.changedTouches?.[0];
    if (!t) return;
    e.preventDefault();
    const synthetic = {
      pointerId: `t-${t.identifier}`,
      pointerType: t.touchType === 'stylus' ? 'pen' : 'touch',
      pressure: t.force || 1,
      buttons: 1,
      clientX: t.clientX,
      clientY: t.clientY
    };
    if (duplicate('touch', synthetic)) return;
    activeSource = 'touch';
    touchId = t.identifier;
    begin(synthetic);
  }, { passive: false });
  handCanvas.addEventListener('touchmove', e => {
    if (activeSource !== 'touch' || touchId === null) return;
    const t = findTouch(e.changedTouches, touchId) || findTouch(e.touches, touchId);
    if (!t) return;
    e.preventDefault();
    append({ pointerId: `t-${touchId}`, clientX: t.clientX, clientY: t.clientY });
  }, { passive: false });
  for (const ev of ['touchend', 'touchcancel']) {
    handCanvas.addEventListener(ev, e => {
      if (activeSource !== 'touch') return;
      e.preventDefault();
      finish({ pointerId: `t-${touchId}` });
      touchId = null;
      activeSource = null;
    }, { passive: false });
  }
}

function drawAllStrokes() {
  if (!handCtx || !handCanvas) return;
  const r=handCanvas.getBoundingClientRect();
  handCtx.clearRect(0,0,r.width,r.height);
  handCtx.strokeStyle='#1f2937'; handCtx.fillStyle='#1f2937'; handCtx.lineWidth=4; handCtx.lineCap='round'; handCtx.lineJoin='round';
  for (const stroke of strokes) {
    if (!stroke.length) continue;
    if (stroke.length===1) { handCtx.beginPath(); handCtx.arc(stroke[0].x,stroke[0].y,2,0,Math.PI*2); handCtx.fill(); continue; }
    handCtx.beginPath(); handCtx.moveTo(stroke[0].x,stroke[0].y);
    for (const p of stroke.slice(1)) handCtx.lineTo(p.x,p.y);
    handCtx.stroke();
  }
}
function undoStroke() { strokes.pop(); drawAllStrokes(); }
function clearCanvas() {
  strokes=[]; drawAllStrokes();
  if (!document.querySelector('.canvas-hint')) {
    const hint=document.createElement('div'); hint.className='canvas-hint'; hint.textContent='ここに手書きします';
    document.querySelector('.hand-canvas-wrap')?.appendChild(hint);
  }
}

function answerQuestion(q, selectedIndex, selectedButton) {
  const s = state.session;
  if (s.pendingNext) return;
  s.pendingNext = true;
  const correct = selectedIndex === q.answer;
  s.answered++;
  if (correct) s.correct++;

  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    const idx = Number(btn.dataset.index);
    const mark = btn.querySelector('.choice-mark');
    if (idx === q.answer) {
      btn.classList.add('correct');
      mark.textContent = '○';
    } else if (btn === selectedButton) {
      btn.classList.add('incorrect');
      mark.textContent = '×';
    }
  });
  const feedback = document.getElementById('feedback');
  feedback.innerHTML = correct
    ? `<span class="feedback-ok">○ 正解！</span>`
    : `<span class="feedback-bad">× 不正解</span><span class="feedback-answer">正解：${escapeHTML(q.answerText)}</span>`;

  const prev = state.progress.results[q.id] || { attempts: 0, correctCount: 0 };
  state.progress.results[q.id] = {
    attempts: prev.attempts + 1,
    correctCount: prev.correctCount + (correct ? 1 : 0),
    lastCorrect: correct,
    lastAnsweredAt: new Date().toISOString()
  };
  if (s.mode === 'cycle') {
    const cycle = getCycle(s.subject, s.subtag);
    if (!cycle.doneIds.includes(q.id)) cycle.doneIds.push(q.id);
  }
  saveProgress();

  s.rewardPending = Boolean(
    s.answered % state.rewards.interval === 0 &&
    state.rewards.images.length
  );

  const nextButton = document.getElementById('nextQuestionBtn');
  nextButton.textContent = s.index >= s.questions.length - 1 ? '結果を見る' : '次へ';
  nextButton.classList.remove('hidden');
  nextButton.focus({ preventScroll: true });
}

function advanceAfterAnswer() {
  const s = state.session;
  if (!s || !s.pendingNext) return;
  const nextButton = document.getElementById('nextQuestionBtn');
  if (nextButton) nextButton.disabled = true;

  if (s.rewardPending) {
    s.rewardPending = false;
    showReward();
  } else {
    nextQuestion();
  }
}

function nextQuestion() {
  if (!state.session) return;
  state.session.index++;
  state.session.pendingNext = false;
  state.session.answerShown = false;
  state.session.pendingRating = null;
  strokes = [];
  renderQuestion();
}

function renderResult() {
  const s = state.session;
  if (!s) return renderHome();
  const wrongNow = scopeQuestions(s.subject, s.subtag).filter(q => state.progress.results[q.id]?.lastCorrect === false).length;
  const cycle = getCycle(s.subject, s.subtag);
  const total = scopeQuestions(s.subject, s.subtag).length;
  const done = cycle.doneIds.filter(id => scopeQuestions(s.subject, s.subtag).some(q => q.id === id)).length;
  setHeader('今回の結果', s.title);
  const writtenSession = s.questions.every(q => q.mode === 'written');
  main.innerHTML = `<section class="panel result-panel">
    <div class="result-score">${s.correct} / ${s.questions.length}</div>
    <p>${writtenSession ? '○（できた）率' : '正答率'} ${Math.round((s.correct/s.questions.length)*100)}%</p>
    ${s.mode === 'cycle' ? `<p>現在の周回：${done}/${total}問</p>` : `<p>残っている間違い：${wrongNow}問</p>`}
    <div class="button-row">
      <button class="primary-btn" id="continueMode">同じモードを続ける</button>
      <button class="secondary-btn" id="backModes">モード選択へ</button>
    </div>
  </section>`;
  document.getElementById('continueMode').onclick = () => s.mode === 'cycle' ? startCycle(s.subject, s.subtag) : startWrongReview(s.subject, s.subtag);
  document.getElementById('backModes').onclick = () => renderModes(s.subject, s.subtag);
}

function renderStats() {
  setHeader('成績', '端末内に保存されています');
  const answered = Object.values(state.progress.results);
  const attempts = answered.reduce((a,x)=>a+(x.attempts||0),0);
  const correct = answered.reduce((a,x)=>a+(x.correctCount||0),0);
  const wrong = Object.values(state.progress.results).filter(x=>x.lastCorrect===false).length;
  main.innerHTML = `<section class="stats-grid">
    <section class="panel">
      <h2>全体</h2>
      <p>自己採点回数：${attempts}</p>
      <p>○（できた）：${correct}</p>
      <p>現在の要復習（△・×）：${wrong}問</p>
      <p>通算○率：${attempts ? Math.round(correct/attempts*100) : 0}%</p>
    </section>
    ${state.knowledgeTables ? `<section class="panel">
      <h2>歴史・知識定着シート</h2>
      <p>自己採点済み：${Object.keys(state.tableProgress.results || {}).length}空欄</p>
      <p>現在の×：${Object.values(state.tableProgress.results || {}).filter(x=>x.lastRating==='cross').length}空欄</p>
    </section>` : ''}
    <section class="panel">
      <h2>成績リセット</h2>
      <p class="muted">回答履歴・間違い記録・周回状況をすべて消します。問題や画像は消えません。</p>
      <button class="danger-btn" id="resetAll">成績をリセット</button>
    </section>
  </section>`;
  document.getElementById('resetAll').onclick = () => {
    if (!confirm('成績と周回状況をすべて消します。よろしいですか？')) return;
    const word = prompt('確認のため「リセット」と入力してください');
    if (word !== 'リセット') { toast('リセットを中止しました'); return; }
    state.progress = { results: {}, cycles: {} };
    state.tableProgress = { results: {} };
    saveProgress();
    saveTableProgress();
    renderStats();
    toast('成績をリセットしました');
  };
}

function showReward() {
  const image = drawReward();
  if (!image) return nextQuestion();
  const modal = document.getElementById('rewardModal');
  const img = document.getElementById('rewardImage');
  const blur = document.getElementById('rewardBlur');
  img.src = image.file;
  blur.style.backgroundImage = `url("${image.file}")`;
  document.getElementById('rewardCaption').textContent = image.caption || 'よくできました！';
  modal.classList.remove('hidden');
}

function closeRewardAndContinue() {
  document.getElementById('rewardModal').classList.add('hidden');
  nextQuestion();
}

function drawReward() {
  const images = state.rewards.images;
  if (!images.length) return null;
  if (!state.rewardDeck.length) {
    state.rewardDeck = shuffle(images.map(x => x.id));
    if (state.lastRewardId && state.rewardDeck.length > 1 && state.rewardDeck[0] === state.lastRewardId) {
      [state.rewardDeck[0], state.rewardDeck[1]] = [state.rewardDeck[1], state.rewardDeck[0]];
    }
  }
  const id = state.rewardDeck.shift();
  state.lastRewardId = id;
  return images.find(x => x.id === id);
}



// ---------------------------------------------------------------------------
// History knowledge-table mode (v3.3)
// ---------------------------------------------------------------------------
function renderKnowledgeVariantSelect() {
  if (!state.knowledgeTables) { toast('知識定着シートを読み込めません'); return; }
  state.tableSession = null;
  setHeader('歴史・知識定着シート', 'A/Bで空欄位置を変えて反復');
  main.innerHTML = `<section class="panel knowledge-start">
    <h2>どちらの版で解きますか？</h2>
    <div class="mode-grid">
      <button class="mode-card knowledge-mode-a" data-table-variant="A">
        <strong>A版</strong><span>主に左列を空欄にします</span><small>${state.knowledgeTables.variantCounts.A}空欄</small>
      </button>
      <button class="mode-card knowledge-mode-b" data-table-variant="B">
        <strong>B版</strong><span>主に右列を空欄にします</span><small>${state.knowledgeTables.variantCounts.B}空欄</small>
      </button>
    </div>
    <div class="button-row"><button class="secondary-btn" id="backHistoryUnits">戻る</button></div>
  </section>`;
  document.querySelectorAll('[data-table-variant]').forEach(btn => btn.onclick = () => renderKnowledgeEraSelect(btn.dataset.tableVariant));
  document.getElementById('backHistoryUnits').onclick = () => renderSubtags('歴史');
}

function renderKnowledgeEraSelect(variant) {
  const data = state.knowledgeTables;
  setHeader(`知識定着シート ${variant}版`, '時代を選んでください');
  const eraCards = data.eras.map(era => {
    const count = knowledgeEraBlankIds(era, variant).length;
    const wrong = knowledgeEraBlankIds(era, variant).filter(id => state.tableProgress.results[id]?.lastRating === 'cross').length;
    return `<article class="unit-tile" data-knowledge-era="${escapeAttr(era.name)}">
      <h3>${escapeHTML(era.name)}</h3><p>${count}空欄</p><p>${wrong ? `× ${wrong}空欄` : `スライド ${escapeHTML(era.slides || '')}`}</p>
    </article>`;
  }).join('');
  main.innerHTML = `<section class="subject-group">
    <div class="tile-grid">${eraCards}</div>
    <div class="button-row"><button class="secondary-btn" id="backKnowledgeVariant">戻る</button></div>
  </section>`;
  document.querySelectorAll('[data-knowledge-era]').forEach(el => el.onclick = () => startKnowledgeEra(variant, el.dataset.knowledgeEra));
  document.getElementById('backKnowledgeVariant').onclick = renderKnowledgeVariantSelect;
}

function startKnowledgeEra(variant, eraName) {
  const era = state.knowledgeTables.eras.find(x => x.name === eraName);
  if (!era) return;
  state.tableSession = {
    variant, eraName, sectionIndex: 0, currentBlankId: null,
    revealed: {}, ratings: {}, retryIds: null, pendingRating: null, sectionComplete: false
  };
  strokes = [];
  openKnowledgeSection(0);
}

function openKnowledgeSection(index) {
  const s = state.tableSession;
  const era = state.knowledgeTables.eras.find(x => x.name === s?.eraName);
  if (!s || !era || !era.sections[index]) return;
  s.sectionIndex = index;
  s.revealed = {};
  s.ratings = {};
  s.retryIds = null;
  s.pendingRating = null;
  s.sectionComplete = false;
  const ids = knowledgeSectionBlankIds(era.sections[index], s.variant);
  s.currentBlankId = ids[0] || null;
  strokes = [];
  renderKnowledgeSection();
}

function renderKnowledgeSection() {
  const s = state.tableSession;
  const era = state.knowledgeTables.eras.find(x => x.name === s?.eraName);
  if (!s || !era) return renderKnowledgeVariantSelect();
  const section = era.sections[s.sectionIndex];
  const allIds = knowledgeSectionBlankIds(section, s.variant);
  const activeIds = s.retryIds || allIds;
  if (!s.currentBlankId || !activeIds.includes(s.currentBlankId)) s.currentBlankId = activeIds.find(id => !s.ratings[id]) || activeIds[0] || null;
  const numberMap = new Map(allIds.map((id, i) => [id, i + 1]));
  const current = s.currentBlankId ? state.knowledgeTables.problems[s.currentBlankId] : null;
  const currentNo = current ? numberMap.get(current.id) : null;
  const revealed = current ? Boolean(s.revealed[current.id]) : false;

  setHeader(`${era.name}・${s.variant}版`, section.title);
  main.innerHTML = `<section class="knowledge-shell">
    <div class="knowledge-toolbar">
      <div class="knowledge-section-tabs">
        ${era.sections.map((sec, i) => `<button data-knowledge-section="${i}" class="${i===s.sectionIndex?'active':''}">${escapeHTML(sec.id)}</button>`).join('')}
      </div>
      <div class="knowledge-count">${allIds.length}空欄</div>
    </div>
    <div class="knowledge-layout">
      <section class="knowledge-table-panel">
        <div class="knowledge-table-wrap">
          <table class="knowledge-table">
            <thead><tr><th>${escapeHTML(section.headers[0])}</th><th>${escapeHTML(section.headers[1])}</th></tr></thead>
            <tbody>${section.rows.map(row => renderKnowledgeRow(row, s.variant, numberMap, s)).join('')}</tbody>
          </table>
        </div>
      </section>
      <aside class="knowledge-answer-panel">
        ${current ? `<div class="knowledge-current"><span>${currentNo}</span> を回答中</div>
          ${current.constraint ? `<div class="knowledge-constraint">${escapeHTML(current.constraint)}</div>` : '<div class="knowledge-constraint muted">手書きで答えを書きます</div>'}
          <div class="hand-canvas-wrap knowledge-canvas-wrap">
            <canvas id="handCanvas" class="hand-canvas knowledge-canvas"></canvas>
            ${strokes.length ? '' : '<div class="canvas-hint">ここに手書きします</div>'}
          </div>
          <div class="canvas-actions">
            <button class="secondary-btn" id="undoStrokeBtn">一つ戻す</button>
            <button class="secondary-btn" id="clearCanvasBtn">全消去</button>
          </div>
          ${revealed ? `<div class="knowledge-answer-reveal">正答：<strong>${escapeHTML(current.answer)}</strong></div>
            <div class="written-ratings knowledge-ratings">
              <button data-table-rating="circle" class="judge-good ${s.pendingRating==='circle'?'selected':''}">○<small>できた</small></button>
              <button data-table-rating="triangle" class="judge-mid ${s.pendingRating==='triangle'?'selected':''}">△<small>迷った</small></button>
              <button data-table-rating="cross" class="judge-bad ${s.pendingRating==='cross'?'selected':''}">×<small>書けなかった</small></button>
            </div>
            <button id="knowledgeNextBlank" class="primary-btn knowledge-main-btn" ${s.pendingRating?'':'disabled'}>${isLastKnowledgePending(activeIds, s) ? 'この表の結果' : '次の空欄'}</button>`
          : '<button id="knowledgeShowAnswer" class="primary-btn knowledge-main-btn">答えを見る</button>'}`
        : '<div class="empty">この表には空欄がありません。</div>'}
        <div class="knowledge-side-nav">
          <button class="secondary-btn" id="backKnowledgeEras">時代選択へ</button>
        </div>
      </aside>
    </div>
  </section>`;

  document.querySelectorAll('[data-knowledge-section]').forEach(btn => btn.onclick = () => {
    const idx = Number(btn.dataset.knowledgeSection);
    if (idx !== s.sectionIndex) openKnowledgeSection(idx);
  });
  document.querySelectorAll('[data-knowledge-blank]').forEach(btn => btn.onclick = () => {
    const id = btn.dataset.knowledgeBlank;
    if (s.retryIds && !s.retryIds.includes(id)) return;
    s.currentBlankId = id; s.pendingRating = null; strokes = []; renderKnowledgeSection();
  });
  document.getElementById('backKnowledgeEras').onclick = () => renderKnowledgeEraSelect(s.variant);
  if (current) {
    document.getElementById('undoStrokeBtn').onclick = undoStroke;
    document.getElementById('clearCanvasBtn').onclick = clearCanvas;
    if (!revealed) document.getElementById('knowledgeShowAnswer').onclick = () => {
      s.revealed[current.id] = true; s.pendingRating = null; renderKnowledgeSection();
    };
    else {
      document.querySelectorAll('[data-table-rating]').forEach(btn => btn.onclick = () => {
        s.pendingRating = btn.dataset.tableRating; renderKnowledgeSection();
      });
      document.getElementById('knowledgeNextBlank').onclick = commitKnowledgeRating;
    }
    setupHandCanvas();
  }
}

function renderKnowledgeRow(row, variant, numberMap, s) {
  const v = row.variants[variant];
  return `<tr class="${row.distinguish?'knowledge-distinguish':''}">
    <td>${renderKnowledgeCell(v.left, numberMap, s)}</td>
    <td>${renderKnowledgeCell(v.right, numberMap, s)}</td>
  </tr>`;
}

function renderKnowledgeCell(cell, numberMap, s) {
  return cell.parts.map(part => {
    if (part.text !== undefined) return escapeHTML(part.text).replace(/\n/g,'<br>');
    const id = part.blank;
    const p = state.knowledgeTables.problems[id];
    const no = numberMap.get(id);
    const active = s.currentBlankId === id;
    const revealed = Boolean(s.revealed[id]);
    if (revealed) return `<button class="knowledge-blank revealed ${active?'active':''}" data-knowledge-blank="${id}"><span class="blank-no">${no}</span><span class="blank-answer">${escapeHTML(p.answer)}</span></button>`;
    return `<button class="knowledge-blank ${active?'active':''}" data-knowledge-blank="${id}"><span class="blank-no">${no}</span><span class="blank-space">（　　　　）</span></button>`;
  }).join('');
}

function commitKnowledgeRating() {
  const s = state.tableSession;
  const id = s?.currentBlankId;
  if (!s || !id || !s.pendingRating) return;
  const rating = s.pendingRating;
  s.ratings[id] = rating;
  const prev = state.tableProgress.results[id] || { attempts: 0, circleCount: 0 };
  state.tableProgress.results[id] = {
    attempts: (prev.attempts || 0) + 1,
    circleCount: (prev.circleCount || 0) + (rating === 'circle' ? 1 : 0),
    lastRating: rating,
    lastAnsweredAt: new Date().toISOString()
  };
  saveTableProgress();
  const era = state.knowledgeTables.eras.find(x => x.name === s.eraName);
  const section = era.sections[s.sectionIndex];
  const activeIds = s.retryIds || knowledgeSectionBlankIds(section, s.variant);
  const next = activeIds.find(x => !s.ratings[x]);
  if (next) {
    s.currentBlankId = next; s.pendingRating = null; strokes = []; renderKnowledgeSection();
  } else {
    renderKnowledgeSectionResult();
  }
}

function renderKnowledgeSectionResult() {
  const s = state.tableSession;
  const era = state.knowledgeTables.eras.find(x => x.name === s.eraName);
  const section = era.sections[s.sectionIndex];
  const ids = s.retryIds || knowledgeSectionBlankIds(section, s.variant);
  const counts = {circle:0, triangle:0, cross:0};
  ids.forEach(id => { const r=s.ratings[id]; if (r) counts[r]++; });
  const crossIds = ids.filter(id => s.ratings[id] === 'cross');
  setHeader(`${era.name}・${s.variant}版`, `${section.title} 結果`);
  main.innerHTML = `<section class="panel result-panel knowledge-result">
    <h2>${escapeHTML(section.title)}</h2>
    <div class="knowledge-result-grid">
      <div><strong>○</strong><span>${counts.circle}</span></div>
      <div><strong>△</strong><span>${counts.triangle}</span></div>
      <div><strong>×</strong><span>${counts.cross}</span></div>
    </div>
    <div class="button-row knowledge-result-actions">
      ${crossIds.length ? '<button class="primary-btn" id="retryKnowledgeCross">×だけもう一度</button>' : ''}
      ${s.sectionIndex < era.sections.length-1 ? '<button class="primary-btn" id="nextKnowledgeSection">次の表へ</button>' : ''}
      <button class="secondary-btn" id="restartKnowledgeSection">この表を最初から</button>
      <button class="secondary-btn" id="backKnowledgeEraList">時代選択へ</button>
    </div>
  </section>`;
  const retry = document.getElementById('retryKnowledgeCross');
  if (retry) retry.onclick = () => {
    s.retryIds = crossIds; s.ratings = {}; s.pendingRating = null; s.currentBlankId = crossIds[0];
    // Keep successful answers visible; hide only the cross targets for another attempt.
    crossIds.forEach(id => delete s.revealed[id]);
    strokes=[]; renderKnowledgeSection();
  };
  const next = document.getElementById('nextKnowledgeSection');
  if (next) next.onclick = () => openKnowledgeSection(s.sectionIndex + 1);
  document.getElementById('restartKnowledgeSection').onclick = () => openKnowledgeSection(s.sectionIndex);
  document.getElementById('backKnowledgeEraList').onclick = () => renderKnowledgeEraSelect(s.variant);
}

function knowledgeSectionBlankIds(section, variant) {
  const ids=[];
  section.rows.forEach(row => row.variants[variant].blankIds.forEach(id => ids.push(id)));
  return ids;
}
function knowledgeEraBlankIds(era, variant) { return era.sections.flatMap(sec => knowledgeSectionBlankIds(sec, variant)); }
function isLastKnowledgePending(activeIds, s) { return activeIds.filter(id => !s.ratings[id]).length <= 1; }
function saveTableProgress() { saveJSON(TABLE_PROGRESS_KEY, state.tableProgress); }

function scopeQuestions(subject, subtag) {
  const subMap = state.bySubject.get(subject);
  if (!subMap) return [];
  if (subtag === '__ALL__') return [...subMap.values()].flat();
  return subMap.get(subtag) || [];
}
function scopeKey(subject, subtag) { return `${subject}::${subtag}`; }
function getCycle(subject, subtag) {
  const key = scopeKey(subject, subtag);
  if (!state.progress.cycles[key]) state.progress.cycles[key] = { doneIds: [], round: 1 };
  return state.progress.cycles[key];
}
function cycleSummary(subject, subtag) {
  const total = scopeQuestions(subject, subtag).length;
  const done = getCycle(subject, subtag).doneIds.filter(id => scopeQuestions(subject, subtag).some(q=>q.id===id)).length;
  return `周回 ${done}/${total}問`;
}
function scopeLabel(subject, subtag) {
  if (subtag !== '__ALL__') return subtag;
  return subject === '都道府県特訓' ? '全特訓' : '全単元';
}
function saveProgress() { saveJSON(STORAGE_KEY, state.progress); }
function setHeader(title, sub) { headerTitle.textContent = title; headerSub.textContent = sub; }
function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = message; document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
function loadJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function saveJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function shuffle(arr) { const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function escapeHTML(v='') { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function escapeAttr(v='') { return escapeHTML(v); }
