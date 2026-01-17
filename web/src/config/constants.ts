// Application-wide constants
// Centralized configuration to avoid magic numbers and strings

// WebSocket Configuration
export const WS_CONFIG = {
  PLAY_URL: 'ws://localhost:3001',
  WATCH_URL: 'ws://localhost:3002',
  RECONNECT_DELAY_MS: 2000,
}

// API Configuration
export const API_CONFIG = {
  BASE_URL: 'http://localhost:3003',
}

// Map defaults
export const MAP_DEFAULTS = {
  WIDTH: 60,
  HEIGHT: 46,
}

// Conversation Configuration  
export const CONVERSATION_CONFIG = {
  REQUEST_TIMEOUT_MS: 30000,
  INITIATION_RADIUS: 15,
  REJECTION_COOLDOWN_MS: 30000,
}

// Entity Configuration
export const ENTITY_CONFIG = {
  SIZE: 2, // 2x2 entities
}
