import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import {
  draftFreeForm,
  draftFromImage,
  draftFromResponsePrompt,
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
    label: 'From bulletin response prompt',
    icon: '📋',
    blurb: 'Pick a recent bulletin; Claude drafts from its response prompt.',
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
        <ResponsePromptFlow user={user} navigate={navigate} onBack={() => setSource(null)} />
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
// Response-prompt flow: pick a published bulletin with a response prompt
// =====================================================================
function ResponsePromptFlow({ user, navigate, onBack }) {
  const [loading, setLoading] = useState(true);
  const [bulletins, setBulletins] = useState([]);
  const [picked, setPicked] = useState(null);
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
            .from('bulletins')
            .select(
              'id, service_date, sunday_designation, status, response_prompt'
            )
            .not('response_prompt', 'is', null)
            .order('service_date', { ascending: false })
            .limit(30)
        );
        if (err) throw err;
        if (cancelled) return;
        setBulletins(data ?? []);
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
      // Pull adjacent sermon info if we can find one for the bulletin.
      let sermon = null;
      try {
        const { data: liturgyRow } = await withTimeout(
          supabase
            .from('liturgy_items')
            .select(
              'sermon_id, sermon:sermons(title, scripture_reference)'
            )
            .eq('bulletin_id', picked.id)
            .not('sermon_id', 'is', null)
            .limit(1)
            .maybeSingle()
        );
        sermon = liturgyRow?.sermon ?? null;
      } catch {
        /* harmless — just no sermon context */
      }

      const result = await draftFromResponsePrompt({
        responsePrompt: picked.response_prompt,
        bulletinDesignation: picked.sunday_designation,
        serviceDate: picked.service_date,
        sermonTitle: sermon?.title,
        scriptureRef: sermon?.scripture_reference,
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
        sourceType="response_prompt"
        sourceBulletinId={picked.id}
        onBack={() => setDrafted(null)}
        busy={busy}
        setBusy={setBusy}
      />
    );
  }

  if (loading) return <LoadingSpinner label="Loading bulletins…" />;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-umc-900">
          From bulletin response prompt
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
        <p className="text-sm text-gray-500">
          No bulletins found with a response prompt. Add one in the Bulletin
          admin first.
        </p>
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
          {picked && (
            <div className="bg-gray-50 border border-gray-200 rounded p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Response prompt
              </p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {picked.response_prompt}
              </p>
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
