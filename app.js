"use strict";

// ---- Config ----
const GRID_SIZE = 4;
const DEFAULT_DURATION = 60; // seconds, default 1 minute
const MIN_WORD_LEN = 3;
const WORDLIST_URL = "https://cdn.jsdelivr.net/gh/dolph/dictionary@master/enable1.txt";
const BEST_SCORE_KEY = "wordscramble.bestScore";
const HIGH_SCORE_KEY = "wordscramble.highScores";
const PLAYER_NAME_KEY = "wordscramble.playerName";
const PLAYER_ID_KEY = "wordscramble.playerId";
const MAX_HIGH_SCORES = 5;

// ---- Shared leaderboard (JSONBin.io) ----
// SECURITY NOTE: this Master Key is embedded in client-side code and is visible to anyone
// who views the page source, so anyone could read/write/delete the shared bin with it.
// This is an accepted trade-off for a casual, low-stakes leaderboard (no abuse protection).
// Fill these in with your own JSONBin.io Bin ID / Master Key to enable sharing; leave blank
// to keep high scores purely local (per-browser), which is the default fallback behavior.
const LEADERBOARD_BIN_ID = "6a957da5da38895dfe265228";
const LEADERBOARD_API_KEY = "$2a$10$g4ewkrAVKyDzOtKx49ByterOVT1/4OSyUJ.CtIg2m.9vdim5yt0CO";
const LEADERBOARD_URL = `https://api.jsonbin.io/v3/b/${LEADERBOARD_BIN_ID}`;

function sharedLeaderboardEnabled() {
  return Boolean(LEADERBOARD_BIN_ID && LEADERBOARD_API_KEY);
}


// Classic "New Boggle" 16-cube letter distribution.
// 'Q' faces are treated as a combined "Qu" tile.
const DICE = [
  "AAEEGN", "ABBJOO", "ACHOPS", "AFFKPS",
  "AOOTTW", "CIMOTU", "DEILRX", "DELRVY",
  "DISTTY", "EEGHNW", "EEINSU", "EHRTVW",
  "EIOSST", "ELRTTY", "HIMNQU", "HLNNRZ",
];

// Standard Scrabble letter point values. The combined "Qu" tile is fixed at 11 (Q=10 + U=1).
const LETTER_POINTS = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1,
  P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

function tilePoints(tile) {
  if (tile.value === "QU") return 11;
  return LETTER_POINTS[tile.value] || 0;
}

// Score color thresholds per game duration (seconds): yellow < orange < rainbow.
const SCORE_COLOR_THRESHOLDS = {
  60: { yellow: 80, orange: 90, rainbow: 100 },
  120: { yellow: 100, orange: 150, rainbow: 200 },
  180: { yellow: 200, orange: 250, rainbow: 300 },
};

function applyScoreColor(el, scoreValue, duration) {
  const th = SCORE_COLOR_THRESHOLDS[duration] || SCORE_COLOR_THRESHOLDS[60];
  el.classList.remove("score-yellow", "score-orange", "score-rainbow");
  if (scoreValue >= th.rainbow) el.classList.add("score-rainbow");
  else if (scoreValue >= th.orange) el.classList.add("score-orange");
  else if (scoreValue >= th.yellow) el.classList.add("score-yellow");
}

// Word score = sum of tile points + length bonus (0 for 3-letter words, N-3 for longer words).
function wordScore(selectedPath, word) {
  const tileSum = selectedPath.reduce((sum, idx) => sum + tilePoints(board[idx]), 0);
  const bonus = Math.max(0, word.length - 3);
  return tileSum + bonus;
}

// ---- DOM refs ----
const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const timerEl = document.getElementById("timer");
const bestEl = document.getElementById("best");
const currentWordEl = document.getElementById("current-word");
const foundListEl = document.getElementById("found-list");
const foundCountEl = document.getElementById("found-count");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");
const gameoverOverlay = document.getElementById("gameover-overlay");
const finalScoreEl = document.getElementById("final-score");
const finalFoundCountEl = document.getElementById("final-found-count");
const totalWordCountEl = document.getElementById("total-word-count");
const solvingTextEl = document.getElementById("solving-text");
const missedWordsEl = document.getElementById("missed-words");
const missedListEl = document.getElementById("missed-list");
const lengthBreakdownEl = document.getElementById("length-breakdown");
const playerNameInput = document.getElementById("player-name");
const retireBtn = document.getElementById("retire-btn");
const highScoreList60El = document.getElementById("high-score-list-60");
const highScoreList120El = document.getElementById("high-score-list-120");
const highScoreList180El = document.getElementById("high-score-list-180");
const highScoreLabel60El = document.getElementById("high-score-label-60");
const highScoreLabel120El = document.getElementById("high-score-label-120");
const highScoreLabel180El = document.getElementById("high-score-label-180");
const hudLabelScoreEl = document.getElementById("hud-label-score");
const hudLabelTimeEl = document.getElementById("hud-label-time");
const hudLabelBestEl = document.getElementById("hud-label-best");
const foundHeadingTextEl = document.getElementById("found-heading-text");
const playerNameLabelEl = document.getElementById("player-name-label");
const durationLabel60El = document.getElementById("duration-label-60");
const durationLabel120El = document.getElementById("duration-label-120");
const durationLabel180El = document.getElementById("duration-label-180");
const scoringInfoEl = document.getElementById("scoring-info");
const gameoverHeadingEl = document.getElementById("gameover-heading");
const foundSummaryPrefixEl = document.getElementById("found-summary-prefix");
const missedHeadingEl = document.getElementById("missed-heading");
const highScoreHeadingEl = document.getElementById("high-score-heading");
const finalScoreLabelTextEl = document.getElementById("final-score-label-text");
const howToPlayHeadingEl = document.getElementById("how-to-play-heading");
const howToPlayListEl = document.getElementById("how-to-play-list");

// ---- i18n ----
const LANG_KEY = "wordscramble.lang";
const I18N = {
  ja: {
    hudScore: "SCORE", hudTime: "TIME", hudBest: "BEST",
    boardAria: "文字盤",
    foundHeading: "見つけた単語",
    playerNameLabel: "プレイヤー名",
    playerNamePlaceholder: "名無し",
    durationAria: "制限時間",
    duration60: "1分", duration120: "2分", duration180: "3分",
    scoringInfo: "得点 = タイル点数の合計 ＋ 文字数ボーナス（3文字:+0 / 4文字以上:+(文字数-3)）",
    startBtn: "スタート",
    retireBtn: "リタイヤ",
    loadingText: "辞書を読み込み中...",
    loadingError: "辞書の読み込みに失敗しました。オンライン状態を確認してタップして再試行してください。",
    gameoverHeading: "ゲーム終了！",
    foundSummaryPrefix: "見つけた単語:",
    missedHeading: "見逃した単語(文字数別)",
    highScoreHeading: "ハイスコア ランキング",
    highScoreEmpty: "まだ記録がありません",
    finalScoreLabel: "SCORE",
    restartBtn: "もう一度プレイ",
    howToPlayHeading: "あそびかた",
    howToPlaySteps: [
      "隣り合うマス(斜め方向もOK)をなぞって単語をつなげよう",
      "3文字以上の単語が得点になる",
      "指を離すと単語が確定",
      "制限時間内にできるだけ多くの単語を見つけよう",
    ],
    lengthUnit: (key) => (key === "8+" ? "8+文字" : `${key}文字`),
    lengthCount: (n) => `${n}個`,
    scorePts: (n) => `${n}点`,
  },
  en: {
    hudScore: "SCORE", hudTime: "TIME", hudBest: "BEST",
    boardAria: "Letter Board",
    foundHeading: "Found Words",
    playerNameLabel: "Player Name",
    playerNamePlaceholder: "Anonymous",
    durationAria: "Time Limit",
    duration60: "1 min", duration120: "2 min", duration180: "3 min",
    scoringInfo: "Score = sum of tile points + length bonus (3 letters: +0 / 4+ letters: +(length-3))",
    startBtn: "Start",
    retireBtn: "Give Up",
    loadingText: "Loading dictionary...",
    loadingError: "Failed to load the dictionary. Check your connection and tap to retry.",
    gameoverHeading: "Game Over!",
    foundSummaryPrefix: "Words found:",
    missedHeading: "Missed words (by length)",
    highScoreHeading: "High Score Ranking",
    highScoreEmpty: "No records yet",
    finalScoreLabel: "SCORE",
    restartBtn: "Play Again",
    howToPlayHeading: "How to Play",
    howToPlaySteps: [
      "Drag across adjacent letters (including diagonals) to connect them into a word",
      "Words of 3+ letters score points",
      "Release your finger to submit the word",
      "Find as many words as you can before time runs out",
    ],
    lengthUnit: (key) => (key === "8+" ? "8+ letters" : `${key} letters`),
    lengthCount: (n) => `${n}`,
    scorePts: (n) => `${n} pts`,
  },
};

let currentLang = localStorage.getItem(LANG_KEY) || "ja";
let lastMissedWords = [];
let lastHighScores = {};

function applyLanguage() {
  const t = I18N[currentLang];
  document.documentElement.lang = currentLang;
  hudLabelScoreEl.textContent = t.hudScore;
  hudLabelTimeEl.textContent = t.hudTime;
  hudLabelBestEl.textContent = t.hudBest;
  boardEl.setAttribute("aria-label", t.boardAria);
  foundHeadingTextEl.textContent = t.foundHeading;
  playerNameLabelEl.textContent = t.playerNameLabel;
  playerNameInput.placeholder = t.playerNamePlaceholder;
  document.getElementById("duration-select").setAttribute("aria-label", t.durationAria);
  durationLabel60El.textContent = t.duration60;
  durationLabel120El.textContent = t.duration120;
  durationLabel180El.textContent = t.duration180;
  scoringInfoEl.textContent = t.scoringInfo;
  startBtn.textContent = t.startBtn;
  retireBtn.textContent = t.retireBtn;
  loadingText.textContent = t.loadingText;
  gameoverHeadingEl.textContent = t.gameoverHeading;
  foundSummaryPrefixEl.textContent = t.foundSummaryPrefix;
  missedHeadingEl.textContent = t.missedHeading;
  highScoreHeadingEl.textContent = t.highScoreHeading;
  finalScoreLabelTextEl.textContent = t.finalScoreLabel;
  restartBtn.textContent = t.restartBtn;
  highScoreLabel60El.textContent = t.duration60;
  highScoreLabel120El.textContent = t.duration120;
  highScoreLabel180El.textContent = t.duration180;
  howToPlayHeadingEl.textContent = t.howToPlayHeading;
  howToPlayListEl.innerHTML = "";
  t.howToPlaySteps.forEach((step) => {
    const li = document.createElement("li");
    li.textContent = step;
    howToPlayListEl.appendChild(li);
  });
  renderLengthCounts(lengthBreakdownEl, foundWords);
  renderLengthCounts(missedListEl, lastMissedWords);
  renderHighScores(lastHighScores);
}

// ---- State ----
let wordSet = null; // Set<string> uppercase, dictionary
let trie = null; // nested-object trie built from wordSet
let board = []; // array of { display, value } length 16
let neighbors = []; // adjacency list per index (8-direction)
let foundWords = new Set();
let score = 0;
let gameDuration = DEFAULT_DURATION;
let timeLeft = DEFAULT_DURATION;
let timerId = null;
let selecting = false;
let path = [];
let gameActive = false;
let lastMoveX = 0;
let lastMoveY = 0;
let timerStarted = false; // countdown begins on the first tile drag, not on the start button

// ---- Neighbor computation (8-direction) ----
function computeNeighbors() {
  const result = [];
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const row = Math.floor(i / GRID_SIZE);
    const col = i % GRID_SIZE;
    const list = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < GRID_SIZE && c >= 0 && c < GRID_SIZE) {
          list.push(r * GRID_SIZE + c);
        }
      }
    }
    result.push(list);
  }
  return result;
}

// ---- Word list loading ----
async function loadWordList() {
  const res = await fetch(WORDLIST_URL);
  if (!res.ok) throw new Error("word list fetch failed: " + res.status);
  const text = await res.text();
  const words = text
    .split("\n")
    .map((w) => w.trim().toUpperCase())
    .filter((w) => w.length >= MIN_WORD_LEN && /^[A-Z]+$/.test(w));
  return new Set(words);
}

function buildTrie(words) {
  const root = {};
  for (const word of words) {
    let node = root;
    for (const ch of word) {
      node = node[ch] ?? (node[ch] = {});
    }
    node.$ = true;
  }
  return root;
}

// ---- Board generation ----
function rollDie(letters) {
  const face = letters[Math.floor(Math.random() * letters.length)];
  if (face === "Q") return { display: "Qu", value: "QU" };
  return { display: face, value: face };
}

function generateBoard() {
  const shuffled = [...DICE].sort(() => Math.random() - 0.5);
  return shuffled.map(rollDie);
}

function renderBoard() {
  boardEl.innerHTML = "";
  board.forEach((tile, idx) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.idx = String(idx);
    cell.innerHTML = `<span class="letter">${tile.display}</span><span class="points">${tilePoints(tile)}</span>`;
    boardEl.appendChild(cell);
  });
}

// ---- Selection interaction ----
// Map a touch/mouse point to a cell by grid position (not DOM hit-test), so the
// gaps between tiles never cause a diagonal swipe to miss a cell. Used only for
// the initial tap; subsequent moves use directional matching (see below).
function cellElAt(x, y) {
  const rect = boardEl.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const col = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * GRID_SIZE)));
  const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((y - rect.top) / rect.height) * GRID_SIZE)));
  return boardEl.querySelector(`.cell[data-idx="${row * GRID_SIZE + col}"]`);
}

function cellCenter(idx) {
  const rect = boardEl.getBoundingClientRect();
  const cellW = rect.width / GRID_SIZE;
  const cellH = rect.height / GRID_SIZE;
  const row = Math.floor(idx / GRID_SIZE);
  const col = idx % GRID_SIZE;
  return { x: rect.left + cellW * (col + 0.5), y: rect.top + cellH * (row + 0.5), cellW, cellH };
}

// Pick whichever neighbor of `fromIdx` best matches the drag direction toward (x, y),
// rather than requiring the finger to visually enter that tile's box. This is what
// makes diagonal swipes register from intent/angle instead of exact hit-testing.
function directionalNeighbor(fromIdx, x, y) {
  const from = cellCenter(fromIdx);
  const dx = x - from.x;
  const dy = y - from.y;
  const dist = Math.hypot(dx, dy);
  const deadZone = Math.min(from.cellW, from.cellH) * 0.5;
  if (dist < deadZone) return null; // finger hasn't committed to a direction yet
  let best = null;
  let bestScore = -Infinity;
  for (const idx of neighbors[fromIdx]) {
    const to = cellCenter(idx);
    const ndx = to.x - from.x;
    const ndy = to.y - from.y;
    const score = (dx * ndx + dy * ndy) / (dist * Math.hypot(ndx, ndy)); // cosine similarity
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  return bestScore > 0.5 ? best : null; // within ~60 degrees of the neighbor's direction
}

function updateSelectionUI() {
  const cells = boardEl.querySelectorAll(".cell");
  cells.forEach((cell) => cell.classList.remove("selected"));
  path.forEach((idx) => {
    const cell = boardEl.querySelector(`.cell[data-idx="${idx}"]`);
    if (cell) cell.classList.add("selected");
  });
  currentWordEl.textContent = path.map((idx) => board[idx].display).join("").toUpperCase();
}

function startSelect(x, y) {
  if (!gameActive) return;
  const cellEl = cellElAt(x, y);
  if (!cellEl) return;
  beginCountdown();
  selecting = true;
  path = [Number(cellEl.dataset.idx)];
  lastMoveX = x;
  lastMoveY = y;
  updateSelectionUI();
}

// Extend/backtrack the path to a single target cell index.
function tryExtendTo(idx) {
  const last = path[path.length - 1];
  if (idx === last) return;
  if (path.length > 1 && idx === path[path.length - 2]) {
    path.pop();
    updateSelectionUI();
    return;
  }
  if (path.includes(idx)) return;
  if (!neighbors[last].includes(idx)) return;
  path.push(idx);
  updateSelectionUI();
}

// Fast swipes can skip touchmove samples past more than one cell, so walk the
// segment in small steps, picking each step's cell by drag direction rather than
// by exact hit-testing.
function moveSelect(x, y) {
  if (!selecting) return;
  const dx = x - lastMoveX;
  const dy = y - lastMoveY;
  const dist = Math.hypot(dx, dy);
  const step = 10; // px
  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= steps; i++) {
    const px = lastMoveX + (dx * i) / steps;
    const py = lastMoveY + (dy * i) / steps;
    const idx = directionalNeighbor(path[path.length - 1], px, py);
    if (idx !== null) tryExtendTo(idx);
  }
  lastMoveX = x;
  lastMoveY = y;
}

function endSelect() {
  if (!selecting) return;
  selecting = false;
  submitWord(path);
  path = [];
  updateSelectionUI();
}

function attachInputHandlers() {
  boardEl.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const t = e.touches[0];
      startSelect(t.clientX, t.clientY);
    },
    { passive: false }
  );
  boardEl.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      const t = e.touches[0];
      moveSelect(t.clientX, t.clientY);
    },
    { passive: false }
  );
  boardEl.addEventListener("touchend", (e) => {
    e.preventDefault();
    endSelect();
  });
  boardEl.addEventListener("mousedown", (e) => startSelect(e.clientX, e.clientY));
  document.addEventListener("mousemove", (e) => moveSelect(e.clientX, e.clientY));
  document.addEventListener("mouseup", () => endSelect());
}

// ---- Word submission ----
function submitWord(selectedPath) {
  if (selectedPath.length === 0) return;
  const word = selectedPath.map((idx) => board[idx].value).join("");
  if (word.length < MIN_WORD_LEN) return;
  if (foundWords.has(word)) return;
  if (!wordSet.has(word)) return;
  foundWords.add(word);
  score += wordScore(selectedPath, word);
  updateHUD();
  const li = document.createElement("li");
  li.textContent = word;
  foundListEl.appendChild(li);
  foundCountEl.textContent = String(foundWords.size);
}

// ---- HUD ----
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateHUD() {
  scoreEl.textContent = String(score);
  applyScoreColor(scoreEl, score, gameDuration);
  timerEl.textContent = formatTime(timeLeft);
}

// ---- Result breakdown ----
function renderLengthCounts(targetEl, words) {
  const counts = {};
  words.forEach((w) => {
    const key = w.length >= 8 ? "8+" : String(w.length);
    counts[key] = (counts[key] || 0) + 1;
  });
  const t = I18N[currentLang];
  targetEl.innerHTML = "";
  ["3", "4", "5", "6", "7", "8+"].forEach((key) => {
    const li = document.createElement("li");
    li.textContent = `${t.lengthUnit(key)}: ${t.lengthCount(counts[key] || 0)}`;
    targetEl.appendChild(li);
  });
}

// ---- High scores ----
function getAllHighScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIGH_SCORE_KEY) || "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch (_err) {
    // ignore malformed storage
  }
  return {};
}

function getHighScores(duration) {
  const all = getAllHighScores();
  return Array.isArray(all[duration]) ? all[duration] : [];
}

function addHighScore(name, scoreValue, duration, playerId) {
  const all = getAllHighScores();
  const list = Array.isArray(all[duration]) ? all[duration] : [];
  const existingIdx = list.findIndex((e) => e.id === playerId);
  if (existingIdx >= 0) {
    // Same browser/player: keep only their best score, but always refresh the displayed name.
    if (scoreValue > list[existingIdx].score) list[existingIdx].score = scoreValue;
    list[existingIdx].name = name;
  } else {
    list.push({ id: playerId, name, score: scoreValue });
  }
  list.sort((a, b) => b.score - a.score);
  all[duration] = list.slice(0, MAX_HIGH_SCORES);
  localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(all));
  return all;
}

// Fetches the shared leaderboard, optionally merges in one entry, and writes it back.
// Pass entry=null for a read-only refresh. Returns null (and leaves local data untouched)
// if the shared leaderboard isn't configured or the network call fails.
async function syncSharedHighScores(entry) {
  if (!sharedLeaderboardEnabled()) return null;
  try {
    const res = await fetch(`${LEADERBOARD_URL}/latest`, {
      headers: { "X-Master-Key": LEADERBOARD_API_KEY, "X-Bin-Meta": "false" },
    });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const remote = await res.json();
    const all = remote && typeof remote === "object" && !Array.isArray(remote) ? remote : {};
    if (!entry) return all;

    const list = Array.isArray(all[entry.duration]) ? all[entry.duration] : [];
    const existingIdx = list.findIndex((e) => e.id === entry.id);
    if (existingIdx >= 0) {
      if (entry.score > list[existingIdx].score) list[existingIdx].score = entry.score;
      list[existingIdx].name = entry.name;
    } else {
      list.push({ id: entry.id, name: entry.name, score: entry.score });
    }
    list.sort((a, b) => b.score - a.score);
    all[entry.duration] = list.slice(0, MAX_HIGH_SCORES);

    const putRes = await fetch(LEADERBOARD_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": LEADERBOARD_API_KEY },
      body: JSON.stringify(all),
    });
    if (!putRes.ok) throw new Error(`update failed: ${putRes.status}`);
    return all;
  } catch (_err) {
    return null;
  }
}

function renderHighScoreList(targetEl, list) {
  const t = I18N[currentLang];
  targetEl.innerHTML = "";
  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = t.highScoreEmpty;
    targetEl.appendChild(li);
    return;
  }
  list.forEach((entry) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${entry.name}</span><span>${t.scorePts(entry.score)}</span>`;
    targetEl.appendChild(li);
  });
}

function renderHighScores(all) {
  renderHighScoreList(highScoreList60El, all[60] || []);
  renderHighScoreList(highScoreList120El, all[120] || []);
  renderHighScoreList(highScoreList180El, all[180] || []);
}

function getPlayerName() {
  const name = playerNameInput.value.trim();
  return name || "名無し";
}

// Persistent per-browser identity so repeat plays update one ranking entry instead of duplicating it.
function getPlayerId() {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

// ---- Game flow ----
function getSelectedDuration() {
  const checked = document.querySelector('input[name="duration"]:checked');
  return checked ? Number(checked.value) : DEFAULT_DURATION;
}

function resetGameState() {
  board = generateBoard();
  neighbors = computeNeighbors();
  foundWords = new Set();
  score = 0;
  gameDuration = getSelectedDuration();
  timeLeft = gameDuration;
  path = [];
  selecting = false;
  timerStarted = false;
  foundListEl.innerHTML = "";
  foundCountEl.textContent = "0";
  currentWordEl.textContent = "";
  renderBoard();
  updateHUD();
}

// The countdown only starts once the player drags the first tile, not on the start button.
function beginCountdown() {
  if (timerStarted) return;
  timerStarted = true;
  timerId = setInterval(() => {
    timeLeft -= 1;
    updateHUD();
    if (timeLeft <= 0) endGame();
  }, 1000);
}

function startGame() {
  resetGameState();
  gameActive = true;
  localStorage.setItem(PLAYER_NAME_KEY, getPlayerName());
  document.body.classList.add("playing");
  gameoverOverlay.classList.add("hidden");
  startBtn.classList.add("hidden");
  retireBtn.classList.remove("hidden");
  document.getElementById("duration-select").classList.add("hidden");
  document.getElementById("scoring-info").classList.add("hidden");
  document.getElementById("player-name-select").classList.add("hidden");
}

function endGame() {
  gameActive = false;
  document.body.classList.remove("playing");
  clearInterval(timerId);
  timerId = null;
  timerStarted = false;
  path = [];
  selecting = false;
  updateSelectionUI();

  finalScoreEl.textContent = String(score);
  applyScoreColor(finalScoreEl, score, gameDuration);
  finalFoundCountEl.textContent = String(foundWords.size);
  totalWordCountEl.textContent = "?";
  renderLengthCounts(lengthBreakdownEl, foundWords);
  solvingTextEl.classList.remove("hidden");
  missedWordsEl.classList.add("hidden");
  missedListEl.innerHTML = "";
  gameoverOverlay.classList.remove("hidden");
  startBtn.classList.remove("hidden");
  retireBtn.classList.add("hidden");
  document.getElementById("duration-select").classList.remove("hidden");
  document.getElementById("scoring-info").classList.remove("hidden");
  document.getElementById("player-name-select").classList.remove("hidden");

  const scores = score > 0 ? addHighScore(getPlayerName(), score, gameDuration, getPlayerId()) : getAllHighScores();
  lastHighScores = scores;
  renderHighScores(scores);

  // Sync with the shared leaderboard in the background; re-render if/when it succeeds.
  const entry = score > 0 ? { name: getPlayerName(), score, duration: gameDuration, id: getPlayerId() } : null;
  syncSharedHighScores(entry).then((remote) => {
    if (!remote) return;
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(remote));
    lastHighScores = remote;
    renderHighScores(remote);
  });

  const best = Number(localStorage.getItem(BEST_SCORE_KEY) || "0");
  if (score > best) {
    localStorage.setItem(BEST_SCORE_KEY, String(score));
    bestEl.textContent = String(score);
  }

  // Solve the board asynchronously so the UI stays responsive.
  setTimeout(() => {
    const allWords = solveBoard();
    totalWordCountEl.textContent = String(allWords.size);
    const missed = [...allWords].filter((w) => !foundWords.has(w));
    lastMissedWords = missed;
    renderLengthCounts(missedListEl, missed);
    solvingTextEl.classList.add("hidden");
    missedWordsEl.classList.remove("hidden");
  }, 50);
}

// ---- Board solver (trie-pruned DFS) ----
function solveBoard() {
  const found = new Set();
  const visited = new Array(board.length).fill(false);

  function dfs(idx, node, prefix) {
    const tile = board[idx];
    let curNode = node;
    for (const ch of tile.value) {
      curNode = curNode[ch];
      if (!curNode) return;
    }
    const word = prefix + tile.value;
    if (curNode.$ && word.length >= MIN_WORD_LEN) found.add(word);
    visited[idx] = true;
    for (const nb of neighbors[idx]) {
      if (!visited[nb]) dfs(nb, curNode, word);
    }
    visited[idx] = false;
  }

  for (let i = 0; i < board.length; i++) dfs(i, trie, "");
  return found;
}

// ---- Init ----
async function init() {
  attachInputHandlers();
  document.querySelectorAll('input[name="lang"]').forEach((radio) => {
    radio.checked = radio.value === currentLang;
    radio.addEventListener("change", () => {
      currentLang = radio.value;
      localStorage.setItem(LANG_KEY, currentLang);
      applyLanguage();
    });
  });
  applyLanguage();
  playerNameInput.value = localStorage.getItem(PLAYER_NAME_KEY) || "";
  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
  retireBtn.addEventListener("click", () => {
    if (gameActive) endGame();
  });
  document.querySelectorAll('input[name="duration"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (!gameActive) timerEl.textContent = formatTime(getSelectedDuration());
    });
  });
  timerEl.textContent = formatTime(getSelectedDuration());

  const best = Number(localStorage.getItem(BEST_SCORE_KEY) || "0");
  bestEl.textContent = String(best);

  try {
    wordSet = await loadWordList();
    trie = buildTrie(wordSet);
    loadingOverlay.classList.add("hidden");
  } catch (err) {
    loadingText.textContent = I18N[currentLang].loadingError;
    loadingOverlay.addEventListener("click", () => location.reload(), { once: true });
    return;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
