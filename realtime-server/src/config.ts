import 'dotenv/config';

export const PLAY_PORT = 3001;
export const WATCH_PORT = 3002;

// Map size in tiles (each tile is 32 pixels)
// Should match your background.png dimensions: width_in_pixels / 32, height_in_pixels / 32
// Background: 2400x1792 pixels = 75x56 tiles

export const MAP_WIDTH = 75;
export const MAP_HEIGHT = 56;
export const TICK_RATE = 100; // ms
export const AI_TICK_RATE = 1000; // ms

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
export const API_URL = process.env.API_URL || 'http://localhost:3003/agent/decision';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Supabase credentials required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}
