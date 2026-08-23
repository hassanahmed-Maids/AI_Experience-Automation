#!/usr/bin/env python3
"""Re-generate every embedded breaker block in the repo from the canonical file.

WHY THIS EXISTS. The block is generated rather than hand-copied so a drifted copy is a finding
instead of an opinion (ERP-LOAD-POLICY.md section 5). But that only holds if re-generating is
EASIER than editing in place - otherwise the first time the canonical changes, someone patches
the four copies by hand and the guarantee is gone. On 2026-08-22 the canonical classifier had a
real bug fixed in it and four embeds needed the same update; this script is what made that a
mechanical step.

Each embed carries the exact command that produced it on its "Re-generate with:" line, so the
source node is read back out of the file rather than kept in a list here that could fall out of
step with the files it describes.

ONLY THE CORE IS REGENERATED - the call site is left exactly as it is. The core is the part
erp_compliance.py byte-compares and the part a canonical fix has to reach; the call site is
per-flow prose that says what THIS batch is, which of the three thresholds can actually fire
here, and what a trip saves. Regenerating the whole block would overwrite all of that with
WF-E's, which is worse than not regenerating at all: it replaces true statements about one flow
with false statements borrowed from another, in the exact comments a reader trusts most. That
nearly happened on 2026-08-23, when ten embeds with hand-written call sites were reported as
"would change" - they had not drifted, the tool was proposing to damage them.

    python3 tools/regen_breaker_embeds.py [--check]

--check reports what WOULD change and exits non-zero, for use before publishing.
"""
import os, re, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BEGIN = '// ===================== ERP CIRCUIT BREAKER'
END = '// =================== END ERP CIRCUIT BREAKER'
# The directive may be wrapped across continuation lines by someone tidying comment width. Read
# the continuations too: on 2026-08-23 a wrapped `--source-node` was silently cut off, the tool
# regenerated four embeds against the DEFAULT source node, and reported drift on four files that
# had not drifted. A half-read directive is worse than an unreadable one, because it still
# produces output.
CMD = re.compile(r'Re-generate with: python3 \S*build_breaker_embed\.py (.+(?:\n//\s+--\S.*)*)')

def generate(args):
    out = subprocess.run([sys.executable, os.path.join(HERE, 'build_breaker_embed.py')] + args,
                         capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit('generator failed for ' + ' '.join(args) + ':\n' + out.stderr)
    return out.stdout.rstrip()

def main(check):
    changed, seen = [], 0
    for path in sorted(glob.glob(os.path.join(ROOT, '**', '*.js'), recursive=True)):
        if os.path.join(ROOT, 'tools') + os.sep in path:
            continue
        src = open(path, encoding='utf-8').read()
        if BEGIN not in src:
            continue
        seen += 1
        m = CMD.search(src)
        if not m:
            raise SystemExit(path + ' carries a breaker block but no "Re-generate with:" line, so '
                             'nobody can tell which call site it was built for. Re-generate it.')
        # shlex would strip the quotes we need to pass through intact.
        directive = re.sub(r'\n//\s+', ' ', m.group(1))
        args = [a.strip('"') for a in re.findall(r'--\S+|"[^"]*"|\S+', directive)]
        # A block whose guard names a node the directive does not is a directive that cannot
        # reproduce its own file. Say so rather than regenerating against the wrong source.
        guard = re.search(r"function erpBreakerGuard\(opts\) \{\s*\n\s*const src = \$\('([^']+)'\)", src)
        if guard and '--source-node' not in args and guard.group(1) != 'Read Chunk':
            raise SystemExit(path + ': the guard reads $(\'' + guard.group(1) + "') but the "
                             'Re-generate line passes no --source-node, so it does not reproduce '
                             'this file. Fix the directive before regenerating.')
        block = generate(args)
        # Splice the CORE only: everything from the first const up to the call-site marker.
        # Both the generated block and the file are cut at the same landmark, so the file keeps
        # its own header, its own call site and its own trailing code.
        CORE_START, SITE = 'const ERP_BREAKER_DEFAULTS', '// --- call site'
        try:
            gen_core = block[block.index(CORE_START):block.index(SITE)]
        except ValueError:
            raise SystemExit('the generator no longer emits the landmarks this splice needs')
        seg = src[src.index(BEGIN):src.index(END)]
        try:
            a = src.index(BEGIN) + seg.index(CORE_START)
            b = src.index(BEGIN) + seg.index(SITE)
        except ValueError:
            raise SystemExit(path + ' has a breaker block whose landmarks were edited, so the core '
                             'cannot be located. Re-generate it from scratch.')
        new = src[:a] + gen_core + src[b:]
        rel = os.path.relpath(path, ROOT)
        if new != src:
            changed.append(rel)
            if not check:
                open(path, 'w', encoding='utf-8').write(new)
    print('%d embed(s) scanned, %d %s' % (seen, len(changed),
          'would change' if check else 'regenerated'))
    for c in changed:
        print('  ' + c)
    return 1 if (check and changed) else 0

if __name__ == '__main__':
    sys.exit(main('--check' in sys.argv[1:]))
