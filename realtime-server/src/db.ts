import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, MAP_WIDTH, MAP_HEIGHT } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export async function getPosition(userId: string): Promise<{ x: number; y: number; facing: { x: number; y: number } }> {
  const { data } = await supabase
    .from('user_positions')
    .select('x, y, facing_x, facing_y')
    .eq('user_id', userId)
    .single();
  
  if (data) {
    return { 
      x: data.x, 
      y: data.y, 
      facing: { x: data.facing_x, y: data.facing_y } 
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

export async function updatePosition(userId: string, x: number, y: number, facing?: { x: number; y: number }): Promise<void> {
  const updateData: any = { x, y, updated_at: new Date().toISOString() };
  if (facing) {
    updateData.facing_x = facing.x;
    updateData.facing_y = facing.y;
  }
  

  
  const { error } = await supabase
    .from('user_positions')
    .update(updateData)
    .eq('user_id', userId);

  if (error) {
    console.error('Supabase updatePosition error:', error);
  }
}
