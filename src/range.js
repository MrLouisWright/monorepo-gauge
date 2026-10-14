// Compact SemVer range matching (npm semantics, without prerelease opt-in subtleties).
const V = /^\s*v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/;

export function parseVersion(v) {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$/.exec(String(v ?? ''));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] } : null;
}
export function cmp(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (!a.pre.length && !b.pre.length) return 0;
  if (!a.pre.length) return 1; if (!b.pre.length) return -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]; const y = b.pre[i];
    if (x === undefined) return -1; if (y === undefined) return 1;
    const nx = /^\d+$/.test(x); const ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x < +y ? -1 : 1; } else if (nx !== ny) return nx ? -1 : 1; else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
const wild = (s) => s === undefined || /^[xX*]$/.test(s);
function partial(s) { const m = V.exec(s); if (!m) return null; return { major: wild(m[1]) ? null : +m[1], minor: wild(m[2]) ? null : +m[2], patch: wild(m[3]) ? null : +m[3], pre: m[4] ? m[4].split('.') : [] }; }
const ver = (M, m, p, pre = []) => ({ major: M, minor: m, patch: p, pre });

/** Expand one comparator token into [op, version] pairs (AND). */
function expand(tok) {
  const m = /^(\^|~>?|>=|<=|>|<|=)?\s*(.*)$/.exec(tok); const op = m[1] || ''; const p = partial(m[2]);
  if (!p) throw new Error(`Invalid comparator: ${tok}`);
  const { major: M, minor: mi, patch: pa, pre } = p;
  if (M === null) return op === '<' || op === '>' ? [['<', ver(0, 0, 0, ['0'])]] : [];
  if (op === '^') {
    const lo = ver(M, mi ?? 0, pa ?? 0, pre);
    const hi = M > 0 || mi === null ? ver(M + 1, 0, 0, ['0']) : mi > 0 || pa === null ? ver(0, mi + 1, 0, ['0']) : ver(0, 0, pa + 1, ['0']);
    return [['>=', lo], ['<', hi]];
  }
  if (op.startsWith('~')) { const lo = ver(M, mi ?? 0, pa ?? 0, pre); const hi = mi === null ? ver(M + 1, 0, 0, ['0']) : ver(M, mi + 1, 0, ['0']); return [['>=', lo], ['<', hi]]; }
  if (op === '' || op === '=') {
    if (mi === null) return [['>=', ver(M, 0, 0)], ['<', ver(M + 1, 0, 0, ['0'])]];
    if (pa === null) return [['>=', ver(M, mi, 0)], ['<', ver(M, mi + 1, 0, ['0'])]];
    return [['=', ver(M, mi, pa, pre)]];
  }
  if (op === '>') { if (mi === null) return [['>=', ver(M + 1, 0, 0)]]; if (pa === null) return [['>=', ver(M, mi + 1, 0)]]; return [['>', ver(M, mi, pa, pre)]]; }
  if (op === '>=') return [['>=', ver(M, mi ?? 0, pa ?? 0, pre)]];
  if (op === '<') return [['<', ver(M, mi ?? 0, pa ?? 0, mi === null || pa === null ? ['0'] : pre)]];
  if (op === '<=') { if (mi === null) return [['<', ver(M + 1, 0, 0, ['0'])]]; if (pa === null) return [['<', ver(M, mi + 1, 0, ['0'])]]; return [['<=', ver(M, mi, pa, pre)]]; }
  return [];
}

/** Parse a range into a list of comparator sets (OR of ANDs). Throws on invalid input. */
export function parseRange(range) {
  const r = String(range ?? '').trim();
  if (r === '' || r === '*' || r === 'x' || r === 'latest') return [[]];
  return r.split('||').map((part) => {
    const s = part.trim();
    const hy = /^(\S+)\s+-\s+(\S+)$/.exec(s);
    if (hy) { const a = partial(hy[1]); const b = partial(hy[2]); if (!a || !b) throw new Error(`Invalid range: ${range}`); const lo = ver(a.major ?? 0, a.minor ?? 0, a.patch ?? 0, a.pre); const hi = b.minor === null ? ['<', ver(b.major + 1, 0, 0, ['0'])] : b.patch === null ? ['<', ver(b.major, b.minor + 1, 0, ['0'])] : ['<=', ver(b.major, b.minor, b.patch, b.pre)]; return [['>=', lo], hi]; }
    if (!s) return [];
    return s.replace(/(\^|~>?|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).flatMap(expand);
  });
}

const test = (v, [op, x]) => { const c = cmp(v, x); return op === '=' ? c === 0 : op === '>' ? c > 0 : op === '>=' ? c >= 0 : op === '<' ? c < 0 : c <= 0; };
export function satisfies(version, range) {
  const v = typeof version === 'string' ? parseVersion(version) : version; if (!v) return false;
  let sets; try { sets = parseRange(range); } catch { return false; }
  return sets.some((set) => set.every((c) => test(v, c)) && (!v.pre.length || set.some(([, x]) => x.pre.length && x.pre[0] !== '0' && x.major === v.major && x.minor === v.minor && x.patch === v.patch) || set.length === 0));
}
export function validRange(range) { try { parseRange(range); return true; } catch { return false; } }
/** Lowest version a range admits (for comparing majors). */
export function minVersion(range) {
  let sets; try { sets = parseRange(range); } catch { return null; }
  let best = null;
  for (const set of sets) { const lo = set.filter(([op]) => op === '>=' || op === '=' || op === '>').map(([, x]) => x).sort(cmp).pop() || ver(0, 0, 0); if (!best || cmp(lo, best) < 0) best = lo; }
  return best;
}
