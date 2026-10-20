# HyperSense frontend loading fix

## Findings

Live pages and static files returned successfully. Login/signup handler timings were below 1 ms on the warm requests measured. Existing CSS/JS responses carried the application's Server-Timing header and no-cache/must-revalidate headers, so those responses were still being served through Python rather than taking the intended direct static-asset route.

The old workspace fetched ten stylesheets and a graph of 41 JavaScript source modules. A network waterfall or repeated revalidation can delay the complete interface even when a single handler is quick.

Most of the approximately eight-second elapsed time in this testing environment occurred during TLS setup; it is not a reliable measurement of loading speed on your phone. Authenticated database/API latency could not be measured without your session. This patch addresses the observed frontend request and caching problems; real deployed timing still needs a before/after check.

## What changes

- A build step bundles each page's CSS in its original cascade order and bundles its JavaScript imports.
- The workspace uses one ~153 KB minified JavaScript file and one stylesheet.
- Login/signup/verification, account settings, support and admin pages use their own bundles.
- Generated `/assets/<name>.<content-hash>.css/js` files live under `public/assets/` for Vercel's direct CDN delivery.
- Versioned bundles are cached for a year. When contents change, the filename changes, so users receive the new version.
- Module preload starts the main JS download early. A small dark background rule prevents a bright background before styles arrive.
- Generated deployment templates retain social-provider placeholders, account metadata and screen includes. Source templates continue working in local development.
- Private HTML, account data and API responses retain their existing no-store behavior.
- Camera, transcription, OAuth, email settings and database configuration are preserved.

This addresses late styling and frontend loading; it does not redesign the page layout. If the fully loaded layout is still wrong, capture that screen separately.

## Apply

1. Extract the ZIP into your HyperSense repository, preserving directories and replacing its included files. This patch was prepared against public `main` downloaded on 20 October 2026.
2. From the project terminal run:

```bash
npm ci --include=dev
node scripts/build_frontend.cjs
node tests/frontend_bundle_ui.cjs
python -m unittest tests.test_frontend_assets tests.test_social_auth tests.test_account_delivery -v
npm test
```

Use the project's activated Python environment. The tests simulate providers and email; they do not contact real accounts. The generated-asset test skips itself during source-only backend CI if the frontend build has not run.

3. Commit the source changes:

```bash
git add .gitignore vercel.json public/.gitkeep backend/assets.py backend/pages.py backend/accounts/routes.py backend/accounts/settings.py backend/admin/pages.py backend/support/routes.py
git add scripts/build_frontend.cjs scripts/build_vercel.py tests/test_frontend_assets.py tests/frontend_bundle_ui.cjs FRONTEND_PERFORMANCE_SETUP.md
git commit -m "Bundle frontend assets and serve versioned files through CDN"
git push origin main
```

Generated `public/assets/` and `generated/templates/` files are intentionally ignored. The deployment build regenerates them from source.

## Vercel deployment check

Use the production project `hypersense-ai-vo3h` and the new main commit.

1. Confirm its Build Command runs `python scripts/build_vercel.py`. This is set in the included vercel.json. Remove any incompatible build override if the deployment log shows a different command.
2. The log must include:

```text
Bundled frontend assets for 7 templates; 6 JS entrypoints.
Published static assets to public/static for CDN delivery
```

The build installs existing Node dev dependencies for esbuild, then generates the frontend bundles and native assets. A build failure should be corrected rather than deploying incomplete output.

3. Wait for **Ready**, open the production URL in a fresh private tab, and inspect page source. The main stylesheet and script should now begin `/assets/` and contain a content hash. If they still reference the old individual `/static/css/` links, the generated templates are not being used: check the deployed commit and build output first.
4. In desktop DevTools → Network, leave **Disable cache unchecked** for normal-use testing. Reload twice. Versioned assets should be served directly and then use browser cache; their requests should not appear as FastAPI function invocations in Vercel logs. Confirm the assets return 200 with the correct content type, not an HTML error page.
5. Test login, both social sign-ins, verification, dashboard, device checks and a short interview on desktop and mobile.

If private pages are still slow after assets are cached, inspect the slow **document or API request**, its Waiting/TTFB timing and Server-Timing response header. Share the route, timings and status with credentials/cookies/tokens omitted. That is the evidence needed to distinguish database or provider waits from network delay.

## Validation performed

- Full existing npm UI suite passed.
- Actual minified workspace and authentication bundles booted successfully in jsdom with working navigation.
- Fourteen targeted Python tests passed, covering generated templates/assets plus OAuth and email regression checks.
- Generated HTML keeps account/social placeholders; every referenced generated CSS/JS file exists.
- No live deployment, real provider sign-in or authenticated database timing was performed from this workspace.

## Reference

Vercel's FastAPI documentation describes serving the public directory from the CDN:
https://vercel.com/docs/frameworks/backend/fastapi#the-public-directory
