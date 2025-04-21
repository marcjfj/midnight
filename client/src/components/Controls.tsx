import React from "react";

interface ControlsProps {
  isMyTurn: boolean;
  rollCount: number;
  dice: number[];
  keptDice: boolean[];
  mustKeepDie: boolean;
  onRollDice: () => void;
  onEndTurn: () => void;
}

const Controls: React.FC<ControlsProps> = ({
  isMyTurn,
  rollCount,
  dice,
  keptDice,
  mustKeepDie,
  onRollDice,
  onEndTurn,
}) => {
  // Player can roll if it's their turn, not all dice are kept, and they don't need to keep a die
  const canRoll =
    isMyTurn && keptDice.filter(Boolean).length < dice.length && !mustKeepDie;
  const canEndTurn = isMyTurn && rollCount > 0; // Can end turn after at least one roll

  return (
    <div className="w-full flex flex-col items-center gap-4">
      {/* Only show Roll button if the player can roll */}
      {(canRoll || mustKeepDie) && (
        <button
          onClick={onRollDice}
          disabled={!canRoll}
          className={`
            w-full max-w-xs px-6 py-4 rounded-lg font-bold text-xl tracking-wide
            transition-all duration-200 ease-in-out
            ${
              canRoll
                ? "bg-gradient-to-r from-lime-400 to-lime-500 hover:from-lime-300 hover:to-lime-400 text-gray-900 shadow-lg shadow-lime-400/40 hover:shadow-xl hover:shadow-lime-400/50 hover:-translate-y-1 cursor-pointer"
                : "bg-gray-700 text-gray-500 cursor-not-allowed opacity-50"
            }
          `}
        >
          {mustKeepDie ? "Select a Die First" : "Roll Dice"}
        </button>
      )}

      {/* Show End Turn button if turn has started */}
      {canEndTurn && (
        <button
          onClick={onEndTurn}
          disabled={!canEndTurn}
          className={`
            px-4 py-3 rounded-lg font-semibold text-sm transition-all duration-200 ease-in-out
            w-full max-w-xs
            ${
              canEndTurn
                ? "bg-transparent border-2 border-red-500 text-red-400 hover:bg-red-500/20 hover:text-red-300 hover:-translate-y-1 cursor-pointer"
                : "bg-transparent border border-gray-600 text-gray-500 cursor-not-allowed opacity-50"
            }
            ${!canRoll ? "mt-2 px-6 py-4 text-lg" : ""}
          `}
        >
          End Turn
        </button>
      )}
    </div>
  );
};

export default Controls;
