# Supabase Configuration

This folder contains database migrations and configuration for the project's Supabase instance.

## 🗄 Schema

### `user_positions` Table
Tracks the last known location and state of a user. This acts as the persistence layer for the game.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Primary Key, References `auth.users` |
| `x` | Integer | X Coordinate |
| `y` | Integer | Y Coordinate |
| `facing_x` | Integer | X direction component (-1, 0, 1) |
| `facing_y` | Integer | Y direction component (-1, 0, 1) |
| `conversation_state` | Text | One of IDLE, PENDING_REQUEST, WALKING_TO_CONVERSATION, IN_CONVERSATION |
| `conversation_target_id` | UUID | ID of entity being walked toward |
| `conversation_partner_id` | UUID | ID of entity currently in conversation with |
| `updated_at` | Timestamp | Last update time |

## 🔐 Auth
The project uses Supabase Auth for user identity.
- **Frontend (`web`):** Uses Anon Key to sign in users.
- **Backend (`realtime-server`):** Uses Service Role Key to verify tokens and trust operations.
