#!/usr/bin/env python3
"""Generate a breaker block with a FLOW-SPECIFIC call site.

build_breaker_embed.py ships five call sites written for the flows that needed them, and its
--call-site text names WF-E's nodes. Pasting one of those into a different flow leaves a comment
describing work that flow does not do - which is how a reader learns to stop trusting the
comments. tools/erp_compliance.py compares only the CORE (everything between
`const ERP_BREAKER_DEFAULTS` and `// --- call site`), so the call site is free to be honest.

  python3 tools/make_breaker_block.py --source-node "Expand Maids" --call-site-file site.js
"""
import subprocess, sys, os, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
END = '// =================== END ERP CIRCUIT BREAKER ==================='

ap = argparse.ArgumentParser()
ap.add_argument('--source-node', required=True)
ap.add_argument('--call-site-file', required=True)
a = ap.parse_args()

gen = subprocess.run([sys.executable, os.path.join(HERE, 'build_breaker_embed.py'),
                      '--call-site', 'plan', '--source-node', a.source_node],
                     capture_output=True, text=True, check=True).stdout
head = gen[:gen.index('// --- call site')]
site = open(a.call_site_file, encoding='utf-8').read().rstrip('\n')
sys.stdout.write(head + site + '\n' + END + '\n')
