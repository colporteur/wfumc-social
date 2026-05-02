import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import {
  publicPostImageUrl,
  uploadPostImage,
  deletePostImage,
} from '../lib/postImages';
import ChannelChips from '../components/ChannelChips.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

const STATUS_BADGE = {
  draft:    { label: 'Draft',    cls: 'bg-gray-200 text-gray-700' },
  ready:    { label: 'Ready',    cls: 'bg-blue-100 text-blue-800' },
  posted:   { label: 'Posted',   cls: 'bg-green-100 text-green-800' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
};

const SOURCE_LABEL = {
  manual: 'Manual',
  free_form: 'Free-form draft',
  response_prompt: 'Bulletin response prompt',
  sermon: 'Sermon',
  image_upload: 'Image upload',
};

export default function PostDetail() {
  const { user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [post, setPost] = useState(null);
  // Source-side reads (so we can show "Drafted from <bulletin/sermon>")
  const [sourceBulletin, setSourceBulletin] = useState(null);
  const [sourceSermon, setSourceSermon] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copyMsg, setCopyMsg] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await withTimeout(
          supabase
            .from('social_posts')
            .select('*')
            .eq('id', id)
            .maybeSingle()
        );
        if (err) throw err;
        if (cancelled) return;
        setPost(data);

        // Fan-out reads for source linkage display
        if (data?.source_bulletin_id) {
          const { data: b } = await withTimeout(
            supabase
              .from('bulletins')
              .select('id, service_date, sunday_designation')
              .eq('id', data.source_bulletin_id)
              .maybeSingle()
          );
          if (!cancelled) setSourceBulletin(b);
        }
        if (data?.source_sermon_id) {
          const { data: s } = await withTimeout(
            supabase
              .from('sermons')
              .select('id, title, scripture_reference')
              .eq('id', data.source_sermon_id)
              .maybeSingle()
          );
          if (!cancelled) setSourceSermon(s);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user?.id]);

  // Image preview lifecycle
  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const startEdit = () => {
    setDraft({
      title: post.title ?? '',
      body: post.body ?? '',
      status: post.status,
      scheduled_for: post.scheduled_for ?? '',
      posted_at: post.posted_at ? post.posted_at.slice(0, 10) : '',
      platforms: post.platforms ?? [],
      notes: post.notes ?? '',
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
    setImageFile(null);
  };


  const save = async () => {
    if (!draft) return;
    if (!draft.body.trim()) {
      setError('Post text is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Optional: upload a new image first.
      let imagePath = post.image_path;
      let oldPath = null;
      if (imageFile && user?.id) {
        const newPath = await uploadPostImage({
          file: imageFile,
          ownerUserId: user.id,
          postId: post.id,
        });
        if (post.image_path) oldPath = post.image_path;
        imagePath = newPath;
      }

      // Auto-stamp posted_at when transitioning to "posted" without one.
      let postedAt = draft.posted_at
        ? new Date(draft.posted_at + 'T12:00:00').toISOString()
        : null;
      if (draft.status === 'posted' && !postedAt) {
        postedAt = new Date().toISOString();
      }
      if (draft.status !== 'posted' && draft.status !== 'archived') {
        // Going back to draft / ready — clear posted_at.
        postedAt = null;
      }

      const { data, error: err } = await withTimeout(
        supabase
          .from('social_posts')
          .update({
            title: draft.title.trim() || null,
            body: draft.body.trim(),
            status: draft.status,
            scheduled_for: draft.scheduled_for || null,
            posted_at: postedAt,
            platforms: draft.platforms,
            notes: draft.notes.trim() || null,
            image_path: imagePath,
          })
          .eq('id', post.id)
          .select()
          .single()
      );
      if (err) throw err;
      if (oldPath) await deletePostImage(oldPath);
      setPost(data);
      setEditing(false);
      setDraft(null);
      setImageFile(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!post) return;
    if (
      !window.confirm(
        'Delete this post? This can\'t be undone.'
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('social_posts').delete().eq('id', post.id)
      );
      if (err) throw err;
      if (post.image_path) await deletePostImage(post.image_path);
      navigate('/');
    } catch (e) {
      setError(e.message || String(e));
      setDeleting(false);
    }
  };

  const copyBody = async () => {
    if (!post?.body) return;
    try {
      await navigator.clipboard.writeText(post.body);
      setCopyMsg('Copied to clipboard.');
      setTimeout(() => setCopyMsg(null), 2500);
    } catch {
      setCopyMsg('Copy failed — select and copy manually.');
    }
  };

  // Quick status transitions from view mode (no edit mode required)
  const setStatus = async (newStatus) => {
    if (!post) return;
    const update = { status: newStatus };
    if (newStatus === 'posted' && !post.posted_at) {
      update.posted_at = new Date().toISOString();
    }
    if ((newStatus === 'draft' || newStatus === 'ready') && post.posted_at) {
      update.posted_at = null;
    }
    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await withTimeout(
        supabase
          .from('social_posts')
          .update(update)
          .eq('id', post.id)
          .select()
          .single()
      );
      if (err) throw err;
      setPost(data);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleImageChoose = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('That file does not appear to be an image.');
      return;
    }
    setError(null);
    setImageFile(f);
  };

  if (loading) return <LoadingSpinner label="Loading post…" />;
  if (error && !post) {
    return (
      <div className="card text-center space-y-3">
        <p className="text-sm text-red-700">Couldn't load post.</p>
        <p className="text-xs text-gray-500">{error}</p>
        <Link to="/" className="btn-secondary inline-block">
          ← Back to posts
        </Link>
      </div>
    );
  }
  if (!post) {
    return (
      <div className="card text-center space-y-3">
        <h1 className="font-serif text-xl text-umc-900">Post not found</h1>
        <Link to="/" className="btn-secondary inline-block">
          ← Back to posts
        </Link>
      </div>
    );
  }

  const badge = STATUS_BADGE[post.status] ?? STATUS_BADGE.draft;
  const imgUrl = post.image_path ? publicPostImageUrl(post.image_path) : null;

  return (
    <div className="space-y-6">
      <Link
        to="/"
        className="inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        ← All posts
      </Link>

      <div className="card space-y-4">
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Title (internal)</label>
                <input
                  type="text"
                  className="input"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  className="input"
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                >
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="posted">Posted</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">Post text *</label>
              <textarea
                className="input min-h-[200px] font-mono text-sm"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">
                {draft.body.length} characters
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Scheduled for</label>
                <input
                  type="date"
                  className="input"
                  value={draft.scheduled_for}
                  onChange={(e) =>
                    setDraft({ ...draft, scheduled_for: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Posted on</label>
                <input
                  type="date"
                  className="input"
                  value={draft.posted_at}
                  onChange={(e) =>
                    setDraft({ ...draft, posted_at: e.target.value })
                  }
                />
              </div>
            </div>
            <div>
              <label className="label">Channels</label>
              <ChannelChips
                value={draft.platforms}
                onChange={(next) => setDraft({ ...draft, platforms: next })}
              />
            </div>
            <div>
              <label className="label">Image</label>
              {imagePreview ? (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">
                    New image — replaces current on save:
                  </p>
                  <img
                    src={imagePreview}
                    alt="preview"
                    className="max-h-60 rounded border border-gray-200"
                  />
                  <button
                    type="button"
                    onClick={() => setImageFile(null)}
                    className="text-xs text-red-600 hover:text-red-800 underline"
                  >
                    Cancel new image
                  </button>
                </div>
              ) : imgUrl ? (
                <div className="space-y-2">
                  <img
                    src={imgUrl}
                    alt=""
                    className="max-h-60 rounded border border-gray-200"
                  />
                  <label className="btn-secondary text-sm cursor-pointer inline-block">
                    Replace image
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageChoose}
                    />
                  </label>
                </div>
              ) : (
                <label className="btn-secondary text-sm cursor-pointer inline-block">
                  📷 Add image
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageChoose}
                  />
                </label>
              )}
            </div>
            <div>
              <label className="label">Internal notes</label>
              <textarea
                className="input min-h-[60px]"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Notes for the team — not part of the post."
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="btn-primary disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" onClick={cancelEdit} className="btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                  {post.title && (
                    <h1 className="font-serif text-2xl text-umc-900">
                      {post.title}
                    </h1>
                  )}
                  {post.owner_user_id !== user?.id && (
                    <span className="text-[10px] uppercase tracking-wide text-umc-700">
                      from teammate
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>Source: {SOURCE_LABEL[post.source_type] || post.source_type}</span>
                  {post.scheduled_for && (
                    <span>Scheduled: {post.scheduled_for}</span>
                  )}
                  {post.posted_at && (
                    <span>Posted: {new Date(post.posted_at).toLocaleString()}</span>
                  )}
                  {(post.platforms ?? []).length > 0 && (
                    <span>On: {post.platforms.join(', ')}</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={startEdit}
                  className="btn-secondary text-sm"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="text-sm text-red-600 hover:text-red-800 underline disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>

            {imgUrl && (
              <div className="mt-4">
                <img
                  src={imgUrl}
                  alt=""
                  className="max-w-full rounded border border-gray-200 bg-gray-50"
                />
              </div>
            )}

            <div className="mt-4 bg-gray-50 border border-gray-200 rounded p-3">
              <p className="text-base text-gray-800 whitespace-pre-wrap font-serif leading-relaxed">
                {post.body || (
                  <span className="italic text-gray-400">(empty)</span>
                )}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={copyBody}
                disabled={!post.body}
                className="btn-primary text-sm disabled:opacity-50"
              >
                📋 Copy post text
              </button>
              {copyMsg && (
                <span className="text-xs text-green-700">{copyMsg}</span>
              )}
            </div>

            {/* Quick status transitions */}
            <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-2">
              <span className="text-xs text-gray-500 mr-2 self-center">
                Mark as:
              </span>
              {['draft', 'ready', 'posted', 'archived'].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  disabled={saving || post.status === s}
                  className={`text-xs px-2 py-1 rounded border ${
                    post.status === s
                      ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-umc-700 hover:text-umc-900'
                  }`}
                >
                  {STATUS_BADGE[s].label}
                </button>
              ))}
            </div>

            {(sourceBulletin || sourceSermon) && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                  Drafted from
                </p>
                {sourceBulletin && (
                  <p className="text-sm text-gray-700">
                    Bulletin: {sourceBulletin.service_date} ·{' '}
                    {sourceBulletin.sunday_designation || 'Sunday'}
                  </p>
                )}
                {sourceSermon && (
                  <p className="text-sm text-gray-700">
                    Sermon: {sourceSermon.title}
                    {sourceSermon.scripture_reference && (
                      <span className="text-gray-500">
                        {' '}
                        — {sourceSermon.scripture_reference}
                      </span>
                    )}
                  </p>
                )}
              </div>
            )}

            {post.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                  Internal notes
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {post.notes}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
