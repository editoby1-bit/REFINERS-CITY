# Automatic WhatsApp: setup guide

This turns on sending from the app through the official **WhatsApp Business Platform (Cloud API)**:
hundreds or thousands of messages from one click, birthdays and holidays at 8:00 every morning, and a delivery log
showing who received and read each message. The Meta side takes days (business verification, template approval), so
**start Part A now**. Part B takes about 30 minutes once you have the Meta details.

> Meta changes menu names and rules from time to time. If a menu below has moved, search for the name in Meta's help
> or ask me and I will help you find it.

## How it works (so the steps make sense)

1. In the app, the Church Admin picks people and a **template** and presses Send. The app puts the messages in a queue in
   Supabase (`wa_outbox`). Nothing is sent from the browser.
2. The **`wa-send` function** (running in Supabase) sends the queue to Meta a few at a time, about once a second, respecting your
   daily limit. The database wakes it up straight away and again every minute. A bad access token or billing problem
   **pauses** sending and shows the reason in the app; nothing is lost.
3. Meta tells the **`wa-webhook` function** when each message is delivered or read (or failed). People who reply **STOP**
   are never messaged again.
4. Every morning at 8:00 (Lagos time) the database checks the Automation Rules (birthdays, holidays, scheduled dates)
   and queues the ones due that have a template.

Only the **Church Admin** can send. Bishops and pastors keep the free tap-to-send way.

---

## Part A: Meta (start now)

### A1. Business account and verification
1. Go to **business.facebook.com** and create a **Meta Business account** for the church.
2. Open **Business Settings → Security Center → Business verification** and submit the church's registration documents.
   - Until verified, Meta lets a number message about **250 different people per 24 hours**.
   - Verified, it starts at about **1,000**, and Meta raises it automatically (10,000, 100,000, ...) as you send more
     with good quality. The app's **People per 24 hours** setting should match your current level; extra people simply
     wait for the next day.

### A2. Create the app
1. Go to **developers.facebook.com → My Apps → Create App**, choose the **Business** type, and link your business account.
2. Add the **WhatsApp** product. This creates a **WhatsApp Business Account** and a free *test number* for trying things.

### A3. Add the church's real phone number
1. In **WhatsApp → API Setup (or Phone numbers) → Add phone number**, add a number that can receive an SMS or call for the code.
2. The number **must not be registered in the WhatsApp or WhatsApp Business app** (delete that account first), unless
   you use Meta's *coexistence* option, which lets one number run in the Business app and the API together. Ask Meta
   support about it if you want to keep reading replies on a phone.
3. Choose a display name such as **Refiners City International Church** and wait for Meta to approve it.

### A4. Create the message templates
Automatic messages to people who have not just written to you **must use templates that Meta has approved**.
Go to **WhatsApp Manager → Message templates → Create template**.

Use lowercase names with underscores. Language **English** (code `en`). The `{{1}}` placeholders are filled by the app.
Suggested starting set, with the category Meta usually expects:

| Name | Category | Text | The app fills |
|---|---|---|---|
| `church_greeting` | Marketing | Hello {{1}}, God bless you! Greetings from Refiners City International Church. We are glad to have you in our church family. | {{1}} first name |
| `birthday_wish` | Marketing | Happy birthday {{1}}! Refiners City International Church celebrates you today and prays for a blessed new year ahead. | {{1}} full name |
| `absentee_followup` | Marketing | Hello {{1}}, we missed you at {{2}} on {{3}}. We hope you are well and look forward to seeing you again. | {{1}} name, {{2}} service name, {{3}} service date |
| `christmas_greeting` | Marketing | Merry Christmas {{1}} from Refiners City International Church. May the joy of Christ be with you and your family. | {{1}} first name |
| `easter_greeting` | Marketing | Happy Easter {{1}} from Refiners City International Church. Christ is risen indeed! | {{1}} first name |

- Add a **"Stop promotions"** quick-reply button to marketing templates if Meta offers it. The app treats it like STOP.
- Approval usually takes minutes to a day. Keep the wording honest: no misleading offers, no all-capitals shouting.
- The app can fill up to **4** values per template, from: full name, first name, area, service name, service date.
  Daily rules (birthday, holiday, scheduled) can only use name, first name and area, because they are not tied to a service.

### A5. Collect four things from Meta
| What | Where to find it | Used as |
|---|---|---|
| **Phone number ID** | WhatsApp → API Setup → *Phone number ID* (a long number, **not** the phone number itself) | `WA_PHONE_NUMBER_ID` |
| **Permanent access token** | **Business Settings → Users → System users → Add** (role: Admin) → *Add assets*: your app and the WhatsApp account with full control → **Generate token**, expiry **Never**, permissions **whatsapp_business_messaging** and **whatsapp_business_management** | `WA_ACCESS_TOKEN` |
| **App secret** | App → Settings → Basic → *App secret* → Show | `WA_APP_SECRET` |
| Two made-up random strings (30+ letters and digits each) | You make them up | `WA_VERIFY_TOKEN` and `WA_CRON_SECRET` |

The **temporary token** on the API Setup page expires in about 24 hours. **Do not use it.**
Treat the access token and app secret like bank passwords: never post them in chat, GitHub or `config.js`.

### A6. Payment method
Add a card under **WhatsApp Manager → Payment settings** (or Business Settings → Billing). Meta charges **per template
message delivered**, by category and the recipient's country. Check Meta's current **WhatsApp Business Platform pricing**
page for Nigeria and multiply by your list size before big sends. The app shows a confirmation with the number of people
before every send.

---

## Part B: Supabase (about 30 minutes)

### B1. Turn on two extensions
**Database → Extensions**: switch on **`pg_cron`** and **`pg_net`**.

### B2. Create the tables and functions
**SQL Editor → New query**: paste all of **`supabase/whatsapp.sql`** and press **Run**. Safe to run again.
(If you have not already run the latest `supabase/setup.sql`, run that first.)

### B3. Deploy the two functions
**Edge Functions → Deploy a new function → Via Editor**, once for each:

| Function name | Paste the code of |
|---|---|
| `wa-send` | `supabase/functions/wa-send/index.ts` |
| `wa-webhook` | `supabase/functions/wa-webhook/index.ts` |

For **both**, open the function's settings and switch **Verify JWT** **off**. Meta and the database authenticate with their own secrets,
which the functions check. (With the Supabase command line tool instead: `supabase functions deploy wa-send` and `wa-webhook`.
`supabase/config.toml` already turns Verify JWT off.)

### B4. Add the secrets
**Edge Functions → Secrets** (or *Manage secrets*): add
`WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`, `WA_CRON_SECRET`.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

### B5. Connect the database to the sender
In the **SQL Editor** run this once, with your project reference (the code in your project URL) and the **same** `WA_CRON_SECRET`:

```sql
select public.wa_configure(
  'https://YOUR-PROJECT-REF.supabase.co/functions/v1/wa-send',
  'THE-SAME-VALUE-AS-WA_CRON_SECRET'
);
```

### B6. Tell Meta where to send delivery reports
In Meta: **WhatsApp → Configuration → Webhook → Edit**
- **Callback URL:** `https://YOUR-PROJECT-REF.supabase.co/functions/v1/wa-webhook`
- **Verify token:** your `WA_VERIFY_TOKEN`

Press **Verify and save**, then **subscribe to the `messages` field**.

---

## Part C: In the app

1. Open **WhatsApp Centre** (as Church Admin). Under **Automatic WhatsApp** choose **On**, set **People per 24 hours**
   to your current Meta level (250 until verified), press **Save**.
2. Under **Templates**, add each approved template: the **name and language exactly as at Meta**, what it is used for,
   the template text, and what fills each `{{ }}` in order.
3. **Send a Test Message** to your own number. It should arrive within a minute and appear in the **Delivery Log**
   as Sent, then Delivered, then Read.
4. Go to **Automation Rules**: add a **Member Birthday Rule**, **Christmas** and **Easter** rules, and choose each rule's
   **Automatic template**. They then go out by themselves at 8:00 every morning (Lagos time).
5. Absentees: on the **Attendance** page the **Message All Absentees** button now sends the absentee template, with
   the service name and date filled in.

## Using it responsibly (this protects your number)
- **Only message people who expect it.** Members gave their numbers to the church; for non-members, make sure they agreed
  to receive messages. Many reports or blocks lower your quality rating, which lowers your limit or can pause the number.
- Anyone who replies **STOP** is added to the opted-out list (WhatsApp Centre → Opted Out) and never messaged again.
  You can also add or restore numbers there.
- The app sends template messages only. **Replies from people go to the church number, not into the app**; someone
  must watch that number (see coexistence in A3) if you want to answer them.
- The same person is not sent the same template twice within 20 hours (protects against double clicks).

## If something goes wrong
The app shows the reason. Common ones:

| You see | Meaning and fix |
|---|---|
| *Sending stopped: ... access token ...* | The token is wrong, expired or lost permissions. Create a new system-user token (A5), update `WA_ACCESS_TOKEN`, press **Resume sending**. |
| *Missing secret in Supabase Edge Functions: ...* | Add that secret (B4), then Resume. |
| *Template not found at Meta* | Name or language differs from Meta, or the template is not approved yet. |
| *This number is not on WhatsApp* | Wrong or non-WhatsApp number. Correct it on the member, then **Retry failed**. |
| *Number is not on the allowed list (test mode)* | The app is still using Meta's test number. Finish A3 with the real number. |
| *Meta chose not to deliver ...* | Meta limits marketing messages to a person who has received many. Try later. |
| Messages stay **Waiting** | Daily limit reached (they continue tomorrow), sending is Paused, the secret in B5 differs from `WA_CRON_SECRET`, or `pg_net` / the function is not set up. See **Edge Functions → wa-send → Logs** in Supabase. |
| Stuck at **Sent**, never Delivered | The webhook (B6) is not connected, or the phone is off. |

Supabase logs for each function: **Edge Functions → (function) → Logs**.

## What it costs
- **Supabase:** nothing extra. Normal use is well inside the free plan (a minute-by-minute check plus the sends).
- **Meta:** per delivered template message (see A6). Nothing is charged for failed or queued messages.
