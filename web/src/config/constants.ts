// Application-wide constants
// Centralized configuration to avoid magic numbers and strings

// WebSocket Configuration
export const WS_CONFIG = {
  PLAY_URL: import.meta.env.VITE_WS_PLAY_URL || 'ws://localhost:3001',
  WATCH_URL: import.meta.env.VITE_WS_WATCH_URL || 'ws://localhost:3002',
  RECONNECT_DELAY_MS: 2000,
}

// API Configuration
export const API_CONFIG = {
  BASE_URL: 'http://localhost:3003',
  REALTIME_API_URL: 'http://localhost:3005',  // Realtime server HTTP API for dynamic NPC addition
}

// Map defaults (should match server config and background.png)
export const MAP_DEFAULTS = {
  WIDTH: 60,
  HEIGHT: 46,
}

// Conversation Configuration  
export const CONVERSATION_CONFIG = {
  REQUEST_TIMEOUT_MS: 4000,    // Request expires after 4 seconds
  INITIATION_RADIUS: 15,
  REJECTION_COOLDOWN_MS: 10000, // 10 second cooldown after rejection
}

// Entity Configuration
export const ENTITY_CONFIG = {
  SIZE: 1, // 1x1 entities
}
