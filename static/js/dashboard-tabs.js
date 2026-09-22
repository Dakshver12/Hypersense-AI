import { $ } from './dom.js';

const sections = ['overview', 'sessions', 'questions', 'backup'];
export function selectDashboardTab(section, focus = false) {
  if (!sections.includes(section)) return;
  for (const name of sections) {
    const active = name === section;
    const tab = $('dashboard-tab-' + name);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    $('dashboard-panel-' + name).hidden = !active;
  }
  $('dashboard-shared-filters').hidden = !['overview', 'sessions'].includes(section);
  if (focus) $('dashboard-tab-' + section).focus();
}
export function initDashboardTabs() {
  if (!$('dashboard-tab-overview')) return;
  for (const [index, section] of sections.entries()) {
    const tab = $('dashboard-tab-' + section);
    tab.onclick = () => selectDashboardTab(section);
    tab.onkeydown = event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
      else if (event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = sections.length - 1;
      else return;
      event.preventDefault();
      selectDashboardTab(sections[next], true);
    };
  }
  selectDashboardTab('overview');
}
