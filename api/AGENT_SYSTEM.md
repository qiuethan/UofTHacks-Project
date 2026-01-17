# Agent Decision System

A utility-based AI system for controlling offline player avatars in a multiplayer virtual world. Agents make autonomous decisions about socializing, exploring, and interacting with world locations based on personality traits, internal needs, and social relationships.

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Data Models](#data-models)
- [Decision Algorithm](#decision-algorithm)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [Configuration](#configuration)
- [Running the System](#running-the-system)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Overview

When a player goes offline in the multiplayer world, their avatar doesn't just stand still—it continues to live, socialize, and explore autonomously. This system makes that possible through:

- **Personality-driven behavior**: Each avatar has unique traits that influence their decisions
- **Need-based motivation**: Avatars get hungry, tired, and lonely, driving them to act
- **Social memory**: Avatars remember past interactions and form relationships
- **World interactions**: Avatars can eat, rest, perform karaoke, and explore

### Key Principles

1. **Server-authoritative**: All decisions happen server-side; clients cannot manipulate agent behavior
2. **LLM-isolated**: AI language models only generate dialogue, never control actions
3. **Multiplayer-safe**: Concurrent processing with locks prevents race conditions
4. **Deterministic + Randomness**: Reproducible scoring with controlled randomness for variety

---

## Quick Start

### 1. Run the Database Migration

Copy the contents of `supabase/migrations/008_agent_decision_system.sql` and run it in your Supabase SQL Editor.

### 2. Install Dependencies

```bash
cd api
pip install -r requirements.txt
```

### 3. Set Environment Variables

Create a `.env` file in the `api` directory:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

### 4. Initialize an Agent

```bash
curl -X POST http://localhost:3003/agent/initialize \
  -H "Content-Type: application/json" \
  -d '{"avatar_id": "your-avatar-uuid"}'
```

### 5. Get Agent's Next Action

```bash
# Request the next action when the agent is free
curl -X POST http://localhost:3003/agent/your-avatar-uuid/action
```

---

## How It Works

### On-Demand Decision Model

Instead of batch processing all agents on a timer, the system uses an **on-demand** model where each agent requests their next action when they're free/done with their current action:

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT DECISION LOOP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. LOAD CONTEXT                                                 │
│     ├── Avatar position (x, y)                                   │
│     ├── Personality traits                                       │
│     ├── Current needs (energy, hunger, loneliness, mood)        │
│     ├── Social memories (relationships with other avatars)      │
│     ├── Nearby avatars (within conversation radius)             │
│     ├── World locations (food, karaoke, rest areas)             │
│     └── Active cooldowns                                         │
│                                                                  │
│  2. CHECK INTERRUPTS                                             │
│     ├── Critical hunger? → Go to food                           │
│     ├── Critical energy? → Go to rest                           │
│     └── Pending conversation from player? → Accept              │
│                                                                  │
│  3. GENERATE CANDIDATE ACTIONS                                   │
│     ├── Always: Idle, Wander                                    │
│     ├── Per location: Walk to / Interact                        │
│     └── Per nearby avatar: Initiate conversation                │
│                                                                  │
│  4. SCORE EACH ACTION                                            │
│     utility = need_satisfaction                                  │
│             + personality_alignment                              │
│             + social_memory_bias                                 │
│             + world_affinity                                     │
│             - recency_penalty                                    │
│             + randomness                                         │
│                                                                  │
│  5. SELECT ACTION (Softmax)                                      │
│     Higher scores = higher probability                           │
│     But NOT deterministic!                                       │
│                                                                  │
│  6. EXECUTE & UPDATE STATE                                       │
│     ├── Apply action effects                                    │
│     ├── Update position if moving                               │
│     ├── Record interaction if applicable                        │
│     └── Update social memory if social action                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Example Decision

**Scenario**: Avatar "Alice" has been idle for a while.

| Need | Value | Description |
|------|-------|-------------|
| Energy | 0.6 | Moderate |
| Hunger | 0.7 | High (getting hungry!) |
| Loneliness | 0.4 | Moderate |
| Mood | 0.3 | Slightly low |

**Personality**: Sociability=0.7, Food Affinity=0.8

**Candidate Actions & Scores**:

| Action | Need Score | Personality | Total | Probability |
|--------|------------|-------------|-------|-------------|
| Walk to Cafe | 1.05 | 0.64 | 1.89 | **52%** |
| Talk to Bob | 0.48 | 0.56 | 1.24 | 28% |
| Wander | 0.20 | 0.30 | 0.60 | 12% |
| Idle | 0.12 | 0.08 | 0.30 | 8% |

**Result**: Alice will probably go to the cafe (52% chance), but might decide to chat with Bob instead (28% chance).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Server                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  main.py              FastAPI application with endpoints         │
│       │                                                          │
│       ├── /agent/{id}/action    Get next action (on-demand)     │
│       ├── /agent/initialize     Set up new agent                 │
│       ├── /agent/{id}/state     Get/update needs                 │
│       ├── /agent/{id}/personality  Get traits                    │
│       └── /agent/sentiment      Update relationships             │
│                                                                  │
│  agent_models.py      Pydantic data models                       │
│       │                                                          │
│       ├── AgentPersonality      Static traits                    │
│       ├── AgentState            Dynamic needs                    │
│       ├── SocialMemory          Relationship data                │
│       ├── CandidateAction       Action + score                   │
│       └── AgentContext          All decision inputs              │
│                                                                  │
│  agent_engine.py      Core decision logic                        │
│       │                                                          │
│       ├── calculate_need_satisfaction()                          │
│       ├── calculate_personality_alignment()                      │
│       ├── calculate_social_bias()                                │
│       ├── generate_candidate_actions()                           │
│       ├── score_action()                                         │
│       ├── softmax_select()                                       │
│       └── make_decision()       Main entry point                 │
│                                                                  │
│  agent_database.py    Supabase CRUD operations                   │
│       │                                                          │
│       ├── get_personality() / create_personality()               │
│       ├── get_state() / update_state()                           │
│       ├── get_social_memories() / update_social_memory()         │
│       ├── acquire_tick_lock() / release_tick_lock()              │
│       └── build_agent_context()                                  │
│                                                                  │
│  agent_worker.py      Action processing                          │
│       │                                                          │
│       ├── process_agent_tick()    Get next action for avatar    │
│       ├── process_all_pending_ticks()  Batch                     │
│       ├── execute_action()        Apply effects                  │
│       └── run_worker_loop()       Continuous mode                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Supabase                                 │
├─────────────────────────────────────────────────────────────────┤
│  agent_personality    Traits per avatar                          │
│  agent_state          Needs per avatar                           │
│  agent_social_memory  Relationships (from → to)                  │
│  world_locations      Fixed interaction points                   │
│  world_interactions   Active cooldowns                           │
│  agent_decisions      Audit log (optional)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### Personality (Static)

Personality traits are set when an agent is created and don't change. They bias decision-making but don't impose hard rules.

```python
{
  "avatar_id": "uuid",
  "sociability": 0.7,      # 0-1: Preference for social interactions
  "curiosity": 0.5,        # 0-1: Preference for exploration
  "agreeableness": 0.6,    # 0-1: Tendency to accept requests
  "energy_baseline": 0.5,  # 0-1: Natural energy level
  "world_affinities": {    # Preference for location types
    "food": 0.8,
    "karaoke": 0.3,
    "rest_area": 0.5,
    "social_hub": 0.6,
    "wander_point": 0.4
  }
}
```

### Internal State (Dynamic Needs)

Needs change over time and drive agent behavior. They decay/grow naturally and are modified by actions.

```python
{
  "avatar_id": "uuid",
  "energy": 0.6,      # 0-1: Decays over time, restored by rest
  "hunger": 0.4,      # 0-1: Grows over time, reduced by eating
  "loneliness": 0.5,  # 0-1: Grows over time, reduced by socializing
  "mood": 0.3,        # -1 to +1: Affected by interactions
  "current_action": "idle",
  "last_tick": "2026-01-17T12:00:00Z"
}
```

**Natural Decay (per 5-minute tick)**:
- Energy: -0.02
- Hunger: +0.03
- Loneliness: +0.02
- Mood: drifts toward 0

### Social Memory (Directional)

Each avatar stores memories about other avatars they've interacted with. Relationships are directional (Alice→Bob may differ from Bob→Alice).

```python
{
  "from_avatar_id": "alice-uuid",
  "to_avatar_id": "bob-uuid",
  "sentiment": 0.5,           # -1 to +1: How they feel about them
  "familiarity": 0.3,         # 0-1: How well they know them
  "interaction_count": 5,
  "last_interaction": "2026-01-17T10:00:00Z",
  "last_conversation_topic": "weather"
}
```

### World Locations

Fixed points in the world where avatars can interact.

```python
{
  "id": "cafe-uuid",
  "name": "Cozy Cafe",
  "location_type": "food",    # food, karaoke, rest_area, social_hub, wander_point
  "x": 10,
  "y": 10,
  "effects": {                # Applied when interacting
    "hunger": -0.4,
    "mood": 0.1,
    "energy": 0.1
  },
  "cooldown_seconds": 180,    # Must wait before using again
  "duration_seconds": 45      # How long the interaction takes
}
```

---

## Decision Algorithm

### Utility Scoring

Each candidate action is scored using multiple factors:

```
utility = (need_satisfaction × 1.0)
        + (personality_alignment × 0.6)
        + (social_memory_bias × 0.4)
        + (world_affinity × 0.5)
        - (recency_penalty × 0.3)
        + (randomness × 0.2)
```

#### Need Satisfaction

How well does this action address urgent needs?

| Condition | Action | Score Boost |
|-----------|--------|-------------|
| Hunger > 0.7 | Go to food | +1.5 × hunger |
| Energy < 0.2 | Go to rest | +1.5 × (1-energy) |
| Loneliness > 0.6 | Social action | +1.2 × loneliness |

#### Personality Alignment

How well does this action match personality?

| Trait | Action | Score Boost |
|-------|--------|-------------|
| High sociability | Conversation | +0.8 × sociability |
| High curiosity | Wander | +0.6 × curiosity |
| Low energy baseline | Rest/Idle | +0.4 × (1-baseline) |

#### Social Memory Bias

How does relationship affect desire to interact?

| Condition | Effect |
|-----------|--------|
| Positive sentiment | +0.5 × sentiment |
| High familiarity | +0.3 × familiarity |
| Very negative (<-0.5) | -0.5 penalty |
| Unknown avatar | +0.1 curiosity bonus |
| Online player | +0.2 bonus |

#### Recency Penalty

Avoid repetitive actions:

| Condition | Penalty |
|-----------|---------|
| Talked to same avatar recently | Up to -0.5 |
| Location on cooldown | -1.0 (strong) |

### Softmax Selection

Instead of always picking the highest score, actions are selected probabilistically:

```python
probability(action) = exp(score / temperature) / Σ exp(scores / temperature)
```

- **Temperature = 0.5** (default): Favors high scores but allows variety
- **Lower temperature**: More deterministic
- **Higher temperature**: More random

### Interrupt Handling

Some conditions bypass normal scoring:

1. **Critical hunger (>0.8)**: Immediately go to nearest food
2. **Critical energy (<0.15)**: Immediately go to rest or idle
3. **Player conversation request**: Always accept (agreeableness check for robots)

---

## API Reference

### Get Next Action (On-Demand)

```http
POST /agent/{avatar_id}/action?debug=false
```

Call this when an agent is free/done with their current action to get their next action.

**Response**:
```json
{
  "ok": true,
  "avatar_id": "uuid",
  "action": "walk_to_location",
  "target": {
    "target_type": "location",
    "target_id": "cafe-uuid",
    "x": 10,
    "y": 15
  },
  "score": 1.89,
  "state": {
    "energy": 0.52,
    "hunger": 0.73,
    "loneliness": 0.38,
    "mood": 0.22
  }
}
```

### Initialize Agent

```http
POST /agent/initialize
Content-Type: application/json

{
  "avatar_id": "uuid",
  "personality": null  // Optional, generates random if null
}
```

### Get/Update Agent State

```http
GET /agent/{avatar_id}/state

PATCH /agent/{avatar_id}/state
Content-Type: application/json

{
  "energy": 0.8,
  "hunger": 0.2
}
```

### Update Sentiment After Conversation

```http
POST /agent/sentiment
Content-Type: application/json

{
  "from_avatar_id": "alice-uuid",
  "to_avatar_id": "bob-uuid",
  "sentiment_delta": 0.1,      // How much sentiment changed
  "familiarity_delta": 0.1,    // How much familiarity increased
  "conversation_topic": "music"
}
```

### Get Full Decision Context (Debug)

```http
GET /agent/{avatar_id}/context
```

Returns everything the agent considers when making a decision.

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `world_locations` | Fixed interaction points (cafe, karaoke, etc.) |
| `agent_personality` | Static traits per avatar |
| `agent_state` | Dynamic needs per avatar |
| `agent_social_memory` | Relationship data (from → to) |
| `world_interactions` | Track cooldowns |
| `agent_decisions` | Audit log for debugging |

### Key Functions

| Function | Purpose |
|----------|---------|
| `acquire_agent_tick_lock(avatar_id, duration)` | Prevent concurrent processing |
| `release_agent_tick_lock(avatar_id)` | Release lock and update timestamp |
| `get_nearby_avatars(avatar_id, radius)` | Spatial query for social actions |
| `initialize_agent_for_avatar(avatar_id)` | Create random personality/state |

---

## Configuration

### Decision Weights

Edit `agent_engine.py` → `DecisionConfig`:

```python
class DecisionConfig:
    # Scoring weights
    NEED_WEIGHT = 1.0           # Importance of need satisfaction
    PERSONALITY_WEIGHT = 0.6    # Importance of personality match
    SOCIAL_WEIGHT = 0.4         # Importance of relationships
    AFFINITY_WEIGHT = 0.5       # Importance of location preference
    RECENCY_WEIGHT = 0.3        # Strength of recency penalty
    RANDOMNESS_WEIGHT = 0.2     # Amount of randomness
    
    # Selection
    SOFTMAX_TEMPERATURE = 0.5   # Lower = more deterministic
    
    # Thresholds
    CRITICAL_HUNGER = 0.8       # Triggers interrupt
    CRITICAL_ENERGY = 0.15      # Triggers interrupt
    HIGH_LONELINESS = 0.7       # Boosts social actions
    
    # Social
    CONVERSATION_RADIUS = 8     # Distance for social actions
    RECENT_INTERACTION_HOURS = 2  # Recency penalty window
```

### Adding World Locations

Insert directly into Supabase:

```sql
INSERT INTO world_locations (name, location_type, x, y, effects, cooldown_seconds, duration_seconds)
VALUES (
  'Hot Spring',
  'rest_area',
  30, 20,
  '{"energy": 0.4, "mood": 0.2, "loneliness": -0.1}',
  600,
  60
);
```

---

## Running the System

### On-Demand Model

The system uses an on-demand model where agents request their next action when they're free:

```bash
# When an agent finishes their current action, request the next one
curl -X POST http://localhost:3003/agent/{avatar_id}/action
```

**Typical flow:**
1. Agent completes current action (walking, eating, talking)
2. Client/server calls `/agent/{id}/action`
3. System evaluates context and returns next action
4. Agent executes the action
5. Repeat when done

### Integration Example

```typescript
// In your game loop or action completion handler
async function onAgentActionComplete(avatarId: string) {
  const response = await fetch(`/agent/${avatarId}/action`, {
    method: 'POST'
  });
  const { action, target, state } = await response.json();
  
  // Execute the new action
  executeAgentAction(avatarId, action, target);
}
```

---

## Testing

### Run Unit Tests

```bash
cd api

# All tests (excluding integration)
python3 -m pytest tests/test_agent_system.py -v -k "not Integration"

# Specific test category
python3 -m pytest tests/test_agent_system.py -v -k "TestNeedSatisfaction"

# Single test
python3 -m pytest tests/test_agent_system.py::TestMakeDecision::test_make_decision_interrupt_priority -v
```

### Test Categories

| Category | Tests | What it verifies |
|----------|-------|------------------|
| TestAgentModels | 6 | Pydantic model validation |
| TestNeedSatisfaction | 4 | Need-based scoring |
| TestPersonalityAlignment | 3 | Personality-based scoring |
| TestSocialBias | 4 | Relationship-based scoring |
| TestActionGeneration | 5 | Candidate action creation |
| TestActionScoring | 3 | Full scoring pipeline |
| TestActionSelection | 4 | Softmax selection |
| TestInterrupts | 4 | Interrupt handling |
| TestStateUpdates | 4 | Decay and effect application |
| TestMakeDecision | 3 | End-to-end decision making |

### Integration Tests

Require the database migration to be run:

```bash
python3 -m pytest tests/test_agent_system.py -v -k "Integration"
```

---

## Troubleshooting

### "Table not found" Error

Run the database migration in Supabase SQL Editor:
`supabase/migrations/008_agent_decision_system.sql`

### Agents Not Processing

1. Check if avatars are marked offline: `is_online = false`
2. Check `last_tick` timestamp (must be older than interval)
3. Check for stuck locks: `tick_lock_until < NOW()`

### Agents Making Poor Decisions

1. Enable debug mode: `{"debug": true}` in tick request
2. Check `/agent/{id}/context` for full decision inputs
3. Query `agent_decisions` table for historical data
4. Adjust weights in `DecisionConfig`

### High Database Load

1. Reduce `max_agents_per_tick`
2. Increase `tick_interval_seconds`
3. Add indexes on frequently queried columns

---

## Design Decisions

### Why Utility-Based?

- **Flexible**: Easy to add new actions and factors
- **Tunable**: Weights can be adjusted without code changes
- **Debuggable**: Every score component is visible
- **Natural variety**: Softmax prevents repetitive behavior

### Why Not Behavior Trees?

- More complex to modify
- Harder to balance competing priorities
- Less natural variety in decisions

### Why Not Pure LLM?

- LLMs can hallucinate or make inconsistent decisions
- Expensive for high-frequency decisions
- Hard to guarantee multiplayer safety
- Instead: LLMs only generate dialogue *after* action selection

### Why Directional Social Memory?

Alice might like Bob, but Bob might dislike Alice. Real relationships aren't symmetric.

---

## Future Enhancements

- [ ] Group conversations (3+ participants)
- [ ] Long-term goals and planning
- [ ] Learned preferences from interaction history
- [ ] Emotional contagion between nearby avatars
- [ ] Day/night activity patterns
- [ ] Special events and gatherings
