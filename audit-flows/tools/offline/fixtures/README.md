# Graph fixtures

Flow graphs transcribed from live n8n workflows for checking §4 (the lease) when the full export
is impractical to capture. They carry **every field `erp_compliance.py` reads for §4** — node
names, types, `onError`, connections, lease-node parameters, and the jsCode of any node on an
error rail — and nothing else.

They live here rather than in `exports/` on purpose: a partial file in `exports/` would be picked
up by `--all` and report a clean §1/§2/§5 for sections it does not actually contain the data to
check. A fixture that looks like an export is the silent blind spot this whole tool exists to
avoid.
