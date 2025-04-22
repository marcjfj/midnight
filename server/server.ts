import dotenv from "dotenv";
dotenv.config(); // Load .env file

import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import Redis from "ioredis";

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
  playersPlayedThisRound: string[];
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

// --- Redis Initialization ---
// Render provides the connection string via REDIS_URL
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error("REDIS_URL environment variable not set!");
  process.exit(1); // Exit if Redis isn't configured
}
const redis = new Redis(redisUrl);

redis.on("connect", () => {
  console.log("Connected to Redis");
});
redis.on("error", (err) => {
  console.error("Redis connection error:", err);
  // Consider how to handle runtime errors - maybe attempt reconnect or shutdown gracefully
});
// --- End Redis Initialization ---

// --- Game State Management ---
// Remove the in-memory rooms object
// const rooms: Record<string, GameState> = {}; // <-- REMOVE THIS LINE

// Helper function to get game state from Redis
async function getGameState(roomId: string): Promise<GameState | null> {
  console.log(`[getGameState] Attempting to get state for room: ${roomId}`);
  const stateString = await redis.get(`room:${roomId}`); // Use prefix for clarity
  if (!stateString) {
    console.log(`[getGameState] No state found in Redis for room: ${roomId}`);
    return null;
  }
  console.log(`[getGameState] Found state string for room: ${roomId}`);
  try {
    const state = JSON.parse(stateString) as GameState;
    // Ensure playersPlayedThisRound is always an array (handles potential old data)
    state.playersPlayedThisRound = state.playersPlayedThisRound || [];
    console.log(`[getGameState] Successfully parsed state for room: ${roomId}`);
    return state;
  } catch (error) {
    console.error(
      `[getGameState] Failed to parse state for room ${roomId}:`,
      error
    );
    console.error(`[getGameState] Corrupted state string: ${stateString}`);
    // Decide how to handle corruption, e.g., delete the key?
    // await deleteGameState(roomId);
    return null; // Return null if parsing fails
  }
}

// Helper function to save game state to Redis
async function saveGameState(roomId: string, state: GameState): Promise<void> {
  console.log(`[saveGameState] Attempting to save state for room: ${roomId}`);
  try {
    // Ensure playersPlayedThisRound is an array before saving
    if (state.playersPlayedThisRound instanceof Set) {
      console.warn(
        `[saveGameState] Converting Set to array for storage in room ${roomId}`
      );
      state.playersPlayedThisRound = Array.from(state.playersPlayedThisRound);
    }
    const stateString = JSON.stringify(state);
    await redis.set(`room:${roomId}`, stateString);
    console.log(`[saveGameState] Successfully saved state for room: ${roomId}`);
    // Consider setting an expiration (TTL) for rooms if needed, e.g., 24 hours
    // await redis.expire(`room:${roomId}`, 60 * 60 * 24);
  } catch (error) {
    console.error(
      `[saveGameState] Failed to save state for room ${roomId}:`,
      error
    );
    // Rethrow or handle as appropriate for the application context
    throw error;
  }
}

// Helper function to delete game state from Redis
async function deleteGameState(roomId: string): Promise<void> {
  await redis.del(`room:${roomId}`);
}

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
    playersPlayedThisRound: [], // <-- Initialize as empty array
    roundEnded: false, // Track if the round has ended
    roundWinner: null, // Track the round winner
    // Add room-specific properties if needed later
  };
}

// Helper function to get the next player *within a room*
function getNextPlayer(roomState: GameState): string | null {
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
function resetTurnState(roomState: GameState): void {
  if (!roomState) return;
  roomState.dice = [0, 0, 0, 0, 0, 0];
  roomState.keptDice = [false, false, false, false, false, false];
  roomState.rollCount = 0;
  roomState.turnScore = 0; // Reset turn score
  roomState.mustKeepDie = false; // Can roll immediately at turn start
}

// Helper function to check if a round has ended
function checkRoundEnd(roomState: GameState): boolean {
  if (!roomState) return false;

  // Convert array back to Set for size comparison logic
  const playedSet = new Set(roomState.playersPlayedThisRound);
  return playedSet.size >= Object.keys(roomState.players).length;
}

// Helper function to determine the round winner
function determineRoundWinner(roomState: GameState): string | null {
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
async function startNewRound(roomId: string): Promise<void> {
  const roomState = await getGameState(roomId);
  if (!roomState) return;

  // Reset round-specific state
  roomState.roundEnded = false;
  roomState.playersPlayedThisRound = []; // Reset to empty array
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
  resetTurnState(roomState); // Pass state directly

  // Save the updated state back to Redis
  await saveGameState(roomId, roomState);
}

// --- End Game State Management ---

// Middleware to parse JSON bodies (needed for POST requests)
app.use(express.json());

// --- API Endpoints ---

// Endpoint to create a new game room
app.post("/api/create-room", async (req, res) => {
  const roomId = uuidv4(); // Generate a unique room ID
  console.log(
    `[/api/create-room] Request received, generated roomId: ${roomId}`
  );
  const initialState = createInitialGameState();
  try {
    console.log(
      `[/api/create-room] Attempting to save initial state for room: ${roomId}`
    );
    await saveGameState(roomId, initialState); // <-- Save to Redis
    console.log(
      `[/api/create-room] Successfully saved initial state for room: ${roomId}`
    );
    res.json({ roomId }); // Send the new room ID back to the client
  } catch (error) {
    // Log the specific error from saveGameState if it throws
    console.error(
      `[/api/create-room] Failed to save initial state for room ${roomId}:`,
      error
    );
    res.status(500).json({ message: "Failed to create room" });
  }
});

// --- End API Endpoints ---

// Serve static files from the React app build directory
// This assumes the client build output is in 'client/dist' relative to the server directory
app.use(express.static(path.join(__dirname, "../../client/dist")));

io.on("connection", (socket: Socket) => {
  console.log("a user connected:", socket.id);

  socket.on("disconnect", async () => {
    console.log("user disconnected:", socket.id);

    // Use the stored roomId from socket data
    const roomId = (socket.data as SocketData).roomId;

    if (roomId) {
      const roomState = await getGameState(roomId); // <-- Get from Redis
      if (roomState) {
        const wasCurrentPlayer = roomState.currentPlayer === socket.id;

        // Remove player data
        delete roomState.players[socket.id];
        delete roomState.scores[socket.id];
        delete roomState.roundScores[socket.id]; // Also remove from round scores
        roomState.playerOrder = roomState.playerOrder.filter(
          (id) => id !== socket.id
        );
        // Remove from playersPlayedThisRound array if present
        const playedIndex = roomState.playersPlayedThisRound.indexOf(socket.id);
        if (playedIndex > -1) {
          roomState.playersPlayedThisRound.splice(playedIndex, 1);
        }

        // If the disconnected player was the current player, advance the turn
        if (wasCurrentPlayer) {
          const nextPlayer = getNextPlayer(roomState); // Pass state directly
          roomState.currentPlayer = nextPlayer;
          if (nextPlayer) {
            resetTurnState(roomState); // Pass state directly
          } else {
            // Handle game end or reset if no players left in the room
            roomState.currentPlayer = null;
            console.log(`No players left in room ${roomId}.`);
            // Optionally delete the room after some inactivity?
            // await deleteGameState(roomId); // <-- Delete from Redis if needed
          }
        }

        // Check if any players remain
        if (Object.keys(roomState.players).length > 0) {
          // Save the updated state back to Redis
          await saveGameState(roomId, roomState); // <-- Save to Redis
          // Broadcast the updated state *to that specific room*
          io.to(roomId).emit("gameStateUpdate", roomState);
        } else {
          // No players left, delete the room from Redis
          console.log(`Deleting empty room ${roomId} from Redis.`);
          await deleteGameState(roomId); // <-- Delete from Redis
        }
      } else {
        console.log(
          `Room ${roomId} not found in Redis during disconnect for socket ${socket.id}.`
        );
      }
    }
  });

  socket.on("rollDice", async () => {
    // Use the stored roomId from socket data
    const roomId = (socket.data as SocketData).roomId;
    if (!roomId) {
      console.error(
        `Cannot roll dice: Socket ${socket.id} not associated with a room.`
      );
      return; // No room associated
    }

    const roomState = await getGameState(roomId); // <-- Get from Redis
    if (!roomState) {
      console.error(
        `Cannot roll dice: Room ${roomId} not found in Redis for socket ${socket.id}.`
      );
      // Maybe emit an error to the client?
      socket.emit("error", {
        message: "Game room data not found. Please rejoin.",
      });
      return;
    }
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
    // Save state before emitting to show rolling animation immediately
    await saveGameState(roomId, roomState); // <-- Save rolling state
    // Emit update to start animation on clients
    io.to(roomId).emit("gameStateUpdate", roomState);
    // --- End Start Rolling State ---

    // Simulate roll delay
    setTimeout(async () => {
      // <-- Add async to timeout callback
      // Re-fetch state in case something changed during the delay
      const currentState = await getGameState(roomId);
      if (
        !currentState ||
        currentState.currentPlayer !== socket.id ||
        !currentState.isRolling
      ) {
        console.log(
          `Roll cancelled for ${socket.id} in room ${roomId} due to state change during delay.`
        );
        return; // State changed, abort the roll result
      }

      // Roll only the dice that are not kept
      for (let i = 0; i < 6; i++) {
        if (!currentState.keptDice[i]) {
          currentState.dice[i] = Math.floor(Math.random() * 6) + 1;
        }
      }
      currentState.rollCount++;
      currentState.mustKeepDie = true; // Set flag: Player must keep a die now
      currentState.isRolling = false; // <-- Set rolling to false *after* roll

      // TODO: Add check for BUST here

      console.log(
        `Player ${socket.id} in room ${roomId} rolled: `,
        currentState.dice,
        `(Roll ${currentState.rollCount})`
      );

      // Save the final updated state *to Redis*
      await saveGameState(roomId, currentState); // <-- Save updated state
      // Broadcast the final updated state *to the room*
      io.to(roomId).emit("gameStateUpdate", currentState);
    }, 1000); // 1 second delay to match client animation duration
  });

  socket.on("keepDice", async (index: number) => {
    const roomId = (socket.data as SocketData).roomId;
    if (!roomId) {
      console.error(
        `Cannot keep dice: Socket ${socket.id} not associated with a room.`
      );
      return;
    }

    const roomState = await getGameState(roomId); // <-- Get from Redis
    if (!roomState) {
      console.error(
        `Cannot keep dice: Room ${roomId} not found for socket ${socket.id}.`
      );
      socket.emit("error", {
        message: "Game room data not found. Please rejoin.",
      });
      return;
    }
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

    const wasKept = roomState.keptDice[index];
    roomState.keptDice[index] = !wasKept; // Toggle keep status

    // If a die was just set to kept, it satisfies the 'mustKeepDie' condition
    if (roomState.keptDice[index]) {
      roomState.mustKeepDie = false;
    } else {
      // If a die was un-kept, check if any *other* dice are still kept from this roll.
      const anyDieKept = roomState.keptDice.some((kept) => kept);
      if (!anyDieKept) {
        roomState.mustKeepDie = true;
      }
    }

    console.log(
      `Player ${socket.id} in room ${roomId} toggled keep for die index ${index}:`,
      roomState.keptDice
    );
    // Save the updated state *to Redis*
    await saveGameState(roomId, roomState); // <-- Save updated state
    // Broadcast the updated state *to the room*
    io.to(roomId).emit("gameStateUpdate", roomState);
  });

  socket.on("joinRoom", async (roomId: string, playerName: string) => {
    console.log(
      `[joinRoom] User ${socket.id} attempting to join room: ${roomId} as ${playerName}`
    );

    // --- Initial Fetch ---
    console.log(`[joinRoom] Attempting initial fetch for room: ${roomId}`);
    let roomState = await getGameState(roomId); // <-- Get from Redis

    // Retry logic: If room not found, wait briefly and try again
    if (!roomState) {
      console.log(
        `[joinRoom] Room ${roomId} not found initially for ${socket.id}. Retrying once after delay...`
      );
      await new Promise((resolve) => setTimeout(resolve, 250)); // Wait 250ms
      // --- Retry Fetch ---
      console.log(`[joinRoom] Attempting retry fetch for room: ${roomId}`);
      roomState = await getGameState(roomId); // Try fetching again
    }

    if (!roomState) {
      // Handle invalid room ID after retry
      console.error(
        `[joinRoom] Room ${roomId} still not found for ${socket.id} after retry. Emitting error.`
      );
      socket.emit("error", { message: "Room not found" });
      return;
    }

    console.log(
      `[joinRoom] Successfully fetched state for room: ${roomId}. Proceeding with join.`
    );

    // Join the Socket.IO room
    socket.join(roomId);
    console.log(
      `[joinRoom] Socket ${socket.id} joined Socket.IO room: ${roomId}`
    );

    // Add player to the room's state using the provided name
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
      console.log(
        `[joinRoom] Added ${socket.id} to playerOrder for room: ${roomId}`
      );
    }

    // If this is the first player joining this specific room, make it their turn
    if (!roomState.currentPlayer) {
      roomState.currentPlayer = socket.id;
      resetTurnState(roomState); // Pass state directly
      console.log(
        `[joinRoom] Set ${socket.id} as currentPlayer for room: ${roomId}`
      );
    }

    console.log(
      `[joinRoom] Attempting to save updated state after player join for room: ${roomId}`
    );
    // Save the updated state *to Redis*
    await saveGameState(roomId, roomState);
    console.log(
      `[joinRoom] Successfully saved updated state after player join for room: ${roomId}`
    );

    // Send the current room state to the newly joined client
    socket.emit("gameStateUpdate", roomState);
    console.log(
      `[joinRoom] Emitted gameStateUpdate to joining socket ${socket.id}`
    );

    // Broadcast the updated room state to everyone in the room
    io.to(roomId).emit("gameStateUpdate", roomState); // Send full state
    console.log(`[joinRoom] Broadcasted gameStateUpdate to room ${roomId}`);

    // Store the room ID on the socket data
    socket.data = { ...socket.data, roomId: roomId };
    console.log(
      `[joinRoom] Stored roomId ${roomId} in socket data for ${socket.id}`
    );
  });

  // Make playAgain handler async for Redis operations
  socket.on("playAgain", async () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      console.error(
        `Cannot start new round: Socket ${socket.id} not associated with a room.`
      );
      return;
    }
    // Fetch state first to check if round has ended
    const roomState = await getGameState(roomId);
    if (!roomState) {
      console.error(
        `Cannot start new round: Room ${roomId} not found for socket ${socket.id}.`
      );
      socket.emit("error", {
        message: "Game room data not found. Please rejoin.",
      });
      return;
    }

    // Only allow initiating a new round if the current round has ended
    if (!roomState.roundEnded) {
      console.log(
        `Player ${socket.id} tried to start a new round before the current one ended in room ${roomId}.`
      );
      return;
    }

    // Start a new round (startNewRound now saves state internally)
    await startNewRound(roomId); // <-- Await the async helper
    console.log(`New round started in room ${roomId}`);

    // Fetch the latest state after startNewRound to broadcast
    const updatedState = await getGameState(roomId);
    if (updatedState) {
      // Broadcast the updated state to the room
      io.to(roomId).emit("gameStateUpdate", updatedState);
    } else {
      console.error(`Room ${roomId} vanished after starting new round?`);
    }
  });

  // Make endTurn handler async for Redis operations
  socket.on("endTurn", async () => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      console.error(
        `Cannot end turn: Socket ${socket.id} not associated with a room.`
      );
      return;
    }

    const roomState = await getGameState(roomId); // <-- Get from Redis
    if (!roomState) {
      console.error(
        `Cannot end turn: Room ${roomId} not found for socket ${socket.id}.`
      );
      socket.emit("error", {
        message: "Game room data not found. Please rejoin.",
      });
      return;
    }
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

    // Ensure scores object exists before assignment
    if (!roomState.scores) roomState.scores = {};
    if (!roomState.roundScores) roomState.roundScores = {};

    roomState.scores[socket.id] =
      (roomState.scores[socket.id] || 0) + turnScore;
    roomState.roundScores[socket.id] = turnScore; // Track round-specific score
    console.log(
      `Player ${
        socket.id
      } in room ${roomId} ended turn with score ${turnScore}. Total score: ${
        roomState.scores[socket.id]
      }`
    );
    // --- End Scoring Logic ---

    // Mark this player as having played this round (add to array if not present)
    if (!roomState.playersPlayedThisRound.includes(socket.id)) {
      roomState.playersPlayedThisRound.push(socket.id);
    }

    // Check if the round has ended
    const roundEnded = checkRoundEnd(roomState); // Pass state directly
    if (roundEnded) {
      // Determine the round winner
      const roundWinner = determineRoundWinner(roomState); // Pass state directly
      roomState.roundEnded = true;
      roomState.roundWinner = roundWinner;

      console.log(
        `Round ended in room ${roomId}. Winner: ${roundWinner || "Tie"}`
      );

      // Save state before broadcasting round end
      await saveGameState(roomId, roomState); // <-- Save state
      // Broadcast the updated state with round end information
      io.to(roomId).emit("gameStateUpdate", roomState);
      return;
    }

    // If the round hasn't ended, advance to the next player in the room
    const nextPlayer = getNextPlayer(roomState); // Pass state directly
    roomState.currentPlayer = nextPlayer;
    if (nextPlayer) {
      resetTurnState(roomState); // Pass state directly
      console.log(`Turn advanced to player ${nextPlayer} in room ${roomId}`);
    } else {
      // This case should ideally not happen if round end is checked correctly,
      // but handle defensively.
      roomState.currentPlayer = null;
      console.log(
        `Error: No next player found, but round not ended in room ${roomId}.`
      );
      // Consider resetting the round or logging more info.
    }

    // Save the updated state *to Redis*
    await saveGameState(roomId, roomState); // <-- Save state
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
