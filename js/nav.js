// D-pad navigation.
//
// Containers say how the arrows move inside them:
//   data-axis="x" | "y"  a list: arrows along the axis go to the previous / next child
//   data-grid            a grid: arrows go to the nearest cell in that direction
// A press a container can't handle (the end of a row, Down inside a row) bubbles to the
// container around it, so Down in a row of cards moves to the next row. If no container
// handles it, the nearest *visible on-screen* element in that direction wins.
//
// data-<dir>="none" on an element or container stops a press at that edge, and
// data-<dir>="<selector>" sends it somewhere specific. Containers and [data-group]
// elements remember their last focused element, so moving back into one lands where you
// left it. [data-clip] marks an overflow-hidden area: elements scrolled out of it don't
// count as on-screen.
const Nav = (() => {
  let current = null;
  const memory = new WeakMap();
  const CONTAINER = '[data-axis],[data-grid]';
  const MEMO = '[data-axis],[data-grid],[data-group]';

  const visible = el => el.offsetParent !== null;
  const navigable = el => visible(el) && (el.classList.contains('focusable') || !!el.querySelector('.focusable'));

  function focus(el) {
    if (!el) return;
    if (current && current !== el) current.classList.remove('focused');
    current = el;
    el.classList.add('focused');
    for (let a = el.parentElement; a; a = a.parentElement) if (a.matches(MEMO)) memory.set(a, el);
    el.dispatchEvent(new CustomEvent('nav:focus', { bubbles: true }));
  }

  // Focus an element, or the remembered (else first) element inside a container.
  function enter(target) {
    if (!target) return false;
    if (target.classList.contains('focusable')) { focus(target); return true; }
    const m = memory.get(target);
    if (m && target.contains(m) && visible(m)) { focus(m); return true; }
    const first = Array.prototype.find.call(target.querySelectorAll('.focusable'), visible);
    if (first) focus(first);
    return !!first;
  }

  function score(a, b, dir) {
    const horizontal = dir === 'left' || dir === 'right';
    const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    const bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2;
    const main = dir === 'right' ? bx - ax : dir === 'left' ? ax - bx : dir === 'down' ? by - ay : ay - by;
    // A candidate must be genuinely beyond the current element, not a few pixels off: the
    // focused card is scaled and lifted, so its neighbours' centres shift slightly.
    const size = horizontal ? Math.min(a.right - a.left, b.right - b.left) : Math.min(a.bottom - a.top, b.bottom - b.top);
    if (main <= size / 2) return Infinity;
    const gap = horizontal
      ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom))
      : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    return main + gap * 4 + (horizontal ? Math.abs(by - ay) : Math.abs(bx - ax)) * 0.3;
  }

  function nearest(from, candidates, dir) {
    const a = from.getBoundingClientRect();
    let best = null, bestScore = Infinity;
    for (const el of candidates) {
      if (el === from || el.contains(from)) continue;
      const s = score(a, el.getBoundingClientRect(), dir);
      if (s < bestScore) { bestScore = s; best = el; }
    }
    return best;
  }

  function stepInside(container, child, dir) {
    if (container.hasAttribute('data-grid')) return nearest(child, Array.prototype.filter.call(container.children, navigable), dir);
    const axis = container.getAttribute('data-axis');
    // Walk the siblings rather than checking the whole list: rows can hold dozens of tiles.
    const key = dir === (axis === 'x' ? 'right' : 'down') ? 'nextElementSibling'
      : dir === (axis === 'x' ? 'left' : 'up') ? 'previousElementSibling' : null;
    if (!key) return null;
    let el = child[key];
    while (el && !navigable(el)) el = el[key];
    return el;
  }

  function onScreen(el) {
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return false;
    const clip = el.closest('[data-clip]');
    if (!clip) return true;
    const c = clip.getBoundingClientRect();
    return r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom;
  }

  // Returns true when the override decided the press (moved, or stopped it). A target that
  // isn't showing (e.g. the A–Z bar under another sort) falls back to normal movement.
  function override(el, dir) {
    const v = el.getAttribute('data-' + dir);
    if (!v) return false;
    if (v === 'none') return true;
    const target = document.querySelector(v);
    if (!target || !visible(target)) return false;
    enter(target);
    return true;
  }

  function move(dir) {
    if (!current || !document.contains(current) || !visible(current)) {
      enter(Array.prototype.find.call(document.querySelectorAll('.focusable'), visible));
      return;
    }
    if (override(current, dir)) return;

    let node = current;
    for (let box = node.parentElement && node.parentElement.closest(CONTAINER); box;
      node = box, box = box.parentElement && box.parentElement.closest(CONTAINER)) {
      let child = node;
      while (child.parentElement !== box) child = child.parentElement;
      const next = stepInside(box, child, dir);
      if (next) { enter(next); return; }
      if (override(box, dir)) return;
    }

    const all = Array.prototype.filter.call(document.querySelectorAll('.focusable'), el => visible(el) && onScreen(el));
    const target = nearest(current, all, dir);
    if (!target) return;
    // Land on the remembered element of the outermost group being entered.
    let landing = target;
    for (let a = target.parentElement; a; a = a.parentElement) {
      if (a.contains(current)) break;
      if (a.matches(MEMO)) landing = a;
    }
    enter(landing);
  }

  return {
    focus, move, enter,
    current: () => current,
    remember: (container, el) => memory.set(container, el),
  };
})();
