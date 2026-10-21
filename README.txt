REFINERS CITY ATTENDANCE APP

WHAT IS INSIDE
- Church Admin, Ordained Pastor, G12 Pastor, and Bishop roles
- Member database with name, phone, address, birthday, area, G12 class, date added
- Area management with bishop name and automatic area assignment for bishop-added members
- Sunday 1st / 2nd / 3rd / 4th service and Midweek service attendance
- Custom service / conference / activity creation
- Admin-only attendance marking
- Date range filter for members added within a period
- Growth ladder:
  * 0-7 attended services = New Member
  * 8-15 attended services = Consistent New Timer
  * 16+ attended services = Strong Member
- Member profile modal showing area, address, phone, G12 class, level, attendance count
- Separate Non Members / Prospect list
- Birthday view for members and non members
- WhatsApp Centre for:
  * one person
  * selected members
  * selected non members
  * area
  * G12 class
  * everyone
  * birthdays today
  * all non members
- Saved scheduled / holiday / birthday rules (admin can delete rules)
- Edit / delete members (admin; bishops can edit members in their own area)
- Edit / delete non members, and convert a non member into a member
- Delete a service (admin) - its attendance is removed and growth levels recalculate
- Settings & Backup (admin):
  * download a full backup file and restore it (also how you move to a new phone/computer)
  * export Members, Attendance Records, Service Summary and Non Members as CSV (Excel / Google Sheets)
  * reset any account password, remove accounts
- My Account: every user can change their own password

AUTOMATIC WHATSAPP (SENDING TO HUNDREDS OR THOUSANDS AT ONCE)
The app can send through the official WhatsApp Business API: one click sends to everyone selected, birthdays and
holidays go out by themselves at 8:00 every morning, and a delivery log shows who received and read each message.
It needs a Meta (Facebook) business account, a church phone number and approved message templates, and Meta charges
per message. Full step-by-step guide: WHATSAPP_SETUP.md. Until it is set up, the free tap-to-send way below keeps working.

IMPORTANT NOTE ABOUT WHATSAPP (free tap-to-send)
Because the app has no server of its own, WhatsApp sending works by opening WhatsApp chat links with the prepared message text.
That means:
- messaging one person opens their WhatsApp chat straight away
- messaging many people opens a send list: tap each name to open their chat with the message ready
  (browsers block more than one pop-up at a time, so this is the reliable way to send in bulk)
- scheduled / automated rules become due inside the app
- when due, you can run them and the app opens the correct WhatsApp chats
There is no server in this version, so background sending while the app is fully closed is not possible yet.

ONLINE DATABASE (SUPABASE) - ONE-TIME SETUP
Once connected, records are stored online and shared live between every approved account,
on any phone or computer. Logins and passwords are handled securely by Supabase.
Until it is connected, the app still works but keeps records in one browser only.

1. Go to https://supabase.com, create a free account, then "New project".
   Pick any name, save the database password somewhere safe, choose the region closest to the church.
2. In the project: SQL Editor > New query. Open supabase/setup.sql from this repository,
   copy ALL of it, paste it in, and press Run. You should see "Success".
3. Authentication > Sign In / Providers > Email: turn OFF "Confirm email".
   (New accounts still cannot see anything until the Church Admin approves them.)
4. Authentication > URL Configuration: set "Site URL" to your GitHub Pages address
   (for example https://editoby1-bit.github.io/REFINERS-CITY/) and add the same address under Redirect URLs.
5. Project Settings > API (or the "Connect" button): copy the Project URL and the anon / publishable key
   into config.js (supabaseUrl and supabaseAnonKey), commit and push.
   This key is meant to be public - the database security rules protect the data.
6. Open the app and choose "Create account" straight away. THE FIRST ACCOUNT CREATED BECOMES THE CHURCH ADMIN.
7. Moving old records: on the phone/computer that has the old records, log in as the admin and open
   Settings & Backup > "Upload them to the online database". (Or use Restore From Backup with a backup file.)
   Pastors and bishops then create their own accounts and you approve them under Settings & Backup.

WHO CAN DO WHAT (enforced by the database, not just the app)
- People who sign up wait for approval and see nothing until the Church Admin approves them.
- Church Admin: everything, including attendance, services, areas, approving accounts and roles.
- Bishops: add / edit members in their area. G12 pastors: assign members to their class.
- All approved accounts: view records, add non members, use the WhatsApp Centre.

STAYING INSIDE THE FREE SUPABASE PLAN
Free plan limits: 500 MB database, 5 GB downloads (egress) a month, 200 live connections at once,
2 million live-update messages a month, 50,000 monthly active users.
A Free plan project is never charged. If a limit is passed, Supabase warns the owner by email and,
after a grace period, may restrict the project until the next month or an upgrade. What the app does:
- Downloads: each phone/computer keeps a copy of the records (IndexedDB) and afterwards downloads
  only what changed. A normal visit downloads a few KB instead of the whole database. The copy is
  removed when someone presses Logout.
- Deletions are kept as tiny markers for 45 days so every device catches up, then cleaned out
  automatically (the admin's device triggers the clean-up once a day).
- Live updates: tabs that stay hidden for 5 minutes disconnect and catch up when reopened.
  Large uploads pause live updates on the uploading device.
- Saving: edits are grouped (a quarter of a second) and sent in batches of 500; failed saves retry
  with increasing waits up to a minute instead of hammering the server. The page warns before
  closing while something is still being saved.
- Database work: security checks run once per request (not once per row) and lookups are indexed,
  so the small free server is never overloaded.
- Abuse: logged-out visitors and unapproved accounts cannot read or change anything. Sign-in and
  sign-up attempts are rate limited by Supabase itself (Authentication > Rate Limits; keep the defaults).
- Settings & Backup > Database Usage shows the database size against the 500 MB limit.
  Monthly downloads and live-update messages: Supabase > Organization > Usage.
Rough sizes: 1,000 members with 5 services a week is about 260,000 attendance records a year,
roughly 100 MB. Exporting and trimming old years is only needed after several years.
Do not add a card or upgrade unless you choose to: on the Free plan nothing is billed automatically.

GOOD TO KNOW
- The top bar shows "All changes saved" when everything has reached the database.
- Free Supabase projects pause after about a week with no use at all. Weekly church use keeps it awake;
  if it ever pauses, press "Restore project" in the Supabase dashboard.
- After an app update that changes supabase/setup.sql, run the file again in the SQL Editor
  (it keeps all records and accounts).
- Password reset emails ("Forgot password?" and the admin's "Email Password Reset Link") need an email
  sender: Supabase > Authentication > Emails > SMTP Settings (a free Brevo or Resend account works).
  Supabase's built-in sender only delivers to your own Supabase team members.
- If an account ever gets stuck (for example nobody is admin), the Supabase SQL Editor can fix it, e.g.
  update public.profiles set role = 'admin', approved = true where email = 'you@example.com';
- Settings & Backup > Download Full Backup still gives you an extra copy any time.

DEMO LOGIN ACCOUNTS (only when the online database is NOT connected)
Change these passwords (Settings / My Account) before entering real church records.
The demo hint on the login page disappears once a demo password has been changed.

1. Church Admin
   Email: admin@refiners.local
   Password: admin123

2. Ordained Pastor
   Email: ordained@refiners.local
   Password: pastor123

3. G12 Pastor
   Email: g12@refiners.local
   Password: g12pass

4. Bishop
   Email: bishop@refiners.local
   Password: bishop123

FILES
- index.html
- styles.css
- app.js            (screens and features)
- cloud.js          (online database sync)
- config.js         (your Supabase project URL and key)
- supabase/setup.sql (run once in Supabase)
- supabase/whatsapp.sql, supabase/functions/ (automatic WhatsApp, see WHATSAPP_SETUP.md)
- whatsapp.js       (WhatsApp Centre screens for automatic sending)
- vendor/supabase.js (Supabase library, bundled so no extra downloads are needed)
- assets/logo.jpg

HOW TO DEPLOY TO GITHUB PAGES
1. Upload all files to your repository root.
2. Commit and push.
3. In GitHub Pages settings, publish from the root branch.
4. Open your GitHub Pages URL.

NEXT PHASE IDEAS
- real scheduled delivery via server jobs
- import members from CSV
- analytics charts
- follow-up task tracker
