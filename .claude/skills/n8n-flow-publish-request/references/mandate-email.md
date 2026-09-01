# The mandate, verbatim

Maya Ali's email, reproduced exactly as sent. This is the authority for the
template — where anything in SKILL.md appears to disagree with the text below,
the text below wins.

---

Dear All,

To improve quality, traceability, and organization, we’re standardizing how n8n non-chatbot flows are published.

**1. Submit a Request in JIRA**

Project: SD (Service Desk)

**What to Include in the Ticket (Required)**

Business Context/Goal: What problem the flow solves and the expected outcome.

Trigger & Schedule: manual / webhook / scheduled, and when it runs.

Inputs & Data Sources: DBs, files, etc...

Outputs & Recipients: systems updated, notifications sent, actions taken.

Expected Number of Executions per day: please estimate.

Attachments:

* n8n flow export (.json)
* n8n workflow link
* List of environment variables / credentials used (do NOT paste secrets in JIRA, just write the name of the credentials you're using as it appears in the dropdown menu in n8n)

APIs Used: link the API Requests Tasks or list them.

Tickets missing artifacts will be rejected.

**2. Review & Validation Flow**

1. The task will be routed from SD to the appropriate Technical Analyst.
2. Technical Analyst (TA) : validates business logic and checks for conflicts with existing requests.
3. Project Manager (PM): after TA validation, the PM hands off the flow to the NF project if it was accepted.
4. (N8N Flow) NF Project – Assignee: Ali Hachem: performs stress testing, infinite-loop checks, and security validation.

**3. Release & Visibility**

1. After all checks, Ali (NF) deploys the flow to production.
2. NF ticket is updated with a read-only production mirror link (to view execution logs).
3. No edits are possible in the mirror.

Enhancements and bugs (including API Failures or any technical issue) follow the same submission and review process by creating a new jira task and linking the original task.

Please share this email with your BAs.

Best,
Maya Ali
