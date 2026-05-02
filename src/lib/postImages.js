// Storage helpers for the social-images bucket. One image per post for
// MVP — keeps the schema and UI simple. Mirrors the resource-images
// pattern from the Sermons app.

import { supabase, withTimeout } from './supabase';

export const POST_BUCKET = 'social-images';

export async function uploadPostImage({ file, ownerUserId, postId }) {
  if (!file) throw new Error('No file selected');
  if (!ownerUserId) throw new Error('Missing owner');
  if (!postId) throw new Error('Missing post id');

  let ext = 'bin';
  const name = file.name || '';
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    ext = name.slice(dot + 1).toLowerCase();
  } else if (file.type) {
    const m = file.type.match(/\/([a-z0-9]+)$/i);
    if (m) ext = m[1] === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  }
  const path = `${ownerUserId}/${postId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const { error } = await withTimeout(
    supabase.storage.from(POST_BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || `image/${ext}`,
    }),
    60000
  );
  if (error) throw error;
  return path;
}

export function publicPostImageUrl(path) {
  if (!path) return null;
  return supabase.storage.from(POST_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function deletePostImage(path) {
  if (!path) return;
  try {
    await withTimeout(
      supabase.storage.from(POST_BUCKET).remove([path]),
      15000
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to delete post image', path, e);
  }
}
