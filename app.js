// UI Coordinator and Game Controller for GigaSudoku

// App State
let size = 25;
let difficulty = 'medium';
let symbolMode = 'letters'; // 'letters' or 'numbers'
let boardPuzzle = [];       // Original puzzle with empty spaces
let boardSolution = [];     // Solved puzzle
let boardState = [];        // Current player state
let boardNotes = [];        // 2D Array [cellIndex][notes]
let givenIndices = new Set();
let selectedCell = null;
let notesMode = false;
let timerSeconds = 0;
let timerInterval = null;
let isPaused = false;
let historyStack = [];
let redoStack = [];
let errorIndices = new Set();
let isGenerating = false;
let isReviewMode = false;
let isSubmitted = false;
let hintsUsed = 0;
let theme = 'dark';

// Zoom and Pan State
let zoom = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

// Web Worker instance
let worker = null;

// Initialize elements
const boardViewport = document.getElementById('board-viewport');
const boardViewportContainer = document.querySelector('.board-viewport-container');
const sudokuBoardEl = document.getElementById('sudoku-board');
const keypadEl = document.getElementById('keypad');
const timerEl = document.getElementById('timer');
const pauseBtn = document.getElementById('pause-btn');
const pauseIcon = document.getElementById('pause-icon');
const progressEl = document.getElementById('stat-progress');
const sizeSelect = document.getElementById('grid-size-select');
const diffSelect = document.getElementById('difficulty-select');
const symbolModeSelect = document.getElementById('symbol-mode-select');
const newGameBtn = document.getElementById('new-game-btn');
const notesBtn = document.getElementById('notes-btn');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const hintBtn = document.getElementById('hint-btn');
const solveBtn = document.getElementById('solve-btn');
const submitBtn = document.getElementById('submit-btn');
const clearBtn = document.getElementById('clear-btn');
const helpBtn = document.getElementById('help-btn');
const themeBtn = document.getElementById('theme-btn');
const themeIcon = document.getElementById('theme-icon');

// Modals
const helpModal = document.getElementById('help-modal');
const resultModal = document.getElementById('result-modal');
const pauseModal = document.getElementById('pause-modal');
const helpCloseBtn = document.getElementById('help-close-btn');
const resultCloseBtn = document.getElementById('result-close-btn');
const resultReviewBtn = document.getElementById('result-review-btn');
const resumeBtn = document.getElementById('resume-btn');
const boardLoader = document.getElementById('board-loader');
const loaderText = document.getElementById('loader-text');

// --- Symbol Representation Mapping ---

function getSymbol(val, gridSize, mode) {
  if (val === null || val === undefined || val === "") return "";
  
  if (mode === 'numbers') {
    return val.toString();
  }

  // Letter Mode mappings
  if (gridSize === 9) {
    return val.toString();
  } else if (gridSize === 16) {
    // Hex: 0-F (maps 1-16 to 0-F)
    return (val - 1).toString(16).toUpperCase();
  } else if (gridSize === 25) {
    // Alphabet: A-Y (maps 1-25 to A-Y)
    return String.fromCharCode(65 + val - 1);
  } else if (gridSize === 36) {
    // Alphanumeric: 0-9 then A-Z
    if (val <= 10) {
      return (val - 1).toString();
    } else {
      return String.fromCharCode(65 + val - 11);
    }
  }
  return val.toString();
}

function parseSymbolInput(char, gridSize, mode) {
  const cleanChar = char.toString().trim().toUpperCase();
  if (cleanChar === "") return null;

  if (mode === 'numbers') {
    const num = parseInt(cleanChar, 10);
    if (!isNaN(num) && num >= 1 && num <= gridSize) return num;
    return null;
  }

  // Letter Mode mapping back to 1-N
  if (gridSize === 9) {
    const num = parseInt(cleanChar, 10);
    if (!isNaN(num) && num >= 1 && num <= 9) return num;
  } else if (gridSize === 16) {
    // Hex 0-F
    const num = parseInt(cleanChar, 16);
    if (!isNaN(num) && num >= 0 && num <= 15) return num + 1;
  } else if (gridSize === 25) {
    // Alphabet A-Y
    const code = cleanChar.charCodeAt(0);
    if (code >= 65 && code <= 89) { // A-Y
      return code - 65 + 1;
    }
  } else if (gridSize === 36) {
    // 0-9 then A-Z
    const code = cleanChar.charCodeAt(0);
    if (code >= 48 && code <= 57) { // 0-9
      return code - 48 + 1;
    } else if (code >= 65 && code <= 90) { // A-Z
      return code - 65 + 11;
    }
  }
  return null;
}

// --- Worker Setup ---

function initWorker() {
  if (worker) {
    worker.terminate();
  }

  worker = new Worker('sudoku-worker.js');

  worker.onmessage = function (e) {
    const data = e.data;

    if (data.type === 'generate' && data.success) {
      boardPuzzle = data.puzzle;
      boardSolution = data.solution;
      boardState = [...boardPuzzle];
      boardNotes = Array.from({ length: size * size }, () => []);
      errorIndices.clear();
      
      // Determine given indices
      givenIndices.clear();
      for (let i = 0; i < boardPuzzle.length; i++) {
        if (boardPuzzle[i] !== null) {
          givenIndices.add(i);
        }
      }

      selectedCell = null;
      historyStack = [];
      redoStack = [];
      
      hideLoader();
      isGenerating = false;
      renderBoard();
      updateProgress();
      resetTimer();
      startTimer();
      saveGame();

    } else if (data.type === 'solve') {
      hideLoader();
      if (data.success) {
        pushHistory();
        boardState = [...data.solution];
        boardNotes = Array.from({ length: size * size }, () => []);
        errorIndices.clear();
        selectedCell = null;
        renderBoard();
        updateProgress();
        triggerWin();
      } else {
        alert("The current board has no valid solution!");
      }

    } else if (data.type === 'validate') {
      errorIndices.clear();
      data.errors.forEach(idx => errorIndices.add(idx));
      
      // Highlight errors in UI
      const cells = sudokuBoardEl.querySelectorAll('.sudoku-cell');
      cells.forEach((cell, idx) => {
        if (errorIndices.has(idx)) {
          cell.classList.add('error');
        } else {
          cell.classList.remove('error');
        }
      });

      if (data.isComplete && data.isValid) {
        submitGame();
      }
      saveGame();
    } else if (data.type === 'error') {
      hideLoader();
      isGenerating = false;
      alert("An error occurred in Sudoku engine: " + data.message);
    }
  };
}

// --- Gameplay Actions ---

function generateNewGame() {
  if (isGenerating) return;
  isGenerating = true;
  showLoader("Generating board...");
  
  isReviewMode = false;
  isSubmitted = false;
  hintsUsed = 0;
  document.getElementById('stat-score').textContent = "0";

  if (submitBtn) {
    submitBtn.style.background = 'linear-gradient(135deg, var(--accent-green), #065f46)';
    const span = submitBtn.querySelector('span');
    if (span) span.textContent = "Submit Board";
    const svg = submitBtn.querySelector('svg');
    if (svg) svg.innerHTML = `<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`;
  }
  
  size = parseInt(sizeSelect.value, 10);
  difficulty = diffSelect.value;
  symbolMode = symbolModeSelect.value;
  
  // Set stat headers
  document.getElementById('stat-grid-size').textContent = `${size}x` + size;
  document.getElementById('stat-difficulty').textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  
  // Update CSS custom property for grid size
  document.documentElement.style.setProperty('--grid-size', size);

  // Reinitialize worker in case files were updated
  initWorker();

  // Send request to Web Worker
  worker.postMessage({
    type: 'generate',
    size,
    difficulty
  });
}

function solveGame() {
  if (isReviewMode) return;
  if (confirm("Are you sure you want to solve the entire board? This will reveal the solution.")) {
    showLoader("Solving board...");
    worker.postMessage({
      type: 'solve',
      board: boardState
    });
  }
}

function checkValidation() {
  worker.postMessage({
    type: 'validate',
    board: boardState
  });
}

function showHint() {
  if (isReviewMode) return;
  if (selectedCell === null) {
    alert("Please select a cell first to receive a hint!");
    return;
  }
  if (givenIndices.has(selectedCell)) {
    return; // Already a clue
  }
  
  const correctVal = boardSolution[selectedCell];
  if (correctVal) {
    pushHistory();
    hintsUsed++;
    fillCell(selectedCell, correctVal);
    checkValidation();
  }
}

function clearSelectedCell() {
  if (isReviewMode) return;
  if (selectedCell === null || givenIndices.has(selectedCell)) return;
  pushHistory();
  boardState[selectedCell] = null;
  boardNotes[selectedCell] = [];
  renderBoard();
  updateProgress();
  checkValidation();
}

function fillCell(index, value) {
  if (isReviewMode) return;
  if (givenIndices.has(index)) return;

  if (notesMode) {
    // Note/Pencil Mode
    boardState[index] = null; // Clear number when typing notes
    const idxInNotes = boardNotes[index].indexOf(value);
    if (idxInNotes > -1) {
      boardNotes[index].splice(idxInNotes, 1); // Remove if exists
    } else {
      boardNotes[index].push(value); // Add note
      boardNotes[index].sort((a, b) => a - b);
    }
  } else {
    // Normal input mode
    boardNotes[index] = []; // Clear notes when finalising value
    if (boardState[index] === value) {
      boardState[index] = null; // Toggle off if clicked same number
    } else {
      boardState[index] = value;
      // Auto-prune notes helper: remove this number from peer cells notes
      prunePeerNotes(index, value);
    }
  }

  renderBoard();
  updateProgress();
  checkValidation();
}

function prunePeerNotes(cellIndex, val) {
  const r = Math.floor(cellIndex / size);
  const c = cellIndex % size;
  const K = Math.sqrt(size) | 0;
  const b = Math.floor(r / K) * K + Math.floor(c / K);

  for (let i = 0; i < size * size; i++) {
    const pr = Math.floor(i / size);
    const pc = i % size;
    const pb = Math.floor(pr / K) * K + Math.floor(pc / K);

    if (pr === r || pc === c || pb === b) {
      const idx = boardNotes[i].indexOf(val);
      if (idx > -1) {
        boardNotes[i].splice(idx, 1);
      }
    }
  }
}

// --- History & Undo/Redo ---

function pushHistory() {
  // Push copy to history stack
  historyStack.push({
    boardState: [...boardState],
    boardNotes: boardNotes.map(n => [...n])
  });
  redoStack = []; // Clear redo stack on new action
}

function undo() {
  if (isReviewMode) return;
  if (historyStack.length === 0) return;
  
  // Push current to redo
  redoStack.push({
    boardState: [...boardState],
    boardNotes: boardNotes.map(n => [...n])
  });

  const previous = historyStack.pop();
  boardState = previous.boardState;
  boardNotes = previous.boardNotes;

  renderBoard();
  updateProgress();
  checkValidation();
}

function redo() {
  if (isReviewMode) return;
  if (redoStack.length === 0) return;

  // Push current to undo
  historyStack.push({
    boardState: [...boardState],
    boardNotes: boardNotes.map(n => [...n])
  });

  const next = redoStack.pop();
  boardState = next.boardState;
  boardNotes = next.boardNotes;

  renderBoard();
  updateProgress();
  checkValidation();
}

// --- Rendering Board & Keypad ---

function renderBoard() {
  sudokuBoardEl.innerHTML = '';
  const K = Math.sqrt(size) | 0;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const idx = r * size + c;
      const cellVal = boardState[idx];
      
      const cellEl = document.createElement('div');
      cellEl.classList.add('sudoku-cell');
      cellEl.dataset.index = idx;

      // Add subgrid border styling
      if (c % K === 0) cellEl.classList.add('border-left');
      if ((c + 1) % K === 0) cellEl.classList.add('border-right');
      if (r % K === 0) cellEl.classList.add('border-top');
      if ((r + 1) % K === 0) cellEl.classList.add('border-bottom');

      // Outer outline styles
      if (c === 0) cellEl.classList.add('outer-left');
      if (c === size - 1) cellEl.classList.add('outer-right');
      if (r === 0) cellEl.classList.add('outer-top');
      if (r === size - 1) cellEl.classList.add('outer-bottom');

      // Given/Clue vs User Filled
      if (givenIndices.has(idx)) {
        cellEl.classList.add('given');
        cellEl.textContent = getSymbol(cellVal, size, symbolMode);
      } else if (isReviewMode) {
        const correctVal = boardSolution[idx];
        if (cellVal === correctVal) {
          cellEl.classList.add('review-correct');
          cellEl.textContent = getSymbol(cellVal, size, symbolMode);
        } else {
          cellEl.classList.add('review-incorrect');
          const container = document.createElement('div');
          container.classList.add('review-incorrect-container');
          
          if (cellVal !== null && cellVal !== undefined && cellVal !== "") {
            const userValEl = document.createElement('span');
            userValEl.classList.add('review-user-val');
            userValEl.textContent = getSymbol(cellVal, size, symbolMode);
            
            const arrowEl = document.createElement('span');
            arrowEl.classList.add('review-arrow');
            arrowEl.innerHTML = '&darr;';
            
            const correctValEl = document.createElement('span');
            correctValEl.classList.add('review-correct-val');
            correctValEl.textContent = getSymbol(correctVal, size, symbolMode);
            
            container.appendChild(userValEl);
            container.appendChild(arrowEl);
            container.appendChild(correctValEl);
          } else {
            const emptyCorrectEl = document.createElement('span');
            emptyCorrectEl.classList.add('review-empty-correct');
            emptyCorrectEl.textContent = getSymbol(correctVal, size, symbolMode);
            container.appendChild(emptyCorrectEl);
          }
          cellEl.appendChild(container);
        }
      } else if (cellVal) {
        cellEl.classList.add('user-filled');
        cellEl.textContent = getSymbol(cellVal, size, symbolMode);
      } else {
        // Render Notes
        const notes = boardNotes[idx];
        if (notes && notes.length > 0) {
          const notesContainer = document.createElement('div');
          notesContainer.classList.add('notes-container');
          
          // Populate pencil notes
          // To keep layout neat, generate a wrapper representing all possible inputs
          for (let val = 1; val <= size; val++) {
            const noteItem = document.createElement('div');
            noteItem.classList.add('note-item');
            if (notes.includes(val)) {
              noteItem.textContent = getSymbol(val, size, symbolMode);
            } else {
              noteItem.innerHTML = '&nbsp;';
            }
            notesContainer.appendChild(noteItem);
          }
          cellEl.appendChild(notesContainer);
        }
      }

      // Selection & Highlights
      if (selectedCell !== null) {
        const selRow = Math.floor(selectedCell / size);
        const selCol = selectedCell % size;
        const selBox = Math.floor(selRow / K) * K + Math.floor(selCol / K);
        const cellBox = Math.floor(r / K) * K + Math.floor(c / K);

        if (idx === selectedCell) {
          cellEl.classList.add('selected');
        } else if (r === selRow || c === selCol || cellBox === selBox) {
          cellEl.classList.add('peer-highlight');
        }

        // Highlight same values
        const selVal = boardState[selectedCell];
        if (selVal && cellVal === selVal) {
          cellEl.classList.add('same-value');
        }
      }

      if (errorIndices.has(idx)) {
        cellEl.classList.add('error');
      }

      // Add click handler
      cellEl.addEventListener('click', () => {
        selectCell(idx);
      });

      sudokuBoardEl.appendChild(cellEl);
    }
  }

  renderKeypad();
}

function selectCell(idx) {
  if (isPaused || isReviewMode) return;
  selectedCell = idx;
  renderBoard();
}

function renderKeypad() {
  keypadEl.innerHTML = '';
  
  // Count frequencies of each number
  const counts = Array(size + 1).fill(0);
  for (let i = 0; i < boardState.length; i++) {
    if (boardState[i]) {
      counts[boardState[i]]++;
    }
  }

  for (let val = 1; val <= size; val++) {
    const symbolStr = getSymbol(val, size, symbolMode);
    
    const keyBtn = document.createElement('button');
    keyBtn.classList.add('keypad-btn');
    keyBtn.innerHTML = `<div>${symbolStr}</div>`;
    
    const countBadge = document.createElement('span');
    countBadge.classList.add('count-badge');
    countBadge.textContent = `${counts[val]}/${size}`;
    keyBtn.appendChild(countBadge);

    // If fully placed, mark completed
    if (counts[val] >= size) {
      keyBtn.classList.add('completed');
    }

    keyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedCell !== null) {
        pushHistory();
        fillCell(selectedCell, val);
      }
    });

    keypadEl.appendChild(keyBtn);
  }
}

function updateProgress() {
  let filled = 0;
  for (let i = 0; i < boardState.length; i++) {
    if (boardState[i] !== null && boardState[i] !== undefined && boardState[i] !== "") {
      filled++;
    }
  }
  progressEl.textContent = `${filled} / ${size * size}`;
}

// --- Zoom & Pan Removed (Board is now Static and Responsive) ---

// --- Timer & UI States ---

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!isPaused) {
      timerSeconds++;
      updateTimerUI();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function resetTimer() {
  timerSeconds = 0;
  updateTimerUI();
}

function updateTimerUI() {
  const hrs = Math.floor(timerSeconds / 3600);
  const mins = Math.floor((timerSeconds % 3600) / 60);
  const secs = timerSeconds % 60;
  
  let timeStr = "";
  if (hrs > 0) {
    timeStr += (hrs < 10 ? '0' : '') + hrs + ':';
  }
  timeStr += (mins < 10 ? '0' : '') + mins + ':';
  timeStr += (secs < 10 ? '0' : '') + secs;
  
  timerEl.textContent = timeStr;
}

function togglePause() {
  isPaused = !isPaused;
  if (isPaused) {
    stopTimer();
    pauseIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`; // Play icon
    pauseModal.classList.add('active');
  } else {
    startTimer();
    pauseIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`; // Pause icon
    pauseModal.classList.remove('active');
  }
}

function calculateScore() {
  let baseScore = 2000;
  switch (size) {
    case 9: baseScore = 1000; break;
    case 16: baseScore = 5000; break;
    case 25: baseScore = 15000; break;
    case 36: baseScore = 30000; break;
  }

  let diffMultiplier = 1.0;
  switch (difficulty) {
    case 'easy': diffMultiplier = 0.5; break;
    case 'medium': diffMultiplier = 1.0; break;
    case 'hard': diffMultiplier = 1.5; break;
    case 'expert': diffMultiplier = 2.0; break;
  }
  
  let targetBase = baseScore * diffMultiplier;

  let wrongCount = 0;
  let emptyCount = 0;
  let correctCount = 0;
  let totalUserFilled = 0;

  for (let i = 0; i < boardState.length; i++) {
    if (givenIndices.has(i)) continue;
    
    totalUserFilled++;
    const userVal = boardState[i];
    const correctVal = boardSolution[i];

    if (userVal === null || userVal === undefined || userVal === "") {
      emptyCount++;
    } else if (userVal !== correctVal) {
      wrongCount++;
    } else {
      correctCount++;
    }
  }

  let wrongPenalty = 0;
  let hintPenalty = 0;
  let timeDecay = 0;

  switch (size) {
    case 9:
      wrongPenalty = 50;
      hintPenalty = 150;
      timeDecay = 0.5;
      break;
    case 16:
      wrongPenalty = 150;
      hintPenalty = 400;
      timeDecay = 1.0;
      break;
    case 25:
      wrongPenalty = 300;
      hintPenalty = 800;
      timeDecay = 2.0;
      break;
    case 36:
      wrongPenalty = 500;
      hintPenalty = 1500;
      timeDecay = 3.0;
      break;
  }

  const wrongDeduction = wrongCount * wrongPenalty;
  const hintDeduction = hintsUsed * hintPenalty;
  const timeDeduction = Math.floor(timerSeconds * timeDecay);

  const finalScore = Math.max(0, Math.floor(targetBase - wrongDeduction - hintDeduction - timeDeduction));
  const accuracy = totalUserFilled > 0 ? Math.round((correctCount / totalUserFilled) * 100) : 0;

  return {
    score: finalScore,
    accuracy,
    correctCount,
    totalUserFilled,
    wrongCount,
    emptyCount
  };
}

function submitGame() {
  if (isSubmitted) {
    generateNewGame();
    return;
  }

  let emptyCells = 0;
  for (let i = 0; i < boardState.length; i++) {
    if (boardState[i] === null || boardState[i] === undefined || boardState[i] === "") {
      emptyCells++;
    }
  }

  if (emptyCells > 0) {
    if (!confirm(`There are still ${emptyCells} empty cells. Do you want to submit anyway and lock your score?`)) {
      return;
    }
  }

  isReviewMode = true;
  isSubmitted = true;
  selectedCell = null;
  stopTimer();

  const stats = calculateScore();
  
  document.getElementById('stat-score').textContent = stats.score.toLocaleString();

  submitBtn.style.background = 'linear-gradient(135deg, var(--accent-purple), var(--accent-cyan))';
  const span = submitBtn.querySelector('span');
  if (span) span.textContent = "Start New Game";
  const svg = submitBtn.querySelector('svg');
  if (svg) svg.innerHTML = `<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>`;

  document.getElementById('result-grid-size').textContent = `${size}x${size}`;
  document.getElementById('result-difficulty').textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  
  const hrs = Math.floor(timerSeconds / 3600);
  const mins = Math.floor((timerSeconds % 3600) / 60);
  const secs = timerSeconds % 60;
  document.getElementById('result-time').textContent = `${hrs > 0 ? hrs + 'h ' : ''}${mins}m ${secs}s`;
  
  document.getElementById('result-hints').textContent = hintsUsed;
  document.getElementById('result-accuracy').textContent = `${stats.accuracy}% (${stats.correctCount}/${stats.totalUserFilled} correct)`;
  document.getElementById('result-score').textContent = stats.score.toLocaleString();

  const resultTitleEl = document.getElementById('result-title');
  if (stats.wrongCount === 0 && stats.emptyCount === 0) {
    resultTitleEl.textContent = "Perfect Solution!";
    resultTitleEl.style.color = "var(--accent-green)";
  } else {
    resultTitleEl.textContent = "Submission Finished";
    resultTitleEl.style.color = "var(--accent-yellow)";
  }

  resultModal.classList.add('active');

  if (stats.wrongCount === 0 && stats.emptyCount === 0) {
    sudokuBoardEl.classList.add('board-solved-animate');
    setTimeout(() => {
      sudokuBoardEl.classList.remove('board-solved-animate');
    }, 1000);
  }

  renderBoard();
  localStorage.removeItem('gigadusoku_save_state');
}

function showLoader(message) {
  loaderText.textContent = message;
  boardLoader.classList.add('active');
}

function hideLoader() {
  boardLoader.classList.remove('active');
}

// --- Winning Ceremony ---

// triggerWin combined with submitGame

// --- Local Storage Persistence ---

function saveGame() {
  if (isGenerating || boardPuzzle.length === 0) return;
  
  const state = {
    size,
    difficulty,
    symbolMode,
    boardPuzzle,
    boardSolution,
    boardState,
    boardNotes,
    givenIndices: Array.from(givenIndices),
    timerSeconds,
    errorIndices: Array.from(errorIndices),
    hintsUsed,
    isSubmitted
  };
  localStorage.setItem('gigadusoku_save_state', JSON.stringify(state));
}

function loadSavedGame() {
  const saved = localStorage.getItem('gigadusoku_save_state');
  if (!saved) return false;

  try {
    const state = JSON.parse(saved);
    
    // Set variables
    size = state.size;
    difficulty = state.difficulty;
    symbolMode = state.symbolMode;
    boardPuzzle = state.boardPuzzle;
    boardSolution = state.boardSolution;
    boardState = state.boardState;
    boardNotes = state.boardNotes;
    givenIndices = new Set(state.givenIndices);
    timerSeconds = state.timerSeconds;
    errorIndices = new Set(state.errorIndices || []);
    hintsUsed = state.hintsUsed || 0;
    isSubmitted = state.isSubmitted || false;

    // Set UI dropdown selections
    sizeSelect.value = size;
    diffSelect.value = difficulty;
    symbolModeSelect.value = symbolMode;

    document.getElementById('stat-grid-size').textContent = `${size}x${size}`;
    document.getElementById('stat-difficulty').textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
    
    // Update CSS custom property for grid size
    document.documentElement.style.setProperty('--grid-size', size);
    
    initWorker();
    
    // If it was already submitted, lock UI and display score
    if (isSubmitted) {
      isReviewMode = true;
      const stats = calculateScore();
      document.getElementById('stat-score').textContent = stats.score.toLocaleString();
      if (submitBtn) {
        submitBtn.style.background = 'linear-gradient(135deg, var(--accent-purple), var(--accent-cyan))';
        const span = submitBtn.querySelector('span');
        if (span) span.textContent = "Start New Game";
        const svg = submitBtn.querySelector('svg');
        if (svg) svg.innerHTML = `<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>`;
      }
    }
    
    renderBoard();
    updateProgress();
    updateTimerUI();
    if (!isSubmitted) {
      startTimer();
    }

    return true;
  } catch (err) {
    console.error("Failed to load saved state:", err);
    return false;
  }
}

// --- Keyboard Event Handlers ---

window.addEventListener('keydown', (e) => {
  if (selectedCell === null || isPaused || isReviewMode) return;

  const key = e.key;

  // Arrow Key Navigation
  const r = Math.floor(selectedCell / size);
  const c = selectedCell % size;

  if (key === 'ArrowUp') {
    e.preventDefault();
    if (r > 0) selectCell((r - 1) * size + c);
  } else if (key === 'ArrowDown') {
    e.preventDefault();
    if (r < size - 1) selectCell((r + 1) * size + c);
  } else if (key === 'ArrowLeft') {
    e.preventDefault();
    if (c > 0) selectCell(r * size + (c - 1));
  } else if (key === 'ArrowRight') {
    e.preventDefault();
    if (c < size - 1) selectCell(r * size + (c + 1));
  }
  
  // Pencil note toggle shortcut
  else if (key === 'n' || key === 'N') {
    notesMode = !notesMode;
    updateNotesModeUI();
  }

  // Clear shortcut
  else if (key === 'Backspace' || key === 'Delete') {
    e.preventDefault();
    clearSelectedCell();
  }

  // Value inputs matching keyboard input
  else {
    const val = parseSymbolInput(key, size, symbolMode);
    if (val !== null) {
      e.preventDefault();
      pushHistory();
      fillCell(selectedCell, val);
    }
  }
});

function updateNotesModeUI() {
  if (notesMode) {
    notesBtn.classList.add('active');
    notesBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      Notes (On)
    `;
    document.getElementById('note-mode-indicator').style.display = 'block';
  } else {
    notesBtn.classList.remove('active');
    notesBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      Notes (Off)
    `;
    document.getElementById('note-mode-indicator').style.display = 'none';
  }
}

// --- Wire Up Button Clicks & Change Selectors ---

newGameBtn.addEventListener('click', generateNewGame);
sizeSelect.addEventListener('change', generateNewGame);
diffSelect.addEventListener('change', generateNewGame);
themeBtn.addEventListener('click', toggleTheme);
symbolModeSelect.addEventListener('change', () => {
  symbolMode = symbolModeSelect.value;
  renderBoard();
});

notesBtn.addEventListener('click', () => {
  notesMode = !notesMode;
  updateNotesModeUI();
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
clearBtn.addEventListener('click', clearSelectedCell);
hintBtn.addEventListener('click', showHint);
solveBtn.addEventListener('click', solveGame);
submitBtn.addEventListener('click', submitGame);
pauseBtn.addEventListener('click', togglePause);
resumeBtn.addEventListener('click', togglePause);

helpBtn.addEventListener('click', () => {
  helpModal.classList.add('active');
});
helpCloseBtn.addEventListener('click', () => {
  helpModal.classList.remove('active');
});
resultReviewBtn.addEventListener('click', () => {
  resultModal.classList.remove('active');
});
resultCloseBtn.addEventListener('click', () => {
  resultModal.classList.remove('active');
  generateNewGame();
});

// Close modals when clicking overlay
window.addEventListener('click', (e) => {
  if (e.target === helpModal) helpModal.classList.remove('active');
});

function toggleTheme() {
  theme = (theme === 'dark') ? 'light' : 'dark';
  applyTheme();
  localStorage.setItem('gigadusoku_theme', theme);
}

function applyTheme() {
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
  } else {
    document.body.classList.remove('light-theme');
    themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
  }
}

// Initialize Game
window.addEventListener('DOMContentLoaded', () => {
  // Load theme preference
  const savedTheme = localStorage.getItem('gigadusoku_theme');
  if (savedTheme) {
    theme = savedTheme;
  }
  applyTheme();

  // Check if there's a saved game, otherwise generate fresh
  const loaded = loadSavedGame();
  if (!loaded) {
    generateNewGame();
  }
});
