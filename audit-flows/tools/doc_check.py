#!/usr/bin/env python3
"""
doc_check.py - the docs cite tools and files. Do they exist?

WHY. Three times in three days a markdown file named a script as the tool that proves something,
and the script was not in the repo: `tools/verify_order.py` (found 2026-08-22, cited as the
precondition for the WF-A lease rewire), `tools/seam_check.py` (found 2026-08-23, cited twice as
the tool that found a live defect - written that day), and `tools/tidy_canvas.py` (found
2026-08-23, cited as what laid out every canvas). Each read as a capability the project had. None
were checkable, and one of them was load-bearing in an argument for not deploying something.

A citation that cannot be run is worse than no citation: it ends the reader's investigation.

  python3 tools/doc_check.py            # every *.md under audit-flows/
  python3 tools/doc_check.py path.md    # just these

Exit 1 if any cited path is missing.

WHAT THIS DOES NOT DO, so nobody reads a green run as more than it is: it checks that a cited FILE
EXISTS. It cannot tell you the file still does what the sentence claims, and it says nothing about
the far more common staleness - prose asserting a deployment state that changed underneath it.
For that there is exactly one answer and it is not a doc: `python3 tools/erp_compliance.py --all`.
Docs should point at it rather than restate it.
"""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# Paths cited in backticks that live in this repo and are worth checking. Deliberately narrow:
# a broad "anything that looks like a path" scan pulls in ERP routes, n8n node names and URLs,
# and a checker that cries wolf is one nobody runs.
CITE = re.compile(
    r'`((?:tools|nodes|offline|wfa|wf-a|wf-b|wf-e|wf-t|scripts'
    r'|cc-below-agreed|cc-price|mv-monthly-payment|erp-lease|compliance)'
    r'/[A-Za-z0-9_\-./]+\.(?:py|js|json|md))`')

# A doc may cite a file precisely to say it is NOT there - "tools/verify_order.py does not exist
# and never did" is the correction, not the bug. Those must not be reported, or the fix for a
# phantom citation would itself fail the check and the honest sentence would get deleted to make
# the tool green. The doc has to SAY it, within two lines: the failure mode being guarded is a
# citation that reads as available, and one that reads as absent is already safe.
DECLARED_ABSENT = ('does not exist', 'never existed', 'never did', 'not in this repo',
                   'is not present', 'was found missing', 'found not to exist', 'no longer exists')

def declared_absent(text, idx):
    lines = text[:idx].count('\n')
    all_lines = text.split('\n')
    window = ' '.join(all_lines[max(0, lines - 2):lines + 3]).lower()
    return any(p in window for p in DECLARED_ABSENT)

def md_files(paths):
    if paths:
        return paths
    out = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in ('.git', 'node_modules', '__pycache__', 'exports')]
        for f in files:
            if f.endswith('.md'):
                out.append(os.path.join(base, f))
    return sorted(out)

def resolve(doc, cited):
    """Resolve a citation from the doc's directory UPWARDS to audit-flows/.

    Every convention in this repo is in use at once: ERP-LOAD-POLICY.md writes
    `tools/erp_breaker.js` meaning the root, cc-below-agreed/README.md writes
    `nodes/Build_Runs_Log.js` meaning its own subtree, and cc-below-agreed/wf-e/README.md writes
    `offline/guards_test.js` meaning its CHECK's offline dir, one level up from itself. Walking up
    accepts all three the way a reader does. Trying only doc-dir-then-root reported the last of
    those as missing when the file was there - a false positive on the tool's first run, which is
    how a checker loses its reader.
    """
    base = os.path.dirname(os.path.abspath(doc))
    root = os.path.abspath(ROOT)
    while True:
        cand = os.path.normpath(os.path.join(base, cited))
        if os.path.exists(cand):
            return cand
        if os.path.abspath(base) == root or len(base) <= len(root):
            return None
        base = os.path.dirname(base)

def main(paths):
    missing = []
    declared = []
    checked = 0
    for doc in md_files(paths):
        text = open(doc, encoding='utf-8', errors='replace').read()
        for m in CITE.finditer(text):
            cited = m.group(1)
            checked += 1
            if resolve(doc, cited) is None:
                line = text[:m.start()].count('\n') + 1
                if declared_absent(text, m.start()):
                    declared.append((os.path.relpath(doc, ROOT), line, cited))
                else:
                    missing.append((os.path.relpath(doc, ROOT), line, cited))
    seen = set()
    for doc, line, cited in missing:
        key = (doc, cited)
        if key in seen:
            continue
        seen.add(key)
        print('  MISSING  %s:%d cites %s' % (doc, line, cited))
    shown = set()
    for doc, line, cited in declared:
        key = (doc, cited)
        if key in shown:
            continue
        shown.add(key)
        print('  absent   %s:%d cites %s - and says so' % (doc, line, cited))
    print('%d citation(s) checked, %d missing, %d declared-absent'
          % (checked, len(seen), len(shown)))
    if not seen:
        print('every cited file either exists or is declared absent')
    return 1 if seen else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
