import { useState, useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import socketIOClient from "socket.io-client";
import Room from "./components/Room"; // Import the new Room component

// Define shared types (could be moved to a types file)
export interface Player {
  id: string;
  name: string;
}

export interface GameState {
  players: Record<string, Player>;
  dice: number[];
  keptDice: boolean[];
  rollCount: number;
  currentPlayer: string | null;
  scores: Record<string, number>;
  roundScores: Record<string, number>;
  mustKeepDie: boolean;
  isRolling: boolean;
  playerOrder: string[];
  playersPlayedThisRound: Set<string>;
  roundEnded: boolean;
  roundWinner: string | null;
}

export const initialGameState: GameState = {
  players: {},
  dice: [0, 0, 0, 0, 0, 0],
  keptDice: [false, false, false, false, false, false],
  rollCount: 0,
  currentPlayer: null,
  scores: {},
  roundScores: {},
  mustKeepDie: false,
  isRolling: false,
  playerOrder: [],
  playersPlayedThisRound: new Set(),
  roundEnded: false,
  roundWinner: null,
};

// Connect to the Socket.IO server (Keep this connection logic here or lift higher if needed)
const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3001";
const socket = socketIOClient(SERVER_URL);

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    function onConnect() {
      console.log("Connected to server");
      setIsConnected(true);
    }

    function onDisconnect() {
      console.log("Disconnected from server");
      setIsConnected(false);
      // Note: Game state is now managed within the Room component
    }

    // Error handling from server (e.g., room not found)
    function onError(error: { message: string }) {
      console.error("Server error:", error.message);
      // Potentially display this error to the user
      alert(`Error: ${error.message}`);
      // Maybe redirect to home page if it's a room error?
      // navigate('/'); // Requires navigate from useNavigate hook
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("error", onError);

    // Clean up the core connection listeners
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("error", onError);
      // Game state listeners are now managed in Room component
    };
  }, []); // Empty dependency array, runs once

  return (
    // Main container styling can remain here
    <div className="min-h-screen bg-gray-900 text-lime-300 font-mono flex flex-col items-center p-4">
      {/* Title can stay */}
      <div className="flex justify-between w-full items-center mb-4">
        <h1 className="text-lg font-bold text-purple-500">Midnight</h1>
        <p className="text-sm text-gray-400">
          Status:{" "}
          {isConnected ? (
            <span className="text-green-400">Connected</span>
          ) : (
            <span className="text-red-400">Disconnected</span>
          )}
        </p>
      </div>

      <Routes>
        <Route path="/" element={<Home />} />
        {/* Pass the socket instance to the Room component */}
        <Route path="/room/:roomId" element={<Room socket={socket} />} />
      </Routes>
    </div>
  );
}

// --- Home Component (for creating rooms) ---
function Home() {
  const navigate = useNavigate();
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateRoom = async () => {
    setCreatingRoom(true);
    setError(null);
    try {
      // Use fetch to call the backend API endpoint
      console.log("[handleCreateRoom] Sending request to create room...");
      const response = await fetch("/api/create-room", {
        // Ensure proxy is set up in vite.config.ts or use full URL
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const roomId = data.roomId;

      if (roomId) {
        console.log(
          `[handleCreateRoom] Room created: ${roomId}, storing in localStorage for debugging...`
        );
        // Store roomId in localStorage for debugging purposes
        localStorage.setItem("lastCreatedRoomId", roomId);
        // Navigate to the new room URL
        console.log(`[handleCreateRoom] Navigating to /room/${roomId}`);
        navigate(`/room/${roomId}`);
      } else {
        throw new Error("Failed to get room ID from server");
      }
    } catch (err: any) {
      console.error("[handleCreateRoom] Error creating room:", err);
      setError(err.message || "Failed to create room. Please try again.");
      setCreatingRoom(false);
    }
    // No finally block needed to set creatingRoom = false, handled in success/error
  };

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-3xl text-lime-400 mb-6">Welcome to Midnight!</h2>
      <button
        onClick={handleCreateRoom}
        disabled={creatingRoom}
        className="px-6 py-3 bg-purple-600 hover:bg-purple-700 rounded text-white font-bold text-xl disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
      >
        {creatingRoom ? "Creating Room..." : "Create New Room"}
      </button>
      {error && <p className="text-red-500 mt-4">Error: {error}</p>}
      {/* Instructions or other home page content can go here */}
      <p className="mt-8 text-gray-400">
        Create a room and share the link with your friends to play!
      </p>
    </div>
  );
}

export default App;
