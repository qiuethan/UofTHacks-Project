import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, MAP_WIDTH, MAP_HEIGHT } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export async function getPosition(userId: string): Promise<{ x: number; y: number }> {
  const { data } = await supabase
    .from('user_positions')
    .select('x, y')
    .eq('user_id', userId)
    .single();
  
  if (data) return { x: data.x, y: data.y };
  
  // First time user - create random position
  const x = Math.floor(Math.random() * MAP_WIDTH);
  const y = Math.floor(Math.random() * MAP_HEIGHT);
  await supabase.from('user_positions').insert({ user_id: userId, x, y });
  return { x, y };
}

export async function updatePosition(userId: string, x: number, y: number): Promise<void> {
  await supabase
    .from('user_positions')
    .update({ x, y, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}
