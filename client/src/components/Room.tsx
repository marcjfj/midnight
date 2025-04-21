import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import DiceArea from "./DiceArea";
import Controls from "./Controls";
import PlayersScoreboard from "./PlayersScoreboard";
import { GameState, initialGameState } from "../App"; // Import shared types/initial state

// Define the type based on the actual client instance if needed
// Or use the imported Socket type directly if available
import { Socket } from "socket.io-client"; // Import the value

interface RoomProps {
  // Use the imported type alias
  socket: typeof Socket; // Use typeof Socket
}

// Helper function to calculate the current turn's potential score
const calculateTurnScore = (
  dice: number[],
  keptDice: boolean[]
): number | null => {
  const keptValues = dice.filter((_, index) => keptDice[index]);

  // Check if mandatory 1 and 4 are kept
  const hasOne = keptValues.includes(1);
  const hasFour = keptValues.includes(4);

  // If 1 or 4 is missing, score is not yet calculable based on game rules
  // Return null to indicate score is not final/applicable yet
  if (!hasOne || !hasFour) {
    return null;
  }

  // Calculate score from the other dice (excluding the first 1 and 4 found)
  let score = 0;
  let foundOne = false;
  let foundFour = false;
  for (let i = 0; i < dice.length; i++) {
    if (keptDice[i]) {
      if (dice[i] === 1 && !foundOne) {
        foundOne = true;
        continue; // Don't add the mandatory 1 to the score
      }
      if (dice[i] === 4 && !foundFour) {
        foundFour = true;
        continue; // Don't add the mandatory 4 to the score
      }
      // Add other kept dice to score
      score += dice[i];
    }
  }

  return score;
};

function Room({ socket }: RoomProps) {
  const { roomId } = useParams<{ roomId: string }>(); // Get roomId from URL
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [hasJoined, setHasJoined] = useState(false);
  const [playerName, setPlayerName] = useState<string | null>(null);
  const [isNameSet, setIsNameSet] = useState<boolean>(false); // Track if name process is complete
  const [showNamePrompt, setShowNamePrompt] = useState<boolean>(false);
  const previousRollCountRef = useRef<number>(gameState.rollCount); // Ref to track previous roll count
  const myPlayerId = socket.id; // Store myPlayerId outside useEffect
  const previousIsMyTurnRef = useRef<boolean>(false); // Ref to track if it was my turn *before* state update

  // Effect for handling name logic
  useEffect(() => {
    const storedName = localStorage.getItem("playerName");
    if (storedName) {
      console.log("Found stored name:", storedName);
      setPlayerName(storedName);
      setIsNameSet(true); // Name is already set
    } else {
      console.log("No stored name found, showing prompt.");
      setShowNamePrompt(true); // Need to ask for name
    }
  }, []); // Run only on mount

  // Effect for socket connection and joining (depends on name being set)
  useEffect(() => {
    if (!isNameSet || !roomId || !playerName) {
      // Don't connect or join until name is set and roomId is available
      return;
    }

    if (!roomId) {
      console.error("No room ID found in URL");
      // Handle this error, maybe navigate back to home?
      return;
    }

    // Listener for game state updates specifically for this room
    function onGameStateUpdate(newState: GameState) {
      console.log(`GameState Update Received for room ${roomId}:`, newState);

      // Auto-keep last die logic
      const myTurn = newState.currentPlayer === myPlayerId;
      const rollCountIncreased =
        newState.rollCount > previousRollCountRef.current;
      const keptCount = newState.keptDice.filter(Boolean).length;
      const allDiceCount = newState.dice.length;

      if (myTurn && rollCountIncreased && keptCount === allDiceCount - 1) {
        const indexToKeep = newState.keptDice.findIndex((kept) => !kept);
        if (indexToKeep !== -1) {
          console.log(
            `Auto-keeping last die at index: ${indexToKeep} in room ${roomId}`
          );
          // Emit keepDice immediately, server state will eventually reflect this
          // No need to wait for the next state update for this specific action
          socket.emit("keepDice", indexToKeep);
          // We could potentially update the local keptDice state optimistically here,
          // but let's rely on the server update for consistency for now.
        }
      }

      setGameState(newState);
      // Only set hasJoined to true if the player's ID is actually in the received player list
      // This prevents the UI flashing to "Waiting for players..." briefly if the join hasn't fully processed server-side yet
      if (myPlayerId && newState.players[myPlayerId]) {
        setHasJoined(true); // Consider the player joined once they receive state *and* are listed
      }
      previousRollCountRef.current = newState.rollCount; // Update ref after processing
      previousIsMyTurnRef.current = newState.currentPlayer === myPlayerId; // Update previous turn status *after* processing
    }

    // Set up listener before joining
    socket.on("gameStateUpdate", onGameStateUpdate);

    // Emit event to join the room
    console.log(`Attempting to join room: ${roomId} as ${playerName}`);
    socket.emit("joinRoom", roomId, playerName); // Send name when joining

    // Clean up the listener when the component unmounts or roomId changes
    return () => {
      console.log(`Leaving room: ${roomId}`);
      socket.off("gameStateUpdate", onGameStateUpdate);
      // Optionally emit a 'leaveRoom' event if needed by the server
      // socket.emit("leaveRoom", roomId);
    };
  }, [isNameSet, roomId, socket, myPlayerId, playerName]); // Add name-related dependencies

  const handleNameSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nameInput = event.currentTarget.elements.namedItem(
      "playerName"
    ) as HTMLInputElement;
    const name = nameInput?.value.trim();
    if (name) {
      console.log("Setting player name:", name);
      setPlayerName(name);
      localStorage.setItem("playerName", name);
      setShowNamePrompt(false);
      setIsNameSet(true); // Mark name as set, triggering the join effect
    }
  };

  const isMyTurn = gameState.currentPlayer === myPlayerId;
  const playerCount = Object.keys(gameState.players).length;
  const currentTurnScore = isMyTurn
    ? calculateTurnScore(gameState.dice, gameState.keptDice)
    : null;

  // Handler for clicking a die
  const handleKeepToggle = (index: number) => {
    if (isMyTurn && gameState.rollCount > 0 && hasJoined) {
      console.log(`Toggling keep for die index: ${index} in room ${roomId}`);
      socket.emit("keepDice", index); // Server infers room from socket
    }
  };

  // Handler for clicking Roll Dice
  const handleRollDice = () => {
    if (isMyTurn && hasJoined && !gameState.isRolling) {
      console.log(`Rolling dice in room ${roomId}...`);
      socket.emit("rollDice"); // Server infers room from socket
    }
  };

  // Handler for clicking End Turn
  const handleEndTurn = () => {
    if (isMyTurn && gameState.rollCount > 0 && hasJoined) {
      console.log(`Ending turn in room ${roomId}...`);
      socket.emit("endTurn"); // Server infers room from socket
    }
  };

  // Handler for Play Again button
  const handlePlayAgain = () => {
    console.log(`Starting new round in room ${roomId}...`);
    socket.emit("playAgain"); // Server infers room from socket
  };

  // Get winner name
  const getWinnerName = () => {
    if (!gameState.roundWinner) return "It's a tie!";
    // Use playerName state if the winner is the current player, otherwise use gameState
    if (gameState.roundWinner === myPlayerId) {
      return playerName || "You"; // Fallback to "You" if playerName state isn't set somehow
    }
    return gameState.players[gameState.roundWinner]?.name || "Unknown Player";
  };

  // 1. Show name prompt if needed
  if (showNamePrompt) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4 p-8">
        <div className="text-2xl text-purple-400 font-bold mb-4">Midnight</div>
        <form
          onSubmit={handleNameSubmit}
          className="bg-gray-800/80 border border-purple-500 rounded-lg p-8 max-w-sm w-full text-center shadow-lg shadow-purple-500/20 space-y-4"
        >
          <label htmlFor="playerName" className="block text-lg mb-2">
            Enter your name:
          </label>
          <input
            type="text"
            id="playerName"
            name="playerName"
            required
            maxLength={16} // Add a reasonable max length
            autoFocus // Focus the input field automatically
            className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 text-white" // Ensure text is visible
            placeholder="Your Name" // Add placeholder text
          />
          <button
            type="submit"
            className="w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-md transition-all duration-200"
          >
            Join Game
          </button>
        </form>
      </div>
    );
  }

  // 2. Show joining/loading state AFTER name is set but BEFORE game state is received and processed
  // Use !hasJoined check here
  if (!hasJoined && isNameSet) {
    return (
      <div className="flex flex-col items-center justify-center h-full space-y-4 p-8">
        <div className="animate-pulse text-2xl text-purple-400 font-bold">
          Midnight
        </div>
        {/* Display name during joining */}
        <p className="text-xl">
          Joining room: {roomId} as {playerName}...
        </p>
        <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // 3. Show invite CTA only after joining and if player count is still 1
  if (hasJoined && playerCount <= 1) {
    return (
      <div className="w-full max-w-6xl mx-auto h-full flex flex-col items-center justify-center p-8">
        <div className="bg-gray-800/80 border border-purple-500 rounded-lg p-8 max-w-md w-full text-center shadow-lg shadow-purple-500/20">
          <h2 className="text-2xl font-bold text-purple-400 mb-4">
            Waiting for Players
          </h2>
          <p className="text-lg mb-6">
            Invite friends to join you in this game!
          </p>

          <div className="bg-gray-900 p-4 rounded mb-6 flex items-center">
            <input
              type="text"
              value={window.location.href}
              readOnly
              className="bg-transparent text-white flex-1 outline-none text-sm"
            />
            <button
              onClick={() =>
                navigator.clipboard.writeText(window.location.href)
              }
              className="ml-2 px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-white text-sm transition-colors"
            >
              Copy
            </button>
          </div>

          <p className="text-gray-400 text-sm">
            The game will start automatically when another player joins.
          </p>
        </div>
      </div>
    );
  }

  // 4. Render the main game UI once joined and there's more than one player
  // Use hasJoined check here
  if (hasJoined) {
    return (
      <div className="w-full max-w-6xl mx-auto h-full flex flex-col">
        {/* Round Winner Announcement */}
        {gameState.roundEnded && (
          <div className="w-full mb-6 p-6 border border-yellow-500 rounded-lg bg-gray-800/80 shadow-lg shadow-yellow-500/20 flex flex-col items-center">
            <h2 className="text-2xl font-bold text-yellow-300 mb-4">
              Round Over!
            </h2>
            <p className="text-xl mb-6">
              {gameState.roundWinner
                ? `${getWinnerName()} won!`
                : "It's a tie!"}
            </p>
            <button
              onClick={handlePlayAgain}
              className="px-6 py-3 bg-lime-600 hover:bg-lime-700 text-white font-bold rounded-md transition-all duration-200 hover:shadow-lg hover:shadow-lime-600/30"
            >
              Play Again
            </button>
          </div>
        )}

        {/* Main Game Area Layout */}
        <div className="flex-1 flex flex-col md:flex-row gap-6 px-4 pb-4 pt-4">
          {/* Left Panel: Dice & Controls */}
          <div className="order-1 md:order-1 md:w-2/3 flex flex-col rounded-lg bg-gray-800/50 backdrop-blur shadow-lg border border-gray-700 overflow-hidden">
            {/* Game Status - Player Turn */}
            <div className="w-full bg-gray-800/70 px-4 py-3 border-b border-gray-700">
              {gameState.currentPlayer && !gameState.roundEnded ? (
                <div className="flex justify-center items-center space-x-3">
                  <span
                    className={`text-lg ${
                      isMyTurn
                        ? "text-lime-300 font-semibold"
                        : "text-purple-400"
                    }`}
                  >
                    {isMyTurn
                      ? "Your Turn"
                      : `${
                          gameState.players[gameState.currentPlayer]?.name ||
                          "Player"
                        }'s Turn`}
                  </span>
                  {/* Display Current Turn Score */}
                  {isMyTurn &&
                    gameState.rollCount > 0 &&
                    currentTurnScore !== null && (
                      <span className="text-lg text-yellow-300 font-semibold">
                        (Score: {currentTurnScore})
                      </span>
                    )}
                  {isMyTurn &&
                    gameState.rollCount > 0 &&
                    currentTurnScore === null &&
                    !gameState.mustKeepDie && (
                      <span className="text-sm text-gray-400 italic ml-2">
                        Keep 1 & 4 to score
                      </span>
                    )}
                  {isMyTurn &&
                    gameState.rollCount === 3 &&
                    currentTurnScore === null && (
                      <span className="text-lg text-red-500 font-semibold">
                        (Score: 0)
                      </span>
                    )}
                </div>
              ) : (
                <div className="text-center text-gray-400">
                  Waiting for players...
                </div>
              )}
            </div>

            {/* Dice Area */}
            <div className="flex-1 flex flex-col items-center justify-center p-6">
              <DiceArea
                dice={gameState.dice}
                keptDice={gameState.keptDice}
                isMyTurn={isMyTurn && !gameState.roundEnded}
                rollCount={gameState.rollCount}
                onKeepToggle={handleKeepToggle}
                isRolling={gameState.isRolling}
              />
            </div>

            {/* Controls */}
            {!gameState.roundEnded && (
              <div className="w-full p-4 bg-gray-800/70 border-t border-gray-700">
                <Controls
                  isMyTurn={isMyTurn}
                  rollCount={gameState.rollCount}
                  dice={gameState.dice}
                  keptDice={gameState.keptDice}
                  mustKeepDie={gameState.mustKeepDie}
                  onRollDice={handleRollDice}
                  onEndTurn={handleEndTurn}
                />
              </div>
            )}
          </div>

          {/* Right Panel: Players & Scores */}
          <div className="order-2 md:order-2 md:w-1/3 border border-purple-500/70 rounded-lg p-5 bg-gray-800/80 shadow-lg shadow-purple-500/10">
            <PlayersScoreboard
              players={gameState.players}
              scores={gameState.scores}
              currentPlayerId={gameState.currentPlayer}
              myPlayerId={myPlayerId}
              roomId={roomId}
            />
          </div>
        </div>
      </div>
    );
  }

  // Fallback rendering (e.g., if roomId is missing, though handled in effect)
  // Or if none of the above conditions are met (shouldn't happen with correct logic)
  return (
    <div className="flex flex-col items-center justify-center h-full space-y-4 p-8">
      <div className="text-2xl text-purple-400 font-bold mb-4">Midnight</div>
      <p className="text-xl text-red-500">Something went wrong.</p>
      {/* Maybe add a button to go back home */}
    </div>
  );
}

export default Room;
