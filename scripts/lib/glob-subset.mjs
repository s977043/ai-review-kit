// ---------------------------------------------------------------------------
// glob-subset.mjs — decide brace expansion, overlap, and containment between two
// globs, exactly, over a symbolic finite alphabet.
//
// Used by validate-agent-skills.mjs to check that an entry (agent-skills router)
// skill's `applyTo` covers the union of its routing-target registry skills'
// `applyTo` (issue #1508). Following repo principle #1070 (deterministic checks
// guard the deterministic domain, false-positives are caught by canary), the
// decisions here are made false-positive-first: `globContains`/`globOverlaps`
// return 'unknown' for any glob whose grammar this module does not model, and
// the caller degrades an 'unknown' to a non-blocking warning rather than an
// error.
//
// Supported glob grammar (after brace expansion):
//   /   path separator
//   **  a whole path segment: matches zero or more segments (incl. separators)
//   *   matches zero or more non-`/` characters within a segment
//   ?   matches exactly one non-`/` character
//   any other character is a literal
// Constructs outside this grammar (character classes `[...]`, extglob `@(...)`,
// negation `!`, leftover braces) make the containing glob 'unknown'.
// ---------------------------------------------------------------------------

/**
 * Expand brace groups (`{a,b,c}`) in a glob into the set of concrete globs.
 * Handles multiple and nested groups via recursion. A glob with no braces
 * returns `[glob]`.
 *
 * @param {string} pattern
 * @returns {string[]}
 */
export function expandBraces(pattern) {
  const open = pattern.indexOf('{');
  if (open === -1) return [pattern];

  // Find the matching close brace for the first `{`, honoring nesting.
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  // Unbalanced brace: treat literally (do not expand).
  if (close === -1) return [pattern];

  const prefix = pattern.slice(0, open);
  const suffix = pattern.slice(close + 1);
  const body = pattern.slice(open + 1, close);

  // Split the body on top-level commas only (ignore commas inside nested braces).
  const options = [];
  let current = '';
  let nest = 0;
  for (const ch of body) {
    if (ch === '{') nest += 1;
    else if (ch === '}') nest -= 1;
    if (ch === ',' && nest === 0) {
      options.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  options.push(current);

  const results = [];
  for (const opt of options) {
    for (const expandedSuffix of expandBraces(suffix)) {
      results.push(`${prefix}${opt}${expandedSuffix}`);
    }
  }
  // Re-expand in case an option itself contained another brace group.
  return results.flatMap((r) => (r.includes('{') ? expandBraces(r) : [r]));
}

const OTHER = 'OTHER';

/**
 * True when `glob` uses only the grammar this module can decide exactly. A glob
 * with braces (should be expanded first) or with unsupported constructs is not
 * decidable and the caller must treat comparisons involving it as 'unknown'.
 */
export function isDecidableGlob(glob) {
  return !/[[\]()!+@{}]/.test(glob);
}

// --- AST ---------------------------------------------------------------------
// Node kinds: {t:'char',sym} {t:'notslash'} {t:'any'} {t:'concat',items}
//             {t:'star',node} {t:'empty'}

function concat(items) {
  const flat = items.filter((n) => n && n.t !== 'empty');
  if (flat.length === 0) return { t: 'empty' };
  if (flat.length === 1) return flat[0];
  return { t: 'concat', items: flat };
}

function plus(node) {
  return concat([node, { t: 'star', node }]);
}

function compileSegment(seg) {
  const items = [];
  for (const ch of seg) {
    if (ch === '*') items.push({ t: 'star', node: { t: 'notslash' } });
    else if (ch === '?') items.push({ t: 'notslash' });
    else items.push({ t: 'char', sym: ch });
  }
  return concat(items);
}

/**
 * Compile a brace-free, decidable glob into a regex-equivalent AST over the
 * symbolic alphabet. Globstar segment handling mirrors minimatch: a globstar
 * segment matches zero or more whole path segments and absorbs one adjacent
 * separator so that e.g. "a/(globstar)/b" also matches the path "a/b".
 */
function globToAst(glob) {
  const segments = glob.split('/');
  const n = segments.length;
  const parts = [];
  let prevSuppressSep = false;

  for (let s = 0; s < n; s += 1) {
    const seg = segments[s];
    const isGlobstar = seg === '**';
    let atom;
    let preSep;
    let suppressNextSep;

    if (isGlobstar) {
      if (n === 1) {
        atom = { t: 'star', node: { t: 'any' } };
        preSep = true;
        suppressNextSep = false;
      } else if (s === n - 1) {
        // trailing `/**`: absorbs the preceding separator, may match nothing.
        atom = { t: 'star', node: concat([{ t: 'char', sym: '/' }, plus({ t: 'notslash' })]) };
        preSep = false;
        suppressNextSep = false;
      } else {
        // leading `**/` (s === 0) or middle `/**/`: `(?:[^/]+/)*`, absorbs the
        // following separator.
        atom = { t: 'star', node: concat([plus({ t: 'notslash' }), { t: 'char', sym: '/' }]) };
        preSep = s !== 0;
        suppressNextSep = true;
      }
    } else {
      atom = compileSegment(seg);
      preSep = true;
      suppressNextSep = false;
    }

    if (s > 0 && preSep && !prevSuppressSep) {
      parts.push({ t: 'char', sym: '/' });
    }
    parts.push(atom);
    prevSuppressSep = suppressNextSep;
  }

  return concat(parts);
}

function collectLiterals(ast, set) {
  if (!ast) return;
  if (ast.t === 'char') set.add(ast.sym);
  else if (ast.t === 'star') collectLiterals(ast.node, set);
  else if (ast.t === 'concat') ast.items.forEach((n) => collectLiterals(n, set));
}

function buildAlphabet(...asts) {
  const lits = new Set();
  for (const ast of asts) collectLiterals(ast, lits);
  lits.add('/');
  const alphabet = [...lits];
  alphabet.push(OTHER);
  return alphabet;
}

// --- Thompson epsilon-NFA ----------------------------------------------------

function buildNfa(ast, alphabet) {
  let counter = 0;
  const newState = () => counter++;
  const trans = new Map(); // state -> Array<{sym: string|null, to: number}> (null = epsilon)
  const addEdge = (from, sym, to) => {
    if (!trans.has(from)) trans.set(from, []);
    trans.get(from).push({ sym, to });
  };

  function frag(node) {
    switch (node.t) {
      case 'empty': {
        const s = newState();
        const a = newState();
        addEdge(s, null, a);
        return { start: s, accept: a };
      }
      case 'char': {
        const s = newState();
        const a = newState();
        addEdge(s, node.sym, a);
        return { start: s, accept: a };
      }
      case 'notslash': {
        const s = newState();
        const a = newState();
        for (const sym of alphabet) if (sym !== '/') addEdge(s, sym, a);
        return { start: s, accept: a };
      }
      case 'any': {
        const s = newState();
        const a = newState();
        for (const sym of alphabet) addEdge(s, sym, a);
        return { start: s, accept: a };
      }
      case 'concat': {
        let first = null;
        let prevAccept = null;
        for (const item of node.items) {
          const f = frag(item);
          if (first === null) first = f.start;
          else addEdge(prevAccept, null, f.start);
          prevAccept = f.accept;
        }
        return { start: first, accept: prevAccept };
      }
      case 'star': {
        const s = newState();
        const a = newState();
        const inner = frag(node.node);
        addEdge(s, null, inner.start);
        addEdge(s, null, a);
        addEdge(inner.accept, null, inner.start);
        addEdge(inner.accept, null, a);
        return { start: s, accept: a };
      }
      default:
        throw new Error(`unknown ast node ${node.t}`);
    }
  }

  const { start, accept } = frag(ast);
  return { start, accept, trans };
}

function epsilonClosure(nfa, states) {
  const stack = [...states];
  const closure = new Set(states);
  while (stack.length) {
    const st = stack.pop();
    for (const edge of nfa.trans.get(st) ?? []) {
      if (edge.sym === null && !closure.has(edge.to)) {
        closure.add(edge.to);
        stack.push(edge.to);
      }
    }
  }
  return closure;
}

const DEAD = 'DEAD';

/**
 * Determinize an epsilon-NFA into a total DFA over `alphabet` (missing
 * transitions route to an explicit DEAD state). Returns a graph keyed by a
 * canonical string id per DFA state.
 */
function determinize(nfa, alphabet) {
  const startSet = epsilonClosure(nfa, [nfa.start]);
  const idOf = (set) => [...set].sort((a, b) => a - b).join(',');
  const startId = idOf(startSet);

  const dfaTrans = new Map(); // id -> Map(sym -> id)
  const accepting = new Set();
  const setById = new Map([[startId, startSet]]);
  const queue = [startId];

  while (queue.length) {
    const id = queue.shift();
    if (dfaTrans.has(id)) continue;
    const set = setById.get(id);
    if (set.has(nfa.accept)) accepting.add(id);
    const row = new Map();
    for (const sym of alphabet) {
      const move = new Set();
      for (const st of set) {
        for (const edge of nfa.trans.get(st) ?? []) {
          if (edge.sym === sym) move.add(edge.to);
        }
      }
      if (move.size === 0) {
        row.set(sym, DEAD);
      } else {
        const closed = epsilonClosure(nfa, move);
        const nid = idOf(closed);
        if (!setById.has(nid)) {
          setById.set(nid, closed);
          queue.push(nid);
        }
        row.set(sym, nid);
      }
    }
    dfaTrans.set(id, row);
  }

  // DEAD state: total, never accepting, self-loops on all symbols.
  const deadRow = new Map();
  for (const sym of alphabet) deadRow.set(sym, DEAD);
  dfaTrans.set(DEAD, deadRow);

  return { start: startId, accepting, trans: dfaTrans, alphabet };
}

/**
 * BFS the product of two DFAs; return true when a reachable product state
 * satisfies `pred(aAccepts, bAccepts)`.
 */
function productReaches(dfaA, dfaB, alphabet, pred) {
  const start = `${dfaA.start}|${dfaB.start}`;
  const seen = new Set([start]);
  const queue = [[dfaA.start, dfaB.start]];
  while (queue.length) {
    const [a, b] = queue.shift();
    if (pred(dfaA.accepting.has(a), dfaB.accepting.has(b))) return true;
    for (const sym of alphabet) {
      const na = dfaA.trans.get(a).get(sym);
      const nb = dfaB.trans.get(b).get(sym);
      const key = `${na}|${nb}`;
      if (!seen.has(key)) {
        seen.add(key);
        queue.push([na, nb]);
      }
    }
  }
  return false;
}

function compile(glob, alphabet) {
  return determinize(buildNfa(globToAst(glob), alphabet), alphabet);
}

/**
 * Do two globs match at least one common path?
 * @returns {'yes'|'no'|'unknown'}
 */
export function globOverlaps(a, b) {
  if (!isDecidableGlob(a) || !isDecidableGlob(b)) return 'unknown';
  const astA = globToAst(a);
  const astB = globToAst(b);
  const alphabet = buildAlphabet(astA, astB);
  const dfaA = determinize(buildNfa(astA, alphabet), alphabet);
  const dfaB = determinize(buildNfa(astB, alphabet), alphabet);
  const reaches = productReaches(dfaA, dfaB, alphabet, (aAcc, bAcc) => aAcc && bAcc);
  return reaches ? 'yes' : 'no';
}

/**
 * Does every path matching `inner` also match `outer` (L(inner) ⊆ L(outer))?
 * @returns {'yes'|'no'|'unknown'}
 */
export function globContains(outer, inner) {
  if (!isDecidableGlob(outer) || !isDecidableGlob(inner)) return 'unknown';
  const astOuter = globToAst(outer);
  const astInner = globToAst(inner);
  const alphabet = buildAlphabet(astOuter, astInner);
  const dfaOuter = determinize(buildNfa(astOuter, alphabet), alphabet);
  const dfaInner = determinize(buildNfa(astInner, alphabet), alphabet);
  // L(inner) ⊆ L(outer)  ⇔  L(inner) ∩ complement(L(outer)) = ∅.
  // complement(outer): flip accepting (DEAD becomes accepting).
  const notInLanguage = productReaches(
    dfaInner,
    dfaOuter,
    alphabet,
    (innerAcc, outerAcc) => innerAcc && !outerAcc
  );
  return notInLanguage ? 'no' : 'yes';
}

/** @internal exported for unit tests */
export const _internal = { globToAst, compile, buildAlphabet };
