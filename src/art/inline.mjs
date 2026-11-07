// Puts a file from this folder straight into the page, so its lines take the page's colour and its accents take
// the --accent in force where it sits. Every file also carries its own light and dark fallbacks, so a plain
// <img src="src/art/hero.svg"> is enough wherever the OS theme decides the colours. Inline art when it sits on
// the dark stage inside a light page, or when it should follow a local --accent.
const SVG = 'http://www.w3.org/2000/svg';
const base = new URL('./', import.meta.url);
const cache = new Map();

/**
 * @param name A file in src/art, such as 'hero.svg'.
 * @param options.className Class for the root <svg>.
 * @param options.label Spoken description, replacing the file's own title. Omit to keep the title in the file.
 * @param options.decorative Hide it from screen readers, when the words beside it already say what it shows.
 * @param options.copy A short tag, such as 2 or 'home', when the same file appears more than once on a page. Its
 *   gradient and mask ids are global, so each extra copy needs its own.
 * @returns The <svg> element, ready to append.
 */
export async function artSvg(name, { className, label, decorative = false, copy } = {}) {
  if (!cache.has(name)) {
    cache.set(name, fetch(new URL(name, base)).then((res) => {
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      return res.text();
    }));
  }
  let text = await cache.get(name);
  // Every id in these files starts with "rl-", and so does every reference to one.
  if (copy !== undefined && copy !== null) text = text.replaceAll('rl-', `rl-${String(copy).replace(/[^\w-]/g, '')}-`);
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (parsed.localName !== 'svg') throw new Error(`${name} is not an SVG`);
  const svg = document.adoptNode(parsed);
  if (className) svg.setAttribute('class', className);
  if (decorative) {
    svg.setAttribute('aria-hidden', 'true');
    svg.removeAttribute('role');
    svg.removeAttribute('aria-labelledby');
  } else if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.removeAttribute('aria-labelledby');
  }
  svg.setAttribute('focusable', 'false');
  return svg;
}

/**
 * One line icon from icons.svg, drawn through <use> so the sprite is fetched once. Hidden from screen readers
 * unless a label is given, because the icon normally sits beside its words.
 * @param name camera, walk, turn, score, judge, wall, download, socials, check, chevron, play, pause, close, upload,
 *   pencil, alert, device or clap.
 */
export function icon(name, { className = 'rw-icon', label } = {}) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('focusable', 'false');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `${new URL('icons.svg', base).pathname}#rl-icon-${name}`);
  svg.append(use);
  return svg;
}
