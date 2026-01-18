import 'dotenv/config';

export const PLAY_PORT = 3001;
export const WATCH_PORT = 3002;

// Map size in tiles (each tile is 16 pixels)
// Matches the Tiled map: 60x40 tiles = 960x640 pixels

export const MAP_WIDTH = 60;
export const MAP_HEIGHT = 40;
export const TICK_RATE = 150; // ms (50% slower movement speed)
export const AI_TICK_RATE = 1000; // ms
export const API_BASE_URL = 'http://localhost:3003';
export const CONVERSATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
export const API_URL = process.env.API_URL || 'http://localhost:3003/agent/decision';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Supabase credentials required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}
