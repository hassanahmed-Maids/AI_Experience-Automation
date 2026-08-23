#!/usr/bin/env python3
"""Guard MANIFEST.json against the INSTANCE, not against the exports directory.

WHY THIS EXISTS. MANIFEST.json stops `erp_compliance.py --all` reporting success over a subset of
exports/. Nothing stopped the manifest itself being a subset of the instance, and on 2026-08-23
that happened three times in one day:

  1. --all went green over 16 flows because the exports directory held 16. The manifest fixed that.
  2. The manifest was built from the `audit: *` tag set, and three flows were untagged - one of
     them live, and the worst-paced flow in the estate.
  3. The resulting fix list was built from "everything with an ERP node in it" and swept in a
     pre-existing working check the programme was never meant to touch.

Every one of those was the same mistake: a list built from something narrower than reality, then
trusted as reality. So this tool does not maintain a list of interesting flows. It requires a
disposition for EVERY workflow in the instance - a total function - and fails when one is missing,
stale, or disagrees with the manifest. A new workflow cannot slip past by not being interesting.

    python3 tools/manifest_vs_instance.py

Inputs, all in exports/:
    instance-listing.json   what the instance contains. Refresh from the n8n MCP:
                            search_workflows(limit 200, sortBy updatedAt:desc)
    instance-register.json  one disposition per listed workflow
    MANIFEST.json           the flows erp_compliance.py --all must audit

Exit 1 on any failure. Warnings do not fail the run but are always printed.
"""
import json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORTS = os.path.join(os.path.dirname(HERE), 'exports')

def load(name):
    p = os.path.join(EXPORTS, name)
    if not os.path.exists(p):
        raise SystemExit('missing %s - see this file\'s docstring for how to produce it' % name)
    return json.load(open(p, encoding='utf-8'))

def main():
    listing = load('instance-listing.json')
    register = load('instance-register.json')
    manifest = load('MANIFEST.json')

    inst = {w['id']: w for w in listing['workflows']}
    reg = {r['id']: r for r in register['rows']}
    man = {f['id']: f for f in manifest['flows']}

    fails, warns = [], []

    # 1. TOTALITY. Every workflow in the instance has a disposition. This is the whole point: an
    #    unlisted flow is exactly the shape of the three misses above.
    for i, w in inst.items():
        if i not in reg:
            fails.append('NO DISPOSITION for %s "%s" (active=%s). It exists in the instance and '
                         'nobody has said what it is. Add a row to instance-register.json - and if '
                         'it is an ERP-touching check the programme should cover, add it to '
                         'MANIFEST.json too.' % (i, w['name'], w['active']))

    # 2. The register must not outlive the instance either - a row for a workflow that is gone is
    #    a claim about something that no longer exists.
    for i, r in reg.items():
        if i not in inst:
            warns.append('register row for %s "%s" is not in the instance listing any more - '
                         'archived or deleted. Drop the row once that is confirmed.'
                         % (i, r.get('name')))

    # 3. FRESHNESS. A disposition was a judgement about a specific version of a flow. If the flow
    #    changed, the judgement is unproven again: a reporting workflow can grow an ERP node.
    for i, r in reg.items():
        w = inst.get(i)
        if w and w['updatedAt'] != r.get('judged_at_updatedAt'):
            fails.append('STALE DISPOSITION for %s "%s": judged at %s, instance now says %s. It '
                         'changed since it was classified - re-judge it and update the row. A '
                         'workflow that had no ERP surface last month may have one now.'
                         % (i, w['name'], r.get('judged_at_updatedAt'), w['updatedAt']))

    # 4. Both directions between the register and the manifest. A manifest entry nobody dispositioned
    #    and a disposition of "in-manifest" that is not in the manifest are the same bug seen from
    #    two ends, and checking one direction only is how the earlier gaps survived.
    for i, r in reg.items():
        if r.get('disposition') == 'in-manifest' and i not in man:
            fails.append('%s "%s" is dispositioned in-manifest but MANIFEST.json does not list it.'
                         % (i, r.get('name')))
    for i, f in man.items():
        if i not in reg:
            fails.append('MANIFEST.json lists %s "%s" but the register has no row for it.'
                         % (i, f.get('name')))
        elif reg[i].get('disposition') != 'in-manifest':
            fails.append('MANIFEST.json lists %s "%s" but the register dispositions it as "%s".'
                         % (i, f.get('name'), reg[i].get('disposition')))

    # 5. THE TRACKER RULE. A flow the skill built, that reaches ERP, must be in MANIFEST.json so
    #    erp_compliance.py --all audits it forever. This is what makes "which flows did the skill
    #    produce" a rule that breaks the build rather than a list someone maintains out of
    #    diligence - and it is the check that would have caught the five skill-built flows found
    #    sitting outside the programme on 2026-08-23.
    #    A skill-built ERP flow may legitimately not belong in the manifest - a throwaway probe
    #    marked "delete after use" should be DELETED, not paced and audited forever. So the rule
    #    is satisfied by the manifest OR by an explicit `manifest_exempt` reason. What it will
    #    not accept is SILENCE, which is the state all five missed flows were in.
    exempt_used = []
    for i, r in reg.items():
        if r.get('skill_built') != 'yes' or r.get('erp') != 'yes' or i in man:
            continue
        why = (r.get('manifest_exempt') or '').strip()
        if why:
            exempt_used.append((r, why))
            continue
        fails.append('%s "%s"%s was BUILT BY THE SKILL and reaches ERP, but MANIFEST.json does '
                     'not list it and it carries no manifest_exempt reason - so nothing audits it '
                     'and nobody has decided that is right. Add it to the manifest, or write a '
                     'manifest_exempt reason saying why the rule does not apply.'
                     % (i, r.get('name'), ' [ACTIVE]' if r.get('active') else ''))
    if exempt_used:
        by_reason = collections.Counter(w.split('.')[0] for _, w in exempt_used)
        warns.append('%d skill-built ERP flow(s) are exempt from the manifest by an explicit '
                     'recorded reason, not by silence: %s' %
                     (len(exempt_used), '; '.join('%s (%d)' % (k, v) for k, v in by_reason.items())))
        pend = [r for r, _ in exempt_used if r.get('disposition') == 'delete-me']
        if pend:
            warns.append('%d of those are marked DELETE-ME: throwaway probes still sitting in the '
                         'instance with ERP credentials wired in. Deleting them is the fix, and '
                         'until someone does, this line will keep saying so: %s'
                         % (len(pend), ', '.join(r['name'] for r in pend)))

    # ---- warnings: the residual, stated as a number rather than left as a feeling -------------
    unknown_prov = [r for r in reg.values() if r.get('skill_built') == 'unverified']
    if unknown_prov:
        warns.append('%d workflow(s) have UNVERIFIED provenance - nobody has opened the payload to '
                     'see whether the skill built them. The tracker rule above cannot fire on any '
                     'of them, so this number is the size of the blind spot, not a formality. '
                     'Resolve with a provenance sweep (meta.aiBuilderAssisted).' % len(unknown_prov))

    unverified = [r for r in reg.values()
                  if r.get('erp') in ('yes', 'unknown') and not r.get('erp_verified_from_export')]
    if unverified:
        warns.append('%d disposition(s) judge ERP contact from the NAME AND DESCRIPTION, not from '
                     'the workflow JSON. That is weaker evidence and it is counted here rather '
                     'than hidden. Verify one by exporting it and re-reading.' % len(unverified))
    # THE SHARPEST CLASS. The skill built these, so the policy is the standard they were meant to
    # meet - unlike a 2025 production workflow, which never was. Named individually, because
    # "5 flows" is a number someone can ignore and a list of names is not.
    skill_out = sorted([r for r in reg.values()
                        if r.get('disposition') == 'skill-built-outside-programme'
                        and r.get('erp') == 'yes'],
                       key=lambda r: (not r['active'], r['name']))
    if skill_out:
        warns.append('%d flow(s) BUILT BY THIS SKILL reach ERP and are outside the six-check '
                     'programme, so nothing has brought them to ERP-LOAD-POLICY.md: %s'
                     % (len(skill_out),
                        '; '.join('%s (%s)' % (r['name'], 'ACTIVE' if r['active'] else 'draft')
                                  for r in skill_out)))

    erp_outside = sorted([r for r in reg.values()
                          if r.get('disposition') == 'out-of-programme-erp-audit'],
                         key=lambda r: (not r['active'], r['name']))
    if erp_outside:
        live = [r for r in erp_outside if r['active']]
        warns.append('%d ERP-touching audit check(s) exist OUTSIDE the six-check programme, %d of '
                     'them active. ERP-LOAD-POLICY.md has never been applied to any of them, so '
                     'the lease they do not take and the pacing they do not honour are real - they '
                     'are simply not this programme\'s scope. Live ones: %s'
                     % (len(erp_outside), len(live), ', '.join(r['name'] for r in live) or 'none'))

    # ---- report -------------------------------------------------------------------------------
    counts = collections.Counter(r.get('disposition') for r in reg.values())
    print('instance: %d workflow(s)   register: %d row(s)   manifest: %d flow(s)'
          % (len(inst), len(reg), len(man)))
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print('  %-28s %3d' % (k, v))
    print()
    for w in warns:
        print('warn ' + w)
    for f in fails:
        print('FAIL ' + f)
    print()
    if fails:
        print('%d failure(s): the manifest and the instance disagree.' % len(fails))
        return 1
    print('every workflow in the instance has a current disposition, and the manifest agrees '
          'with it in both directions.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
