// Keep existing account links and handlers; only change their mobile presentation.
export function initMobileShell() {
  const toggle = document.getElementById('mobile-account-toggle');
  const menu = document.getElementById('account-menu');
  if (!toggle || !menu) return;
  toggle.hidden = false;
  const setOpen = (open, restoreFocus=false) => {
    menu.toggleAttribute('data-mobile-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('click', event => {
    if (!menu.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      event.preventDefault(); setOpen(false, true);
    }
  });
  initMobileSetup();
  const media = window.matchMedia?.('(max-width: 800px)');
  media?.addEventListener('change', () => setOpen(false));
}

// Rearrange the existing controls, preserving their IDs, values and listeners.
export function initMobileSetup() {
  const setup = document.getElementById('session-setup');
  const form = setup?.querySelector('.setup-form');
  const media = window.matchMedia?.('(max-width: 600px)');
  if (!form || !media || setup.dataset.mobileInitialized) return;
  setup.dataset.mobileInitialized = 'true';
  let restore = [];
  const relocate = (node, target) => {
    if (!node) return;
    const marker = document.createComment('mobile position');
    node.before(marker); target.append(node);
    restore.push(() => { marker.replaceWith(node); });
  };
  const edit = (node, value) => {
    if (!node) return;
    const original = [...node.childNodes];
    node.textContent = value;
    restore.push(() => { node.replaceChildren(...original); });
  };
  const apply = () => {
    restore.reverse().forEach(fn => fn()); restore = [];
    if (!media.matches) return;
    edit(document.getElementById('session-title'), 'Your next interview');
    edit(setup.querySelector('.setup-heading .muted'), 'Choose your focus. We’ll check your devices next.');
    edit(form.querySelector('.section-heading h2'), 'Session preferences');
    edit(form.querySelector('label[for="language"]'), 'Language');
    edit(form.querySelector('label[for="technology"]'), 'Topic');
    edit(document.getElementById('camera-consent-help'), 'Camera required for face and head-movement checks. Frames are processed on the server and aren’t saved.');
    const core = form.querySelector('.setup-grid');
    const quick = document.createElement('div');quick.className = 'mobile-question-options';
    core.after(quick);restore.push(() => quick.remove());
    relocate(document.getElementById('session-source')?.closest('.setup-grid'),quick);
    relocate(document.getElementById('manual-question-fields'),quick);
    const preferences = document.createElement('details');
    preferences.id = 'mobile-session-options';preferences.className = 'setup-disclosure mobile-preferences';
    const summary = document.createElement('summary');summary.textContent = 'Personalise & preferences';preferences.append(summary);
    quick.after(preferences);restore.push(() => preferences.remove());
    relocate(form.querySelector('details.setup-disclosure:not(#mobile-session-options)'),preferences);
    const workflow = document.getElementById('auto-flow');
    const workflowHelp = workflow?.nextElementSibling;
    relocate(form.querySelector('label[for="auto-flow"]'),preferences);
    relocate(workflow,preferences);relocate(workflowHelp,preferences);
    for (const help of [...form.querySelectorAll(':scope > small')]) {
      if (help.id !== 'camera-consent-help') relocate(help,preferences);
    }
    relocate(document.getElementById('practice-focus')?.closest('.field'),preferences);
    const saved = setup.querySelector(':scope > details.setup-disclosure');
    if (saved) {
      relocate(saved,form);
      edit(saved.querySelector('summary'), 'Saved interview setups');
      // Use a short disclosure after the essential fields, not a large card above them.
      preferences.after(saved);
    }
    const importButton = document.getElementById('account-import');
    const accountMenu = document.getElementById('account-menu');
    if (importButton && accountMenu) relocate(importButton,accountMenu);
    const secondHeading = [...form.querySelectorAll(':scope > .section-heading')][1];
    if (secondHeading) {secondHeading.classList.add('mobile-secondary-heading');restore.push(()=>secondHeading.classList.remove('mobile-secondary-heading'));}
  };
  apply();media.addEventListener('change',apply);
}
