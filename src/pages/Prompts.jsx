import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

// Response Prompts management for the Social Media team.
//
// The team writes the prompts that go into the bulletin's "Response"
// section so that worshippers' answers feed straight back into their
// post pipeline. This page lets them author + edit those prompts
// without needing access to the rest of the bulletin admin.
//
// Layout: a list of recent + upcoming bulletins (drafts + published).
// Each bulletin is a card; per card you can add prompts, edit them
// inline, reorder, or remove. Saves on blur.
export default function Prompts() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bulletins, setBulletins] = useState([]);
  // Map of bulletin_id → array of prompts. Loaded with the bulletins
  // and refetched per-bulletin on changes.
  const [promptsByBulletin, setPromptsByBulletin] = useState({});

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      // Show the next 6 weeks of upcoming + the most recent 6 weeks of
      // past bulletins. Drafts included so the team can prep ahead.
      const today = new Date().toISOString().slice(0, 10);
      const sixWeeksAgo = new Date();
      sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42);
      const cutoff = sixWeeksAgo.toISOString().slice(0, 10);

      const [blnRes, prRes] = await Promise.all([
        withTimeout(
          supabase
            .from('bulletins')
            .select('id, service_date, sunday_designation, status')
            .gte('service_date', cutoff)
            .in('status', ['draft', 'published'])
            .order('service_date', { ascending: false })
        ),
        withTimeout(
          supabase
            .from('response_prompts')
            .select('id, bulletin_id, text, sort_order, created_at')
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
        ),
      ]);
      if (blnRes.error) throw blnRes.error;
      if (prRes.error) throw prRes.error;
      setBulletins(blnRes.data ?? []);
      const grouped = {};
      for (const p of prRes.data ?? []) {
        if (!grouped[p.bulletin_id]) grouped[p.bulletin_id] = [];
        grouped[p.bulletin_id].push(p);
      }
      setPromptsByBulletin(grouped);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user?.id) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Sort bulletins: upcoming first (earliest upcoming at top), then past
  // (most recent first). Pinned because "the next bulletin" is the most
  // common thing to want to edit.
  const ordered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = bulletins
      .filter((b) => b.service_date >= today)
      .sort((a, b) => a.service_date.localeCompare(b.service_date));
    const past = bulletins
      .filter((b) => b.service_date < today)
      .sort((a, b) => b.service_date.localeCompare(a.service_date));
    return [...upcoming, ...past];
  }, [bulletins]);

  if (loading) return <LoadingSpinner label="Loading bulletins…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-umc-900">
            Response prompts
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Questions worshippers respond to in each week's bulletin. Their
            answers come back to you on the dashboard.
          </p>
        </div>
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 underline">
          ← Back to posts
        </Link>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {ordered.length === 0 ? (
        <p className="card text-sm text-gray-500 text-center py-10">
          No recent or upcoming bulletins to attach prompts to.
        </p>
      ) : (
        <ul className="space-y-3">
          {ordered.map((b) => (
            <BulletinPromptsCard
              key={b.id}
              bulletin={b}
              prompts={promptsByBulletin[b.id] ?? []}
              onChanged={reload}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtServiceDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function BulletinPromptsCard({ bulletin, prompts, onChanged, onError }) {
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const isUpcoming = bulletin.service_date >= today;

  const addPrompt = async () => {
    if (!newText.trim()) return;
    setBusy(true);
    onError?.(null);
    try {
      const nextSort =
        prompts.length === 0
          ? 0
          : (prompts[prompts.length - 1].sort_order ?? 0) + 10;
      const { error: err } = await withTimeout(
        supabase
          .from('response_prompts')
          .insert({
            bulletin_id: bulletin.id,
            text: newText.trim(),
            sort_order: nextSort,
          })
      );
      if (err) throw err;
      setNewText('');
      setAdding(false);
      await onChanged();
    } catch (e) {
      onError?.(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const removePrompt = async (id) => {
    if (
      !window.confirm(
        'Remove this prompt? Responses already submitted to it stay, but lose their prompt link.'
      )
    ) {
      return;
    }
    setBusy(true);
    onError?.(null);
    try {
      const { error: err } = await withTimeout(
        supabase.from('response_prompts').delete().eq('id', id)
      );
      if (err) throw err;
      await onChanged();
    } catch (e) {
      onError?.(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const movePrompt = async (id, direction) => {
    const idx = prompts.findIndex((p) => p.id === id);
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || targetIdx < 0 || targetIdx >= prompts.length) return;
    const a = prompts[idx];
    const b = prompts[targetIdx];
    setBusy(true);
    onError?.(null);
    try {
      await Promise.all([
        withTimeout(
          supabase
            .from('response_prompts')
            .update({ sort_order: b.sort_order })
            .eq('id', a.id)
        ),
        withTimeout(
          supabase
            .from('response_prompts')
            .update({ sort_order: a.sort_order })
            .eq('id', b.id)
        ),
      ]);
      await onChanged();
    } catch (e) {
      onError?.(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const updatePromptText = async (id, text) => {
    onError?.(null);
    try {
      const { error: err } = await withTimeout(
        supabase
          .from('response_prompts')
          .update({ text })
          .eq('id', id)
      );
      if (err) throw err;
      await onChanged();
    } catch (e) {
      onError?.(e.message || String(e));
    }
  };

  return (
    <li className={`card ${isUpcoming ? 'border-umc-200' : ''}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-serif text-lg text-umc-900">
            {bulletin.sunday_designation || fmtServiceDate(bulletin.service_date)}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {fmtServiceDate(bulletin.service_date)} ·{' '}
            <span
              className={
                bulletin.status === 'published'
                  ? 'text-green-700'
                  : 'text-amber-700'
              }
            >
              {bulletin.status}
            </span>
            {isUpcoming && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-umc-700">
                upcoming
              </span>
            )}
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn-secondary text-sm"
          >
            + Add prompt
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-3 space-y-2 border border-dashed border-umc-300 rounded p-3 bg-umc-50/30">
          <textarea
            autoFocus
            className="input min-h-[70px]"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="What do you want worshippers to respond to this week?"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addPrompt}
              disabled={busy || !newText.trim()}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {busy ? 'Adding…' : 'Add prompt'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setNewText('');
              }}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {prompts.length === 0 && !adding ? (
        <p className="mt-3 text-sm text-gray-400 italic">
          No prompts yet for this bulletin.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {prompts.map((p, idx) => (
            <li key={p.id} className="border border-gray-200 rounded p-3">
              <PromptEditor
                prompt={p}
                onSave={(text) => updatePromptText(p.id, text)}
              />
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => movePrompt(p.id, 'up')}
                    disabled={busy || idx === 0}
                    className="px-1 py-0.5 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => movePrompt(p.id, 'down')}
                    disabled={busy || idx === prompts.length - 1}
                    className="px-1 py-0.5 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removePrompt(p.id)}
                  disabled={busy}
                  className="text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// Inline prompt editor — saves on blur (matches the bulletin admin's
// version so the editing experience feels the same wherever a team
// member edits a prompt).
function PromptEditor({ prompt, onSave }) {
  const [text, setText] = useState(prompt.text);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(prompt.text);
  }, [prompt.text]);

  const save = async () => {
    if (text.trim() === prompt.text) return;
    if (!text.trim()) {
      // Don't blank-save — restore the original instead.
      setText(prompt.text);
      return;
    }
    setSaving(true);
    await onSave(text.trim());
    setSaving(false);
  };

  return (
    <>
      <textarea
        className="input min-h-[60px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      {saving && <p className="text-xs text-gray-400 mt-1">Saving…</p>}
    </>
  );
}
