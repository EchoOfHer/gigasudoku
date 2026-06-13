// Web Worker for Sudoku Game Engine
// Handles computationally intensive operations in the background to prevent UI stuttering.

self.onmessage = function (e) {
  const { type, size, difficulty, board } = e.data;

  try {
    if (type === 'generate') {
      const { puzzle, solution } = generateSudoku(size, difficulty);
      self.postMessage({ type: 'generate', success: true, puzzle, solution });
    } else if (type === 'solve') {
      const solution = solveSudoku(board);
      if (solution) {
        self.postMessage({ type: 'solve', success: true, solution });
      } else {
        self.postMessage({ type: 'solve', success: false });
      }
    } else if (type === 'validate') {
      const validation = validateBoard(board);
      self.postMessage({ type: 'validate', ...validation });
    } else if (type === 'submit_check') {
      const solution = solveSudoku(board);
      self.postMessage({
        type: 'submit_check',
        success: !!solution,
        userSolution: solution
      });
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};

// --- Helper Data Structures & Constants ---

function getBlockSize(size) {
  return Math.sqrt(size) | 0; // 9 -> 3, 16 -> 4, 25 -> 5, 36 -> 6
}

// --- Generator Algorithm ---

function generateSudoku(size, difficulty) {
  const K = getBlockSize(size);
  
  // 1. Generate a valid base solved board using mathematical shifting.
  // S(r, c) = ((r % K) * K + floor(r / K) + c) % N
  let baseBoard = [];
  for (let r = 0; r < size; r++) {
    baseBoard[r] = [];
    for (let c = 0; c < size; c++) {
      baseBoard[r][c] = ((r % K) * K + Math.floor(r / K) + c) % size + 1;
    }
  }

  // 2. Shuffle the board using symmetry-preserving transformations.
  // Swap symbols
  const symbols = Array.from({ length: size }, (_, i) => i + 1);
  shuffleArray(symbols);
  const symbolMap = {};
  for (let i = 0; i < size; i++) {
    symbolMap[i + 1] = symbols[i];
  }

  // Apply symbol mapping
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      baseBoard[r][c] = symbolMap[baseBoard[r][c]];
    }
  }

  // Swap rows within block rows
  for (let b = 0; b < K; b++) {
    // block rows are b * K to (b + 1) * K - 1
    const rowIndices = Array.from({ length: K }, (_, i) => b * K + i);
    shuffleArray(rowIndices);
    const tempRows = rowIndices.map(idx => [...baseBoard[idx]]);
    for (let i = 0; i < K; i++) {
      baseBoard[b * K + i] = tempRows[i];
    }
  }

  // Swap columns within block columns
  for (let b = 0; b < K; b++) {
    const colIndices = Array.from({ length: K }, (_, i) => b * K + i);
    shuffleArray(colIndices);
    for (let r = 0; r < size; r++) {
      const tempColValues = colIndices.map(idx => baseBoard[r][idx]);
      for (let i = 0; i < K; i++) {
        baseBoard[r][b * K + i] = tempColValues[i];
      }
    }
  }

  // Swap block rows
  const blockRowIndices = Array.from({ length: K }, (_, i) => i);
  shuffleArray(blockRowIndices);
  const tempBlockRows = [];
  for (let i = 0; i < K; i++) {
    const blockIdx = blockRowIndices[i];
    tempBlockRows.push(baseBoard.slice(blockIdx * K, (blockIdx + 1) * K));
  }
  let rowIndex = 0;
  for (let i = 0; i < K; i++) {
    for (let r = 0; r < K; r++) {
      baseBoard[rowIndex++] = tempBlockRows[i][r];
    }
  }

  // Swap block columns
  const blockColIndices = Array.from({ length: K }, (_, i) => i);
  shuffleArray(blockColIndices);
  for (let r = 0; r < size; r++) {
    const newRow = [];
    for (let i = 0; i < K; i++) {
      const blockIdx = blockColIndices[i];
      for (let c = 0; c < K; c++) {
        newRow.push(baseBoard[r][blockIdx * K + c]);
      }
    }
    baseBoard[r] = newRow;
  }

  // Flat clone of the fully solved board
  const solution = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      solution.push(baseBoard[r][c]);
    }
  }

  // 3. Remove cells based on difficulty
  // Define clue percentage (remaining cells)
  let clueRatio = 0.5;
  switch (difficulty) {
    case 'easy': clueRatio = 0.55; break;
    case 'medium': clueRatio = 0.42; break;
    case 'hard': clueRatio = 0.28; break;
    case 'expert': clueRatio = 0.18; break;
  }

  const puzzle = [...solution];
  const totalCells = size * size;
  const cellsToRemove = Math.floor(totalCells * (1 - clueRatio));

  // Generate random cells list and shuffle it
  const cellIndices = Array.from({ length: totalCells }, (_, i) => i);
  shuffleArray(cellIndices);

  // Remove cells
  for (let i = 0; i < cellsToRemove; i++) {
    const idx = cellIndices[i];
    puzzle[idx] = null; // empty cell
  }

  return { puzzle, solution };
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// --- Solver Algorithm (Backtracking with MRV & Forward Checking) ---

function solveSudoku(flatBoard) {
  const size = Math.sqrt(flatBoard.length) | 0;
  const K = getBlockSize(size);

  // Initialize constraint trackers
  const rowUsed = Array.from({ length: size }, () => Array(size + 1).fill(false));
  const colUsed = Array.from({ length: size }, () => Array(size + 1).fill(false));
  const boxUsed = Array.from({ length: size }, () => Array(size + 1).fill(false));

  const board2D = [];
  for (let r = 0; r < size; r++) {
    board2D[r] = [];
    for (let c = 0; c < size; c++) {
      const val = flatBoard[r * size + c];
      board2D[r][c] = val;
      if (val !== null && val !== undefined && val !== "") {
        const numVal = parseInt(val, 10);
        const boxIdx = Math.floor(r / K) * K + Math.floor(c / K);
        if (rowUsed[r][numVal] || colUsed[c][numVal] || boxUsed[boxIdx][numVal]) {
          return null; // Initial duplicate exists, board is unsolvable
        }
        rowUsed[r][numVal] = true;
        colUsed[c][numVal] = true;
        boxUsed[boxIdx][numVal] = true;
      }
    }
  }

  function getPossibleValues(r, c) {
    const boxIdx = Math.floor(r / K) * K + Math.floor(c / K);
    const possible = [];
    for (let val = 1; val <= size; val++) {
      if (!rowUsed[r][val] && !colUsed[c][val] && !boxUsed[boxIdx][val]) {
        possible.push(val);
      }
    }
    return possible;
  }

  // Backtracking function with MRV
  function backtrack() {
    let minPossibilities = size + 1;
    let bestRow = -1;
    let bestCol = -1;
    let bestPossibilities = [];

    // Find empty cell with minimum remaining values (MRV)
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board2D[r][c] === null || board2D[r][c] === undefined || board2D[r][c] === "") {
          const possible = getPossibleValues(r, c);
          if (possible.length < minPossibilities) {
            minPossibilities = possible.length;
            bestRow = r;
            bestCol = c;
            bestPossibilities = possible;
            if (minPossibilities === 0) {
              return false; // Dead end
            }
          }
        }
      }
    }

    // No empty cells left, solved!
    if (bestRow === -1) {
      return true;
    }

    const boxIdx = Math.floor(bestRow / K) * K + Math.floor(bestCol / K);

    // Try values
    for (let i = 0; i < bestPossibilities.length; i++) {
      const val = bestPossibilities[i];

      // Place
      board2D[bestRow][bestCol] = val;
      rowUsed[bestRow][val] = true;
      colUsed[bestCol][val] = true;
      boxUsed[boxIdx][val] = true;

      // Recurse
      if (backtrack()) {
        return true;
      }

      // Undo
      board2D[bestRow][bestCol] = null;
      rowUsed[bestRow][val] = false;
      colUsed[bestCol][val] = false;
      boxUsed[boxIdx][val] = false;
    }

    return false; // Backtrack
  }

  const success = backtrack();
  if (!success) return null;

  // Flatten the result
  const flatSolution = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      flatSolution.push(board2D[r][c]);
    }
  }
  return flatSolution;
}

// --- Validator Algorithm ---

function validateBoard(flatBoard) {
  const size = Math.sqrt(flatBoard.length) | 0;
  const K = getBlockSize(size);

  const errors = new Set(); // Stores indices of conflicting cells
  const rowMaps = Array.from({ length: size }, () => ({}));
  const colMaps = Array.from({ length: size }, () => ({}));
  const boxMaps = Array.from({ length: size }, () => ({}));

  // Populate maps and check for immediate duplicates
  for (let i = 0; i < flatBoard.length; i++) {
    const val = flatBoard[i];
    if (val === null || val === undefined || val === "") continue;

    const r = Math.floor(i / size);
    const c = i % size;
    const b = Math.floor(r / K) * K + Math.floor(c / K);

    // Row check
    if (rowMaps[r][val] !== undefined) {
      errors.add(i);
      errors.add(rowMaps[r][val]);
    } else {
      rowMaps[r][val] = i;
    }

    // Col check
    if (colMaps[c][val] !== undefined) {
      errors.add(i);
      errors.add(colMaps[c][val]);
    } else {
      colMaps[c][val] = i;
    }

    // Box check
    if (boxMaps[b][val] !== undefined) {
      errors.add(i);
      errors.add(boxMaps[b][val]);
    } else {
      boxMaps[b][val] = i;
    }
  }

  // Count empty spaces
  let emptyCells = 0;
  for (let i = 0; i < flatBoard.length; i++) {
    if (flatBoard[i] === null || flatBoard[i] === undefined || flatBoard[i] === "") {
      emptyCells++;
    }
  }

  return {
    isValid: errors.size === 0,
    errors: Array.from(errors),
    isComplete: errors.size === 0 && emptyCells === 0
  };
}
