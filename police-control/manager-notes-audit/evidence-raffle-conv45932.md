I now have a complete picture. The manual endpoint (`PayrollManagerNoteController`) allows setting any `additionReason` picklist item generically (line 452 `setAdditionReason(item)`), but the automated raffle-prize note creation comes only from `RafflePerformerJob`. Let me quickly confirm the SMM-angular winners UI is display-only (not a winner picker) and check the `getWinners` participant repo, then I have everything.

The evidence is complete. Let me give the answer.

## Answer

Yes — there is a **complete automated raffle/prize-draw subsystem for housemaids**, living entirely in the `magnamedia-housemaid-management` module (staffmgmt). It is not a manual-only feature. Here are the exact components for each of your four questions.

---

### (1) What selects the winners

The winner-selection engine is the scheduled job **`RafflePerformerJob`** (`com.magnamedia.scheduledjob.raffle.RafflePerformerJob`), registered as job definition `job_to_start_raffle_draw` (in `SetupCustomJobDefinitions`, job name *"Job to start Raffle Draw"*).

Flow:
- `run(...)` finds the current-month draw via `RaffleDrawRepository.findTop1DrawInCurrentMonth()`, verifies status is `PENDING` and that the scheduled `drawDate`/`drawTime` has arrived.
- `startRaffle(RaffleDraw)` sets status `ONGOING`, then builds a "raffle container" — a list where each participant is added **once per ticket point** (`RaffleDrawParticipant.getPoints()`), so more tickets = higher odds.
- `progressRaffle(...)` is the actual draw. It does `Collections.shuffle(raffleContainer)` then `pickRandomElement(...)` using `new Random().nextInt(...)`. The chosen `RaffleDrawParticipant` gets `isWinner=true`, `winOn=now`, and a prize assigned. It recurses (with configurable sleeps between picks/batches) until the winner count reaches `secondPrizeWinners + firstPrizeWinners`.
- Second-prize winners are drawn first; once the second-prize quota is filled, prior first-prize winners are removed from the pool before first-prize picks. On completion it calls `addPrizesToPayroll()` and sets status `FINISHED`.

The draw itself is **created/scheduled** via the controller **`RaffleDrawController`** (`@RequestMapping("/raffledraw")`), method `createEntity(...)` (POST `/staffmgmt/raffledraw/create`), which validates a minimum lead time and calls `RaffleService.createRaffleData(...)`. `RaffleService.createRaffle(...)` persists the `RaffleDraw`, builds participants in batches (`createRaffleDataBGT`), and creates the two prize rows. Related job: `GenerateRaffleTicketLogsJob` (`generate_raffle_tickets_job`) generates the ticket logs that become participant points; `RaffleSmsReminderJob` sends reminders.

Winner *retrieval* endpoints (read-only, no selection): `RaffleDrawController.getWinners`, `getCurrentWinners`, `getLastMonthWinners`, plus the `smm-angular` "raffle-tickets / winners" screens — these only display results.

---

### (2) Entities / tables recording draws, participants, winners

All under package `com.magnamedia.entity.raffledraw` (each `@Entity` → its own table):

- **`RaffleDraw`** — the draw. Columns: `drawDate`, `drawTime`, `endDate`, `status` (enum `INITIALING/PENDING/ONGOING/FINISHED/EXPIRED`), `reminderSmsSent`; `@OneToMany` `prizes` and `participants`.
- **`RaffleDrawParticipant`** — the participants **and** winners (a winner is a participant row with the winner flag). Columns/fields: `draw` (FK), `housemaid` (FK), `points`, `raffleStops`, **`isWinner`**, **`winOn`**, **`prize`** (FK to `RaffleDrawPrizeGrand`).
- **`RaffleDrawPrizeGrand`** — the prizes. Columns: `draw` (FK), `name`, **`worth`** (the amount), `isGrand` (true = first/grand prize).
- **`RaffleTicketLog`** — the ticket ledger feeding participation. Column `ticketsCount`, plus `ticketsReason` enum (`ONE_MONTH_WITH_SAME_CLIENT`, `MAID_RENEWED`, `REPLACEMENT`, `ELIGIBLE_FOR_RAFFLE`).
- **`RaffleDrawLog`** — draw event/animation log (used by the live-draw suggestions endpoints).

Repositories: `RaffleDrawRepository`, `RaffleDrawParticipantRepository`, `RaffleDrawPrizeGrandRepository`, `RaffleTicketLogRepository`, `RaffleDrawLogRepository`.

---

### (3) Parameters / constants setting the prize AMOUNT

Defined as constants in `HousemaidManagementModule` and seeded in `SetupCustomParameters`:

- **`raffle_first_prize`** (`PARAMETER_RAFFLE_FIRST_PRIZE`) — default **2000** ("Raffle first prize").
- **`raffle_second_prize`** (`PARAMETER_RAFFLE_SECOND_PRIZE`) — default **200** ("Raffle second prize").
- **`raffle_first_prize_winners`** — default **3** (number of first-prize winners).
- **`raffle_second_prize_winners`** — default **45** (number of second-prize winners).
- Supporting: `raffle_prize_batch_size` (20), `sleep_between_raffle_batches` (180s), `raffle_least_delay` (60 min), plus ticket-count params (`raffle_renewal_tickets`=35, `raffle_with_client_tickets`=5, `raffle_faulty_replacements_tickets`=10, `raffle_eligible_tickets`=1).

In `RaffleService.createRaffle`, these values are read via `Setup.getParameter(...)` and stored into each `RaffleDrawPrizeGrand.worth`. The paid amount on the winner's note = `participant.getPrize().getWorth()`.

---

### (4) What creates a manager note with `additionReason = raffle_prize`

The reason value is the constant `PARAMETER_RAFFLE_PRIZE_MANAGER_NOTE_REASON = "raffle_prize"`, resolved against picklist `AdditionReasons` (`PICKLIST_MANAGER_NOTE_ADDITION_REASONS`).

**The only place that automatically creates a `PayrollManagerNote` with `additionReason = raffle_prize` is `RafflePerformerJob.addPrizesToPayroll()`.** For each winner it builds a `PayrollManagerNote` with `noteType = ADDITION`, `amount = prize.getWorth()`, `housemaid = winner`, `additionReason = raffle_prize`, saves it, and (if creator is null/`admin`) reassigns the creator to the ERP system user. It then sends the winner a Yaya-app notification and a Customer.io `raffle_winner_selected` event.

The other two references to `raffle_prize` are **read-only**, not creators:
- `ChatGPTController.getLastRafflePrize` (`GET /getLastRafflePrize`) — queries existing notes to report a maid's last raffle prize.
- `PayrollHousemaidFinalSettlementController.calculateAdditionsWithoutRaffleAndReferral` — filters raffle notes *out* of final-settlement additions.

The generic manual endpoint `PayrollManagerNoteController` (its `setAdditionReason(item)` path) can also create a note with any picklist reason including `raffle_prize` if a user manually selects it — but it is not raffle-specific and is not what the draw uses.

---

### Bottom line
This is **not** a manual-only setup. A real, scheduled prize-draw pipeline exists: `RafflePerformerJob` randomly selects winners weighted by ticket points, records them on `RaffleDrawParticipant` (with `RaffleDraw` and `RaffleDrawPrizeGrand`), reads prize amounts from the `raffle_first_prize` / `raffle_second_prize` parameters, and **automatically writes the `raffle_prize` manager note** that lands the amount in payroll. Manual `add-manager-note` is only an incidental alternate path, not the mechanism that decides who wins.