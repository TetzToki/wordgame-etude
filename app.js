"use strict";

// ---- Config ----
const GRID_SIZE = 4;
const DEFAULT_DURATION = 60; // seconds, default 1 minute
const MIN_WORD_LEN = 3;
const WORDLIST_URL = "https://cdn.jsdelivr.net/gh/dolph/dictionary@master/enable1.txt";
const BEST_SCORE_KEY = "wordscramble.bestScore";

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
// gaps between tiles never cause a diagonal swipe to miss a cell.
function cellElAt(x, y) {
  const rect = boardEl.getBoundingClientRect();
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const col = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((x - rect.left) / rect.width) * GRID_SIZE)));
  const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((y - rect.top) / rect.height) * GRID_SIZE)));
  return boardEl.querySelector(`.cell[data-idx="${row * GRID_SIZE + col}"]`);
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

// Fast swipes can skip touchmove samples past more than one cell (diagonals span a
// longer distance between centers), so walk the segment in small steps instead of
// only checking the final point.
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
    const cellEl = cellElAt(px, py);
    if (cellEl) tryExtendTo(Number(cellEl.dataset.idx));
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
  timerEl.textContent = formatTime(timeLeft);
}

// ---- Result breakdown ----
function renderLengthCounts(targetEl, words) {
  const counts = {};
  words.forEach((w) => {
    const key = w.length >= 8 ? "8+" : String(w.length);
    counts[key] = (counts[key] || 0) + 1;
  });
  targetEl.innerHTML = "";
  ["3", "4", "5", "6", "7", "8+"].forEach((key) => {
    const li = document.createElement("li");
    li.textContent = `${key}文字: ${counts[key] || 0}個`;
    targetEl.appendChild(li);
  });
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
  foundListEl.innerHTML = "";
  foundCountEl.textContent = "0";
  currentWordEl.textContent = "";
  renderBoard();
  updateHUD();
}

function startGame() {
  resetGameState();
  gameActive = true;
  document.body.classList.add("playing");
  gameoverOverlay.classList.add("hidden");
  startBtn.classList.add("hidden");
  document.getElementById("duration-select").classList.add("hidden");
  document.getElementById("scoring-info").classList.add("hidden");
  timerId = setInterval(() => {
    timeLeft -= 1;
    updateHUD();
    if (timeLeft <= 0) endGame();
  }, 1000);
}

function endGame() {
  gameActive = false;
  document.body.classList.remove("playing");
  clearInterval(timerId);
  timerId = null;
  path = [];
  selecting = false;
  updateSelectionUI();

  finalScoreEl.textContent = String(score);
  finalFoundCountEl.textContent = String(foundWords.size);
  totalWordCountEl.textContent = "?";
  renderLengthCounts(lengthBreakdownEl, foundWords);
  solvingTextEl.classList.remove("hidden");
  missedWordsEl.classList.add("hidden");
  missedListEl.innerHTML = "";
  gameoverOverlay.classList.remove("hidden");
  startBtn.classList.remove("hidden");
  document.getElementById("duration-select").classList.remove("hidden");
  document.getElementById("scoring-info").classList.remove("hidden");

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
  startBtn.addEventListener("click", startGame);
  restartBtn.addEventListener("click", startGame);
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
    loadingText.textContent = "辞書の読み込みに失敗しました。オンライン状態を確認してタップして再試行してください。";
    loadingOverlay.addEventListener("click", () => location.reload(), { once: true });
    return;
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
