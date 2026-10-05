import { manualQuestionError } from './setup.js';

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
    edit(document.getElementById('dashboard-title'), 'Your progress');
    const filters = document.getElementById('dashboard-shared-filters');
    if(filters) {
      const disclosure = document.createElement('details');disclosure.className = 'mobile-dashboard-filters';
      const title = document.createElement('summary');title.textContent = 'Filter by topic or interview type';disclosure.append(title);
      filters.before(disclosure);restore.push(() => disclosure.remove());relocate(filters,disclosure);
    }
    for(const section of [...document.querySelectorAll('#dashboard-panel-overview > section.card')]) {
      const disclosure = document.createElement('details');disclosure.className = 'mobile-dashboard-report';
      const title = document.createElement('summary');title.textContent = section.querySelector('h2')?.textContent || 'Details';disclosure.append(title);
      section.before(disclosure);restore.push(() => disclosure.remove());relocate(section,disclosure);
    }
    edit(document.getElementById('session-title'), 'Your next interview');
    edit(setup.querySelector('.setup-heading .muted'), 'Choose your focus. We’ll check your devices next.');
    edit(form.querySelector('.section-heading h2'), 'Interview essentials');
    edit(form.querySelector('label[for="language"]'), 'Language');
    edit(form.querySelector('label[for="technology"]'), 'Topic');
    edit(document.getElementById('camera-consent-help'), 'Camera required for face and head-movement checks. Frames are processed on the server and aren’t saved.');
    edit(document.getElementById('camera-check-title'), 'Check your devices');
    edit(document.querySelector('#camera-check-page .device-heading p'), 'Enable your camera, then check your sound if needed.');
    edit(document.getElementById('camera-on'), 'Enable camera');
    edit(document.querySelector('#camera-check-page .camera-empty strong'), 'Camera preview');
    edit(document.querySelector('#camera-check-page .camera-empty p'), 'Enable your camera to check your position.');
    const micPanel = document.querySelector('#camera-check-page .microphone-check');
    if (micPanel) {
      const sound = document.createElement('details');sound.className = 'mobile-sound-check';
      const soundSummary = document.createElement('summary');soundSummary.textContent = 'Test your microphone · optional';sound.append(soundSummary);
      micPanel.before(sound);restore.push(() => sound.remove());relocate(micPanel,sound);
    }
    const core = form.querySelector('.setup-grid');
    const timing = document.createElement('details');
    timing.className = 'mobile-session-timing';timing.id = 'mobile-session-timing';
    const timingSummary = document.createElement('summary');
    const timingTitle = document.createElement('span');timingTitle.textContent = 'Language & timing';
    const timingValue = document.createElement('span');timingValue.className = 'mobile-options-value';
    timingSummary.append(timingTitle,timingValue);
    const timingGrid = document.createElement('div');timingGrid.className = 'setup-grid';
    timing.append(timingSummary,timingGrid);core.after(timing);restore.push(() => timing.remove());
    for (const id of ['language','duration']) relocate(document.getElementById(id)?.closest('.setup-field'),timingGrid);
    const updateTiming = () => {
      const language = document.getElementById('language');const duration = document.getElementById('duration');
      timingValue.textContent = `${language.value} · ${duration.value}s`;
    };
    updateTiming();
    // Refresh when opened too: loading a saved setup can change values without a change event.
    timing.addEventListener('toggle',updateTiming);
    for (const id of ['language','duration']) {
      const control = document.getElementById(id);control.addEventListener('change',updateTiming);
      restore.push(() => control.removeEventListener('change',updateTiming));
    }
    const quick = document.createElement('div');quick.className = 'mobile-question-options';
    timing.after(quick);restore.push(() => quick.remove());
    relocate(document.getElementById('session-source')?.closest('.setup-grid'),quick);
    relocate(document.getElementById('manual-question-fields'),quick);
    const preferences = document.createElement('details');
    preferences.id = 'mobile-session-options';preferences.className = 'setup-disclosure mobile-preferences';
    const summary = document.createElement('summary');summary.textContent = 'Personalise your interview';preferences.append(summary);
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
    // A phone task flow, rather than a scaled desktop form.
    const wizard = document.createElement('div');wizard.id = 'mobile-setup-flow';
    form.prepend(wizard);restore.push(() => wizard.remove());
    const titles = ['Choose your focus','Choose your questions','Ready to practise?'];
    const descriptions = ['Set the interview you want to practise.','Generate questions or bring your own.','Review your choices, then check your camera.'];
    const panels = titles.map((title,index) => {
      const panel = document.createElement('section');panel.className = 'mobile-setup-panel';
      panel.dataset.step = String(index);panel.setAttribute('aria-label',title);
      wizard.append(panel);return panel;
    });
    relocate(core,panels[0]);relocate(timing,panels[0]);relocate(saved,panels[0]);
    relocate(quick,panels[1]);relocate(preferences,panels[1]);
    const review = document.createElement('div');review.className = 'mobile-session-review';panels[2].append(review);
    for (const node of [...form.children]) {
      if (node === wizard || node.classList.contains('section-heading')) continue;
      relocate(node,panels[2]);
    }
    const footer = document.createElement('div');footer.className = 'mobile-flow-controls';wizard.append(footer);
    const back = document.createElement('button');back.type = 'button';back.id = 'mobile-setup-back';back.textContent = 'Back';
    const next = document.createElement('button');next.type = 'button';next.id = 'mobile-setup-next';next.className = 'primary';next.textContent = 'Continue';
    footer.append(back,next);
    const progress = document.createElement('p');progress.className = 'mobile-flow-progress';progress.setAttribute('aria-live','polite');wizard.prepend(progress);
    const exit = document.createElement('button');exit.type = 'button';exit.className = 'mobile-flow-exit';exit.textContent = 'Dashboard';
    exit.addEventListener('click',() => document.getElementById('nav-dashboard')?.click());wizard.prepend(exit);
    let step = 0;
    const heading = document.getElementById('session-title');
    const description = setup.querySelector('.setup-heading .muted');
    const show = (index,focus=false) => {
      // Explicitly sync the editor after preset/browser restoration as well as source changes.
      document.getElementById('manual-question-fields').hidden = document.getElementById('session-source').value !== 'manual';
      step = index;panels.forEach((panel,i) => {panel.hidden = i !== index;});
      heading.textContent = titles[index];description.textContent = descriptions[index];
      progress.textContent = `STEP ${index + 1} OF 3`;
      back.hidden = index === 0;next.hidden = index === 2;
      if (index === 2) {
        review.replaceChildren();
        for (const [label,id] of [['Interview','interview-type'],['Topic','technology'],['Difficulty','difficulty'],['Questions','session-count'],['Language','language'],['Answer time','duration'],['Source','session-source']]) {
          const control = document.getElementById(id);const row = document.createElement('div');
          const key = document.createElement('span');key.textContent = label;
          const value = document.createElement('strong');value.textContent = control.options ? control.options[control.selectedIndex].text : control.value;
          row.append(key,value);review.append(row);
        }
      }
      if (focus) {heading.tabIndex = -1;heading.focus({preventScroll:true});setup.scrollIntoView({block:'start',behavior:'smooth'});}
    };
    const error = document.createElement('p');error.className = 'mobile-flow-error';error.setAttribute('role','alert');error.hidden = true;panels[1].append(error);
    next.addEventListener('click',() => {
      if(step === 1) {
        const problem = manualQuestionError();error.hidden = !problem;error.textContent = problem;
        if(problem) {document.getElementById('session-questions').focus();return;}
      }
      show(Math.min(2,step + 1),true);
    });
    back.addEventListener('click',() => show(Math.max(0,step - 1),true));
    const previousTabindex = heading.getAttribute('tabindex');
    restore.push(() => {if(previousTabindex === null) heading.removeAttribute('tabindex');else heading.setAttribute('tabindex',previousTabindex);});
    show(0);
  };
  apply();media.addEventListener('change',apply);
}
