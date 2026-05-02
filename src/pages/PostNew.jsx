import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import {
  draftFreeForm,
  draftFromImage,
  draftFromSermon,
} from '../lib/claude';
import { uploadPostImage } from '../lib/postImages';
import {
  createPostFromSubmission,
  createPostFromMergedSubmissions,
} from '../lib/submissions';
import SubmissionsBoard from '../components/SubmissionsBoard.jsx';
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
  {
    value: 'announcement',
    label: 'From announcement / event',
    icon: '📅',
    blurb: 'Promote an upcoming event or a bulletin announcement. Pulls from calendar events and bulletins (drafts included).',
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
      {source === 'announcement' && (
        <AnnouncementFlow
          user={user}
          navigate={navigate}
          onBack={() => setSource(null)}
        />
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
  const [busy, setBusy] = useState(false);

  // Load recent bulletins. Show ALL bulletins (not just those with a
  // response prompt) — worshippers can submit highlights from any
  // bulletin even if there's no prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingBulletins(true);
      try {
        // Fetch recent bulletins + each one's response prompts in
        // parallel. Prompts moved out of bulletins.response_prompt into
        // the response_prompts table in migration 0026.
        const [blnRes, prRes] = await Promise.all([
          withTimeout(
            supabase
              .from('bulletins')
              .select('id, service_date, sunday_designation, status')
              .order('service_date', { ascending: false })
              .limit(30)
          ),
          withTimeout(
            supabase
              .from('response_prompts')
              .select('id, bulletin_id, text, sort_order')
              .order('sort_order', { ascending: true })
          ),
        ]);
        if (blnRes.error) throw blnRes.error;
        if (prRes.error) throw prRes.error;
        if (cancelled) return;
        // Attach the prompts to each bulletin so we can show them as
        // context when a bulletin is picked.
        const promptsByBulletin = new Map();
        for (const p of prRes.data ?? []) {
          if (!promptsByBulletin.has(p.bulletin_id)) {
            promptsByBulletin.set(p.bulletin_id, []);
          }
          promptsByBulletin.get(p.bulletin_id).push(p);
        }
        const enriched = (blnRes.data ?? []).map((b) => ({
          ...b,
          prompts: promptsByBulletin.get(b.id) ?? [],
        }));
        setBulletins(enriched);
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

  // Single-submission → create + navigate via shared helper.
  const handleCreateOne = async (sub) => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPostFromSubmission({
        userId: user.id,
        bulletin: picked,
        submission: sub,
      });
      navigate(`/posts/${created.id}`);
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  // Merge multiple → create + navigate.
  const handleMerge = async (subs) => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPostFromMergedSubmissions({
        userId: user.id,
        bulletin: picked,
        submissions: subs,
      });
      navigate(`/posts/${created.id}`);
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

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

          {picked?.prompts?.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3 space-y-2">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Prompts on this bulletin ({picked.prompts.length})
              </p>
              {picked.prompts.map((p) => (
                <p
                  key={p.id}
                  className="text-sm italic text-gray-700 whitespace-pre-wrap"
                >
                  "{p.text}"
                </p>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {picked && (
            loadingSubs ? (
              <LoadingSpinner label="Loading submissions…" />
            ) : (
              <SubmissionsBoard
                submissions={submissions}
                onCreateOne={handleCreateOne}
                onMerge={handleMerge}
                busy={busy}
              />
            )
          )}
        </>
      )}
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

// =====================================================================
// Announcement / event flow.
// Pulls upcoming calendar events + announcements + image_flyer blocks
// from recent bulletins (drafts included — sometimes you want to
// promote before the bulletin is fully published). Click any item to
// open the composer pre-seeded with that content.
// =====================================================================
function AnnouncementFlow({ user, navigate, onBack }) {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [annoucementsByBulletin, setAnnouncementsByBulletin] = useState([]);
  const [error, setError] = useState(null);
  const [staged, setStaged] = useState(null); // → composer
  const [polishing, setPolishing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [evRes, blnRes, annRes, otherRes] = await Promise.all([
          // Upcoming calendar events in the next 90 days.
          withTimeout(
            supabase
              .from('calendar_events')
              .select('id, event_date, event_time, title, location, notes, is_published')
              .gte('event_date', today)
              .order('event_date', { ascending: true })
              .limit(40)
          ),
          // Recent bulletins (draft + published, not archived) so we can
          // group their announcements + flyer blocks below.
          withTimeout(
            supabase
              .from('bulletins')
              .select('id, service_date, sunday_designation, status')
              .in('status', ['draft', 'published'])
              .order('service_date', { ascending: false })
              .limit(8)
          ),
          withTimeout(
            supabase
              .from('announcements')
              .select('id, bulletin_id, position, body')
              .order('position', { ascending: true })
          ),
          withTimeout(
            supabase
              .from('other_blocks')
              .select(
                'id, bulletin_id, position, block_type, heading, body, image_url, signature'
              )
              .order('position', { ascending: true })
          ),
        ]);
        if (evRes.error) throw evRes.error;
        if (blnRes.error) throw blnRes.error;
        if (annRes.error) throw annRes.error;
        if (otherRes.error) throw otherRes.error;
        if (cancelled) return;
        setEvents(evRes.data ?? []);
        // Group announcements + other_blocks under their bulletin.
        const bulletinList = blnRes.data ?? [];
        const blockedByBulletin = bulletinList
          .map((b) => {
            const announcements = (annRes.data ?? []).filter(
              (a) => a.bulletin_id === b.id
            );
            const others = (otherRes.data ?? []).filter(
              (o) => o.bulletin_id === b.id
            );
            return { bulletin: b, announcements, others };
          })
          .filter((g) => g.announcements.length + g.others.length > 0);
        setAnnouncementsByBulletin(blockedByBulletin);
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

  const stageEvent = (ev) => {
    const dateStr = new Date(ev.event_date + 'T00:00:00').toLocaleDateString(
      'en-US',
      { weekday: 'long', month: 'long', day: 'numeric' }
    );
    const timeStr = ev.event_time
      ? new Date(`1970-01-01T${ev.event_time}`).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
        })
      : null;
    const lines = [ev.title];
    lines.push(`${dateStr}${timeStr ? ` at ${timeStr}` : ''}`);
    if (ev.location) lines.push(ev.location);
    if (ev.notes) lines.push(`\n${ev.notes}`);
    setStaged({
      title: ev.title,
      body: lines.join('\n'),
      sourceBulletinId: null,
      kind: 'event',
    });
  };

  const stageAnnouncement = (group, ann) => {
    setStaged({
      title: `Announcement · ${
        group.bulletin.sunday_designation || group.bulletin.service_date
      }`,
      body: ann.body,
      sourceBulletinId: group.bulletin.id,
      kind: 'announcement',
    });
  };

  const stageOtherBlock = (group, blk) => {
    const lines = [];
    if (blk.heading) lines.push(blk.heading);
    if (blk.body) lines.push(blk.body);
    if (blk.signature) lines.push(`\n— ${blk.signature}`);
    setStaged({
      title: blk.heading || `Bulletin item · ${group.bulletin.service_date}`,
      body: lines.join('\n'),
      sourceBulletinId: group.bulletin.id,
      kind: blk.block_type,
      imageUrl: blk.image_url || null,
    });
  };

  const polishWithClaude = async () => {
    if (!staged) return;
    setPolishing(true);
    setError(null);
    try {
      const polished = await draftFreeForm({ prompt: staged.body });
      setStaged((s) => ({
        ...s,
        title: polished.title || s.title,
        body: polished.body || s.body,
      }));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setPolishing(false);
    }
  };

  const save = async () => {
    if (!user?.id || !staged) return;
    if (!staged.body.trim()) {
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
            title: staged.title.trim() || null,
            body: staged.body.trim(),
            source_type: 'manual',
            source_bulletin_id: staged.sourceBulletinId ?? null,
          })
          .select()
          .single()
      );
      if (err) throw err;

      // If the source had an image (e.g., a flyer block), copy it over.
      if (staged.imageUrl) {
        try {
          const res = await fetch(staged.imageUrl);
          if (res.ok) {
            const blob = await res.blob();
            const ext = (blob.type.split('/')[1] || 'jpg').replace(
              'jpeg',
              'jpg'
            );
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
          // eslint-disable-next-line no-console
          console.warn('Failed to copy source image:', imgErr);
        }
      }

      navigate(`/posts/${created.id}`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (staged) {
    return (
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg text-umc-900">Composer</h2>
          <button
            type="button"
            onClick={() => setStaged(null)}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            ← Pick a different item
          </button>
        </div>
        <div>
          <label className="label">Title (internal)</label>
          <input
            type="text"
            className="input"
            value={staged.title}
            onChange={(e) => setStaged({ ...staged, title: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Post text *</label>
          <textarea
            className="input min-h-[200px] font-mono text-sm"
            value={staged.body}
            onChange={(e) => setStaged({ ...staged, body: e.target.value })}
          />
        </div>
        {staged.imageUrl && (
          <div className="text-xs text-gray-500 flex items-center gap-2">
            <img
              src={staged.imageUrl}
              alt=""
              className="h-12 w-12 object-cover rounded"
            />
            <span>The flyer image will be attached to the post.</span>
          </div>
        )}
        <div className="border border-dashed border-gray-300 rounded p-2 bg-gray-50 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-600">
            Want Claude to polish this into posting voice?
          </p>
          <button
            type="button"
            onClick={polishWithClaude}
            disabled={polishing || !staged.body.trim()}
            className="btn-secondary text-xs disabled:opacity-50"
          >
            {polishing ? 'Polishing…' : '✨ Polish with Claude'}
          </button>
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

  if (loading) return <LoadingSpinner label="Loading events + announcements…" />;

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg text-umc-900">
            From announcement / event
          </h2>
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            ← Pick a different source
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Click any item to start a draft. Bulletins still in draft status
          are included so you can promote upcoming things.
        </p>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {events.length > 0 && (
        <div className="card">
          <h3 className="font-serif text-base text-umc-900">
            Upcoming calendar events
            <span className="ml-2 text-xs font-normal text-gray-500">
              ({events.length})
            </span>
          </h3>
          <ul className="mt-2 divide-y divide-gray-100">
            {events.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => stageEvent(ev)}
                  className="w-full text-left py-2 hover:bg-gray-50 px-2 rounded"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-umc-900">
                      {ev.title}
                    </span>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date(ev.event_date + 'T00:00:00').toLocaleDateString(
                        'en-US',
                        { month: 'short', day: 'numeric' }
                      )}
                      {ev.event_time && ` · ${ev.event_time.slice(0, 5)}`}
                    </span>
                  </div>
                  {ev.location && (
                    <p className="text-xs text-gray-500">{ev.location}</p>
                  )}
                  {ev.notes && (
                    <p className="text-xs text-gray-600 line-clamp-2 mt-1">
                      {ev.notes}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {annoucementsByBulletin.length > 0 && (
        <div className="card">
          <h3 className="font-serif text-base text-umc-900">
            Bulletin announcements + flyers
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 mb-3">
            Includes draft bulletins so you can promote ahead of publishing.
          </p>
          <ul className="space-y-3">
            {annoucementsByBulletin.map((g) => (
              <li
                key={g.bulletin.id}
                className="border border-gray-200 rounded p-3"
              >
                <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                  {g.bulletin.sunday_designation || g.bulletin.service_date}
                  {g.bulletin.status === 'draft' && (
                    <span className="ml-2 text-amber-700 normal-case">
                      (draft)
                    </span>
                  )}
                </p>
                <ul className="space-y-1">
                  {g.announcements.map((a) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => stageAnnouncement(g, a)}
                        className="w-full text-left py-1 px-2 hover:bg-gray-50 rounded text-sm text-gray-700 line-clamp-2"
                      >
                        📣 {a.body}
                      </button>
                    </li>
                  ))}
                  {g.others.map((o) => (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => stageOtherBlock(g, o)}
                        className="w-full text-left py-1 px-2 hover:bg-gray-50 rounded text-sm text-gray-700"
                      >
                        {o.block_type === 'image_flyer' && '🖼️ '}
                        {o.block_type === 'personal_note' && '✉️ '}
                        {o.block_type === 'heading_body' && '📋 '}
                        {o.heading || o.body?.slice(0, 80) || '(untitled)'}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      {events.length === 0 && annoucementsByBulletin.length === 0 && (
        <p className="card text-sm text-gray-500 text-center py-6">
          No upcoming events or recent bulletin announcements found.
        </p>
      )}
    </div>
  );
}
