import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../lib/channels';

export default function Channels() {
  const { user, isStaff } = useAuth();
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ slug: '', name: '', color: '' });
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await listChannels();
      setChannels(c);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const handleAdd = async () => {
    if (!isStaff) {
      setError('Only staff users can manage channels.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createChannel(
        {
          slug: draft.slug,
          name: draft.name,
          color: draft.color,
          sortOrder: (channels[channels.length - 1]?.sort_order ?? 0) + 10,
        },
        user?.id
      );
      setDraft({ slug: '', name: '', color: '' });
      setAdding(false);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (channel) => {
    const newName = window.prompt('Rename channel:', channel.name);
    if (!newName || newName.trim() === channel.name) return;
    setBusy(true);
    setError(null);
    try {
      await updateChannel(channel.id, { name: newName.trim() });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleColor = async (channel) => {
    const newColor = window.prompt(
      'Hex color for the chip (e.g., #1877f2). Empty to clear:',
      channel.color || ''
    );
    if (newColor === null) return; // canceled
    setBusy(true);
    setError(null);
    try {
      await updateChannel(channel.id, {
        color: newColor.trim() || null,
      });
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (channel) => {
    if (
      !window.confirm(
        `Delete channel "${channel.name}"? Existing posts that reference it stay intact, but you won't be able to add it to new posts.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteChannel(channel.id);
      await reload();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingSpinner label="Loading channels…" />;

  return (
    <div className="space-y-4">
      <Link
        to="/"
        className="inline-block text-sm text-gray-500 hover:text-gray-700"
      >
        ← Back to posts
      </Link>

      <div>
        <h1 className="font-serif text-2xl text-umc-900">Channels</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Platforms you post to. Used as the chip selector on each post.
        </p>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {!isStaff && (
        <div className="card border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-900">
            Only staff users can add or edit channels — but anyone can pick
            from the list when composing a post.
          </p>
        </div>
      )}

      <div className="card">
        {!adding ? (
          isStaff && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-primary text-sm"
            >
              + New channel
            </button>
          )
        ) : (
          <div className="space-y-3">
            <h2 className="font-serif text-lg text-umc-900">New channel</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Name</label>
                <input
                  type="text"
                  className="input"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      name: e.target.value,
                      // Auto-fill slug from name if user hasn't typed one.
                      slug:
                        d.slug ||
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/(^-|-$)/g, ''),
                    }))
                  }
                  placeholder="e.g., Threads"
                />
              </div>
              <div>
                <label className="label">Slug</label>
                <input
                  type="text"
                  className="input font-mono text-xs"
                  value={draft.slug}
                  onChange={(e) =>
                    setDraft({ ...draft, slug: e.target.value })
                  }
                  placeholder="threads"
                />
              </div>
              <div>
                <label className="label">Color (optional)</label>
                <input
                  type="text"
                  className="input font-mono text-xs"
                  value={draft.color}
                  onChange={(e) =>
                    setDraft({ ...draft, color: e.target.value })
                  }
                  placeholder="#000000"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAdd}
                disabled={busy || !draft.slug.trim() || !draft.name.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? 'Adding…' : 'Add channel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setDraft({ slug: '', name: '', color: '' });
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {channels.length === 0 ? (
        <p className="card text-center text-sm text-gray-500 py-10">
          No channels defined.
        </p>
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => (
            <li key={c.id} className="card">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="inline-block h-6 w-6 rounded shrink-0 border border-gray-200"
                    style={{
                      backgroundColor: c.color || '#f3f4f6',
                    }}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-umc-900 truncate">
                      {c.name}
                    </p>
                    <p className="text-xs text-gray-500 font-mono">
                      slug: {c.slug}
                      {c.color && (
                        <span className="ml-2">color: {c.color}</span>
                      )}
                    </p>
                  </div>
                </div>
                {isStaff && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRename(c)}
                      disabled={busy}
                      className="text-xs text-umc-700 hover:text-umc-900 underline"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => handleColor(c)}
                      disabled={busy}
                      className="text-xs text-umc-700 hover:text-umc-900 underline"
                    >
                      Color
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(c)}
                      disabled={busy}
                      className="text-xs text-red-600 hover:text-red-800 underline"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
