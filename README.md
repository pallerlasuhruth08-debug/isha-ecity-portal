# ECT Center — Volunteer Care Portal

Mobile-first React + Vite coordinator portal for volunteer & meditator nurturing at
Isha Electronic City, wired to the live Supabase backend (`oreljszgkligutxdwgxw`).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle -> dist/
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app and
publishes `dist/` to GitHub Pages. `vite.config.js` uses `base: './'`, so it works at
any Pages subpath.

## Notes

- The Supabase **publishable/anon key** in `src/lib/supabase.js` is public by design —
  Row Level Security is the security boundary. New sign-ups start pending admin approval.
- Google sign-in requires the deployed URL to be added to Supabase → Auth → URL
  Configuration (redirect allow-list). Email/password works without that.
- Edge-function source (`supabase/`) is intentionally **not** committed (it holds the
  sync shared secret); those functions are deployed directly to Supabase.
