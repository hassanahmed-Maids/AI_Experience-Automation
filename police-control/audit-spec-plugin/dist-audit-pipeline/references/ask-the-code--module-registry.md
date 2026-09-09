# Ask the Code — Module Registry

Pass these values in `project_alias` (or the script's `-m` flag). Comma-separate several.
An empty array (`--all-modules`) searches every module but is markedly slower and more
likely to time out — prefer 1–3 targeted modules.

## Picking the right module for an audit topic

| Audit subject | Start with | Also consider |
| --- | --- | --- |
| Maid salaries, payslips, deductions, loans, final settlement | `erp/magnamedia-payroll-management` | `erp/magnamedia-accounting` |
| Client invoicing, receipts, refunds, ledger, journal entries | `erp/magnamedia-accounting` | `erp/magnamedia-client-management` |
| Client contracts, packages, pricing, cancellations, renewals | `erp/magnamedia-client-management` | `erp/magnamedia-prospects` |
| Maid records, contracts, status, transfers, accommodation | `erp/magnamedia-housemaid-management` | `erp/magnamedia-visa-processing` |
| Visa fees, work permits, EID, overstay fines, government charges | `erp/magnamedia-visa-processing` | `erp/magnamedia-accounting` |
| Sales discounts, promotions, quotes, lead handling | `erp/magnamedia-prospects` | `erp/magnamedia-client-management` |
| Recruitment costs, agent fees, candidate pipeline spend | `erp/magnamedia-recruitment` | `erp/magnamedia-accounting` |
| Complaints, compensation, goodwill credits | `erp/magnamedia-complaints` | `erp/magnamedia-accounting` |
| Existing reports and how a figure is currently computed | `erp/magnamedia-reporting` | `erp/ai-analytics` |
| User permissions, approval rights, admin overrides | `erp/magnamedia-admin` | — |
| Live-out / freedom operator flows | `erp/magnamedia-freedom-operator` | `external-projects/liveout-webapp` |
| Automations that move money or trigger charges | `n8n-flows/prod_main` | `n8n-flows/prod_automation` |

Approval and override paths matter for audits: when the control involves *who was allowed
to authorise something*, include `erp/magnamedia-admin`.

## ERP modules (17)

| Module | `project_alias` |
| --- | --- |
| Accounting | `erp/magnamedia-accounting` |
| Admin | `erp/magnamedia-admin` |
| AI Analytics | `erp/ai-analytics` |
| Chat AI | `erp/chatai` |
| Chat CC | `erp/chatcc` |
| Client Management | `erp/magnamedia-client-management` |
| Complaints | `erp/magnamedia-complaints` |
| Freedom Operator | `erp/magnamedia-freedom-operator` |
| Housemaid Management | `erp/magnamedia-housemaid-management` |
| Low Code Platform | `erp/low-code-platform` |
| Payroll Management | `erp/magnamedia-payroll-management` |
| Public | `erp/magnamedia-public` |
| Recruitment | `erp/magnamedia-recruitment` |
| Reporting | `erp/magnamedia-reporting` |
| Sales | `erp/magnamedia-prospects` |
| Visa | `erp/magnamedia-visa-processing` |
| Yaya Bot | `yaya-bot` |

## n8n workflow modules (9)

| Module | `project_alias` |
| --- | --- |
| Prod Analysis | `n8n-flows/prod_analysis` |
| Prod Automation | `n8n-flows/prod_automation` |
| Prod Broadcast | `n8n-flows/prod_broadcast` |
| Prod Delighters | `n8n-flows/prod_delighters` |
| Prod Maidsat | `n8n-flows/prod_maidsat` |
| Prod Main | `n8n-flows/prod_main` |
| Prod Resolvers | `n8n-flows/prod_resolvers` |
| Prod Sales | `n8n-flows/prod_sales` |
| Staging Main | `n8n-flows/staging_main` |

## External project modules (8)

| Module | `project_alias` |
| --- | --- |
| Liveout Webapp | `external-projects/liveout-webapp` |
| Contract ID Checker | `external-projects/contractidchecker` |
| MMM | `external-projects/mmm` |
| Chatbot LLM Usage Dashboard | `external-projects/chatbot-llm-usage-dashboard` |
| Notifiers Bot | `external-projects/notifiers-bot` |
| Promoter App | `external-projects/promoter-app` |
| Carely | `external-projects/carely` |
| Part Time Cleaners | `external-projects/part-time-cleaners` |

## Verified example result

Asking `erp/magnamedia-payroll-management` for payroll audit tables returned, among others:

- `MONTHLYPAYMENTRULES` — `ID`, `PAYROLL_MONTH`, `PAYMENT_DATE`, `LOCK_DATE`, `PAYROLL_TYPE`,
  `PAYMENT_METHOD`, `MOL_TYPE`, `FINISHED`, `AUDITING_FINISHED`
- `MONTHLYPAYROLLS` — `ID`, `HOUSEMAID_ID`, `PAYROLL_DATE`, `PRIMARY_SALARY`, `TOTAL_SALARY`,
  `STATUS`
- `PAYROLLAUDITTODOS` — `ID`, `MONTHLY_PAYMENT_RULE_ID`, `PAYROLL_MONTH`, `LABEL`,
  `FINISHED_PROCESSING`, `FINISHED_GENERATING_LOGS`
- `PAYROLLACCOUNTANTTODOS` — `ID`, `MONTHLY_PAYMENT_RULE_ID`, `AMOUNT`, `TOTAL`, `TASK_NAME`,
  `PAID_BY_MANAGER`, `DUE_ON`

Note the shape of a useful answer: UPPERCASE table names, and columns like `LOCK_DATE` and
`AUDITING_FINISHED` that are directly relevant to a payroll control. Those two columns are
the kind of field a P&C spec should filter on — they tell you whether a payroll period was
closed and audited. Probe for fields like these deliberately.
