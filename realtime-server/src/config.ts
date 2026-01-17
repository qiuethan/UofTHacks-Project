import 'dotenv/config';

export const PLAY_PORT = 3001;
export const WATCH_PORT = 3002;
export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 30;
export const TICK_RATE = 100; // ms
export const AI_TICK_RATE = 1000; // ms
export const API_URL = 'http://localhost:3003/agent/decision';

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('ERROR: Supabase credentials required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}
