import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import {
  draftFreeForm,
  draftFromImage,
  draftFromSermon,
} from '../lib/claude';
import { uploadPostImage } from '../lib/postImages';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

const SOURCES = [
  {
    value: 'free_form',
    label: 'Blank / typed prompt',
    icon: '✍️',
    blurb: 'Empty composer. Optionally let Claude polish from a brief description.',
  },
  {
    value: 'response_prompt',
    label: 'From worshipper submissions',
    icon: '🙋',
    blurb: 'Browse responses, photos, and highlights worshippers sent in for a bulletin. Pick one to seed your post.',
  },
  {
    value: 'sermon',
    label: 'From sermon',
    icon: '⛪',
    blurb: 'Pick a sermon; Claude drafts an invitation, excerpt, or reflection.',
  },
  {
    value: 'image_upload',
    label: 'From image',
    icon: '📷',
    blurb: 'Upload one or more images; Claude vision drafts post copy.',
  },
];

export default function PostNew() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [source, setSource] = useState(null); // null = picker; else value

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        ← All posts
      </Link>

      <h1 className="font-serif text-2xl text-umc-900">New post</h1>

      {!source && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SOURCES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSource(s.value)}
              className="card text-left hover:border-umc-700 transition-colors"
            >
              <div className="text-2xl">{s.icon}</div>
              <h2 className="font-serif text-lg text-umc-900 mt-1">
                {s.label}
              </h2>
              <p className="text-xs text-gray-500 mt-1">{s.blurb}</p>
            </button>
          ))}
        </div>
      )}

      {source === 'free_form' && (
        <FreeFormFlow user={user} navigate={navigate} onBack={() => setSource(null)} />
      )}
      {source === 'response_prompt' && (
        <SubmissionsFlow user={user} navigate={navigate} onBack={() => setSource(null)} />
      )}
      {source === 'sermon' && (
        <SermonFlow user={user} navigate={navigate} onBack={() => setSource(null)} />
      )}
      {source === 'image_upload' && (
        <ImageFlow user={user} navigate={navigate} onBack={() => setSource(null)} />
      )}
    </div>
  );
}

// =====================================================================
// Shared composer — final step of every flow. Editable title/body, then
// save to social_posts (status=draft) and navigate to detail.
// =====================================================================

function Composer({
  user,
  navigate,
  initialTitle,
  initialBody,
  sourceType,
  sourceBulletinId,
  sourceSermonId,
  imageFile,
  onBack,
  busy,
  setBusy,
}) {
  const [title, setTitle] = useState(initialTitle || '');
  const [body, setBody] = useState(initialBody || '');
  const [error, setError] = useState(null);

  const save = async () => {
    if (!user?.id) return;
    if (!body.trim()) {
      setError('Add some post text before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: created, error: err } = await withTimeout(
        supabase
          .from('social_posts')
          .insert({
            owner_user_id: user.id,
            status: 'draft',
            title: title.trim() || null,
            body: body.trim(),
            source_type: sourceType,
            source_bulletin_id: sourceBulletinId ?? null,
            source_sermon_id: sourceSermonId ?? null,
          })
          .select()
          .single()
      );
      if (err) throw err;

      // If an image came along, upload it and patch image_path.
      if (imageFile) {
        const path = await uploadPostImage({
          file: imageFile,
          ownerUserId: user.id,
          postId: created.id,
        });
        const { error: updErr } = await withTimeout(
          supabase
            .from('social_posts')
            .update({ image_path: path })
            .eq('id', created.id)
        );
        if (updErr) throw updErr;
      }
      navigate(`/posts/${created.id}`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-umc-900">Composer</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          ← Pick a different source
        </button>
      </div>
      <div>
        <label className="label">Title (internal, optional)</label>
        <input
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g., "Easter brunch invite"'
        />
      </div>
      <div>
        <label className="label">Post text *</label>
        <textarea
          className="input min-h-[200px] font-mono text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="The actual post text…"
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
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save as draft'}
        </button>
        <Link to="/" className="btn-secondary">
          Cancel
        </Link>
      </div>
    </div>
  );
}

// =====================================================================
// Free-form flow: optional Claude polish from a typed prompt
// =====================================================================
function FreeFormFlow({ user, navigate, onBack }) {
  const [prompt, setPrompt] = useState('');
  const [drafted, setDrafted] = useState(null); // { title, body }
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const runDraft = async () => {
    if (!prompt.trim()) {
      // Skip Claude — go straight to empty composer
      setDrafted({ title: '', body: '' });
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const result = await draftFreeForm({ prompt });
      setDrafted(result);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDrafting(false);
    }
  };

  if (drafted) {
    return (
      <Composer
        user={user}
        navigate={navigate}
        initialTitle={drafted.title}
        initialBody={drafted.body}
        sourceType="free_form"
        onBack={() => setDrafted(null)}
        busy={busy}
        setBusy={setBusy}
      />
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-umc-900">
          Blank / typed prompt
        </h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          ← Pick a different source
        </button>
      </div>
      <div>
        <label className="label">Brief description (optional)</label>
        <textarea
          className="input min-h-[100px]"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='e.g., "Reminder about Wednesday night dinner this week — 6pm in the fellowship hall, bring a dessert to share."'
        />
        <p className="text-xs text-gray-500 mt-1">
          Type a few notes and Claude will polish into post-ready text. Or
          leave empty to start with a totally blank composer.
        </p>
      </div>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={runDraft}
          disabled={drafting}
          className="btn-primary disabled:opacity-50"
        >
          {drafting ? 'Drafting…' : prompt.trim() ? '✨ Draft with Claude' : 'Start blank'}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Submissions flow: pick a bulletin → browse worshipper submissions
// (text responses, photos, highlights) → pick one to seed the composer
// with that submission's content.
// =====================================================================
function SubmissionsFlow({ user, navigate, onBack }) {
  const [loadingBulletins, setLoadingBulletins] = useState(true);
  const [bulletins, setBulletins] = useState([]);
  const [picked, setPicked] = useState(null);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState(null);
  const [chosenSub, setChosenSub] = useState(null); // → composer
  const [busy, setBusy] = useState(false);

  // Load recent bulletins. Show ALL bulletins (not just those with a
  // response prompt) — worshippers can submit highlights from any
  // bulletin even if there's no prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingBulletins(true);
      try {
        const { data, error: err } = await withTimeout(
          supabase
            .from('bulletins')
            .select(
              'id, service_date, sunday_designation, status, response_prompt'
            )
            .order('service_date', { ascending: false })
            .limit(30)
        );
        if (err) throw err;
        if (cancelled) return;
        setBulletins(data ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoadingBulletins(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load submissions whenever picked changes.
  useEffect(() => {
    if (!picked) {
      setSubmissions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingSubs(true);
      setError(null);
      try {
        const { data, error: err } = await withTimeout(
          supabase
            .from('responses')
            .select(
              'id, is_anonymous, submitter_name, response_text, caption, image_url, highlighted_text, source_label, used_in_social_media, submitted_at'
            )
            .eq('bulletin_id', picked.id)
            .order('submitted_at', { ascending: false })
        );
        if (err) throw err;
        if (cancelled) return;
        setSubmissions(data ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoadingSubs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [picked]);

  if (chosenSub) {
    // Build composer initial values from the submission.
    const sub = chosenSub;
    const attribution = sub.is_anonymous
      ? 'Submitted anonymously'
      : sub.submitter_name
        ? `Submitted by ${sub.submitter_name}`
        : 'Submitted by a worshipper';
    let initialBody = '';
    if (sub.highlighted_text) {
      // Highlight: lead with the snippet, follow with optional commentary.
      initialBody = `"${sub.highlighted_text}"`;
      if (sub.source_label) initialBody += `\n— from ${sub.source_label}`;
      if (sub.response_text) {
        initialBody += `\n\n${sub.response_text}`;
      }
    } else if (sub.response_text) {
      initialBody = sub.response_text;
    } else if (sub.caption) {
      initialBody = sub.caption;
    }
    const initialTitle = `${picked.sunday_designation || picked.service_date} · ${attribution}`;

    return (
      <SubmissionComposer
        user={user}
        navigate={navigate}
        initialTitle={initialTitle}
        initialBody={initialBody}
        sourceBulletinId={picked.id}
        responseId={sub.id}
        existingImageUrl={sub.image_url}
        onBack={() => setChosenSub(null)}
        busy={busy}
        setBusy={setBusy}
      />
    );
  }

  if (loadingBulletins) return <LoadingSpinner label="Loading bulletins…" />;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-umc-900">
          From worshipper submissions
        </h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          ← Pick a different source
        </button>
      </div>

      {bulletins.length === 0 ? (
        <p className="text-sm text-gray-500">No bulletins found.</p>
      ) : (
        <>
          <div>
            <label className="label">Pick a bulletin</label>
            <select
              className="input"
              value={picked?.id ?? ''}
              onChange={(e) =>
                setPicked(bulletins.find((b) => b.id === e.target.value) ?? null)
              }
            >
              <option value="">— Select —</option>
              {bulletins.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.service_date} · {b.sunday_designation || 'Sunday'} ·{' '}
                  {b.status}
                </option>
              ))}
            </select>
          </div>

          {picked?.response_prompt && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                This week's prompt
              </p>
              <p className="text-sm italic text-gray-700 whitespace-pre-wrap">
                "{picked.response_prompt}"
              </p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {picked && (
            <SubmissionsList
              loading={loadingSubs}
              submissions={submissions}
              onPick={setChosenSub}
            />
          )}
        </>
      )}
    </div>
  );
}

function SubmissionsList({ loading, submissions, onPick }) {
  if (loading) return <LoadingSpinner label="Loading submissions…" />;
  if (submissions.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-6">
        No submissions for this bulletin yet.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {submissions.map((s) => {
        const kind = s.highlighted_text
          ? 'highlight'
          : s.image_url
            ? 'photo'
            : 'response';
        const KIND_BADGE = {
          highlight: { label: 'Highlight', cls: 'bg-amber-100 text-amber-800' },
          photo: { label: 'Photo', cls: 'bg-pink-100 text-pink-800' },
          response: { label: 'Response', cls: 'bg-blue-100 text-blue-800' },
        };
        const badge = KIND_BADGE[kind];
        const who = s.is_anonymous
          ? 'Anonymous'
          : s.submitter_name || 'Unnamed';
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="w-full text-left card hover:border-umc-700 transition-colors p-3"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${badge.cls}`}
                >
                  {badge.label}
                </span>
                <span className="text-xs text-gray-500">— {who}</span>
                {s.used_in_social_media && (
                  <span className="text-[10px] uppercase tracking-wide text-green-700">
                    used
                  </span>
                )}
                <span className="text-[10px] text-gray-400 ml-auto">
                  {new Date(s.submitted_at).toLocaleDateString()}
                </span>
              </div>
              <div className="mt-2 flex gap-3">
                {s.image_url && (
                  <img
                    src={s.image_url}
                    alt=""
                    loading="lazy"
                    className="h-16 w-16 object-cover rounded shrink-0 bg-gray-100"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  {s.highlighted_text && (
                    <p className="text-sm italic text-gray-800 line-clamp-3 border-l-2 border-umc-300 pl-2">
                      "{s.highlighted_text}"
                    </p>
                  )}
                  {s.source_label && s.highlighted_text && (
                    <p className="text-[10px] text-gray-500">
                      from {s.source_label}
                    </p>
                  )}
                  {s.response_text && (
                    <p className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                      {s.response_text}
                    </p>
                  )}
                  {s.caption && !s.response_text && (
                    <p className="text-sm text-gray-700 line-clamp-2">
                      {s.caption}
                    </p>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// Variant of Composer that, on save, also marks the source response
// as used_in_social_media. Optionally seeds the post's image from the
// worshipper's uploaded photo (downloads + re-uploads to social bucket
// so the post owns its own copy).
function SubmissionComposer({
  user,
  navigate,
  initialTitle,
  initialBody,
  sourceBulletinId,
  responseId,
  existingImageUrl,
  onBack,
  busy,
  setBusy,
}) {
  const [title, setTitle] = useState(initialTitle || '');
  const [body, setBody] = useState(initialBody || '');
  const [keepImage, setKeepImage] = useState(!!existingImageUrl);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!user?.id) return;
    if (!body.trim()) {
      setError('Add some post text before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Insert the post first — image attach is a follow-up update so
      // we have the post id for the storage path.
      const { data: created, error: err } = await withTimeout(
        supabase
          .from('social_posts')
          .insert({
            owner_user_id: user.id,
            status: 'draft',
            title: title.trim() || null,
            body: body.trim(),
            source_type: 'response_prompt',
            source_bulletin_id: sourceBulletinId,
          })
          .select()
          .single()
      );
      if (err) throw err;

      // Bring the worshipper's photo over to the post.
      if (keepImage && existingImageUrl) {
        try {
          const res = await fetch(existingImageUrl);
          if (res.ok) {
            const blob = await res.blob();
            const ext =
              (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
            const path = `${user.id}/${created.id}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from('social-images')
              .upload(path, blob, {
                cacheControl: '3600',
                upsert: false,
                contentType: blob.type || `image/${ext}`,
              });
            if (!upErr) {
              await supabase
                .from('social_posts')
                .update({ image_path: path })
                .eq('id', created.id);
            }
          }
        } catch (imgErr) {
          // Non-fatal: post still saves without image.
          // eslint-disable-next-line no-console
          console.warn('Failed to copy submission image:', imgErr);
        }
      }

      // Mark the source submission as used.
      try {
        await supabase
          .from('responses')
          .update({ used_in_social_media: true })
          .eq('id', responseId);
      } catch (markErr) {
        // eslint-disable-next-line no-console
        console.warn('Failed to mark response used:', markErr);
      }

      navigate(`/posts/${created.id}`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-umc-900">Composer</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          ← Back to submissions
        </button>
      </div>
      <div>
        <label className="label">Title (internal)</label>
        <input
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label className="label">Post text *</label>
        <textarea
          className="input min-h-[200px] font-mono text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {existingImageUrl && (
        <div className="border border-gray-200 rounded p-3 bg-gray-50">
          <div className="flex items-start gap-3">
            <img
              src={existingImageUrl}
              alt=""
              className="h-24 w-24 object-cover rounded shrink-0"
            />
            <div className="flex-1">
              <p className="text-xs text-gray-600 mb-2">
                The worshipper attached this photo. Keep it on your post?
              </p>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepImage}
                  onChange={(e) => setKeepImage(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-umc-700"
                />
                Use this photo
              </label>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save as draft'}
        </button>
        <Link to="/" className="btn-secondary">
          Cancel
        </Link>
      </div>
    </div>
  );
}

// =====================================================================
// Sermon flow: pick a sermon, choose variant
// =====================================================================
function SermonFlow({ user, navigate, onBack }) {
  const [loading, setLoading] = useState(true);
  const [sermons, setSermons] = useState([]);
  const [picked, setPicked] = useState(null);
  const [variant, setVariant] = useState('invitation');
  const [drafted, setDrafted] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data, error: err } = await withTimeout(
          supabase
            .from('sermons')
            .select(
              'id, title, scripture_reference, theme, manuscript_text, preached_at'
            )
            .order('preached_at', { ascending: false, nullsFirst: false })
            .limit(50)
        );
        if (err) throw err;
        if (cancelled) return;
        setSermons(data ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runDraft = async () => {
    if (!picked) return;
    setDrafting(true);
    setError(null);
    try {
      const result = await draftFromSermon({
        sermonTitle: picked.title,
        scriptureRef: picked.scripture_reference,
        theme: picked.theme,
        manuscriptText: variant === 'excerpt' ? picked.manuscript_text : undefined,
        variant,
      });
      setDrafted(result);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDrafting(false);
    }
  };

  if (drafted) {
    return (
      <Composer
        user={user}
        navigate={navigate}
        initialTitle={drafted.title}
        initialBody={drafted.body}
        sourceType="sermon"
        sourceSermonId={picked.id}
        onBack={() => setDrafted(null)}
        busy={busy}
        setBusy={setBusy}
      />
    );
  }

  if (loading) return <LoadingSpinner label="Loading sermons…" />;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-umc-900">From sermon</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          ← Pick a different source
        </button>
      </div>
      <div>
        <label className="label">Pick a sermon</label>
        <select
          className="input"
          value={picked?.id ?? ''}
          onChange={(e) =>
            setPicked(sermons.find((s) => s.id === e.target.value) ?? null)
          }
        >
          <option value="">— Select —</option>
          {sermons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.preached_at ? `${s.preached_at} · ` : ''}
              {s.title || '(untitled)'}
            </option>
          ))}
        </select>
      </div>
      {picked && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            { value: 'invitation', label: 'Invitation' },
            { value: 'excerpt', label: 'Excerpt' },
            { value: 'reflection', label: 'Reflection' },
          ].map((v) => (
            <label
              key={v.value}
              className={`border rounded p-2 cursor-pointer text-sm ${
                variant === v.value
                  ? 'border-umc-700 bg-umc-50/30'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input
                type="radio"
                name="variant"
                value={v.value}
                checked={variant === v.value}
                onChange={(e) => setVariant(e.target.value)}
                className="mr-2"
              />
              {v.label}
            </label>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={runDraft}
          disabled={!picked || drafting}
          className="btn-primary disabled:opacity-50"
        >
          {drafting ? 'Drafting…' : '✨ Draft with Claude'}
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// Image flow: upload image(s) + optional context, vision-draft
// =====================================================================
function ImageFlow({ user, navigate, onBack }) {
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [context, setContext] = useState('');
  const [drafted, setDrafted] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (files.length === 0) {
      setPreviews([]);
      return;
    }
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const handleChoose = (e) => {
    const fs = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith('image/')
    );
    if (fs.length === 0) return;
    setFiles((prev) => [...prev, ...fs].slice(0, 4));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAt = (idx) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const runDraft = async () => {
    if (files.length === 0) {
      setError('Add at least one image to draft from.');
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const result = await draftFromImage({ images: files, context });
      setDrafted(result);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setDrafting(false);
    }
  };

  if (drafted) {
    // Composer attaches the FIRST image to the saved post (MVP).
    // The other images are viewed-only context for Claude — they're
    // not stored. The user can re-upload if they want all of them on
    // the saved post (extension later).
    return (
      <Composer
        user={user}
        navigate={navigate}
        initialTitle={drafted.title}
        initialBody={drafted.body}
        sourceType="image_upload"
        imageFile={files[0]}
        onBack={() => setDrafted(null)}
        busy={busy}
        setBusy={setBusy}
      />
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-umc-900">From image</h2>
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-gray-700 underline"
        >
          ← Pick a different source
        </button>
      </div>
      <div>
        <label className="label">Image(s)</label>
        <p className="text-xs text-gray-500 mb-2">
          Up to 4 images. Claude looks at all of them, but only the first
          gets attached to the saved post.
        </p>
        <label className="btn-secondary text-sm cursor-pointer inline-block">
          + Add image(s)
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleChoose}
          />
        </label>
        {previews.length > 0 && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {previews.map((url, i) => (
              <div
                key={i}
                className="relative border border-gray-200 rounded overflow-hidden bg-gray-50"
              >
                <img
                  src={url}
                  alt={`upload ${i + 1}`}
                  className="w-full aspect-square object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="absolute top-1 right-1 px-2 py-0.5 text-xs bg-white/90 hover:bg-white text-red-600 hover:text-red-800 rounded shadow"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="label">Context for Claude (optional)</label>
        <textarea
          className="input min-h-[80px]"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          placeholder='e.g., "Volunteers prepping for the food pantry"'
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={runDraft}
          disabled={files.length === 0 || drafting}
          className="btn-primary disabled:opacity-50"
        >
          {drafting ? 'Drafting…' : '✨ Draft with Claude'}
        </button>
      </div>
    </div>
  );
}
