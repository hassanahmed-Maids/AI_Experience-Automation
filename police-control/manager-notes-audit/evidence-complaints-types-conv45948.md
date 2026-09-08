I have all the information needed to answer comprehensively. Let me compile the answer.

## Complaint Type Taxonomy & Maid-Side Communication Records

Primary module: `magnamedia-complaints` (domain `COMPLAINT_MANAGEMENT` / `TICKETING`). The `PayrollManagerNote` indirect path you flagged does exist and is confirmed below, but it belongs to payroll and is **not** part of the complaint conversation record — noted at the end so it isn't conflated.

### 1. Entities modelling complaint categorisation

Three levels model categorisation:

**`ComplaintType`** (the "type" with IDs 1–424) — extends `BaseEntity`, implements `SeriousnessLevelHolder`. Fields:
- `name` (label), `code` (string business key used throughout the code)
- `category` → `ManyToOne ComplaintCategory`
- `classification` — enum `Classification` (mirrored from the category on set)
- `seriousnessLevel` — enum
- `disabled` (boolean) — **the active/inactive flag**
- `causeFaultReplacement`, `isReplacementReason`, `isCancellationReason` (booleans)
- `deductionCode`, `ftmReportLabel`, `availabilityTimer`
- `clientResponsibility` — enum `{FAULTY, INNOCENT}`
- `tags` — `ManyToMany` join table `COMPLAINT_TYPES_TAGS` (drives many behaviours, e.g. the `transportation` tag)
- `type` — `ManyToOne PicklistItem` (picklist `TypeOfComplaintType`), a secondary "type of type" classifier

**`ComplaintCategory`** — the parent grouping: `name`, `code`, `classification`, `warnPoints`, `deduction`, and `status` enum `{ACTIVE, INACTIVE}`.

**`DepartmentComplaintType`** (ticketing) — the newer model. It links a `ComplaintType` to a department `Team` (`DEPARTMENT_COMPLAINT_TYPE` table, unique on department+type) with per-department `active` and `cannotBeCancelled` flags. This is where a type is enabled/disabled per team.

**Hierarchy:** There is **no primary/secondary/sub-type field inside `ComplaintType` itself**. The hierarchy is two-fold:
- **Category → Type** (a category has many types; a type has one category).
- **On the complaint**, one `primaryType` (`ComplaintType`) plus a set of `otherTypes` (`ManyToMany ComplaintType`) — that is where "primary vs secondary type" lives.
- Separately, tickets have their own **Parent / Main / Sub** hierarchy via `Complaint.hierarchyRole` (`ComplaintHierarchyRole`) and `parentComplaint` — but that is ticket-instance hierarchy, not type taxonomy.

**Team & target:** `ComplaintType` does **not** carry a team directly; team routing is via `DepartmentComplaintType` and via `Complaint.assignTo`/`creatorTeam`. Client-vs-housemaid targeting is not a field on `ComplaintType` — it is derived from `Classification` (see Q2).

### 2. HOUSEMAID-side vs client-side

The distinction is driven by the **`Classification` enum** (4 values): `MaidBehaviourIssue`, `MaidUnfitToWork`, `ClientIssue`, `ClientCancellable`.

- A `ComplaintType` gets its `classification` from its `ComplaintCategory`. When set on a `Complaint` (via `setPrimaryType` → `setClassification`), the entity computes the boolean field **`aboutMaid`**:
  - `MaidBehaviourIssue` or `MaidUnfitToWork` → `aboutMaid = true` (**housemaid-side**)
  - `ClientIssue` or `ClientCancellable` → `aboutMaid = false` (client-side)
- `aboutMaid` is the field queried to filter maid-side vs client-side complaints (`ComplaintService` builds filters `filter.and("aboutMaid", …)`).
- A second, independent signal is **`Complaint.targetContact`** (enum `Who`: `Client`, `Maid`, `Maid_CC`) and the per-note `whoSaid` — indicating whether the maid or client is the party being contacted/speaking.
- The **YAYA app** complaint-type codes are the explicitly maid-raised set (the maid app), e.g. `not_satisfied_with_food`, `not_comfortable_with_sleeping_place`, `working_on_day_off`, `not_allowed_out_on_day_off`, `complaint_about_accommodation`, `Difficult_Child__c`, `client_shouts_bad_words`, `Mismanagement_of_Day_Off_Hours__c`.

### 3. Entities holding the CONVERSATION

| Entity | Text field(s) | Free text vs structured |
|---|---|---|
| **`ComplaintNote`** | `text` (`@Lob`) + `whoSaid` (`Who`) | Free text; the classic comment thread (`Complaint.notes`, ordered newest-first) |
| **`TeamComplaintUpdate`** (extends core `Note`) | `text` (inherited) for comments; `payloadJson` (`@Lob`) for structured activity events; `entryType` (`NOTE`/`ACTIVITY_EVENT`), `eventType`, `eventDate`, `team` | Mixed — comments are free text; activity-event rows are **structured** JSON. This is the primary inter-team conversation feed and the source the GPT summary reads. |
| **`ComplaintLog`** | No free text — structured audit: `logStatus`, `decision`, points, responsibilities, `warningLetter` | Structured action log |
| **`ComplaintExtraDetails`** (ticketing satellite) | `chatId`, `callId` (external references to WhatsApp/chat and phone call), plus `pendingExternalReason`, `reopenReason`, `externalOrganization` | `chatId`/`callId` are **structured foreign references** (the WhatsApp/chat transcript and call live in the chat platform / analytics, not inline); the reason fields are free text |
| **`ExpertZiwoRecord`** | `recordingFile` (path), transcription/metadata: `callId`, `duration`, `talkTime`, `agentName`, `direction` | Structured **call recording** metadata; recording is a file reference |
| **`Complaint`** own free-text fields | `initialDescription`, `resolutionDetails`, `managerNotes`, `complaintCancellationReason`, `reviewIssueType`, `summary` | Free text |

Actual WhatsApp/chat transcripts and call transcriptions are held externally (chat platform / `aianalytics` Ziwo calls with `labeledTranscription`) and referenced here by `chatId`/`callId`.

### 4. AI/GPT summarisation & classification

Yes. The `Complaint.summary` (`LONGTEXT`) column is GPT-written. (There is also a deprecated `recentSummary`.)

- **Writer:** `ComplaintsSummaryService.updateSummaryAndRecentSummaryComplaints(complaintId)`, invoked as a background task from `TeamComplaintUpdateController` (i.e. after comments are added). It concatenates all `TeamComplaintUpdate`s (`time – agent – role: comment`) plus `initialDescription`, sends them to `ChatAIService.sendToChatGPT`, and stores the result in `summary`.
- **Prompt/model:** template `GET_UPDATE_COMPLAINTS_SUMMARY_DOCTYPE_TEMPLATE`, a conversational GPT template defined in `ComplaintsModule`. Model **`gpt-4.1-nano`**, temperature `0.9`, topP `0.5`. A parallel template `CHATGPT_PROMPT_GET_UPDATE_COMPLAINTS_SUMMARY_DOCTYPE_TEMPLATE` uses **`gpt-4`**. The prompt casts GPT as a client-support agent producing a short (≤9-sentence) neutral chronological summary with a title, and one variant outputs a structured block: `Last update / Complaint type / Complaint reason / Offer Trainer Instructions / Summary`.
- **AI-assigned category:** partially. `ComplaintService.extractGptComplaintInfo()` parses that structured block back out of the summary to derive a "To-do: `<TYPE>` – `<REASON>`" label (exposed as `getGptGeneratedComplaint()`), configured by `PARAM_GPT_COMPLAINT_EXTRACTION_CONFIG`. There is also `processClientComplaintsForGPTAnalysis()` (template `CHATGPT_PROMPT_CLIENT_COMPLAINTS_ANALYSIS_TEMPLATE`) which analyses a client's 30-day complaint comments and writes matching-type findings back as an automated `TeamComplaintUpdate`.
- **Sentiment:** not on the complaint itself. Sentiment analysis lives in `magnamedia-reporting` — `FarewellSentimentAnalysisService` sends Ziwo cancellation-call transcriptions to GPT and stores sentiment on the `aianalytics` call record; and `AngryAndThreateningJob` / `AngryThreateningService` classify angry/threatening conversations. So sentiment is an analytics-side artifact, not a column on `Complaint`.

### 5. Specific complaint types (exact stored codes)

- **Maid resignation / wanting to leave:** `Maid_Wants_To_Resign__c` (constant `COMPLAINT_TYPE_MAID_WANTS_TO_RESIGN`); related maid-side: `Refused_To_Work__c`, `Maid_does_not_want_to_renew_with_the_company__c`, `Maid's_termination`, `maid_pretended_to_be_sick`. The YAYA "maid wants to leave home" flow reuses the accommodation/company complaint codes.
- **Salary complaints:** No dedicated stored code constant. Salary grievances are handled as free text/summary — the summary prompt explicitly anticipates *"client arguing about the maid's salary."* Salary-side structured data is on the payroll `PayrollManagerNote` (`additionReason`/`deductionReason`), not a complaint type.
- **Non-payment:** No dedicated complaint-type code found in this module.
- **Taxi / transport requests:** No single code — modelled via the **`transportation` tag** on `ComplaintType` (`COMPLAINT_TYPE_TAG_TRANSPORTATION = "transportation"`, the single source of truth) plus the `ComplaintTransportation` entity and taxi work-order purpose picklist (`pickup_from_client`, `deliver_to_client`, live-out variants).
- **Medical assistance:** `Maid_s_Repeat_Medical__c` (`COMPLAINT_TYPE_REPEAT_MEDICAL`) and `Work_Injury_Sickness__c` (`COMPLAINT_TYPE_MAID_IS_SICK`); plus visa/EID medical team codes.
- **Accommodation / relocation:** `complaint_about_accommodation` (YAYA); related sleeping-space code `not_comfortable_with_sleeping_place`; handled via `AccommodationToDo`.
- **Lost luggage:** No dedicated complaint type. Luggage is modelled as a service/work-order flow — `MaidService.Type.PICKUP_LUGGAGE`, `createPickupLuggageRequest`, and `luggageNotPicked`/`luggageInClientHome` flags in replacement flows.
- **Referral disputes:** No complaint type. Referrals live in `magnamedia-housemaid-management` (`HousemaidReferralService`, `ReferralBonusesManagerJob`) and are settled as payroll `PayrollManagerNote` additions, not complaints.

---

**On the `PayrollManagerNote` indirect path you asked to trace:** confirmed. `ManagerNoteService.processExpenseRequestTodo(expenseRequestTodoId)` (in `magnamedia-payroll-management`), when an `ExpenseRequestTodo` is confirmed with payment method `SALARY`, creates a `PayrollManagerNote` of type `ADDITION` and copies `expense.getSalaryAdditionType()` onto the note's `additionReason` (`managerNote.setAdditionReason(expense.getSalaryAdditionType())`). This is a payroll addition record keyed to a `Housemaid` — it is **not** a complaint or a complaint conversation entity, so it does not feed the complaint taxonomy or the maid-side communication record.