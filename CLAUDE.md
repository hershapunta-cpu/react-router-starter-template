# ReBoRn Studio: instructions for Claude Code

ReBoRn Marketing Solution Agency (Antigua & Barbuda). One owner, no employees.
Studio produces content, runs an AI sales line (Nikki) and reports on money,
for ReBoRn itself (workspace #0) and for client workspaces.

## Stack (do not add new infrastructure)
- GitHub repo (this one) -> Cloudflare Pages / Workers for hosting
- The EXISTING Supabase project. Never create a second database.
- Payments: PayPal subscriptions (Stripe is not available for Antigua)

## Hard rules
1. Only touch tables prefixed `studio_`. Never alter or drop other tables.
2. Nothing goes public without the owner's approval. Status flow:
   draft -> pending_owner -> (own workspace: ready | client workspace:
   pending_client -> ready) -> published.
   Only the server worker sets `published`, and only from `ready`.
3. All status changes past `pending_owner` go through `studio_decide()`.
   Never update `status` directly from client code.
4. Client-to-client isolation is enforced by Row Level Security. After ANY
   schema or query change, run the isolation test below before finishing.
5. The Supabase service key and PayPal secrets live only in Cloudflare
   environment variables or a local `.env` that is git-ignored. Never commit
   them, never put them in front-end code.
6. Never clone a voice unless `studio_workspaces.voice_consent = true`.
7. Nikki (the AI sales line) must always say it is an AI in its first message.
8. Do not publish, post, email or message any person on your own. Prepare
   it and put it in the approval queue.

## Isolation test (run every time)
Create two test client workspaces A and B with one test user each.
- User A must see zero rows from B in every `studio_` table and the brief view.
- User A must NOT be able to set a status to `ready` or `published`.
- A `client` role user must NOT be able to insert content, leads or sales.
Report pass/fail per table.

## Plans and billing
- Plans: free, client, agency. Tool access = `studio_plan_tools`.
  Check with `studio_has_tool(workspace_id, 'tool_name')`.
- PayPal webhook (Cloudflare Worker, service key):
  - subscription activated -> set `plan`, store `paypal_subscription_id`
  - cancelled/suspended/expired -> set `plan = 'free'`
  - payment completed -> insert into `studio_sales` (`paypal_txn_id` is unique,
    so ignore duplicate webhook deliveries)
  - always verify the webhook signature with PayPal before trusting it

## Morning brief
Each morning read `studio_brief_v` and write a one-page summary:
1. Money: revenue (24h), sales, cost (30d) per workspace
2. Leads: new, calls booked, which became sales
3. Waiting on the owner: items in `pending_owner`
4. Suggested next content, based on what led to sales
Keep it to one page. Plain language. No hype.

## Build order
1. Run `schema.sql`, add the owner as `owner` in workspace #0, pass the isolation test.
2. Approval queue page in the hub (list pending, approve/reject via `studio_decide`).
3. Voice note -> script (Claude drafts, owner approves).
4. PayPal subscription + webhook -> plan switching.
5. Nikki sales line and checkout.
6. Video and dubbing (French and Spanish first), last because it costs the most.

## Working notes
- Owner builds mostly from a phone (Termux). Keep commands short and copyable,
  and give one step at a time.
- Before changing anything, inspect what already exists and avoid duplicates.
