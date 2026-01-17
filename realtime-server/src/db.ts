import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, MAP_WIDTH, MAP_HEIGHT } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
}

export async function getPosition(userId: string): Promise<UserPositionData> {
  const { data } = await supabase
    .from('user_positions')
    .select('x, y, facing_x, facing_y, display_name, has_avatar, sprite_front, sprite_back, sprite_left, sprite_right, conversation_state, conversation_target_id, conversation_partner_id, pending_conversation_request_id')
    .eq('user_id', userId)
    .single();
  
  if (data) {
    return { 
      x: data.x, 
      y: data.y, 
      facing: { x: data.facing_x, y: data.facing_y },
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
      pendingConversationRequestId: data.pending_conversation_request_id || undefined
    };
  }
  
  // First time user - create random position
  const x = Math.floor(Math.random() * MAP_WIDTH);
  const y = Math.floor(Math.random() * MAP_HEIGHT);
  await supabase.from('user_positions').insert({ 
    user_id: userId, 
    x, 
    y,
    facing_x: 0,
    facing_y: 1
  });
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
 * Used on server startup to populate the world with existing users as ROBOTs.
 */
export async function getAllUsers(): Promise<Array<{ userId: string } & UserPositionData>> {
  console.log('[DB] Loading all users from user_positions table...');
  
  const { data, error } = await supabase
    .from('user_positions')
    .select('user_id, x, y, facing_x, facing_y, display_name, has_avatar, sprite_front, sprite_back, sprite_left, sprite_right, conversation_state, conversation_target_id, conversation_partner_id, pending_conversation_request_id');
  
  if (error) {
    console.error('[DB] Failed to load all users:', error);
    return [];
  }
  
  if (!data) {
    console.log('[DB] No users found in database');
    return [];
  }
  
  console.log(`[DB] Found ${data.length} users in database`);
  
  // Debug: Log raw sprite data for each user
  data.forEach(row => {
    console.log(`[DB] User ${row.display_name || row.user_id.substring(0, 8)}:`, {
      has_avatar: row.has_avatar,
      sprite_front: row.sprite_front ? row.sprite_front.substring(0, 50) + '...' : null,
      sprite_back: row.sprite_back ? 'yes' : null,
      sprite_left: row.sprite_left ? 'yes' : null,
      sprite_right: row.sprite_right ? 'yes' : null
    });
  });
  
  return data.map(row => ({
    userId: row.user_id,
    x: row.x,
    y: row.y,
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
  }));
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
