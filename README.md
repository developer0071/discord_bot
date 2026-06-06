# Discord Regiment Bot

Automatically manages regiment membership with a queue system. When users join the server, they're either assigned the regiment role immediately (if slots are available) or placed in a waiting queue. When a slot opens up (member leaves or admin frees one), the next person in queue is automatically promoted.

## Flow

```
User joins server
     │
     ▼
 Slots available? ──Yes──▶ Assign regiment role ──▶ Notify admins ──▶ Send welcome
     │
    No
     │
     ▼
 Issue ticket & add to queue
     │
     ▼
 Inform user of queue position
     │
     ▼
 (Waiting...)
     │
     ▼
 Place opens up? (member leaves / admin promotes)
     │
     ▼
 Promote next in queue ──▶ Assign role ──▶ Notify admins ──▶ Send welcome
```

---

## Setup

### 1. Discord Developer Portal

1. Go to https://discord.com/developers/applications
2. Create a new application → **Bot** tab → enable bot
3. Copy the **Bot Token** → goes into `.env`
4. Under **Privileged Gateway Intents**, enable:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Invite the bot with these permissions:
   - Manage Roles, Send Messages, Embed Links, Read Messages
   - Use this URL (replace CLIENT_ID):
   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=268438528&scope=bot%20applications.commands
   ```

### 2. Firebase Setup

1. Go to https://console.firebase.google.com
2. Create a new project (or use existing)
3. Go to **Project Settings → Service Accounts**
4. Click **Generate new private key** → download the JSON file
5. From the JSON file, copy:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY`
6. Enable **Firestore Database** in your Firebase project (Start in production mode)

### 3. Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
nano .env
```

| Variable | Where to find it |
|---|---|
| `DISCORD_TOKEN` | Discord Developer Portal → Bot tab |
| `REGIMENT_ROLE_ID` | Right-click role in Server Settings → Copy ID |
| `REGIMENT_MAX_SLOTS` | Your desired max (e.g. `20`) |
| `WELCOME_CHANNEL_ID` | Right-click welcome channel → Copy ID |
| `LOG_CHANNEL_ID` | Right-click log/admin channel → Copy ID |
| `FIREBASE_PROJECT_ID` | Firebase service account JSON |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account JSON |
| `FIREBASE_PRIVATE_KEY` | Firebase service account JSON (keep quotes!) |
| `FIREBASE_DATABASE_URL` | `https://YOUR-PROJECT-ID.firebaseio.com` |

> **Enable Developer Mode in Discord:** User Settings → Advanced → Developer Mode. Then right-click anything to copy IDs.

---

## Running Locally

```bash
npm install
npm start
```

---

## VPS / Droplet Deployment

### 1. Upload files to your VPS

```bash
# From your local machine
scp -r discord-bot/ root@YOUR_VPS_IP:/home/bots/
```

Or use git:
```bash
git clone your-repo /home/bots/discord-bot
```

### 2. Install Node.js on VPS (if not installed)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Install PM2 (process manager)

```bash
npm install -g pm2
```

### 4. Start the bot with PM2

```bash
cd /home/bots/discord-bot
npm install
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

### 5. Useful PM2 commands

```bash
pm2 status                    # see if bot is running
pm2 logs discord-regiment-bot # view live logs
pm2 restart discord-regiment-bot
pm2 stop discord-regiment-bot
```

---

## Slash Commands

| Command | Who | Description |
|---|---|---|
| `/queue` | Everyone | View current slots & full queue list |
| `/myposition` | Everyone | Check your queue position |
| `/promote` | Admin | Manually promote next person in queue |
| `/setslots <number>` | Admin | Change max regiment slots (auto-promotes if increased) |
| `/removemember @user` | Admin | Remove someone from regiment, frees slot |
| `/removequeue @user` | Admin | Remove someone from the queue |

---

## Firebase Data Structure

```
firestore/
├── config/
│   └── regiment/
│       ├── maxSlots: 20
│       └── currentCount: 14
├── queue/
│   └── {userId}/
│       ├── userId: "123456789"
│       ├── username: "user#1234"
│       ├── joinedAt: Timestamp
│       └── ticketNumber: 3
└── members/
    └── {userId}/
        ├── userId: "123456789"
        ├── username: "user#1234"
        └── joinedAt: Timestamp
```

---

## Troubleshooting

**Bot not detecting joins:** Make sure "Server Members Intent" is enabled in the Developer Portal AND in your bot's settings.

**Role not being assigned:** Check that the bot's role is **above** the regiment role in the server's role hierarchy (Server Settings → Roles → drag bot role higher).

**Firebase auth error:** Make sure your `FIREBASE_PRIVATE_KEY` in `.env` keeps the `\n` characters and is wrapped in double quotes.
