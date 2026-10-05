# Mobile workspace update

Extract this ZIP into the project root and replace the matching files. It contains
only the mobile update and can be applied after the Vercel update.

Changes:
- The mobile header keeps the logo and brand on one line.
- Account settings, admin, support and sign out are behind an Account button.
- Setup and Dashboard use two equal navigation buttons.
- Session steps use three equal columns, instead of wrapping two-plus-one.
- Form inputs use 16px text on phones and larger touch areas.
- Existing account links and their safety handlers remain unchanged.
- Desktop account controls retain their current presentation.

The menu closes on Escape or an outside click. Escape returns focus to the
Account button. The template loads the mobile stylesheet last.

Run:

```bash
npm test
```

Then commit on your existing feature branch:

```bash
git add templates/index.html static/js/app.js static/js/mobile-shell.js static/css/mobile-polish.css MOBILE_UI_SETUP.md
git commit -m "Refine mobile header navigation and interview setup"
git push
```

After deploying, refresh the page on your phone. Check the setup page, Account
menu, dashboard and interview controls at normal browser zoom.

Validation: the existing full UI suite passed; menu opening, outside-click
closing, Escape closing and focus return passed. Backend markup and static
asset checks passed. A browser screenshot check could not be completed in this
workspace because browser downloads failed, so phone visual validation remains.
