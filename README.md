# WFUMC Social

Social media composer for Wedowee First UMC. Sister app to the Bulletin
and Sermons apps; shares the same Supabase backend.

Compose posts, track them through draft → ready → posted → archived,
and copy out to whatever platform you actually post on (Facebook,
Instagram, X, etc). No platform API integrations — this is a draft +
copy-to-clipboard workflow.

## What's in here

- **`/` (PostList)** — every post in the workspace, with status / search
  filters. URL-synced so navigating away and coming back keeps your
  filters.
- **`/posts/new`** — pick one of four sources:
  - **Blank / typed prompt** — empty composer, optionally Claude-polished
  - **From bulletin response prompt** — pick a published bulletin, Claude
    drafts from its response prompt
  - **From sermon** — pick a sermon, Claude drafts an invitation /
    excerpt / reflection
  - **From image** — upload up to 4 images, Claude vision drafts post
    copy describing the scene
- **`/posts/:id`** — view + edit a single post; copy text to clipboard;
  quick status transitions; full edit form for body / status /
  platforms / scheduled date / posted date / image / notes.

## Setup (one time)

1. **GitHub repo**: create `wfumc-social` under your account.
2. **Secrets**: Settings → Secrets → Actions → add the same two values
   as the Bulletin / Sermons apps:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. **Pages**: Settings → Pages → Source = "GitHub Actions".
4. **Push** to `main` and the GitHub Actions workflow deploys to
   `https://<your-username>.github.io/wfumc-social/`.

## Local dev

```bash
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (same values as
# the other apps).
npm install
npm run dev
```

## Backend

The `social_posts` table and `social-images` storage bucket are created
by migration `0024_social_posts.sql` in the Bulletin app's
`supabase/migrations/`. Run it once in Supabase.

The Claude proxy edge function (`claude-proxy`) is also shared with the
other apps — already deployed.
