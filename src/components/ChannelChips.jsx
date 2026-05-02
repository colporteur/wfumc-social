import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listChannels } from '../lib/channels';

// Chip selector backed by social_channels. `value` is an array of
// channel slugs; `onChange` receives the next array.
export default function ChannelChips({ value, onChange }) {
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listChannels()
      .then((c) => setChannels(c))
      .catch(() => setChannels([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (slug) => {
    if (value.includes(slug)) onChange(value.filter((s) => s !== slug));
    else onChange([...value, slug]);
  };

  if (loading) return <p className="text-xs text-gray-500">Loading channels…</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {channels.length === 0 ? (
          <p className="text-xs text-gray-500">
            No channels defined yet.{' '}
            <Link to="/channels" className="underline">
              Add one
            </Link>
            .
          </p>
        ) : (
          channels.map((c) => {
            const on = value.includes(c.slug);
            const style =
              on && c.color
                ? { backgroundColor: c.color, borderColor: c.color, color: '#fff' }
                : undefined;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.slug)}
                className={`px-3 py-1 text-sm rounded border transition-colors ${
                  on
                    ? 'border-transparent text-white'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                }`}
                style={style}
              >
                {c.name}
              </button>
            );
          })
        )}
      </div>
      <p className="text-xs text-gray-400">
        <Link to="/channels" className="underline hover:text-gray-600">
          Manage channels
        </Link>
      </p>
    </div>
  );
}
