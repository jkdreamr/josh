// Served in place of a script the site no longer has (see scripts/keep-old-assets.ts). Only a page loaded before
// a deploy asks for one: it was kept open past the week old files are kept, or opened before they were kept at all.
//
// Pages loaded since Oct 13, 2026 show their own "was updated" card with a Reload button when this throws. Pages
// from before that show a "didn't load" card whose Try Again can never work, because the browser remembers the
// failed file. This turns that card into the same one-click Reload, which lands straight back in the game.
// The build fills in GAMES (game title to id) so the reload can reopen the right game.
const GAMES = __GAMES__;
const OLD_CARD = 'something went wrong starting this game';

function setText(el, text) {
  if (!el) return;
  // Change React's own text node rather than replacing it, so React's view of the page stays true.
  const node = el.childNodes.length === 1 && el.firstChild.nodeType === 3 ? el.firstChild : null;
  if (node) node.nodeValue = text;
  else el.textContent = text;
}

/** What the new code reopens after the reload: the window the card sits in, as it was. */
function resumeFor(card, name) {
  const win = card.closest('[data-win]');
  const app = win && win.getAttribute('data-win');
  if (app === 'chrome') {
    // The address bar of a Chrome window showing a game reads chrome://games/<id>, with ?room= for online play.
    const address = win.querySelector('input[aria-label="Address"]');
    const url = address ? address.value : '';
    return { app, args: url.startsWith('chrome://games/') ? { url } : {} };
  }
  if (app === 'coxbox') {
    const params = new URLSearchParams(location.search);
    const room = params.get('game') === 'coxbox' ? params.get('room') : null;
    return { app, args: room ? { room } : {} };
  }
  const id = GAMES[name];
  return { app: 'arcade', args: id ? { play: id } : {} };
}

function reload(card, name) {
  // Reloading offline would swap the whole page for the browser's error page, so check the site answers first.
  fetch('/', { method: 'HEAD', cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`status ${res.status}`);
      try {
        const now = Date.now();
        const fullscreen = !!document.querySelector('.stage.is-fs');
        sessionStorage.setItem('os:reloaded', String(now));
        sessionStorage.setItem('os:resume', JSON.stringify({ ...resumeFor(card, name), fullscreen, at: now }));
      } catch (e) {
        // No storage: still reload, just onto the desktop.
      }
      location.reload();
    })
    .catch(() => {
      setText(card.querySelector('span'), "you're offline. connect to the internet and try again.");
      setText(card.querySelector('.btn-primary'), 'Try again');
    });
}

function patch(card) {
  if (card.hasAttribute('data-reload') || !(card.textContent || '').includes(OLD_CARD)) return;
  card.setAttribute('data-reload', '');
  const title = card.querySelector('b');
  const name = (title && title.textContent ? title.textContent : '').replace(/ didn't load$/, '');
  setText(title, `${name} was updated`);
  setText(card.querySelector('span'), "reload to play the new version. you'll land right back here.");
  const button = card.querySelector('.btn-primary');
  if (!button) return;
  setText(button, 'Reload');
  // Capture the click before React sees it: the old Try Again would only show this card again.
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    reload(card, name);
  }, true);
}

function scan(node) {
  if (node.nodeType !== 1) return;
  if (node.matches('.arcade-notice')) patch(node);
  for (const card of node.querySelectorAll('.arcade-notice')) patch(card);
}

// Every missing file runs this, so set up one watcher per page. It stays for the page's life: a game the page
// already failed to open can show the old card again later without asking for anything new.
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && !window.__missingFile) {
  window.__missingFile = true;
  scan(document.body);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) scan(node);
  }).observe(document.body, { childList: true, subtree: true });
}

throw new Error(`Failed to fetch dynamically imported module: ${import.meta.url}`);
