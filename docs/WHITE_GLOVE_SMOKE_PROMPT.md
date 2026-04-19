# White-Glove Smoke Prompt — windy-pro account-server

**Created:** 2026-04-19, after Wave 13 Phase 1 deploy to AWS
**Purpose:** Hand to a fresh Claude session to do industrial-grade smoke testing on the deployed account-server.

---

## Why this prompt exists

Wave 13 just shipped the account-server to AWS. The unit tests pass, the deploy log is green, the HMAC service-mesh probes round-trip cleanly. **None of that proves the user-facing surface works.** The pattern Grant has been burned by repeatedly: "380/380 tests pass" but every third tab is a 404, every third form is a zombie loop, every third error path crashes silently. This prompt forces a fresh Claude session to behave like a beta tester with a screenshot habit, hitting the deployed surface from outside the code.

---

## Paste this to a fresh Claude session

> You are doing **industrial-grade white-glove smoke testing** on the production windy-pro account-server, freshly deployed to AWS as Wave 13 Phase 1. Your job is to find every defect a real user would hit in their first 60 seconds, before they give up. Unit tests do NOT count — only behaviour observed against the live URL counts.
>
> **Read first:**
>
> 1. `~/.claude/projects/-Users-thewindstorm/memory/MEMORY.md` (auto-loaded)
> 2. `/tmp/kit-army-config/ACCESS_LOCKBOX.md` — search for "Wave 13" and "windy-pro" sections; that gives you the real production URL, the EC2 instance ID, the RDS endpoint, the JWKS key ID, and every HMAC secret you need to sign service-mesh requests.
> 3. `windy-pro/account-server/src/server.ts` — the route mount table is the source of truth for what endpoints exist.
> 4. `windy-pro/account-server/src/routes/` — 20 route files, each module is one section of the surface.
>
> **Then do all of the following against the live deployed URL** (do NOT spin up a local instance — we're testing prod):
>
> ### 1. Public surface — hit it as an anonymous user
> - `GET /` — does it serve the landing page? Status, content-type, content-length plausible? Any console errors if you fetch the HTML and parse it?
> - `GET /.well-known/jwks.json` — returns valid JWK Set? Has the `kid` recorded in the lockbox? Cache headers sane?
> - `GET /.well-known/openid-configuration` — discovery doc valid? Endpoints all point to the same host? Any `localhost` leaks?
> - `GET /health` and `GET /api/v1/health` — both respond? Latency under 200 ms?
> - `GET /assets/<known-file>`, `GET /landing/`, `GET /wizard/` — static assets serve? Correct mime types?
> - `GET /admin` — does this require auth? Does anonymous load leak any internal state?
> - `GET /api/v1/<random-nonexistent>` — does the 404 response carry a JSON body or HTML? Is it consistent? Does it leak stack traces?
> - Send `POST /api/v1/auth/register` with **malformed JSON**, **wrong content-type**, **empty body**, **body 10MB long** — each should return a 400 with a clean envelope, never a 500 with a Node stack trace.
>
> ### 2. Auth flows — sign up, log in, log out, recover
> - `POST /api/v1/auth/register` — create a fresh test user (use a `+test` email on a domain you control). Verify response shape matches what `windy-pro-mobile/src/services/identityApi.ts` expects.
> - Verify the email-verification email actually sends (check `webhooks-eternitas` and `mailer` modules — does it queue an outbound? Is there a way to inspect?).
> - `POST /api/v1/auth/login` with the new credentials — get tokens. Verify access token has correct `iss`, `aud`, `kid`, expiry, signature against the JWKS.
> - `POST /api/v1/auth/login` with **wrong password** — does it rate-limit after N attempts? After how many? Does the rate-limit response shape match `fix/p0-device-approve-rate-limit`?
> - `POST /api/v1/auth/refresh` with the refresh token — does it rotate?
> - `POST /api/v1/auth/refresh` with the **same** refresh token twice — second call should fail (refresh-token reuse detection).
> - Password reset: `POST /api/v1/auth/forgot-password` → check the page Pro hosts at `/reset-password?token=...` — does it render? Does submitting reset the password? Does an expired/used token render a clear error?
>
> ### 3. OAuth device-code + consent surface
> - `POST /api/v1/oauth/device/code` — get a device code. Verify the user_code is human-typeable (not all-O-and-0).
> - Open `/device` (or whatever the user-facing URL is — check `device-approval.ts`) in a browser. Does it load? Does typing the wrong code give a clear error?
> - Approve a code while logged in. Does the polling endpoint flip to `access_token` granted?
> - Try to approve a code that's **expired**. Try to approve one that's **already used**. Both should fail cleanly.
>
> ### 4. Service-mesh endpoints — sign with HMAC and round-trip
> - `POST /api/v1/agent/credentials/issue` — sign with `BROKER_HMAC_SECRET` from lockbox, request a token for `scope=llm:chat`, verify response carries `broker_token`, `expires_at`, `provider`, `model`. Repeat without signature → must 401.
> - `POST /api/v1/agent/credentials/verify` — verify the token you just issued comes back `{ok:true, token:{...}}`. Verify a garbage token returns `{ok:false, reason:"not_found"}`. Verify expired tokens flip to `{ok:false}`.
> - `POST /webhooks/eternitas` — sign with `ETERNITAS_HMAC_SECRET`, send a sample event, expect 200 `{received:true}`. Send unsigned → 401. Send with a stale timestamp (>5min old) → 401.
> - For every service-mesh URL configured in `wave13/docker-compose.aws.yml` (cloud, chat, mail, clone, agent), pick one identity event Pro fans out (e.g. user.created), trigger it via the API, and confirm via the receiving service's logs that the webhook actually arrived and was accepted.
>
> ### 5. Stripe billing webhook — sign with the Stripe secret
> - `POST /api/v1/stripe/webhook` — replay one of the test-mode webhook events Stripe sends (use `stripe events resend` if Stripe CLI is available, or curl the JSON with the right `Stripe-Signature` header). Verify Pro processes it and updates the user's tier.
> - Send an event with a tampered signature → must 400 with no DB write.
>
> ### 6. Admin console — auth-gated UI
> - `GET /admin` while logged out → must redirect to login or 401, never serve the console.
> - Log in as the seeded admin (lockbox has the credentials). Click every nav link. **Screenshot every page.** Note any 404, any blank state, any "Internal Server Error", any HTML that looks half-rendered.
> - Find at least one mutating action (create user, revoke session, force-rotate key) — exercise it. Confirm via the API that the mutation actually happened.
>
> ### 7. Mobile + Cloud + Chat client perspective
> - As the test user from step 2, simulate what `windy-pro-mobile`, `windy-cloud`, and `windy-chat` would do at first launch. The endpoints they hit are documented in their respective `src/services/*Api.ts` files. For each: send the actual request shape, verify the response is what the client expects (correct field names, correct types). Field-name drift is a silent killer.
>
> ### 8. CORS, security headers, TLS
> - `OPTIONS /api/v1/auth/login` from a disallowed origin → must NOT carry `Access-Control-Allow-Origin: *`.
> - `OPTIONS` from each allowed origin in `CORS_ALLOWED_ORIGINS` → must echo it back.
> - `curl -I https://<prod-url>/` — verify HSTS, X-Content-Type-Options, X-Frame-Options, CSP all present and sane.
> - SSL Labs grade ≥ A. (Check `https://www.ssllabs.com/ssltest/analyze.html?d=<host>` if reachable, otherwise inspect cipher list with `openssl s_client`.)
>
> ### 9. Production observability
> - Tail the EC2 instance's account-server logs (lockbox has SSH command). Filter for ERROR / WARN — anything that fired during your testing must be explainable. Unexplained errors are bugs.
> - Check `/health` again after all of the above — if response time degraded, something leaked.
>
> ---
>
> **Output format:** Single Markdown report at `windy-pro/docs/SMOKE_REPORT_<YYYY-MM-DD>.md`. Structure: one H2 per section above. Under each, list every bug as `**SEVERITY** — short title — what you saw vs expected — minimal repro (curl command or steps) — proposed fix or "needs investigation"`. Severity scale: P0 = breaks core auth or leaks secrets, P1 = breaks a user flow, P2 = ugly but nonfatal, P3 = polish. Include curl outputs, response headers, screenshots.
>
> **What "done" looks like:** zero P0, zero P1. Every P2 explained. The report is small enough that Grant can read it in 10 minutes and know exactly what to fix.
>
> **Constraints:**
> - Don't spin up a local server. Test the deployed URL.
> - Don't trust the unit test suite — re-verify every claim against prod.
> - Don't skip a section because it "looks fine." If it looks fine without you having tested it, that's a bug in your process.
> - Don't fix anything yet. Discovery first, fixes second. The fixes are a separate PR after Grant reviews the report.
> - Per `windy-pro/CLAUDE.md` branching policy: any code change goes on a feature branch + PR + admin merge if CI is broken (the runner-pickup CI issue is documented).
> - Grant is non-developer. Write the report so a non-developer can scan severity badges and understand the surface.
