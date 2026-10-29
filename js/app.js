const VIEWS = ['gallery', 'data'];

function currentView() {
  const view = location.hash.replace(/^#\//, '');
  return VIEWS.includes(view) ? view : 'gallery';
}

function render() {
  const active = currentView();
  for (const view of VIEWS) {
    document.getElementById(`view-${view}`).hidden = view !== active;
  }
}

export function navigate(view) {
  location.hash = `#/${view}`;
}

window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', render);
