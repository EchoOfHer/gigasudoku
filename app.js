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
const clearBtn = document.getElementById('clear-btn');
const helpBtn = document.getElementById('help-btn');

// Modals
const helpModal = document.getElementById('help-modal');
const winModal = document.getElementById('win-modal');
const pauseModal = document.getElementById('pause-modal');
const helpCloseBtn = document.getElementById('help-close-btn');
const winCloseBtn = document.getElementById('win-close-btn');
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
      resetZoomPan();
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
        triggerWin();
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
    fillCell(selectedCell, correctVal);
    checkValidation();
  }
}

function clearSelectedCell() {
  if (selectedCell === null || givenIndices.has(selectedCell)) return;
  pushHistory();
  boardState[selectedCell] = null;
  boardNotes[selectedCell] = [];
  renderBoard();
  updateProgress();
  checkValidation();
}

function fillCell(index, value) {
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
  if (isPaused) return;
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

// --- Zoom & Pan Logic ---

function setZoomPan() {
  // Clamp boundaries for zoom
  zoom = Math.max(0.4, Math.min(zoom, 3.0));
  
  // Constrain panning to keep board in viewport
  const viewportRect = boardViewport.getBoundingClientRect();
  const boardSize = 600 * zoom;
  
  const minPanX = -boardSize + 100;
  const maxPanX = viewportRect.width - 100;
  const minPanY = -boardSize + 100;
  const maxPanY = viewportRect.height - 100;

  panX = Math.max(minPanX, Math.min(panX, maxPanX));
  panY = Math.max(minPanY, Math.min(panY, maxPanY));

  // Set CSS Variables
  sudokuBoardEl.style.setProperty('--zoom', zoom);
  sudokuBoardEl.style.setProperty('--pan-x', `${panX}px`);
  sudokuBoardEl.style.setProperty('--pan-y', `${panY}px`);
}

function resetZoomPan() {
  // Center board inside the viewport wrapper
  const containerRect = boardViewport.getBoundingClientRect();
  const width = containerRect.width || 600;
  
  // Fit 25x25 and 36x36 initially
  if (size === 25) {
    zoom = width / 600;
  } else if (size === 36) {
    zoom = width / 600;
  } else {
    zoom = 1.0;
  }
  
  panX = 0;
  panY = 0;
  setZoomPan();
}

// Wheel zoom relative to cursor position
boardViewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  
  const rect = boardViewport.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Mouse coords relative to board origin before zoom
  const boardX = (mouseX - panX) / zoom;
  const boardY = (mouseY - panY) / zoom;

  const zoomFactor = 1.1;
  if (e.deltaY < 0) {
    zoom *= zoomFactor;
  } else {
    zoom /= zoomFactor;
  }

  // Adjust pans so mouse coordinate is preserved
  zoom = Math.max(0.4, Math.min(zoom, 3.0));
  panX = mouseX - boardX * zoom;
  panY = mouseY - boardY * zoom;

  setZoomPan();
}, { passive: false });

// Pan drag start
boardViewport.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('sudoku-cell') || e.target.closest('.notes-container')) {
    // Allow cellular clicking without panning trigger unless they drag
  }
  isPanning = true;
  startPanX = e.clientX - panX;
  startPanY = e.clientY - panY;
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  panX = e.clientX - startPanX;
  panY = e.clientY - startPanY;
  setZoomPan();
});

window.addEventListener('mouseup', () => {
  isPanning = false;
});

// Touch controls for mobile devices
boardViewport.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    isPanning = true;
    startPanX = e.touches[0].clientX - panX;
    startPanY = e.touches[0].clientY - panY;
  }
});

boardViewport.addEventListener('touchmove', (e) => {
  if (!isPanning || e.touches.length !== 1) return;
  panX = e.touches[0].clientX - startPanX;
  panY = e.touches[0].clientY - startPanY;
  setZoomPan();
});

boardViewport.addEventListener('touchend', () => {
  isPanning = false;
});

// Zoom helper events
document.getElementById('zoom-in-btn').addEventListener('click', () => {
  zoom *= 1.2;
  setZoomPan();
});
document.getElementById('zoom-out-btn').addEventListener('click', () => {
  zoom /= 1.2;
  setZoomPan();
});
document.getElementById('zoom-reset-btn').addEventListener('click', () => {
  resetZoomPan();
});
boardViewport.addEventListener('dblclick', resetZoomPan);

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

function showLoader(message) {
  loaderText.textContent = message;
  boardLoader.classList.add('active');
}

function hideLoader() {
  boardLoader.classList.remove('active');
}

// --- Winning Ceremony ---

function triggerWin() {
  stopTimer();
  
  // Set modal texts
  document.getElementById('win-grid-size').textContent = `${size}x${size}`;
  document.getElementById('win-difficulty').textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  
  const hrs = Math.floor(timerSeconds / 3600);
  const mins = Math.floor((timerSeconds % 3600) / 60);
  const secs = timerSeconds % 60;
  document.getElementById('win-time').textContent = `${hrs > 0 ? hrs + 'h ' : ''}${mins}m ${secs}s`;

  winModal.classList.add('active');
  
  // Add animation to the board
  sudokuBoardEl.classList.add('board-solved-animate');
  setTimeout(() => {
    sudokuBoardEl.classList.remove('board-solved-animate');
  }, 1000);

  // Clear save state
  localStorage.removeItem('gigadusoku_save_state');
}

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
    errorIndices: Array.from(errorIndices)
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

    // Set UI dropdown selections
    sizeSelect.value = size;
    diffSelect.value = difficulty;
    symbolModeSelect.value = symbolMode;

    document.getElementById('stat-grid-size').textContent = `${size}x${size}`;
    document.getElementById('stat-difficulty').textContent = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
    
    // Update CSS custom property for grid size
    document.documentElement.style.setProperty('--grid-size', size);
    
    initWorker();
    
    renderBoard();
    updateProgress();
    updateTimerUI();
    startTimer();
    
    // Reset view
    setTimeout(resetZoomPan, 100);

    return true;
  } catch (err) {
    console.error("Failed to load saved state:", err);
    return false;
  }
}

// --- Keyboard Event Handlers ---

window.addEventListener('keydown', (e) => {
  if (selectedCell === null || isPaused) return;

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

pauseBtn.addEventListener('click', togglePause);
resumeBtn.addEventListener('click', togglePause);

helpBtn.addEventListener('click', () => {
  helpModal.classList.add('active');
});
helpCloseBtn.addEventListener('click', () => {
  helpModal.classList.remove('active');
});
winCloseBtn.addEventListener('click', () => {
  winModal.classList.remove('active');
  generateNewGame();
});

// Close modals when clicking overlay
window.addEventListener('click', (e) => {
  if (e.target === helpModal) helpModal.classList.remove('active');
});

// Initialize Game
window.addEventListener('DOMContentLoaded', () => {
  // Check if there's a saved game, otherwise generate fresh
  const loaded = loadSavedGame();
  if (!loaded) {
    generateNewGame();
  }
});
