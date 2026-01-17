# World Engine

A shared TypeScript library that defines the core game logic, data structures, and simulation rules. This package ensures the server and potentially the client (if shared) use the exact same definitions for the game world.

## 📦 Contents

### `engine/`
- **`World` class:** The main simulation container. Handles `tick()`, entity management (`addEntity`, `removeEntity`), and action processing.
- **Determinism:** Designed to be deterministic.

### `entities/`
- **Definitions:** `PLAYER`, `ROBOT`, `WALL`.
- **Factories:** `createAvatar`, `createRobot`, `createWall`.

### `actions/`
- **Types:** `MoveAction`, `SetDirectionAction`.
- **Pipeline:** Logic for validating and applying actions to the state.

### `map/`
- **Grid Logic:** Bounds checking, coordinate clamping.

## 🤝 Usage
This package is imported directly by `realtime-server`.

```typescript
import { World, createMapDef } from '../../world';

const world = new World(createMapDef(20, 15));
world.tick();
```
