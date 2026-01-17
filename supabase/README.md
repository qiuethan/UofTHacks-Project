# Supabase Configuration

This folder contains database migrations and configuration for the project's Supabase instance.

## 🗄 Schema

### `user_positions` Table
Tracks the last known location of a user. This acts as the persistence layer for the game.

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | UUID | Primary Key, References `auth.users` |
| `x` | Integer | X Coordinate |
| `y` | Integer | Y Coordinate |
| `updated_at` | Timestamp | Last update time |

## 🔐 Auth
The project uses Supabase Auth for user identity.
- **Frontend (`web`):** Uses Anon Key to sign in users.
- **Backend (`realtime-server`):** Uses Service Role Key to verify tokens and trust operations.
