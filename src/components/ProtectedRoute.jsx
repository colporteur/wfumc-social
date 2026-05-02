import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';
import { canUseSocialApp, ROLE_LABELS } from '../lib/permissions';

// Authenticated users with the right role can access. Other staff
// roles (music director, treasurer) are blocked with a friendly
// "no access" message — they have their own places in the bulletin
// admin and don't need to see the social media workspace.
export default function ProtectedRoute({ children }) {
  const { loading, session, profile, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner label="Checking access…" />;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Profile may still be loading on first render even after session
  // resolves — show the spinner instead of bouncing them out.
  if (!profile) {
    return <LoadingSpinner label="Loading your profile…" />;
  }

  if (!canUseSocialApp(profile.role)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-50">
        <div className="card max-w-md w-full text-center space-y-3">
          <h1 className="font-serif text-2xl text-umc-900">
            No access to WFUMC Social
          </h1>
          <p className="text-sm text-gray-600">
            You're signed in as{' '}
            <strong>{profile.full_name}</strong>{' '}
            (<span className="text-gray-500">{ROLE_LABELS[profile.role] || profile.role}</span>).
            This app is limited to the social media team and church staff.
          </p>
          <p className="text-xs text-gray-500">
            If you should have access, ask Pastor Todd to update your role.
          </p>
          <button
            type="button"
            onClick={async () => {
              await signOut();
            }}
            className="btn-secondary text-sm"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return children;
}
