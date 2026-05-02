// Helpers for the social_channels table.
//
// Channels are predefined platforms the team posts to (Facebook,
// Instagram, plus any user-added). They drive the chip selector on
// the post editor. The actual platforms-per-post are stored as a
// text[] of slugs on social_posts.platforms — we don't FK so a deleted
// channel doesn't strip history from old posts.

import { supabase, withTimeout } from './supabase';

export async function listChannels() {
  const { data, error } = await withTimeout(
    supabase
      .from('social_channels')
      .select('id, slug, name, color, sort_order')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
  );
  if (error) throw error;
  return data ?? [];
}

export async function createChannel({ slug, name, color, sortOrder }, userId) {
  if (!slug?.trim() || !name?.trim()) {
    throw new Error('Slug and name are required.');
  }
  const cleanSlug = slug.trim().toLowerCase().replace(/\s+/g, '-');
  const { data, error } = await withTimeout(
    supabase
      .from('social_channels')
      .insert({
        slug: cleanSlug,
        name: name.trim(),
        color: color?.trim() || null,
        sort_order: sortOrder ?? 100,
        created_by: userId ?? null,
      })
      .select()
      .single()
  );
  if (error) {
    if (String(error.message || '').toLowerCase().includes('duplicate')) {
      throw new Error('A channel with that slug already exists.');
    }
    throw error;
  }
  return data;
}

export async function updateChannel(id, patch) {
  const { data, error } = await withTimeout(
    supabase
      .from('social_channels')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
  );
  if (error) throw error;
  return data;
}

export async function deleteChannel(id) {
  const { error } = await withTimeout(
    supabase.from('social_channels').delete().eq('id', id)
  );
  if (error) throw error;
}
