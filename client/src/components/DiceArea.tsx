import React, { useState, useEffect, useRef } from "react";

// Define the props the DiceArea component will accept
interface DiceAreaProps {
  dice: number[]; // Array of dice values (0-6)
  keptDice: boolean[]; // Array indicating which dice are kept
  isMyTurn: boolean; // Is it the current player's turn?
  rollCount: number; // Current roll number (to prevent keeping before first roll)
  onKeepToggle: (index: number) => void; // Function to call when a die is clicked
  isRolling: boolean; // <-- Add prop for rolling animation
}

// Helper Pip component
const Pip = ({ className = "" }: { className?: string }) => (
  <span
    className={`block h-3 w-3 md:h-5 md:w-5 rounded-full bg-indigo-900 ${className}`}
  ></span>
);

// Renders the dice face using CSS Grid
const getDicePips = (value: number): React.ReactNode => {
  const pip = <Pip />;
  switch (value) {
    case 1:
      return (
        <div className="grid grid-cols-3 grid-rows-3 h-full w-full items-center justify-items-center">
          <div className="col-start-2 row-start-2">{pip}</div>
        </div>
      );
    case 2:
      return (
        <div className="grid grid-cols-3 grid-rows-3 h-full w-full items-center justify-items-center">
          <div className="col-start-1 row-start-1">{pip}</div>
          <div className="col-start-3 row-start-3">{pip}</div>
        </div>
      );
    case 3:
      return (
        <div className="grid grid-cols-3 grid-rows-3 h-full w-full items-center justify-items-center">
          <div className="col-start-1 row-start-1">{pip}</div>
          <div className="col-start-2 row-start-2">{pip}</div>
          <div className="col-start-3 row-start-3">{pip}</div>
        </div>
      );
    case 4:
      return (
        <div className="grid grid-cols-3 grid-rows-3 h-full w-full items-center justify-items-center">
          <div className="col-start-1 row-start-1">{pip}</div>
          <div className="col-start-3 row-start-1">{pip}</div>
          <div className="col-start-1 row-start-3">{pip}</div>
          <div className="col-start-3 row-start-3">{pip}</div>
        </div>
      );
    case 5:
      return (
        <div className="grid grid-cols-3 grid-rows-3 h-full w-full items-center justify-items-center">
          <div className="col-start-1 row-start-1">{pip}</div>
          <div className="col-start-3 row-start-1">{pip}</div>
          <div className="col-start-2 row-start-2">{pip}</div>
          <div className="col-start-1 row-start-3">{pip}</div>
          <div className="col-start-3 row-start-3">{pip}</div>
        </div>
      );
    case 6:
      return (
        <div className="grid grid-cols-3 grid-rows-3 h-full w-full items-center justify-items-center">
          <div className="col-start-1 row-start-1">{pip}</div>
          <div className="col-start-3 row-start-1">{pip}</div>
          <div className="col-start-1 row-start-2">{pip}</div>
          <div className="col-start-3 row-start-2">{pip}</div>
          <div className="col-start-1 row-start-3">{pip}</div>
          <div className="col-start-3 row-start-3">{pip}</div>
        </div>
      );
    default:
      return null; // Return null for 0 or invalid values
  }
};

const DiceArea: React.FC<DiceAreaProps> = ({
  dice,
  keptDice,
  isMyTurn,
  rollCount,
  onKeepToggle,
  isRolling,
}) => {
  const canKeep = isMyTurn && rollCount > 0;
  // State to hold the dice values actually displayed (for animation)
  const [displayDice, setDisplayDice] = useState<number[]>(dice);
  // Ref to store the keptDice state at the moment the roll starts
  const keptDiceAtRollStartRef = useRef<boolean[]>(keptDice);

  // Effect 1: Update displayDice when the actual dice state changes *unless* we are rolling
  useEffect(() => {
    // When isRolling becomes false, or the dice prop changes fundamentally (e.g., length),
    // update the display to match the canonical dice state.
    if (!isRolling || dice.length !== displayDice.length) {
      setDisplayDice(dice);
    }
    // Dependency array ensures this runs when isRolling becomes false or dice change.
  }, [dice, isRolling, displayDice.length]);

  // Effect 2: Run the rolling animation
  useEffect(() => {
    let intervalId: number | null = null;

    if (isRolling) {
      // Store the keptDice state when animation starts
      keptDiceAtRollStartRef.current = keptDice;

      const startTime = Date.now();
      const duration = 1000; // Animation duration in ms

      intervalId = setInterval(() => {
        const now = Date.now();
        if (now - startTime > duration) {
          clearInterval(intervalId!); // Stop interval after duration
          return;
        }

        // Use the keptDice state *from when the roll started*
        const keptStatus = keptDiceAtRollStartRef.current;
        setDisplayDice((currentDisplayDice) =>
          currentDisplayDice.map((dieValue, index) =>
            !keptStatus[index] // Use ref's value here
              ? Math.floor(Math.random() * 6) + 1
              : dieValue
          )
        );
      }, 80); // Interval time in ms (how often dice change)
    }

    // Cleanup function to clear interval if component unmounts or isRolling becomes false
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
    // Only depend on isRolling to start/stop the interval timer itself.
    // keptDice is handled via the ref inside the effect.
  }, [isRolling]); // <-- Adjust dependency array

  return (
    // Use Grid layout for 2x3 arrangement
    <div className="grid grid-cols-3 gap-4 md:gap-6 p-4 mb-4 w-full max-w-md mx-auto">
      {/* Render using displayDice state */}
      {displayDice.map((value, index) => {
        const isKept = keptDice[index];
        // Active means it's the player's turn, >0 rolls, and *not* kept, AND not currently rolling
        const isActive = canKeep && !isKept && !isRolling;

        return (
          <button
            key={index}
            onClick={() => isActive && onKeepToggle(index)} // Only allow clicking active dice
            disabled={!isActive} // Disable if not active
            className={`
              aspect-square border-3 rounded-xl flex items-center justify-center p-2 md:p-3
              font-bold transition-all duration-200 ease-in-out text-center leading-none
              bg-gradient-to-br from-cyan-100 to-cyan-300
              ${isRolling && !isKept ? "animate-wiggle" : ""}
              ${
                isKept
                  ? "border-gray-500 opacity-60 cursor-not-allowed transform -translate-y-1 scale-95"
                  : `border-lime-300 ${
                      isActive
                        ? "hover:scale-110 hover:shadow-xl hover:shadow-lime-400/40 hover:-translate-y-1 cursor-pointer"
                        : "cursor-not-allowed opacity-80"
                    }`
              }
              ${!isKept ? "shadow-lg shadow-lime-400/30" : ""}
            `}
            style={{
              boxShadow: isKept ? "none" : "0 0 15px rgba(163, 230, 53, 0.3)",
            }}
          >
            {/* Render the pips using the grid layout */}
            {value > 0 ? getDicePips(value) : null}
          </button>
        );
      })}
    </div>
  );
};

export default DiceArea;
