#!/usr/bin/env python3
"""Re-generate every embedded breaker block in the repo from the canonical file.

WHY THIS EXISTS. The block is generated rather than hand-copied so a drifted copy is a finding
instead of an opinion (ERP-LOAD-POLICY.md section 5). But that only holds if re-generating is
EASIER than editing in place - otherwise the first time the canonical changes, someone patches
the four copies by hand and the guarantee is gone. On 2026-08-22 the canonical classifier had a
real bug fixed in it and four embeds needed the same update; this script is what made that a
mechanical step.

Each embed carries the exact command that produced it on its "Re-generate with:" line, so the
call site and source node are read back out of the file rather than kept in a list here that
could fall out of step with the files it describes.

    python3 tools/regen_breaker_embeds.py [--check]

--check reports what WOULD change and exits non-zero, for use before publishing.
"""
import os, re, subprocess, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BEGIN = '// ===================== ERP CIRCUIT BREAKER'
END = '// =================== END ERP CIRCUIT BREAKER'
CMD = re.compile(r'Re-generate with: python3 \S*build_breaker_embed\.py (.+)')

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
        args = [a.strip('"') for a in re.findall(r'--\S+|"[^"]*"|\S+', m.group(1))]
        block = generate(args)
        i, j = src.index(BEGIN), src.index(END)
        j = src.index('\n', j) if '\n' in src[j:] else len(src)
        new = src[:i] + block + src[j:]
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
