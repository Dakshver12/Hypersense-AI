# HyperSense: email verification, Google and GitHub sign-in

## Install this update

This patch is based on the public `main` source downloaded on 18 October 2026. It includes the instant auth-navigation change already present on main.

1. Extract the ZIP in the HyperSense project folder, preserving paths and replacing the included files.
2. Run:

```bash
python -m unittest tests.test_social_auth tests.test_account_delivery tests.test_readiness tests.test_postgres_adapter -v
npm test
```

Use your existing project Python environment. These tests mock email and provider responses; they never send a real email. No new Python dependencies are required: the app already uses `httpx`.

3. Commit the files listed at the end of this guide and push main.
4. Add provider environment variables in Vercel, then redeploy. Environment changes apply to new deployments.

## Email verification on phones and desktop

- `/verify-account` is a dedicated resend screen, also reached by **Resend verification** on login.
- Successful password signup opens this screen and retains the email address.
- A login attempt with a correct password but unverified email opens it too.
- Verification emails include both plain text and a large HTML button.
- `/verify-email` accepts the existing fragment token; the frontend also accepts a query-string token and immediately removes it from the address bar. New emails continue using fragments.
- If a mail app cannot open the link, copy its complete URL into the verification screen's **Verify using a copied email link** form.
- A missing or expired link offers a fresh verification request. A GET request never consumes a verification token; confirmation still requires POST.
- Failed delivery does not verify the user, and the issued token is removed. Mail outages are not bypassed.

The mobile flow fixes have been tested locally. Actual inbox delivery needs a live test with your own mail-provider configuration.

## Choose email delivery

Existing SMTP settings continue working without changes. If SMTP currently returns “Email delivery is unavailable”, you can switch to Brevo's HTTPS transactional-email API:

```dotenv
MAIL_MODE=brevo
BREVO_API_KEY=YOUR_BREVO_API_KEY
SMTP_FROM=HyperSense AI <YOUR_VERIFIED_SENDER_EMAIL>
```

Use a Brevo **API key**, not its SMTP password/key. Keep `SMTP_FROM` set to a sender verified in your Brevo account. `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and SMTP port/security are not used in `brevo` mode. They may stay configured if you want to switch back to `MAIL_MODE=smtp` later.

In Vercel, set these under Project → Settings → Environment Variables for **Production**, then redeploy. Keep this origin:

```dotenv
APP_ORIGIN=https://hypersense-ai-vo3h.vercel.app
```

After deployment, use a fresh email address for one signup, check Inbox/Spam, open the verification email on a phone, confirm, and sign in. If delivery still fails, check Brevo's transactional logs for sender verification, API-key access, account restrictions, bounces or quota. API acceptance does not guarantee inbox delivery.

## Google sign-in

1. Open https://console.cloud.google.com/ and select/create the project for HyperSense.
2. Configure the Google Auth Platform branding and audience. For an external app in testing, add the Google accounts you will test with. Make the app available to your intended users before a public rollout; follow any publication or verification requirements shown in that console.
3. Create an OAuth client of type **Web application**.
4. Add this **Authorized redirect URI**, exactly:

```text
https://hypersense-ai-vo3h.vercel.app/auth/oauth/google/callback
```

5. Copy the OAuth client ID and client secret into Vercel Production environment variables:

```dotenv
GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
```

This is a web-server redirect flow. It does not use the Gemini API key. Only basic profile and verified email access is requested.

## GitHub sign-in

1. Open https://github.com/settings/developers and create an **OAuth App**.
2. Use:

```text
Application name: HyperSense AI
Homepage URL: https://hypersense-ai-vo3h.vercel.app
Authorization callback URL: https://hypersense-ai-vo3h.vercel.app/auth/oauth/github/callback
```

3. Generate a client secret and set:

```dotenv
GITHUB_CLIENT_ID=YOUR_GITHUB_OAUTH_CLIENT_ID
GITHUB_CLIENT_SECRET=YOUR_GITHUB_OAUTH_CLIENT_SECRET
```

GitHub must have a verified email address. Private verified addresses are supported through the `user:email` scope. No repository access is requested.

## What appears in the website

The Google/GitHub buttons are rendered on login and signup only when **both** environment variables for that provider are present. The same controls and full-page redirect flow work on mobile and desktop; there are no popup windows. You may configure just Google first.

OAuth creates a new verified HyperSense account when the provider identity and email are new. Provider access tokens are used for the identity lookup and are not stored as HyperSense sessions.

**Existing email/password users:** sign in normally → Account settings → Connected accounts → choose Google or GitHub. This explicitly connects that provider to the signed-in account, preserving saved sessions. A provider email matching an existing account is never silently merged. A provider identity already connected to another account cannot be reassigned through this page.

**Users who signed up with a provider:** no local password is assigned to the user to remember. Use the password-reset email flow to set a password before using password-protected settings such as account deletion.

Sign-out, revoked sessions and account suspension apply to provider logins too. Changing your Google or GitHub password is managed by that provider.

## Database and deployment

Two private tables are added automatically by the existing schema initializer: `oauth_identities` and `oauth_flows`. Existing user and interview rows are preserved. PostgreSQL startup uses the application's existing schema permissions; the new tables are included in its private-table handling and migration inventory.

The OAuth flow uses a short-lived browser cookie, PKCE and an atomically consumed database state. A callback must return to the same browser and origin that started it. Start a fresh sign-in if a mail app or embedded browser changes browsers during a provider flow. Use a normal browser tab if a provider rejects an embedded browser.

Do not mix deployment hosts. Register callbacks for the exact `APP_ORIGIN`; production credentials should not be copied into arbitrary preview deployments. For localhost, use separate provider app credentials and matching local callbacks.

## Validate live

1. Password signup → email received → phone verification → password login.
2. A fresh Google account → choose account → consent → interview setup → sign out.
3. Repeat Google sign-in and confirm that the same saved account is used.
4. Repeat with GitHub, including an account with a private verified email.
5. Cancel provider consent and confirm a usable login page returns.
6. Connect Google/GitHub from an existing signed-in account, sign out, and verify its saved sessions still appear after provider sign-in.
7. Test both a phone and desktop. Check the deployed commit before testing.

Live provider consent and actual email delivery cannot be certified by mocked tests or by this ZIP alone.

## Git commands

```bash
git add backend/accounts/oauth.py backend/accounts/mail.py backend/accounts/routes.py backend/accounts/schema.py backend/accounts/postgres.py backend/application.py backend/maintenance/readiness.py
git add static/auth/form.js static/css/auth.css templates/auth.html templates/account-settings.html
git add tests/test_social_auth.py tests/test_account_delivery.py tests/test_readiness.py tests/verification_social_ui.cjs tests/ui.cjs SOCIAL_SIGNIN_AND_VERIFICATION_SETUP.md
git commit -m "Add Google and GitHub sign-in and improve email verification"
git push origin main
```

## Official references

- Google web-server OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
- Google identity and userinfo: https://developers.google.com/identity/openid-connect/openid-connect
- GitHub OAuth web flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- GitHub verified email API: https://docs.github.com/en/rest/users/emails
- Brevo transactional email API: https://developers.brevo.com/reference/send-transac-email
