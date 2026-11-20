# Threadline — team chat on Supabase

A standalone team chat app: channels (public and private), direct messages, threads,
reactions, @mentions, file attachments, pins, search, an Activity inbox, online/typing
indicators, and notification sounds. It has real accounts: sign up, sign in, sign out,
password reset, and admin approval for new members.

It's plain HTML/CSS/JavaScript with no build step. Supabase provides the database, logins,
file storage and live updates.

```
index.html          page shell
styles.css          styles
app.js              the app
config.js           ← put your Supabase URL + anon key here
supabase/schema.sql ← run once in Supabase to create the database
```

---

## Setup (about 10 minutes)

### 1. Create a Supabase project
1. Sign up at [supabase.com](https://supabase.com) and click **New project**.
2. Pick a name, a strong database password, and the region closest to your team
   (for India: **Mumbai / ap-south-1**). The Free plan is fine to start.

### 2. Create the database
1. In your project, open **SQL Editor → New query**.
2. Open `supabase/schema.sql`, copy everything, paste it in, and click **Run**.
   You should see "Success. No rows returned."

This creates the tables, the security rules, the `attachments` file bucket, live updates,
and the starter channels `#general` and `#random`.

### 3. Configure sign-in
In **Authentication → URL Configuration**:
- **Site URL**: the address where you'll host the app (e.g. `https://your-team-chat.netlify.app`).
  For local testing use `http://localhost:8000`.
- **Redirect URLs**: add the same address(es). Confirmation and password-reset emails
  link back here.

Email confirmation is on by default, which is what you want. Supabase's built-in email
sender is rate-limited and meant for testing. Before your team relies on it, add your own
SMTP provider under **Authentication → Emails → SMTP Settings** (e.g. Resend, Brevo,
Amazon SES, or your domain's mail server).

### 4. Connect the app
Open **Project Settings → API** (called "Data API" or "API Keys" in some dashboards) and copy:
- **Project URL**
- **anon / publishable** key (the public one, **never** the `service_role` / secret key)

Paste them into `config.js`:

```js
window.THREADLINE_CONFIG = {
  supabaseUrl: 'https://abcdefghijkl.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
};
```

The anon key is meant to be public. Your data is protected by the row-level security
rules in `schema.sql`, which the server enforces for every request.

### 5. Run it
The app has to be served over `http(s)://`. Opening the file directly (`file://`) won't work.

**Locally:**
```bash
cd threadline-supabase
python3 -m http.server 8000
# open http://localhost:8000
```

**Hosting (free options):** upload the folder to any static host:
- **Netlify:** drag the folder onto app.netlify.com/drop
- **Cloudflare Pages / Vercel:** create a project from the folder or a Git repo
- **GitHub Pages:** push to a repo and enable Pages

After deploying, put the final URL in **Site URL / Redirect URLs** (step 3).

### 6. Create your admin account first
**The first person to sign up becomes the admin** and is approved automatically, so
sign up yourself before sharing the link.

### 7. Invite your team
Send them the app's address. They create an account, confirm their email, and see a
"Waiting for approval" screen. Approve them under **👥 People** in the sidebar (or the
workspace menu → *Manage people & approvals*). Their screen updates automatically.

---

## Who can see what

| | Pending (not approved) | Member | Admin |
|---|---|---|---|
| Public channels & their messages | ✗ | ✓ | ✓ |
| Private channels | ✗ | only if invited | only if invited |
| Direct messages | ✗ | only their own | only their own |
| Files | ✗ | same as the channel they're in | same as the channel they're in |
| Approve / remove people, make admins | ✗ | ✗ | ✓ |
| Rename workspace | ✗ | ✗ | ✓ |
| Archive channels | ✗ | channels they created | any |
| Delete messages | ✗ | their own | any |

The database enforces all of this, not just the app, so it holds even if someone calls
the API directly. Admins **cannot** read DMs or private channels they aren't in.

**Removing someone:** *People → Remove* blocks their access straight away (they see the
waiting screen). To delete the account entirely, use **Authentication → Users** in the
Supabase dashboard.

---

## Costs and limits

- **Free plan:** 500 MB database, 1 GB file storage, 5 GB bandwidth per month. Plenty for
  a small team's text chat. **Free projects pause after a week with no activity**; you
  can resume them from the dashboard.
- **Pro plan (~$25/month):** 8 GB database, 250 GB bandwidth, more file storage, and no pausing.
  Worth it once the team depends on the app. Check supabase.com/pricing for current limits.
- Files can be up to 25 MB each (set on the `attachments` bucket).

## Good to know
- **Backups:** don't rely on the Free plan for backups. Check **Database → Backups** for what
  your plan includes, and export important data regularly.
- **Deleted messages:** when someone deletes their own message, its files are removed too.
  When an admin deletes someone else's message, the files stay in storage (only the
  uploader can delete files). Clean them up under **Storage → attachments** if needed.
- **Notification sounds** play only after you've clicked somewhere on the page once (a
  browser rule), and only while the app is open in a tab.
- **Search** matches message text (case-insensitive), across everything you can see.

## Updating the database later
`schema.sql` is for a fresh project. If you change it after you have real data, apply only
the new parts in the SQL Editor rather than re-running the whole file.
