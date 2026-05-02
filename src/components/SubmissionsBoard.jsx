import { useMemo, useState } from 'react';

// Shared list of worshipper submissions with checkbox multi-select.
// Used by both the dashboard (latest bulletin) and the submissions
// browser flow (pick a bulletin first).
//
// Props:
//   submissions     — array of response rows
//   onCreateOne(s)  — callback when user clicks "Create post" on a row
//   onMerge(subs)   — callback when user clicks "Merge selected"
//   busy            — disables actions while a save is in flight
//   compactHeader   — true to skip the "N submissions" header when
//                     embedded inline in another card
export default function SubmissionsBoard({
  submissions,
  onCreateOne,
  onMerge,
  busy = false,
  compactHeader = false,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const selectedSubs = useMemo(
    () => submissions.filter((s) => selectedIds.has(s.id)),
    [submissions, selectedIds]
  );

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clear = () => setSelectedIds(new Set());

  if (submissions.length === 0) {
    return (
      <p className="text-sm text-gray-500 text-center py-6">
        No submissions yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {!compactHeader && (
        <p className="text-xs text-gray-500">
          {submissions.length} submission
          {submissions.length === 1 ? '' : 's'}
          {selectedIds.size > 0 && (
            <>
              {' · '}
              <span className="text-umc-700 font-medium">
                {selectedIds.size} selected
              </span>
            </>
          )}
        </p>
      )}

      <ul className="space-y-2">
        {submissions.map((s) => {
          const checked = selectedIds.has(s.id);
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
            <li
              key={s.id}
              className={`border rounded p-3 ${
                checked
                  ? 'border-umc-700 bg-umc-50/30'
                  : s.used_in_social_media
                    ? 'border-gray-200 bg-gray-50/50'
                    : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(s.id)}
                  disabled={busy}
                  className="h-4 w-4 mt-1 rounded border-gray-300 text-umc-700 shrink-0"
                />
                <div className="min-w-0 flex-1">
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
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onCreateOne(s)}
                      disabled={busy}
                      className="text-xs text-umc-700 hover:text-umc-900 underline disabled:opacity-50"
                    >
                      Create post from this
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Multi-select action bar — appears when 2+ selected. */}
      {selectedIds.size >= 2 && (
        <div className="sticky bottom-2 mt-2 card border-umc-700 shadow-lg bg-white flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-umc-900 font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onMerge(selectedSubs)}
              disabled={busy}
              className="btn-primary text-sm disabled:opacity-50"
            >
              {busy ? 'Saving…' : `Merge into one post`}
            </button>
            <button
              type="button"
              onClick={clear}
              disabled={busy}
              className="btn-secondary text-sm"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
