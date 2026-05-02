import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, withTimeout } from '../lib/supabase';
import { publicPostImageUrl } from '../lib/postImages';
import {
  createPostFromSubmission,
  createPostFromMergedSubmissions,
} from '../lib/submissions';
import SubmissionsBoard from '../components/SubmissionsBoard.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'ready', label: 'Ready' },
  { value: 'posted', label: 'Posted' },
  { value: 'archived', label: 'Archived' },
];

const SORT_OPTIONS = [
  { value: 'updated_desc', label: 'Most recently updated' },
  { value: 'scheduled_asc', label: 'Soonest scheduled' },
  { value: 'created_desc', label: 'Newest first' },
];

const STATUS_BADGE = {
  draft:    { label: 'Draft',    cls: 'bg-gray-200 text-gray-700' },
  ready:    { label: 'Ready',    cls: 'bg-blue-100 text-blue-800' },
  posted:   { label: 'Posted',   cls: 'bg-green-100 text-green-800' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
};

function filtersFromSearch(params) {
  return {
    search: params.get('q') ?? '',
    status: params.get('status') ?? 'all',
    sort: params.get('sort') ?? 'updated_desc',
  };
}

function searchFromFilters(f) {
  const out = {};
  if (f.search?.trim()) out.q = f.search;
  if (f.status && f.status !== 'all') out.status = f.status;
  if (f.sort && f.sort !== 'updated_desc') out.sort = f.sort;
  return out;
}

function fmtDate(yyyymmdd) {
  if (!yyyymmdd) return '';
  return new Date(yyyymmdd + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function PostList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [posts, setPosts] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => filtersFromSearch(searchParams),
    [searchParams]
  );

  const updateFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setSearchParams(searchFromFilters(next), { replace: true });
  };

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // No owner filter — RLS gives owner OR staff. Lets the team see
        // each other's drafts.
        const { data, error: err } = await withTimeout(
          supabase
            .from('social_posts')
            .select(
              'id, owner_user_id, status, title, body, image_path, source_type, source_bulletin_id, source_sermon_id, scheduled_for, posted_at, platforms, updated_at, created_at'
            )
            .order('updated_at', { ascending: false })
        );
        if (err) throw err;
        if (cancelled) return;
        setPosts(data ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    let out = posts.filter((p) => {
      if (filters.status !== 'all' && p.status !== filters.status) return false;
      if (q) {
        const hay = [p.title, p.body, ...(p.platforms ?? [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out = out.slice().sort((a, b) => {
      switch (filters.sort) {
        case 'scheduled_asc':
          return (a.scheduled_for ?? '9999').localeCompare(
            b.scheduled_for ?? '9999'
          );
        case 'created_desc':
          return (b.created_at ?? '').localeCompare(a.created_at ?? '');
        case 'updated_desc':
        default:
          return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
      }
    });
    return out;
  }, [posts, filters]);

  if (loading) return <LoadingSpinner label="Loading posts…" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif text-2xl text-umc-900">Social posts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Compose, track, and copy out to your platforms.
          </p>
        </div>
        <Link to="/posts/new" className="btn-primary text-sm whitespace-nowrap">
          + New post
        </Link>
      </div>

      {error && (
        <div className="card border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <LatestBulletinSubmissions
        userId={user?.id}
        navigate={navigate}
      />

      <div className="card space-y-3">
        <div>
          <label className="label">Search</label>
          <input
            type="text"
            className="input"
            placeholder="Search title, body, platforms…"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Sort</label>
            <select
              className="input"
              value={filters.sort}
              onChange={(e) => updateFilter('sort', e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            Showing {filtered.length} of {posts.length}
          </span>
          {(filters.search || filters.status !== 'all') && (
            <button
              type="button"
              onClick={() => setSearchParams({}, { replace: true })}
              className="underline hover:text-gray-700"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="card text-center space-y-3 py-10">
          <p className="text-gray-500">
            No posts yet. Start with a fresh draft or pull from a recent
            bulletin / sermon.
          </p>
          <Link to="/posts/new" className="btn-primary inline-block">
            + New post
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-10 text-sm text-gray-500">
          No posts match those filters.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((p) => {
            const badge = STATUS_BADGE[p.status] ?? STATUS_BADGE.draft;
            const thumb = p.image_path ? publicPostImageUrl(p.image_path) : null;
            const isMine = p.owner_user_id === user?.id;
            return (
              <li key={p.id}>
                <Link
                  to={`/posts/${p.id}`}
                  className="card block hover:border-umc-700 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {thumb && (
                      <img
                        src={thumb}
                        alt=""
                        loading="lazy"
                        className="h-20 w-20 object-cover rounded shrink-0 bg-gray-100"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span
                          className={`px-2 py-0.5 text-[10px] uppercase tracking-wide rounded ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                        {p.title && (
                          <h2 className="font-serif text-lg text-umc-900 truncate">
                            {p.title}
                          </h2>
                        )}
                        {!isMine && (
                          <span className="text-[10px] uppercase tracking-wide text-umc-700">
                            from teammate
                          </span>
                        )}
                      </div>
                      {p.body && (
                        <p className="mt-2 text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                          {p.body}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        {p.scheduled_for && (
                          <span>
                            <span className="text-gray-400">Scheduled:</span>{' '}
                            {fmtDate(p.scheduled_for)}
                          </span>
                        )}
                        {p.posted_at && (
                          <span>
                            <span className="text-gray-400">Posted:</span>{' '}
                            {new Date(p.posted_at).toLocaleDateString()}
                          </span>
                        )}
                        {(p.platforms ?? []).length > 0 && (
                          <span>
                            <span className="text-gray-400">Platforms:</span>{' '}
                            {p.platforms.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Dashboard panel: latest published bulletin's worshipper submissions.
// Surfaces incoming submissions immediately so the social media team
// doesn't have to remember to go look. Reuses SubmissionsBoard for
// the create-one and merge-many actions.
function LatestBulletinSubmissions({ userId, navigate }) {
  const [loading, setLoading] = useState(true);
  const [bulletin, setBulletin] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Most recent published bulletin.
        const { data: bln, error: blnErr } = await withTimeout(
          supabase
            .from('bulletins')
            .select('id, service_date, sunday_designation, status')
            .eq('status', 'published')
            .order('service_date', { ascending: false })
            .limit(1)
            .maybeSingle()
        );
        if (blnErr) throw blnErr;
        if (cancelled) return;
        if (!bln) {
          setBulletin(null);
          setSubmissions([]);
          return;
        }
        setBulletin(bln);
        const { data: subs, error: subErr } = await withTimeout(
          supabase
            .from('responses')
            .select(
              'id, is_anonymous, submitter_name, response_text, caption, image_url, highlighted_text, source_label, used_in_social_media, submitted_at'
            )
            .eq('bulletin_id', bln.id)
            .order('submitted_at', { ascending: false })
        );
        if (subErr) throw subErr;
        if (!cancelled) setSubmissions(subs ?? []);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleCreateOne = async (sub) => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPostFromSubmission({
        userId,
        bulletin,
        submission: sub,
      });
      navigate(`/posts/${created.id}`);
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  const handleMerge = async (subs) => {
    if (!userId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createPostFromMergedSubmissions({
        userId,
        bulletin,
        submissions: subs,
      });
      navigate(`/posts/${created.id}`);
    } catch (e) {
      setError(e.message || String(e));
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="card text-sm text-gray-500">
        Loading latest bulletin submissions…
      </div>
    );
  }
  if (!bulletin) {
    return null;
  }

  const unusedCount = submissions.filter((s) => !s.used_in_social_media)
    .length;

  return (
    <div className="card border-umc-200 bg-umc-50/30">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-serif text-lg text-umc-900">
            Latest bulletin: {bulletin.sunday_designation || bulletin.service_date}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {submissions.length} submission
            {submissions.length === 1 ? '' : 's'}
            {unusedCount > 0 && (
              <>
                {' · '}
                <span className="text-umc-700 font-medium">
                  {unusedCount} unused
                </span>
              </>
            )}
          </p>
        </div>
        <p className="text-xs text-gray-500">
          {bulletin.service_date}
        </p>
      </div>
      {error && (
        <p className="text-sm text-red-600 mt-2">{error}</p>
      )}
      <div className="mt-3">
        <SubmissionsBoard
          submissions={submissions}
          onCreateOne={handleCreateOne}
          onMerge={handleMerge}
          busy={busy}
          compactHeader
        />
      </div>
    </div>
  );
}
