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

function reload(title) {
  const id = GAMES[title];
  try {
    const now = Date.now();
    sessionStorage.setItem('os:reloaded', String(now));
    const fullscreen = !!document.querySelector('.stage.is-fs');
    sessionStorage.setItem('os:resume', JSON.stringify({ app: 'arcade', args: id ? { play: id } : {}, fullscreen, at: now }));
  } catch (e) {
    // No storage: still reload, just onto the desktop.
  }
  location.reload();
}

function patch(card) {
  if (card.hasAttribute('data-reload') || !(card.textContent || '').includes(OLD_CARD)) return false;
  card.setAttribute('data-reload', '');
  const title = card.querySelector('b');
  const name = (title && title.textContent ? title.textContent : '').replace(/ didn't load$/, '');
  setText(title, `${name} was updated`);
  setText(card.querySelector('span'), "reload to play the new version. you'll land right back here.");
  const button = card.querySelector('.btn-primary');
  if (button) {
    setText(button, 'Reload');
    // Capture the click before React sees it: the old Try Again would only show this card again.
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      reload(name);
    }, true);
  }
  return true;
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  // Every missing file runs this once, so share one watcher per page.
  const state = window.__missingFile || (window.__missingFile = { observer: null, seen: false, timer: 0 });
  const scan = () => {
    for (const card of document.querySelectorAll('.arcade-notice')) if (patch(card)) state.seen = true;
  };
  scan();
  if (!state.observer) {
    state.observer = new MutationObserver(scan);
    state.observer.observe(document.body, { childList: true, subtree: true });
  }
  // An old page keeps watching, since any game it already failed to open can show the old card again. A new page
  // never shows the old card, so stop once its own card has had time to appear.
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    if (state.seen || !state.observer) return;
    state.observer.disconnect();
    state.observer = null;
  }, 15000);
}

throw new Error(`Failed to fetch dynamically imported module: ${import.meta.url}`);
