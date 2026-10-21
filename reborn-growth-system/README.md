# ReBoRn Growth System — beta implementation

React + Vite dashboard for the existing Supabase project. Modules: market intelligence, offer packages, acquisition opportunities, retention actions and metrics scorecard.

## Configure
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in local environment or Cloudflare Pages variables. Use only the publishable/anon key in the browser, never service_role.

## Run
`npm install`
`npm run dev`
`npm run build`

The authenticated user must already belong to an organization via `organization_members`. RLS is the security boundary. Validate with two separate organization members before external client beta. The UI does not claim to scrape competitors, publish ads, or fetch live ad-platform metrics automatically.
