# Moonlight Soldiers Leveling Bot

Production Discord leveling bot using Discord.js v14 and Firebase Realtime Database.

## Features

- Awards 10-25 XP per non-bot message.
- Uses a 5-second XP cooldown per user.
- Calculates levels with cumulative XP: level 2 is 300 XP, level 3 is 600 XP.
- Announces level-ups in `LEVEL_UP_CHANNEL_ID`.
- Keeps all user rank data in memory and writes dirty users to Firebase every 60 seconds.
- Caches rank and leaderboard projections for 10 minutes.
- Logs hourly read/write/cache metrics with rough Firebase cost estimates.
- Saves pending XP on `SIGINT` and `SIGTERM`.

## Commands

```text
!rank [@user]
!leaderboard
!stats [@user]
!resetstats @user
!boostrank @user <xpAmount>
```

Admin commands require `ADMIN_USER_ID`, an ID in `ADMIN_USER_IDS`, or Discord Administrator permission.

## Firebase Data

Data is written below `FIREBASE_ROOT`, which defaults to `discord-bot`.

```text
/discord-bot
  /guilds/{guildId}
    /users/{userId}
      xp
      level
      username
      lastMessageTime
    /history/{userId}/{entryId}
    /auditLogs/{entryId}
```

## Local Run

```bash
cp .env.example .env
npm install
npm run check
npm start
```

The bot can boot without Firebase credentials only when it is already logged into Discord; XP will stay in memory until Firebase is configured.

## PM2 Deployment

```bash
npm install
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

On Oracle Cloud or any VPS, install Node.js 18 or newer before running the commands above.
