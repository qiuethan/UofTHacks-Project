import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, MAP_WIDTH, MAP_HEIGHT } from './config';

// Create Supabase client with optimized settings
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  db: {
    schema: 'public'
  },
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export interface UserPositionData {
  x: number;
  y: number;
  facing: { x: number; y: number };
  displayName?: string;
  hasAvatar?: boolean;
  sprites?: {
    front?: string;
    back?: string;
    left?: string;
    right?: string;
  };
  conversationState?: string;
  conversationTargetId?: string;
  conversationPartnerId?: string;
  pendingConversationRequestId?: string;
  stats?: {
    energy?: number;
    hunger?: number;
    loneliness?: number;
    mood?: number;
  };
}

// Helper to parse a row into UserPositionData
function parseUserRow(row: any): { userId: string } & UserPositionData {
  return {
    userId: row.user_id,
    x: row.x ?? 10,
    y: row.y ?? 10,
    facing: { x: row.facing_x ?? 0, y: row.facing_y ?? 1 },
    displayName: row.display_name || undefined,
    hasAvatar: row.has_avatar || false,
    sprites: (row.sprite_front || row.sprite_back || row.sprite_left || row.sprite_right) ? {
      front: row.sprite_front || undefined,
      back: row.sprite_back || undefined,
      left: row.sprite_left || undefined,
      right: row.sprite_right || undefined,
    } : undefined,
    conversationState: row.conversation_state || undefined,
    conversationTargetId: row.conversation_target_id || undefined,
    conversationPartnerId: row.conversation_partner_id || undefined,
    pendingConversationRequestId: row.pending_conversation_request_id || undefined
  };
}

// Retry wrapper for Supabase queries
async function withRetry<T>(
  operation: () => Promise<{ data: T | null; error: any }>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await operation();
    
    if (!result.error) {
      return result;
    }
    
    lastError = result.error;
    console.warn(`[DB] Query attempt ${attempt}/${maxRetries} failed:`, result.error.message);
    
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    }
  }
  
  return { data: null, error: lastError };
}

export async function getPosition(userId: string): Promise<UserPositionData> {
  const { data, error }: any = await withRetry(() => 
    supabase
      .from('user_positions')
      .select('x, y, facing_x, facing_y, display_name, has_avatar, sprite_front, sprite_back, sprite_left, sprite_right, conversation_state, conversation_target_id, conversation_partner_id, pending_conversation_request_id')
      .eq('user_id', userId)
      .single()
  );
  
  if (error) {
    console.error('[DB] getPosition error:', error);
  }
  
  if (data) {
    // Fetch agent stats if available
    const { data: statsData }: any = await supabase
      .from('agent_state')
      .select('energy, hunger, loneliness, mood')
      .eq('avatar_id', userId)
      .single();
    
    return { 
      x: data.x, 
      y: data.y, 
      facing: { x: data.facing_x ?? 0, y: data.facing_y ?? 1 },
      displayName: data.display_name || undefined,
      hasAvatar: data.has_avatar || false,
      sprites: (data.sprite_front || data.sprite_back || data.sprite_left || data.sprite_right) ? {
        front: data.sprite_front || undefined,
        back: data.sprite_back || undefined,
        left: data.sprite_left || undefined,
        right: data.sprite_right || undefined,
      } : undefined,
      conversationState: data.conversation_state || undefined,
      conversationTargetId: data.conversation_target_id || undefined,
      conversationPartnerId: data.conversation_partner_id || undefined,
      pendingConversationRequestId: data.pending_conversation_request_id || undefined,
      stats: statsData ? {
        energy: statsData.energy,
        hunger: statsData.hunger,
        loneliness: statsData.loneliness,
        mood: statsData.mood
      } : undefined
    };
  }
  
  // First time user - spawn in the middle of the map
  const x = Math.floor(MAP_WIDTH / 2);
  const y = Math.floor(MAP_HEIGHT / 2);
  
  const { error: insertError } = await supabase.from('user_positions').insert({ 
    user_id: userId, 
    x, 
    y,
    facing_x: 0,
    facing_y: 1
  });
  
  if (insertError) {
    console.error('[DB] Failed to insert new user position:', insertError);
  }
  
  return { x, y, facing: { x: 0, y: 1 } };
}

export async function checkUserHasAvatar(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_positions')
    .select('has_avatar')
    .eq('user_id', userId)
    .single();
  
  return data?.has_avatar || false;
}

/**
 * Load all users from the database with their positions.
 * Only loads users who have completed avatar creation (has_avatar = true).
 * Uses optimized query with retry logic.
 */
export async function getAllUsers(): Promise<Array<{ userId: string } & UserPositionData>> {
  console.log('[DB] Loading users with avatars from user_positions table...');
  
  // Only load users who have completed avatar setup and have a display name
  // This filters out incomplete signups and test accounts
  const { data, error }: any = await withRetry(() =>
    supabase
      .from('user_positions')
      .select('user_id, x, y, facing_x, facing_y, display_name, has_avatar, sprite_front, sprite_back, sprite_left, sprite_right, conversation_state, conversation_target_id, conversation_partner_id, pending_conversation_request_id')
      .eq('has_avatar', true)
      .not('display_name', 'is', null)
      .not('display_name', 'eq', '')
      .not('display_name', 'eq', 'Anonymous')
      .order('updated_at', { ascending: false })
  );
  
  if (error) {
    console.error('[DB] Failed to load users:', error);
    return [];
  }
  
  if (!data || data.length === 0) {
    console.log('[DB] No users with avatars found in database');
    return [];
  }
  
  console.log(`[DB] Found ${data.length} users with avatars`);
  
  // Log user data for debugging
  data.forEach(row => {
    const hasSprites = !!(row.sprite_front || row.sprite_back || row.sprite_left || row.sprite_right);
    console.log(`  - ${row.display_name}: sprites=${hasSprites ? 'YES' : 'NO'}`);
  });
  
  return data.map(parseUserRow);
}

/**
 * Delete a user by display name from all tables.
 * Use with caution - this permanently removes user data.
 */
export async function deleteUserByDisplayName(displayName: string): Promise<{ success: boolean; error?: string }> {
  console.log(`[DB] Deleting user with display_name: ${displayName}`);
  
  // First, find the user_id
  const { data: user, error: findError } = await supabase
    .from('user_positions')
    .select('user_id')
    .eq('display_name', displayName)
    .single();
  
  if (findError || !user) {
    return { success: false, error: `User "${displayName}" not found` };
  }
  
  const userId = user.user_id;
  console.log(`[DB] Found user_id: ${userId}`);
  
  // Delete from all related tables
  const tables = [
    'user_positions',
    'conversations',
    'memories'
  ];
  
  for (const table of tables) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId);
    
    if (error) {
      console.warn(`[DB] Failed to delete from ${table}:`, error.message);
    } else {
      console.log(`[DB] Deleted from ${table}`);
    }
  }
  
  return { success: true };
}

export async function updatePosition(
  userId: string, 
  x: number, 
  y: number, 
  facing?: { x: number; y: number },
  conversationState?: string,
  conversationTargetId?: string,
  conversationPartnerId?: string,
  pendingConversationRequestId?: string
): Promise<void> {
  const updateData: any = { x, y, updated_at: new Date().toISOString() };
  if (facing) {
    updateData.facing_x = facing.x;
    updateData.facing_y = facing.y;
  }
  if (conversationState !== undefined) {
    updateData.conversation_state = conversationState;
  }
  if (conversationTargetId !== undefined) {
    updateData.conversation_target_id = conversationTargetId;
  }
  if (conversationPartnerId !== undefined) {
    updateData.conversation_partner_id = conversationPartnerId;
  }
  if (pendingConversationRequestId !== undefined) {
    updateData.pending_conversation_request_id = pendingConversationRequestId;
  }
  

  
  const { error } = await supabase
    .from('user_positions')
    .update(updateData)
    .eq('user_id', userId);

  if (error) {
    console.error('Supabase updatePosition error:', error);
  }
}

/**
 * Fetch stats for all agents from agent_state table.
 * Returns a map of avatar_id -> stats object.
 */
export interface AgentStats {
  energy: number;
  hunger: number;
  loneliness: number;
  mood: number;
  current_action?: string;
  current_action_target?: Record<string, any>;
}

export async function getAllAgentStats(): Promise<Map<string, AgentStats>> {
  const { data, error } = await supabase
    .from('agent_state')
    .select('avatar_id, energy, hunger, loneliness, mood, current_action, current_action_target');
  
  if (error) {
    console.error('[DB] getAllAgentStats error:', error);
    return new Map();
  }
  
  const statsMap = new Map<string, AgentStats>();
  
  for (const row of data || []) {
    statsMap.set(row.avatar_id, {
      energy: row.energy ?? 0.5,
      hunger: row.hunger ?? 0.5,
      loneliness: row.loneliness ?? 0.5,
      mood: row.mood ?? 0.5,
      current_action: row.current_action || 'idle',
      current_action_target: row.current_action_target || null
    });
  }
  
  return statsMap;
}
