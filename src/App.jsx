import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import PostList from './pages/PostList.jsx';
import PostNew from './pages/PostNew.jsx';
import PostDetail from './pages/PostDetail.jsx';
import Channels from './pages/Channels.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<PostList />} />
        <Route path="/posts/new" element={<PostNew />} />
        <Route path="/posts/:id" element={<PostDetail />} />
        <Route path="/channels" element={<Channels />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4">
        <h1 className="font-serif text-3xl text-umc-900">Page not found</h1>
        <a href="/" className="btn-primary inline-block">
          Back to posts
        </a>
      </div>
    </div>
  );
}
