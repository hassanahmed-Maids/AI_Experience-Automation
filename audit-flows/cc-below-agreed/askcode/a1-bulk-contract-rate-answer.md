Those CSV exports are maintenance jobs (isInitial/includeWorkerSalary), not monthly amount, and are emailed. I have thoroughly investigated all three modules. Let me compile the answer.

## Summary

**Modules this session can actually see** (symlinks in the workspace): `erp_magnamedia-accounting`, `erp_magnamedia-client-management`, `erp_magnamedia-reporting`. I could NOT see: sales, logistics, or any core/framework module (e.g. `com.magnamedia.core`), and the Enchanter/sales/DD-confirmation services are reached only via cross-module HTTP calls. My "does/doesn't exist" claims below are scoped to these three modules.

Your two live observations are confirmed by the code.

---

### 1. Which entity/column stores the agreed monthly payment, and how `currentPayment` is computed

**`currentPayment` is NOT a stored column. It is computed at request time.** There is no `currentPayment` field on any entity — it's a `HashMap` assembled in the accounting module.

The underlying stored amount lives on the **`ContractPaymentType`** row (the monthly-payment line of the active `ContractPaymentTerm`). The column is inherited from its mapped superclass:

```66:67:erp_magnamedia-accounting/src/main/java/com/magnamedia/entity/AbstractPaymentTypeConfig.java
    @Column(nullable = false)
    private double amount;
```

`ContractPaymentType extends AbstractPaymentTypeConfig` and adds the CPT link:

```22:27:erp_magnamedia-accounting/src/main/java/com/magnamedia/entity/ContractPaymentType.java
@Entity
public class ContractPaymentType extends AbstractPaymentTypeConfig {

    @ManyToOne(fetch = FetchType.LAZY)
    @JsonSerialize(using = IdLabelSerializer.class)
    private ContractPaymentTerm contractPaymentTerm;
```

Note `ContractPaymentTerm` does **not** store a `monthlyPayment` column — it stores `firstMonthPayment` (`ContractPaymentTerm.java:63`), and `getMonthlyPayment()`/`getMonthlyPaymentType()` are computed/`@JsonIgnore` helpers (`ContractPaymentTerm.java:685`).

**Derivation path for `currentPayment`** (`get-client-details` → CONTRACT_DETAILS):

1. `ClientController.getClientDetails(...)` CONTRACT_DETAILS case calls the accounting module over HTTP and merges the map:

```2779:2782:erp_magnamedia-client-management/src/main/java/com/magnamedia/controller/ClientController.java
                    Map accInfo = modulesConnector.get(ClientManagementModule.ACCOUNTING_MODULE_URL + "/contract/getContractDetailsCM3720/" + contract.getId() + "?sectionName=SEC_3_1",Map.class);
                    if(accInfo == null)accInfo = new HashMap();
                    response.putAll(accInfo);
```

2. In accounting, `ContractService.getContractDetailsCM3720Sec_3_1(...)` puts `currentPayment`:

```303:306:erp_magnamedia-accounting/src/main/java/com/magnamedia/service/ContractService.java
        // current payments
        Map<String, Object> paymentInfo = getContractPaymentInfo(c, true);
        r.put("currentPayments", paymentInfo.get("currentPayments"));
        r.put("currentPayment", paymentInfo.get("currentPayment"));
```

3. `getContractPaymentInfo(...)` computes it with a **two-tier fallback**:
   - **Preferred: the latest actual payment row** for the current month, via `paymentRepository.findCurrentMonthPaymentsInfo(...)` (returns `p.amountOfPayment` from the `Payment` entity), filtered to `monthly_payment` (`ContractService.java:1544`, `:1587-1589`).
   - **Fallback (no payment rows): computed from the CPT**, via `CalculateDiscountsWithVatService.getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, now).get("amount")` — i.e. the `ContractPaymentType.amount` minus discounts/VAT logic (`ContractService.java:1569-1573`, `:1590-1593`).

```1569:1593:erp_magnamedia-accounting/src/main/java/com/magnamedia/service/ContractService.java
                Double amount = type != null ?
                        (Double) Setup.getApplicationContext()
                                .getBean(CalculateDiscountsWithVatService.class)
                                .getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, new LocalDate())
                                .get("amount") : 0D;
                ...
            Double amount = !payments.isEmpty() ?
                    (Double) payments.get(0)[1] :
                    (Double) Setup.getApplicationContext()
                            .getBean(CalculateDiscountsWithVatService.class)
                            .getAmountOfMonthlyPaymentAtTimeWithDiscounts(cpt, new LocalDate())
                            .get("amount");
```

So: **stored source column = `CONTRACTPAYMENTTYPES.AMOUNT` (`AbstractPaymentTypeConfig.amount`) on the active CPT's monthly line; runtime value = latest `Payment.amountOfPayment` if a current-month monthly payment exists, else the discounted CPT amount.** One contract per call.

---

### 2. Every controller endpoint returning the monthly amount for a LIST/PAGE of contracts

**In the three modules I can see, exactly one live endpoint returns contractId + monthly amount for many contracts in one call:**

- **HTTP method / path:** `GET /bytable/PaymentsReport`
- **Controller:** `ByTableController.getReport(...)` (`ByTableController.java:75` dispatch, `:908-909` for `PaymentsReport`)
- **Permission/pagecode:** **none** — the `@GetMapping("/{reportname}")` has no `@PreAuthorize` (`ByTableController.java:75-84`). Output is a Jasper render (`?format=pdf|html|excel`), not JSON.
- **Request DTO:** none (path variable `reportname` + query params `format`, `before`, `duration`, `isNow`, `hourOfTheDay`).
- **Response field carrying the amount:** `monthlyPaymentAmount` on `PaymentsReportWrapper` (`PaymentsReportWrapper.java:13`, populated from the SQL alias `'monthlyPayment'`).

That report's rows come from the reporting `ContractRepository` bulk native queries returning `PaymentReportWrapperInterface` with `getContractId()` + `getMonthlyPayment()` for all contracts in a date window:

```4022:4030:erp_magnamedia-reporting/src/main/java/com/magnamedia/repository/ContractRepository.java
    public static interface PaymentReportWrapperInterface {
        Long getContractId();
        String getClientName();
        ...
        Double getMonthlyPayment();
```
(methods `getPaymentsReportInfo` / `getPaymentsReportInfoNotPaid`, `ContractRepository.java:3927`, `:4018`; the `'monthlyPayment'` alias at `:3849` / `:3940` uses the same "last confirmed monthly DD amount, else CPT AMOUNT − DISCOUNT" logic).

**Endpoints that do NOT carry it (so you're not misled):**
- `POST /clientmgmt/contract/search/page` (`ContractController.all`, permission `contract:all`) — see Q3.
- A JSON `ReportingController` endpoint that ran the same PaymentsReport SQL **exists but is commented out** (`ReportingController.java:~1520-1585`, the block closes with `*/` at line 1585) — so it's not live.
- The client-management CSV exports using `PaymentsReportCsvProjection` (`ContractController.java:1642`, `:1712`) only export `id`, `isInitial`, `includeWorkerSalary` — **no monthly amount** — and are emailed, not returned.

---

### 3. The DTO returned by `POST /clientmgmt/contract/search/page`

The row DTO is the inner interface **`ContractController.ContractSearchProjection`** (`ContractController.java:991-1034`), applied at `:1309`/`:1313` via `projectionFactory.createProjection(ContractSearchProjection.class, obj)`. It matches your observed field list and carries **no monthly fee**:

```991:1033:erp_magnamedia-client-management/src/main/java/com/magnamedia/controller/ContractController.java
    private interface ContractSearchProjection {
        long getId();
        ...
        Map<?, ?> getClient();
        Map<?, ?> getHousemaid();
        Map<?, ?> getContractProspectType();
        public Integer getClientComplaints();
        public Integer getClientReplacments();
        public Integer getMaidComplaints();
        public boolean isDeletedFromApp();
        Date getDateOfTermination();
        boolean isLiveOut();
        Double getWorkerSalaryMonthlyTip();
        boolean isLongTermPackage();
        Boolean getVisaRenewalDeclined();
    }
```

**Can it be made to carry the monthly amount?**
- **`extraFilters` / query params: No.** `search.appendExtraFilters(query)` (`ContractController.java:1233-1234`) and all the query params only add WHERE filters to `SelectQuery<Contract>`; they never change the projection or select list. There is no column-widening parameter.
- **Projection: Yes, with a Java change.** `ContractSearchProjection` is a Spring `@Value`/SpEL open projection over `target` (the `Contract` entity). You could add e.g. `@Value("#{target.getActiveContractPaymentTerm().getMonthlyPaymentType()?.getAmount()}") Double getMonthlyPayment();`. But that (a) requires editing the interface (a Java change + redeploy) and (b) would trigger a lazy CPT/CPT-type load per row (N+1 across the 40-row page), and it would return the raw CPT `amount`, not the discount/VAT-adjusted or last-DD value that `currentPayment` uses. So it is not achievable purely via request payload today.

---

### 4. Is there a reporting/low-code bulk endpoint already exposing contractId + monthly payment?

- **Reporting (Jasper), yes:** `GET /bytable/PaymentsReport` (see Q2) — bulk, paged-by-date-window, exportable to Excel/PDF/HTML, **no permission annotation**. This is the only already-existing bulk exposure of monthly payment I can find.
- **Low-code dynamic API: not usable for this.** The candidates are all either disabled or not data-return endpoints:
  - `AdHocController` (`/adhoc`, native-SQL runner with CSV/PDF export and `report:execute`/`report:exportcsv` permissions) is **entirely commented out** (`AdHocController.java:48-233`) — disabled.
  - `DynamicJasperController` (`/example`) and `CSVDynamicJasperController` (`/CSVexample`) are **fully commented out**.
  - The **Alert system** (`AlertController`, `/alerts`) is a genuine low-code engine that stores arbitrary native SQL (`POST /alerts/create/query`, permission `alerts:create`) and executes it via `NativeQueryExecutor`. But results are emailed/logged by the scheduled `AlertExecutionService`; there is **no endpoint that returns the query rows to the API caller** (`/alerts/test-execute-alert/{id}` only triggers a run). So it can compute contractId+monthly payment in bulk, but not serve it back through the API as data.
  - `ReportingPublicApisController` (`/publicApi`) is a **registry/metadata manager** of public APIs, not a query executor.

---

### 5. If nothing suitable exists, what would need to be added

A JSON bulk endpoint does not exist live today (the one that did is commented out in `ReportingController`). Minimal options:

- **Reuse the existing repository method (no new query needed):** `ContractRepository.getPaymentsReportInfo(from, to)` / `getPaymentsReportInfoNotPaid(from, to)` already return `contractId` + `monthlyPayment` in bulk (`ContractRepository.java:3927`, `:4018`). You'd only need to **add a thin JSON controller endpoint** (and a `@PreAuthorize`) that returns `List<PaymentReportWrapperInterface>` — essentially un-commenting/replacing the disabled block near `ReportingController.java:1520-1585`. This is a Java change + redeploy.
- **If you want it keyed purely by contract id (not a date window):** you'd add a new repository method, e.g. a native/JPQL query selecting `c.id` and the monthly amount using the same "latest confirmed monthly DD amount, else `cptType.AMOUNT - cptType.DISCOUNT`" expression already in `ContractRepository` (lines 3849/3940), accepting `List<Long> contractIds`. Again a Java change.
- **Could a low-code dynamic API expose it without a Java change?** Only through the **Alert system** — you can author the SQL via `POST /alerts/create/query` with no code change — but because the alert engine delivers output by email/log rather than an API response, it does **not** give you a synchronous "call once, get many contracts' monthly payment back" API. So: **no true no-code data endpoint is achievable today; a small Java controller addition is required** (and the repository query it needs already exists).