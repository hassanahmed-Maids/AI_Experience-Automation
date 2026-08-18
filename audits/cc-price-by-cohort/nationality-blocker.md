# The nationality blocker — what we know, and what's needed

## Ruled out (probed live, 2026-08-18)

| Surface | Result |
|---|---|
| `contract/search/page` → `housemaid` | carries `id`, `label`, `travelAssist`, `liveOut` only. `nationality` **null on every sampled row** |
| `get-client-details?type=CONTRACT_DETAILS` | **no current-maid object at all**. Only `replacements[].old/newHousemaidNationality` |
| `getActiveCptInfo` → `nationality` | the **payment term's** nationality — `cptName` provably contains it. Using it would make the mismatch gate compare a value with itself |
| `/clientmgmt/housemaid/{id}` @ `ClientSummary` | `401 API_NOT_FOUND_FOR_PAGE` — route not registered for that pagecode |
| `dynamicApi getactivecccontracts` | `500 SecurityException: Access denied` — would return `maidNationality` inline; **access request filed** |

## The strongest lead: the filter already exists

`contract/search/page` accepts `housemaid.nationality` in its **request body**, so
the server can filter on maid nationality even though it never returns it.

Probed shapes:

| sent | result |
|---|---|
| `{"id": 1}` | parses cleanly, `total` 0 |
| `{"name": "Filipina"}` | `TransientObjectException: object references an unsaved transient instance` |
| `"Filipina"` (string) | JSON parse error against a `com.magnamedia.core.en…` entity |

So the parameter is a **nationality entity keyed by id**. Ids 1–12 all return 0
matches, so the real ids sit outside that range.

**What is missing is only the id lookup.** Once we have it, nationality costs
*zero* per-contract calls:

```
pull A  baseline                                → all 5,395
pull B  housemaid.nationality = {id: <Filipina>}  → Filipina set
pull C  housemaid.nationality = {id: <Ethiopian>} → Ethiopian set
pull D  includeNullNationality = true             → no-nationality set
        Other = A − B − C − D
```

Four population pulls (~60 min) instead of ~5,400 per-contract calls, and every
contract gets a cohort. This is a better architecture than the per-contract
endpoint even if we find one.

## The cheapest way to get the lookup

The generic `/admin/resource/attachment?code=<x>` route returns an **empty array
for unknown codes** rather than erroring, so it cannot be used to discover the
right code — and `housemaid_nationalities_list`, `maid_nationalities_list`,
`nationalities`, `housemaid_nationality_list`, `client_nationalities_list`,
`nationality`, `maid_nationality` all came back empty. `client_areas_list`
returns 1 row, confirming the route itself works.

**Ask:** open the ERP client list, click the maid-nationality filter dropdown,
and capture that one request — exactly like the `client_areas_list` capture. It
will name both the endpoint and the id format.

## A finding that stands regardless

`includeNullNationality: true` returns **1,072** of 5,395 active CC contracts.

Roughly **20% of the active population has no maid nationality recorded in ERP at
all.** Those contracts are unpriceable no matter which endpoint we find — there
is no cohort to price them against. Even with a perfect nationality source this
check tops out near 80% conclusive, and Stage 3 will correctly report the rest as
`pending / no_nationality` rather than clearing them.

That number should be set as the expectation before the first real run, so ~1,000
pendings are not read as a failure of the check.
