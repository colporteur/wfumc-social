import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';

// Any authenticated user can access. Posts are owner-scoped via RLS,
// and staff users can also see/edit each other's drafts (so the social
// media team can collaborate).
export default function ProtectedRoute({ children }) {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner label="Checking access…" />;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
