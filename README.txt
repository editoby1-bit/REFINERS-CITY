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

IMPORTANT NOTE ABOUT WHATSAPP
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

GOOD TO KNOW
- The top bar shows "All changes saved" when everything has reached the database.
- Free Supabase projects pause after about a week with no use at all. Weekly church use keeps it awake;
  if it ever pauses, press "Restore project" in the Supabase dashboard.
- Password reset emails ("Forgot password?" and the admin's "Email Password Reset Link") need an email
  sender: Supabase > Authentication > Emails > SMTP Settings (a free Brevo or Resend account works).
  Supabase's built-in sender only delivers to your own Supabase team members.
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
