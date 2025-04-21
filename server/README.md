# Midnight Game Server

This is the server component for the Midnight Game, written in TypeScript.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Build the TypeScript code:

```bash
npm run build
```

3. Run the server:

```bash
npm start
```

## Development

For development with hot reloading:

```bash
npm run dev
```

## TypeScript Conversion

The server was converted from JavaScript to TypeScript to provide better type safety and developer experience. Key changes include:

- Added interfaces for GameState and Player objects
- Added type definitions for socket.io events
- Properly typed function parameters and return values
- Created a build process using tsc (TypeScript compiler)
