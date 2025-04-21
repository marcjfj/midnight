import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import path from "path";
import { v4 as uuidv4 } from "uuid";

// Define types for game state
interface Player {
  id: string;
  name: string;
}

interface GameState {
  players: Record<string, Player>;
  dice: number[];
  keptDice: boolean[];
  rollCount: number;
  currentPlayer: string | null;
  scores: Record<string, number>;
  roundScores: Record<string, number>;
  turnScore: number;
  mustKeepDie: boolean;
  isRolling: boolean;
  playerOrder: string[];
  playersPlayedThisRound: Set<string>;
  roundEnded: boolean;
  roundWinner: string | null;
}

// Define socket data type
interface SocketData {
  roomId?: string;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for now, restrict in production
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;

// --- Game State Management ---
// Store game states for multiple rooms, keyed by roomId
const rooms: Record<string, GameState> = {};

// Function to create the initial state for a new game room
function createInitialGameState(): GameState {
  return {
    players: {}, // Store player data keyed by socket.id
    dice: [0, 0, 0, 0, 0, 0], // Array to hold the values of 6 dice
    keptDice: [false, false, false, false, false, false], // Boolean array indicating which dice are kept
    rollCount: 0, // Number of rolls in the current turn
    currentPlayer: null, // socket.id of the player whose turn it is
    scores: {}, // Store scores keyed by socket.id
    roundScores: {}, // Store scores for the current round
    turnScore: 0, // Score accumulated in the current turn (needs proper implementation)
    mustKeepDie: false, // Player must keep a die after rolling to roll again
    isRolling: false, // <-- Add isRolling state
    playerOrder: [], // Track player order
    playersPlayedThisRound: new Set<string>(), // Track which players have played in the current round
    roundEnded: false, // Track if the round has ended
    roundWinner: null, // Track the round winner
    // Add room-specific properties if needed later
  };
}

// Helper function to get the next player *within a room*
function getNextPlayer(roomId: string): string | null {
  const roomState = rooms[roomId];
  if (!roomState) return null;

  // If using player order array
  if (roomState.playerOrder.length > 0) {
    const currentPlayerIndex = roomState.playerOrder.indexOf(
      roomState.currentPlayer || ""
    );
    if (currentPlayerIndex === -1 && roomState.playerOrder.length > 0) {
      return roomState.playerOrder[0];
    }
    const nextPlayerIndex =
      (currentPlayerIndex + 1) % roomState.playerOrder.length;
    return roomState.playerOrder[nextPlayerIndex];
  }

  // Fallback to using player keys if playerOrder is empty
  const playerIds = Object.keys(roomState.players);
  if (playerIds.length === 0) return null;
  const currentPlayerIndex = playerIds.indexOf(roomState.currentPlayer || "");
  // Ensure currentPlayer is actually in the room before calculating next index
  if (currentPlayerIndex === -1 && playerIds.length > 0) {
    // If current player wasn't found (e.g., disconnected), pick the first player
    return playerIds[0];
  }
  const nextPlayerIndex = (currentPlayerIndex + 1) % playerIds.length;
  return playerIds[nextPlayerIndex];
}

// Helper function to reset turn state *within a room*
function resetTurnState(roomId: string): void {
  const roomState = rooms[roomId];
  if (!roomState) return;
  roomState.dice = [0, 0, 0, 0, 0, 0];
  roomState.keptDice = [false, false, false, false, false, false];
  roomState.rollCount = 0;
  roomState.turnScore = 0; // Reset turn score
  roomState.mustKeepDie = false; // Can roll immediately at turn start
}

// Helper function to check if a round has ended
function checkRoundEnd(roomId: string): boolean {
  const roomState = rooms[roomId];
  if (!roomState) return false;

  // If all players have played their turn, the round has ended
  return (
    roomState.playersPlayedThisRound.size >=
    Object.keys(roomState.players).length
  );
}

// Helper function to determine the round winner
function determineRoundWinner(roomId: string): string | null {
  const roomState = rooms[roomId];
  if (!roomState) return null;

  let highestScore = -1;
  let winners: string[] = [];

  Object.entries(roomState.roundScores).forEach(([playerId, score]) => {
    if (score > highestScore) {
      highestScore = score;
      winners = [playerId];
    } else if (score === highestScore) {
      winners.push(playerId);
    }
  });

  // Return first winner if there's just one, or null if there's a tie
  return winners.length === 1 ? winners[0] : null;
}

// Helper function to start a new round
function startNewRound(roomId: string): void {
  const roomState = rooms[roomId];
  if (!roomState) return;

  // Reset round-specific state
  roomState.roundEnded = false;
  roomState.playersPlayedThisRound = new Set<string>();
  roomState.roundScores = {};

  // Reset cumulative scores for all players
  Object.keys(roomState.scores).forEach((playerId) => {
    roomState.scores[playerId] = 0;
  });

  // If there was a winner and they're still in the game, make them go first
  if (roomState.roundWinner && roomState.players[roomState.roundWinner]) {
    // Reorder players to have the winner go first
    const newPlayerOrder = [...roomState.playerOrder];
    const winnerIndex = newPlayerOrder.indexOf(roomState.roundWinner);

    if (winnerIndex !== -1) {
      // Remove winner from current position
      newPlayerOrder.splice(winnerIndex, 1);
      // Add winner at the beginning
      newPlayerOrder.unshift(roomState.roundWinner);
      roomState.playerOrder = newPlayerOrder;
    }

    roomState.currentPlayer = roomState.roundWinner;
  } else {
    // If no winner or they left, start with the first player in order
    roomState.currentPlayer =
      roomState.playerOrder.length > 0 ? roomState.playerOrder[0] : null;
  }

  // Reset turn state for the new round
  resetTurnState(roomId);
}

// --- End Game State Management ---

// Middleware to parse JSON bodies (needed for POST requests)
app.use(express.json());

// --- API Endpoints ---

// Endpoint to create a new game room
app.post("/api/create-room", (req, res) => {
  const roomId = uuidv4(); // Generate a unique room ID
  rooms[roomId] = createInitialGameState();
  console.log(`Room created: ${roomId}`);
  res.json({ roomId }); // Send the new room ID back to the client
});

// --- End API Endpoints ---

// Serve static files from the React app build directory
// This assumes the client build output is in 'client/dist' relative to the server directory
app.use(express.static(path.join(__dirname, "../../client/dist")));

io.on("connection", (socket: Socket) => {
  console.log("a user connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);

    // Use the stored roomId from socket data
    const roomId = (socket.data as SocketData).roomId;

    if (roomId && rooms[roomId]) {
      const roomState = rooms[roomId];
      delete roomState.players[socket.id];
      delete roomState.scores[socket.id];

      // If the disconnected player was the current player, advance the turn in that room
      if (roomState.currentPlayer === socket.id) {
        const nextPlayer = getNextPlayer(roomId);
        roomState.currentPlayer = nextPlayer;
        if (nextPlayer) {
          resetTurnState(roomId);
        } else {
          // Handle game end or reset if no players left in the room
          roomState.currentPlayer = null;
          console.log(`No players left in room ${roomId}.`);
          // Optionally delete the room after some inactivity?
          // delete rooms[roomId];
        }
      }
      // Broadcast the updated state *to that specific room*
      io.to(roomId).emit("gameStateUpdate", roomState);
    }
  });

  socket.on("rollDice", () => {
    // Use the stored roomId from socket data
    const roomId = (socket.data as SocketData).roomId;
    if (!roomId || !rooms[roomId]) {
      console.error(
        `Cannot roll dice: Socket ${socket.id} not in a valid room.`
      );
      return;
    }
    const roomState = rooms[roomId];

    if (socket.id !== roomState.currentPlayer) {
      console.log(
        `Player ${socket.id} tried to roll out of turn in room ${roomId}.`
      );
      return; // Not this player's turn
    }
    // Add check: Must have kept a die since last roll
    if (roomState.mustKeepDie) {
      console.log(
        `Player ${socket.id} tried to roll without keeping a die first in room ${roomId}.`
      );
      // Maybe send an error message to the client?
      return;
    }

    // Check if there are any dice left to roll
    const canRollAnyDice = roomState.keptDice.some((kept) => !kept);
    if (!canRollAnyDice && roomState.rollCount > 0) {
      // Added rollCount check to allow initial roll
      console.log(
        `Player ${socket.id} tried to roll when all dice are kept in room ${roomId}.`
      );
      // This is where "hot dice" logic would go if all kept dice scored
      // For now, just prevent rolling.
      return;
    }

    // --- Start Rolling State ---
    roomState.isRolling = true;
    // Emit update to start animation on clients
    io.to(roomId).emit("gameStateUpdate", roomState);
    // --- End Start Rolling State ---

    // Simulate roll delay (optional, but makes animation visible)
    // In a real scenario, the time between setting isRolling true/false
    // might be very short without an artificial delay.
    // Adjust delay as needed.
    setTimeout(() => {
      // Roll only the dice that are not kept
      for (let i = 0; i < 6; i++) {
        if (!roomState.keptDice[i]) {
          roomState.dice[i] = Math.floor(Math.random() * 6) + 1;
        }
      }
      roomState.rollCount++;
      roomState.mustKeepDie = true; // Set flag: Player must keep a die now
      roomState.isRolling = false; // <-- Set rolling to false *after* roll

      // TODO: Add check for BUST here (no scoring dice available on this roll)
      // If bust, end turn automatically

      console.log(
        `Player ${socket.id} in room ${roomId} rolled: `,
        roomState.dice,
        `(Roll ${roomState.rollCount})`
      );

      // Broadcast the final updated state *to the room*
      io.to(roomId).emit("gameStateUpdate", roomState);
    }, 1000); // 1 second delay to match client animation duration
  });

  socket.on("keepDice", (index: number) => {
    // Use the stored roomId from socket data
    const roomId = (socket.data as SocketData).roomId;
    if (!roomId || !rooms[roomId]) {
      console.error(
        `Cannot keep dice: Socket ${socket.id} not in a valid room.`
      );
      return;
    }
    const roomState = rooms[roomId];

    if (socket.id !== roomState.currentPlayer) {
      console.log(
        `Player ${socket.id} tried to keep dice out of turn in room ${roomId}.`
      );
      return; // Not this player's turn
    }
    // Player must have rolled at least once to keep dice
    if (roomState.rollCount === 0) {
      console.log(
        `Player ${socket.id} tried to keep dice before the first roll in room ${roomId}.`
      );
      return;
    }
    // Check if the index is valid
    if (index < 0 || index >= 6) {
      console.log(
        `Invalid keepDice index ${index} from ${socket.id} in room ${roomId}.`
      );
      return;
    }
    // Check if the die value is valid (not 0)
    if (roomState.dice[index] === 0) {
      console.log(
        `Player ${socket.id} tried to keep an unrolled die (index ${index}) in room ${roomId}.`
      );
      return;
    }

    // TODO: Add validation here: Can the selected die actually be kept?
    // This requires scoring logic to know if the die (or combination it forms) is valid.
    // For now, we allow keeping any die that has been rolled.

    const wasKept = roomState.keptDice[index];
    roomState.keptDice[index] = !wasKept; // Toggle keep status

    // If a die was just set to kept, it satisfies the 'mustKeepDie' condition
    if (roomState.keptDice[index]) {
      roomState.mustKeepDie = false;
    } else {
      // If a die was un-kept, check if any *other* dice are still kept from this roll.
      // If not, the player must keep a die again.
      // This requires knowing which dice were kept *before* this specific toggle.
      // This simple toggle might be insufficient. We might need separate "selected" vs "locked" states.
      // For now, let's stick to the simpler logic: un-keeping requires re-keeping *something*.
      const anyDieKept = roomState.keptDice.some((kept) => kept);
      if (!anyDieKept) {
        roomState.mustKeepDie = true;
      }
    }

    console.log(
      `Player ${socket.id} in room ${roomId} toggled keep for die index ${index}:`,
      roomState.keptDice
    );
    // Broadcast the updated state *to the room*
    io.to(roomId).emit("gameStateUpdate", roomState);
  });

  socket.on("joinRoom", (roomId: string, playerName: string) => {
    if (!rooms[roomId]) {
      // Handle invalid room ID
      socket.emit("error", { message: "Room not found" });
      console.log(
        `Socket ${socket.id} tried to join non-existent room ${roomId}`
      );
      return;
    }

    // Join the Socket.IO room
    socket.join(roomId);

    // Add player to the room's state using the provided name
    const roomState = rooms[roomId];
    const safePlayerName = playerName?.trim()
      ? playerName.trim()
      : `Player_${socket.id.substring(0, 4)}`; // Sanitize and provide default
    roomState.players[socket.id] = {
      id: socket.id,
      name: safePlayerName, // Use the provided or default name
    };
    // Initialize score if not already present (e.g., reconnect)
    if (roomState.scores[socket.id] === undefined) {
      roomState.scores[socket.id] = 0;
    }
    if (roomState.roundScores[socket.id] === undefined) {
      roomState.roundScores[socket.id] = 0;
    }

    // Add player to player order if not already in it
    if (!roomState.playerOrder.includes(socket.id)) {
      roomState.playerOrder.push(socket.id);
    }

    // If this is the first player joining this specific room, make it their turn
    if (!roomState.currentPlayer) {
      roomState.currentPlayer = socket.id;
      resetTurnState(roomId); // Initialize dice/roll count for the first turn in this room
    }

    console.log(
      `Socket ${socket.id} (${safePlayerName}) joined room ${roomId}`
    );

    // Send the current room state to the newly joined client
    socket.emit("gameStateUpdate", roomState);

    // Broadcast the updated room state (specifically player list) to everyone in the room
    io.to(roomId).emit("gameStateUpdate", roomState); // Send full state for simplicity

    // Store the room ID on the socket data
    socket.data = { ...socket.data, roomId: roomId };
  });

  // Add play again event handler
  socket.on("playAgain", () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) {
      console.error(
        `Cannot start new round: Socket ${socket.id} not in a valid room.`
      );
      return;
    }

    // Only allow initiating a new round if the current round has ended
    const roomState = rooms[roomId];
    if (!roomState.roundEnded) {
      console.log(
        `Player ${socket.id} tried to start a new round before the current one ended in room ${roomId}.`
      );
      return;
    }

    // Start a new round
    startNewRound(roomId);
    console.log(`New round started in room ${roomId}`);

    // Broadcast the updated state to the room
    io.to(roomId).emit("gameStateUpdate", roomState);
  });

  // Update endTurn to track round progress and detect round end
  socket.on("endTurn", () => {
    // Use the stored roomId from socket data
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) {
      console.error(
        `Cannot end turn: Socket ${socket.id} not in a valid room.`
      );
      return;
    }
    const roomState = rooms[roomId];

    if (socket.id !== roomState.currentPlayer) {
      console.log(
        `Player ${socket.id} tried to end turn out of turn in room ${roomId}.`
      );
      return; // Not this player's turn
    }

    // --- Scoring Logic (using roomState) ---
    let turnScore = 0;
    const hasOne = roomState.dice.some(
      (die, i) => roomState.keptDice[i] && die === 1
    );
    const hasFour = roomState.dice.some(
      (die, i) => roomState.keptDice[i] && die === 4
    );

    if (hasOne && hasFour) {
      for (let i = 0; i < 6; i++) {
        if (
          roomState.keptDice[i] &&
          roomState.dice[i] !== 1 &&
          roomState.dice[i] !== 4
        ) {
          turnScore += roomState.dice[i];
        }
      }
    }

    roomState.scores[socket.id] += turnScore;
    roomState.roundScores[socket.id] = turnScore; // Track round-specific score
    console.log(
      `Player ${
        socket.id
      } in room ${roomId} ended turn with score ${turnScore}. Total score: ${
        roomState.scores[socket.id]
      }`
    );
    // --- End Scoring Logic ---

    // Mark this player as having played this round
    roomState.playersPlayedThisRound.add(socket.id);

    // Check if the round has ended (all players have played)
    const roundEnded = checkRoundEnd(roomId);
    if (roundEnded) {
      // Determine the round winner
      const roundWinner = determineRoundWinner(roomId);
      roomState.roundEnded = true;
      roomState.roundWinner = roundWinner;

      console.log(
        `Round ended in room ${roomId}. Winner: ${roundWinner || "Tie"}`
      );

      // Broadcast the updated state with round end information
      io.to(roomId).emit("gameStateUpdate", roomState);
      return;
    }

    // If the round hasn't ended, advance to the next player in the room
    const nextPlayer = getNextPlayer(roomId);
    roomState.currentPlayer = nextPlayer;
    if (nextPlayer) {
      resetTurnState(roomId);
      console.log(`Turn advanced to player ${nextPlayer} in room ${roomId}`);
    } else {
      roomState.currentPlayer = null;
      console.log(`Last player finished turn in room ${roomId}.`);
      // Optionally delete room or declare winner
    }

    // Broadcast the updated state *to the room*
    io.to(roomId).emit("gameStateUpdate", roomState);
  });
});

// All other GET requests not handled before will return the React app
// This is important for client-side routing
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../../client/dist", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
