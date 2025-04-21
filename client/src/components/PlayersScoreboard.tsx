import React, { useState } from "react";

interface Player {
  id: string;
  name: string;
}

interface PlayersScoreboardProps {
  players: Record<string, Player>;
  scores: Record<string, number>;
  currentPlayerId: string | null;
  myPlayerId: string | null;
  roomId?: string; // Optional room ID to create shareable link
}

const PlayersScoreboard: React.FC<PlayersScoreboardProps> = ({
  players,
  scores,
  currentPlayerId,
  myPlayerId,
  roomId,
}) => {
  const playerIds = Object.keys(players);
  const [shareResult, setShareResult] = useState<string>("");

  // Sort players by score, descending
  const sortedPlayerIds = playerIds.sort(
    (a, b) => (scores[b] ?? 0) - (scores[a] ?? 0)
  );

  // Handler for inviting players
  const handleInvitePlayer = async () => {
    if (!roomId) return;

    const shareableLink = `${window.location.origin}/room/${roomId}`;

    try {
      // Check if the browser supports the Web Share API
      if (navigator.share) {
        await navigator.share({
          title: "Join my Midnight game",
          text: "Click to join my game room:",
          url: shareableLink,
        });
        setShareResult("Invitation sent!");
      } else {
        // Fallback to clipboard
        await navigator.clipboard.writeText(shareableLink);
        setShareResult("Link copied!");

        // Clear the message after 2 seconds
        setTimeout(() => {
          setShareResult("");
        }, 2000);
      }
    } catch (error) {
      console.error("Error sharing:", error);
      setShareResult("Invitation failed");

      // Clear the error message after 2 seconds
      setTimeout(() => {
        setShareResult("");
      }, 2000);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center pb-2 border-b border-purple-500/30">
        <h2 className="text-xl font-bold text-purple-400">Players</h2>
        {roomId && (
          <div className="flex items-center">
            <button
              onClick={handleInvitePlayer}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-purple-500/40 rounded-md text-purple-200 text-sm transition-colors duration-200"
            >
              Invite Player
            </button>
            {shareResult && (
              <span className="ml-2 text-sm font-medium text-lime-300">
                {shareResult}
              </span>
            )}
          </div>
        )}
      </div>
      <ul className="list-none p-0 m-0 space-y-3">
        {sortedPlayerIds.length === 0 ? (
          <li className="text-gray-500 italic p-4 text-center border border-dashed border-gray-700 rounded-lg">
            No players yet...
          </li>
        ) : (
          sortedPlayerIds.map((id) => {
            const player = players[id];
            const score = scores[id] ?? 0;
            const isCurrent = id === currentPlayerId;
            const isMe = id === myPlayerId;

            return (
              <li
                key={id}
                className={`
                  p-3 rounded-lg border-2 flex justify-between items-center
                  transition-all duration-200
                  ${
                    isCurrent
                      ? "border-purple-500 bg-purple-900/40 shadow-md shadow-purple-500/20"
                      : "border-gray-700 bg-gray-800/40"
                  }
                  ${isMe ? "text-lime-300" : "text-gray-300"}
                `}
              >
                <div className="flex items-center">
                  <span className="font-medium">{player.name}</span>
                  {isMe && (
                    <span className="text-xs font-bold text-lime-500 ml-2 px-1.5 py-0.5 bg-lime-900/40 rounded">
                      You
                    </span>
                  )}
                  {isCurrent && (
                    <span className="text-xs font-bold text-purple-400 ml-2 px-1.5 py-0.5 bg-purple-900/40 rounded">
                      Turn
                    </span>
                  )}
                </div>
                <span className="font-bold text-xl text-lime-300 tabular-nums">
                  {score}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
};

export default PlayersScoreboard;
