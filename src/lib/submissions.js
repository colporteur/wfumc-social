// Helpers for turning worshipper responses into social posts.
//
// Single submission → seed composer with that one submission.
// Multiple submissions → merge: concatenate content with attribution,
// take the first photo, mark all source responses as used.
//
// Both paths return the new post id so the caller can navigate to it.

import { supabase, withTimeout } from './supabase';

// Format a single submission as a chunk of text suitable for a post.
// Used by both single + merged creation flows.
function formatSubmissionAsText(sub) {
  const parts = [];
  if (sub.highlighted_text) {
    parts.push(`"${sub.highlighted_text}"`);
    if (sub.source_label) parts.push(`— from ${sub.source_label}`);
  }
  if (sub.response_text) {
    if (parts.length > 0) parts.push('');
    parts.push(sub.response_text);
  } else if (sub.caption && !sub.highlighted_text) {
    parts.push(sub.caption);
  }
  return parts.join('\n');
}

function attribution(sub) {
  if (sub.is_anonymous) return 'Anonymous';
  return sub.submitter_name?.trim() || 'A worshipper';
}

// Build initial composer values for a single submission.
export function buildSinglePostDraft(submission, bulletin) {
  const who = attribution(submission);
  const when = bulletin?.sunday_designation || bulletin?.service_date || '';
  return {
    title: when ? `${when} · ${who}` : `From ${who}`,
    body: formatSubmissionAsText(submission),
  };
}

// Build initial composer values for a merged set of submissions.
// Each contributor gets attributed; submissions interleave in the
// order they were passed in.
export function buildMergedPostDraft(submissions, bulletin) {
  if (!submissions?.length) return { title: '', body: '' };
  const when = bulletin?.sunday_designation || bulletin?.service_date || '';
  const blocks = submissions.map((sub) => {
    const text = formatSubmissionAsText(sub);
    return `${text}\n— ${attribution(sub)}`;
  });
  const body = blocks.join('\n\n');
  const intro = `From ${submissions.length} worshippers`;
  return {
    title: when ? `${when} · ${intro}` : intro,
    body,
  };
}

// Create a single-submission draft post and return the row.
// Optionally copies the worshipper photo over to the social bucket.
export async function createPostFromSubmission({
  userId,
  bulletin,
  submission,
  copyImage = true,
}) {
  const { title, body } = buildSinglePostDraft(submission, bulletin);
  const { data: created, error } = await withTimeout(
    supabase
      .from('social_posts')
      .insert({
        owner_user_id: userId,
        status: 'draft',
        title,
        body,
        source_type: 'response_prompt',
        source_bulletin_id: bulletin?.id ?? null,
      })
      .select()
      .single()
  );
  if (error) throw error;

  if (copyImage && submission.image_url) {
    await tryCopyImageToPost({
      postId: created.id,
      ownerUserId: userId,
      imageUrl: submission.image_url,
    });
  }

  await tryMarkUsed([submission.id]);

  return created;
}

// Create a merged-from-many draft post.
export async function createPostFromMergedSubmissions({
  userId,
  bulletin,
  submissions,
  copyImage = true,
}) {
  if (!submissions?.length) {
    throw new Error('No submissions to merge.');
  }
  const { title, body } = buildMergedPostDraft(submissions, bulletin);
  const { data: created, error } = await withTimeout(
    supabase
      .from('social_posts')
      .insert({
        owner_user_id: userId,
        status: 'draft',
        title,
        body,
        source_type: 'response_prompt',
        source_bulletin_id: bulletin?.id ?? null,
      })
      .select()
      .single()
  );
  if (error) throw error;

  // Copy the FIRST submission with an image (if any) to the post.
  if (copyImage) {
    const withImage = submissions.find((s) => s.image_url);
    if (withImage) {
      await tryCopyImageToPost({
        postId: created.id,
        ownerUserId: userId,
        imageUrl: withImage.image_url,
      });
    }
  }

  await tryMarkUsed(submissions.map((s) => s.id));

  return created;
}

// Best-effort: download the worshipper's image and re-upload to the
// social-images bucket so the post owns its own copy. Failures are
// non-fatal — the post still saves without an image.
async function tryCopyImageToPost({ postId, ownerUserId, imageUrl }) {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `${ownerUserId}/${postId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('social-images')
      .upload(path, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: blob.type || `image/${ext}`,
      });
    if (upErr) return;
    await supabase
      .from('social_posts')
      .update({ image_path: path })
      .eq('id', postId);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to copy submission image:', e);
  }
}

// Best-effort: mark a list of response ids as used_in_social_media.
async function tryMarkUsed(ids) {
  if (!ids?.length) return;
  try {
    await supabase
      .from('responses')
      .update({ used_in_social_media: true })
      .in('id', ids);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Failed to mark responses used:', e);
  }
}
