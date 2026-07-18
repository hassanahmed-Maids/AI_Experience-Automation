# Migrating our customer messaging to CustomerIO — how it works

We're moving our automated messages out of the **ERP** into **CustomerIO**. We do this **one journey at a time** (e.g. "postponed-visa nudges," "medical-exam reminders," "maid replacement"), for **one profile type at a time** (CC Clients, MV Clients, CC Housemaids, MV Housemaids).

Each journey passes through **three systems**, in order. Every system is **gated** — a person reviews and approves before the next step runs — and there are **manual hand-offs between systems** where other teams build or where we make a go-live decision.

---

## System 1 — Understand & Design
*"What should we send, to whom, and when?"* — reverse-engineer how the ERP sends each message today and produce a copy-paste-ready CustomerIO design. **Nothing is built yet.**

1. **Retrieve the messages** — pull the message templates for the profile type from **JourneyAI** (our export of every automated message and its send stats).
2. **Group into journeys** — cluster the messages into coherent business journeys *(using the **low-code platform** to confirm which belong together).*
3. **Reverse-engineer the sending logic** — establish exactly what triggers each message, to whom, and under what conditions, straight from **our own source code via the low-code platform** (the code is our single source of truth — nothing is guessed).
4. **Draw the current journey** — map the ERP flow visually on **Whimsical**.
5. **Map the data** — for every condition and field the journey needs, identify where it lives and how CustomerIO will get it (already in our data feed / needs adding to the feed / a live API call / a new event).
6. **Reality-check against history** — verify the design against who *actually* received these messages, using **Snowflake** (our warehouse of past sends).
7. **Translate into a CustomerIO design** — draw the equivalent CustomerIO campaign on **Whimsical**, ready to copy into CustomerIO.
8. **Validate the design** — an independent, adversarial pass re-checks the drawn campaign against **our source code (low-code)** to catch anything wrong before it advances.

**Draws on:** JourneyAI · low-code platform · Whimsical · Snowflake.
**→ Hands off** a validated design (the Whimsical campaign + its data map). **Manual gate:** you review and approve the design.

---

## System 2 — Prepare for Go-Live
*"Get everything ready so the teams can build it."* — turn the design into the concrete instructions each team needs.

1. **Developer task** — a brief for engineering describing the **triggers (events)** CustomerIO needs and asking them to confirm the flow reaches the right people with no duplicates or gaps.
2. **Data specification** — the exact **data attributes to add to CustomerIO's data feed** (and when to remove them), each **verified against our source code (low-code)** so it's accurate. Handed to the team that edits our data queries.
3. **API specifications** — where a message needs information fetched **live**, a grounded spec (verified via low-code) for that connection.
4. **Build check** — once it's built, confirm the CustomerIO campaign matches the design.

**Draws on:** low-code platform · our customer database.
**Manual steps:** engineering builds the triggers; the data-queries team implements the data changes; you review and approve each before the next.
**→ Hands off** a **built CustomerIO campaign**.

---

## System 3 — Prove It's Safe, Then Switch Over
*"Does CustomerIO do the right thing, live — before we rely on it?"*

1. **Validate the build** — confirm the built campaign and all its data, events and APIs are live and correct — inspecting the campaign directly through the **CustomerIO connector** and verifying against **our source code (low-code)**.
2. **Go live in shadow mode** *(manual)* — CustomerIO runs **every customer through the whole journey and decides who to message, but sends nothing**. The **ERP keeps sending the real messages**, so there is **zero customer-facing risk** while we prove the new platform.
3. **Reconcile** — compare, per message: who CustomerIO *would* have messaged (**CustomerIO connector**) vs who the ERP *actually* messaged (**Snowflake**) vs who *should* have been messaged (**our customer database + source code**). The ERP itself sometimes makes mistakes, so correctness is judged against **the data**, not against the ERP. This produces a **correctness score per message**.
4. **Fix loop** — anything wrong in CustomerIO is flagged with a fix; we fix it and re-check — looping until each message reaches about **80% accuracy or better**.
5. **Cut over** — CustomerIO takes over sending and the **ERP stops** for that journey.

**Draws on:** CustomerIO connector · Snowflake · our customer database · low-code platform.
**Manual steps:** enable shadow mode; fix flagged issues between checks; approve the final cutover.

---

## The pipeline at a glance

```
  Messages          you approve        engineering + data          shadow mode →
 (JourneyAI)        the design          teams build                 fix loop → cutover
     │                  │                    │                           │
     ▼                  ▼                    ▼                           ▼
[ System 1 ] ─design─▶ [ System 2 ] ─built campaign─▶ [ System 3 ] ─▶ LIVE on CustomerIO
 Understand &          Prepare for                     Prove it's safe,     (ERP off for
 Design                Go-Live                          then switch over     that journey)
```

## Why it's safe and trustworthy
- **Our own source code is the single source of truth** — the sending logic is reverse-engineered and verified, never guessed.
- **Every design is cross-checked against real send history** before it's trusted.
- **Nothing goes live until it's proven correct against real data** — and during that proof the ERP keeps sending, so customers are never exposed to the switch.
- **A person approves at every hand-off**, and a journey only cuts over once it clears an accuracy bar.
- It even **surfaces mistakes the ERP is making today** — cases where the new platform is more correct than the old one.
