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
  const media = window.matchMedia?.('(max-width: 800px)');
  media?.addEventListener('change', () => setOpen(false));
}
