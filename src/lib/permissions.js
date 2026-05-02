// Role gating for the WFUMC Social Media app.
//
// Only specific roles get to use this app. Other authenticated users
// (e.g., a music director or treasurer who only needs the bulletin
// admin) get a "no access" message instead of the post list.

export const ROLE_LABELS = {
  pastor: 'Pastor',
  office_admin: 'Office Admin',
  music_director: 'Music Director',
  treasurer: 'Treasurer',
  social_media: 'Social Media Team',
  worship_team: 'Worship Team',
  pianist: 'Pianist',
  staff: 'Staff',
};

const SOCIAL_ALLOWED = new Set(['pastor', 'office_admin', 'social_media']);

export function canUseSocialApp(role) {
  if (!role) return false;
  return SOCIAL_ALLOWED.has(role);
}
