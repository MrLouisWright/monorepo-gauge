// Minimal glob -> RegExp (supports **, *, ?, {a,b}); paths use forward slashes.
export function globToRe(glob) {
  let g = String(glob).replace(/\\/g, '/').replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  let re = ''; let i = 0; let brace = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { const slash = g[i + 2] === '/'; re += slash ? '(?:.*/)?' : '.*'; i += slash ? 3 : 2; continue; }
      re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') { re += '(?:'; brace++; } else if (c === '}' && brace) { re += ')'; brace--; } else if (c === ',' && brace) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    i++;
  }
  return new RegExp(`^${re}$`);
}
export const matchAny = (path, globs) => globs.some((g) => (g instanceof RegExp ? g : globToRe(g)).test(path) || (!String(g).includes('/') && (g instanceof RegExp ? g : globToRe(g)).test(path.split('/').pop())));
