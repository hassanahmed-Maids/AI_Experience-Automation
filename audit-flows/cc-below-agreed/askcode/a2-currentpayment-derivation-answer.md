This endpoint accepts an arbitrary `startDate` and returns `suggestedAmount` from the time-parameterized computation on the ACTIVE cpt. That's directly relevant to question 5. Now I have everything. Let me verify the tier-one query's parameter binding order and re-read lines 519-531 carefully (already have). Let me also confirm whether the query filters status — it filters `p.status <> 'DELETED'` and excludes refund types, but NOT restricted to RECEIVED. I have all facts confirmed.

Let me compose the answer.

---

Answers, grounded in code. Everything below is from the `accounting` module unless noted; the bulk alias is from `reporting`.

## 1. `findCurrentMonthPaymentsInfo` — the full query

```519:531:erp_magnamedia-accounting/src/main/java/com/magnamedia/repository/PaymentRepository.java
    @Query("select p.status, p.amountOfPayment, p.typeOfPayment.name, p.methodOfPayment, p.typeOfPayment.code, " +
            "p.workerSalary, p.workerSalaryWithoutVAT, p.visaFees "+
            "from Payment p " +
            "where p.contract = ?1 and p.dateOfPayment between ?2 and ?3 and p.status <> 'DELETED' and " +
                "not exists (select 1 from PicklistItem pit join pit.tags t where pit.id = p.typeOfPayment.id and " +
                    "t.name = 'refund')  " +
            "order by case " +
                "when p.status = 'RECEIVED' then 0 " +
                "when p.status = 'PDC' then 1 " +
                "when p.status = 'BOUNCED' then 2 " +
                "when p.status = 'PRE_PDP' then 3 " +
            "else 4 end")
    List<Object[]> findCurrentMonthPaymentsInfo(Contract contract, Date d1, Date d2);
```

**Window** — `?2`/`?3` are computed by the caller, not the query. For a normal (non-credit-card) contract they are the **calendar month of `now`**:

```1521:1522:erp_magnamedia-accounting/src/main/java/com/magnamedia/service/ContractService.java
        Date startDate = new LocalDate().dayOfMonth().withMinimumValue().toDate();
        Date endDate = new LocalDate().dayOfMonth().withMaximumValue().toDate();
```

For a credit-card contract the window is the contract's own current CC payment cycle (`getCurrentPaymentDate` … `getLastDayInCurrentPayment`), per lines 1526‑1528. So it is *not* always the calendar month — it is the calendar month of `now`, except CC contracts use their billing cycle. It filters on `dateOfPayment`.

**Status filter** — only `status <> 'DELETED'`. It does **not** restrict to `RECEIVED`; PDC, BOUNCED, PRE_PDP and anything else are all included. It only sorts them (RECEIVED first).

**Type filter** — the query does **not** filter to `monthly_payment`. It returns every non-DELETED, non-`refund`-tagged payment type in the window. The narrowing to `monthly_payment` happens later in Java (see Q2).

## 2. `payments.get(0)[1]` — ordering / which row wins

Two things happen in the service before `get(0)`:

```1587:1593:erp_magnamedia-accounting/src/main/java/com/magnamedia/service/ContractService.java
            payments = payments.stream().filter(p -> p[2].equals("monthly_payment")).collect(Collectors.toList());
            Double amount = !payments.isEmpty() ?
                    (Double) payments.get(0)[1] :
                    (Double) Setup.getApplicationContext()
                            .getBean(CalculateDiscountsWithVatService.class)
                            .getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, new LocalDate())
                            .get("amount");
```

Note `p[2]` is `typeOfPayment.name` (the third selected column), so the filter is by display **name** "monthly_payment", not the code.

The **only** ordering is the `ORDER BY CASE` on status in the query — RECEIVED(0), PDC(1), BOUNCED(2), PRE_PDP(3), else(4). There is **no** `ORDER BY` on `dateOfPayment` and **no** ordering by `id`. Stream `filter` preserves that order. So `get(0)` is: *the monthly-payment row with the best status rank*. Within the same status rank (e.g. two RECEIVED rows — a split payment, or a payment + partial), the tiebreak is **undefined** — whatever order the DB returns. It is neither "latest by date" nor "highest id"; it is unordered within a status bucket.

## 3. Concrete case: CPT 4,715, client paid 2,100 as one `monthly_payment` row

`get-client-details` / `getContractDetailsCM3720` reaches this via `getContractPaymentInfo(c, true)` (line 304). With `returnAmountFromCTP = true`, when payment rows exist the code fills the `currentPayments` **list** (lines 1549‑1560) but leaves the singular `currentPayment` map empty, so `if (currentPayment.isEmpty())` at line 1586 is **true** and the tier-one branch runs.

That single RECEIVED `monthly_payment` row of 2,100 becomes `payments.get(0)`, and:

```1595:1596:erp_magnamedia-accounting/src/main/java/com/magnamedia/service/ContractService.java
            currentPayment.put("amount", "AED " + String.format("%,.0f", amount));
            currentPayment.put("amountValue", amount);
```

**`currentPayment.amountValue` returns 2,100, not 4,715.** Plainly: it returns what the client paid. Your audit would compare 2,100 against 2,100 and clear a contract that is 2,615 short. `currentPayment.amountValue` is **not** a safe source for the expected/agreed amount — it is payment-derived whenever any non-deleted monthly_payment row exists in the window. The agreed CPT amount is only returned in the fallback, when there are **no** monthly_payment rows at all.

## 4. `getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, LocalDate)` — is it the agreed amount?

```323:367:erp_magnamedia-accounting/src/main/java/com/magnamedia/service/CalculateDiscountsWithVatService.java
    public Map<String, Object> getAmountOfMonthlyPaymentAtTimeWithDiscounts(ContractPaymentTerm cpt, LocalDate date, boolean useDateWithOMA, Map<String, Object> map) {
        ...
        double monthlyPaymentAmount = premium ? getMonthlyPayment(cpt, date.toDate()) : getDiscountedMonthlyPayment(cpt, date.toDate());
        m.put("amount", monthlyPaymentAmount);
        ...
        m.putAll(applyAdditionalDiscountAndCreditNoteOnAmount(cpt, date, (Double) m.get("amount")));
        return m;
    }
```

This is **purely CPT-driven — it never reads the `PAYMENTS` table.** It computes from `cpt.getMonthlyPaymentType().getAmount()` (line 302‑305), subtracts discount if past the premium period, applies add-ons, prorating, additional-discount and credit-note. So yes — it is the correct way to obtain the **agreed** amount independent of payment rows.

- **Map keys**: `amount`, `affectedByAdditionalDiscount`, `additionalDiscountAmountPerPayment`, `includeWorkerSalary`, `workerSalary`, `discountAmount`, plus (via `applyAdditionalDiscountAndCreditNoteOnAmount`) additional-discount and credit-note keys such as `additionalDiscountAmountPerPayment` / `moreAdditionalDiscount`. `"amount"` is the one you want.
- **VAT**: the base `getAmount()` is **VAT-inclusive**; the code elsewhere derives `amountWithoutVat` by dividing VAT *out* (`DiscountsWithVatHelper.getAmountWithoutVat`, lines 974‑976), which only makes sense if `amount` is VAT-inclusive. So `"amount"` is VAT-inclusive and discount-adjusted.
- **The `date` and premium logic work** for an arbitrary past date: `isDuringPremiumPeriod(cpt, date)` and the prorating check both branch on the passed date. So passing `2026-07-01` will reflect discount state as of July.

**Important caveat for "arbitrary past month" and mid-window rate change.** The method operates on the `ContractPaymentTerm` object you hand it. Its rate comes from `cpt.getMonthlyPaymentType().getAmount()` — a **current** field on that CPT, not a date-versioned lookup. The `date` parameter drives *discount/premium/prorating* selection, **not** which CPT amount is in force. If the monthly rate itself changed via a new CPT (a `ChangeCptRequest`), the amount picked is that of whichever CPT you pass. Callers pass `contract.getActiveContractPaymentTerm()` (the newest active one), so asking "what was owed in July 2026" while the active CPT now holds a September rate will return the **September** rate with July's discount rules — it does **not** reconstruct the CPT/term that was in force on 2026-07-01. To get a true historical agreed amount you must pass the CPT that was active that month, and even then the base `AMOUNT` is a live field. The date-in-force selection of the *rate* is not handled here.

## 5. Is the time-parameterized computation exposed over HTTP for a single contract?

Two exposures exist:

- **`/contract/getContractDetailsCM3720/{id}`** (permission `contract/getContractDetailsCM3720`) — always uses `new LocalDate()` (lines 1572, 1592), so only "today", and only via the payment-first fallback path. Not usable for "what was owed in July".

- **`GET /ContractPaymentTerm/getnewddInfo`** (permission `ContractPaymentTerm/getNewDDInfo`) — this one **does** accept an arbitrary date:

```264:289:erp_magnamedia-accounting/src/main/java/com/magnamedia/controller/ContractPaymentTermController.java
    @PreAuthorize("hasPermission('ContractPaymentTerm','getNewDDInfo')")
    @RequestMapping(value = "/getnewddInfo", method = RequestMethod.GET)
    public Map getNewDDInfo(
            @RequestParam Long contractId,
            @RequestParam(name = "startDate", required = false) String startDateStr) {
        ...
        result.put("suggestedAmount", calculateDiscountsWithVatService.getAmountOfMonthlyPaymentAtTimeWithDiscounts(contractPaymentTerm, new LocalDate(startDate)).get("amount"));
```

Its `suggestedAmount` is exactly the agreed, payment-independent, VAT-inclusive, discount-adjusted amount for the date you pass, on the **active** CPT. This is the closest existing single-contract endpoint to "what was owed on contract X in July" — subject to the same mid-window caveat in Q4 (it uses `getActiveContractPaymentTerm()`, line 279). It's designed for the new-DD form, but the value it returns is the agreed monthly amount at that date.

The underlying service method is `CalculateDiscountsWithVatService.getAmountOfMonthlyPaymentAtTimeWithDiscounts(ContractPaymentTerm, LocalDate)`. If `getnewddInfo` doesn't fit (e.g. you want the historical CPT rather than the active one), a thin controller over that service method — and over `contractRepository.findX` to pick the right CPT — would be a **Java change**. There is no low-code/dynamic-API exposure of it.

## 6. Bulk path — the `'monthlyPayment'` alias (reporting, lines 3849 / 3940)

```3849:3849:erp_magnamedia-reporting/src/main/java/com/magnamedia/repository/ContractRepository.java
            "    IF(PROS.CODE = 'maids.cc_prospect' , lastMonthlyDD.amount, IF(lastMonthlyDD.amount is not null, lastMonthlyDD.amount, cptType.AMOUNT-cptType.DISCOUNT)) as 'monthlyPayment', " +
```

`lastMonthlyDD` is **not** a payment — it's a `DIRECTDEBITS` row (a scheduled direct-debit *instruction*), joined here:

```3883:3891:erp_magnamedia-reporting/src/main/java/com/magnamedia/repository/ContractRepository.java
            "  LEFT JOIN DIRECTDEBITS lastMonthlyDD ON lastMonthlyDD.id = (SELECT  d.id FROM DIRECTDEBITS d  " +
                    "       WHERE (  " +
                    "  d.CONTRACT_PAYMENT_TERM_ID in(select cpt.id from CONTRACTPAYMENTTERMS cpt where cpt.CONTRACT_ID = C.id)  " +
                    "  AND d.TYPE = 'MONTHLY' " +
                    "        AND (d.STATUS IN ('CONFIRMED' , 'PENDING')  " +
                    "         OR   " +
                    "        d.id IN (SELECT r.id FROM DIRECTDEBITS_REVISIONS r   " +
                    "          WHERE r.id = d.id AND r.STATUS = 'CONFIRMED')))  " +
                    "       ORDER BY d.CREATION_DATE DESC LIMIT 1)  " +
```

So the alias resolves as: latest CONFIRMED/PENDING **monthly DD instruction amount**, else `cptType.AMOUNT - cptType.DISCOUNT` (the CPT monthly-payment type row, via the join at line 3882). It is **not** derived from the `PAYMENTS` table / actual collections — a DD is the *scheduled/agreed* debit, not what was received. `monthlyReceivedAmount` (line 3856) is the separate column that sums actually-received payments.

So this alias is *closer* to "agreed" than `currentPayment.amountValue`, but it is still **not clean**: the first tier is the direct-debit *instruction* amount, which can differ from the contractual CPT figure (e.g. a one-off adjusted DD, or an old DD that predates a rate change). Only the second tier (`cptType.AMOUNT - cptType.DISCOUNT`) is the pure CPT-agreed figure, and it is a raw column subtraction — it does **not** apply the premium-period logic, add-ons, additional-discount or credit-note that Q4's service method applies.

**A source of the agreed amount that is never contaminated by collections:** use the CPT figure directly — the `cptType.AMOUNT - cptType.DISCOUNT` expression in SQL (bulk), or `CalculateDiscountsWithVatService.getCPTAmountAtTime(cpt, date)` / `getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, date)` in Java (single, and the more accurate of the two because it applies premium/add-on/credit-note rules). Neither of these reads `PAYMENTS`. Avoid `currentPayment.amountValue` and avoid relying on the `lastMonthlyDD` tier of the reporting alias if you need a strictly contractual figure.

---

### Bottom line for your audit
- `currentPayment.amountValue` is payment-first: in your 2,100-vs-4,715 example it returns **2,100**, so the audit is circular. Do not use it as the expected amount.
- The uncontaminated agreed amount is the CPT computation: `getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, date)` (single, VAT-inclusive, discount-adjusted) or `cptType.AMOUNT - cptType.DISCOUNT` (bulk, raw).
- For a specific past month, `getnewddInfo?contractId=&startDate=` exposes the agreed amount over HTTP today, but on the **active** CPT only; true historical-rate reconstruction (CPT-in-force at that date) is not implemented and would need a Java change.

Two behaviors I could not fully verify from the visible modules: the exact tiebreak the DB returns for two same-status monthly_payment rows (DB-dependent, no `ORDER BY`), and whether `isPayingViaCreditCard`/OMA branches change the CC-cycle window in ways defined outside these three modules (the `OneMonthAgreementFlowService` methods are here, but their upstream config is not).