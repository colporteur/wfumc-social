import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase, withTimeout } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  // Tracks the user.id that's currently "loaded" (profile fetched).
  // Distinguishes a real user change from a tab-resume re-validation.
  const loadedUserId = useRef(null);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('staff_profiles')
          .select('user_id, full_name, role')
          .eq('user_id', userId)
          .maybeSingle()
      );
      if (error) {
        // On a transient query error, KEEP the existing profile.
        console.error('Error loading staff profile:', error);
        return;
      }
      setProfile(data);
    } catch (e) {
      // Same here: on timeout, keep the last-known-good profile.
      console.error('Timeout loading staff profile:', e);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      loadedUserId.current = s?.user?.id ?? null;
      await loadProfile(s?.user?.id);
      if (mounted) setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!mounted) return;
      if (event === 'INITIAL_SESSION') return;

      const newUserId = s?.user?.id ?? null;
      const sameUser = newUserId && newUserId === loadedUserId.current;

      // SIGNED_IN fires every time the tab regains focus and the auth
      // client re-validates the existing session from storage. Treating
      // those re-validations as a real transition (loading=true →
      // re-fetch profile) makes ProtectedRoute unmount the page on
      // every tab return. So we check whether the user actually changed.
      if (event === 'SIGNED_IN' && sameUser) {
        setSession(s);
        return;
      }

      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED'
      ) {
        setLoading(true);
        setSession(s);
        loadedUserId.current = newUserId;
        await loadProfile(newUserId);
        if (mounted) setLoading(false);
      } else {
        // TOKEN_REFRESHED, PASSWORD_RECOVERY — quiet update.
        setSession(s);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    isStaff: !!profile,
    isPastor: profile?.role === 'pastor',
    loading,
    signIn,
    signOut,
    refreshProfile: () => loadProfile(session?.user?.id),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
