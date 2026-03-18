# 🤖 Kids Autopilot — GitHub Actions Edition

Generates and posts 3 kids educational videos to YouTube **every day**,
even when your Mac is off. Runs entirely free on GitHub Actions.

---

## ⚡ One-time setup (15 minutes total)

### Step 1 — Fork / push this repo to GitHub

```bash
# In the project folder:
git init
git add .
git commit -m "Initial commit"
# Then create a new repo on github.com and push:
git remote add origin https://github.com/YOUR_USERNAME/kids-autopilot.git
git push -u origin main
```

---

### Step 2 — Get your Claude API key

1. Go to https://console.anthropic.com
2. Create an API key
3. Copy it — you'll need it in Step 4

---

### Step 3 — Set up YouTube API credentials

1. Go to https://console.cloud.google.com
2. Create a **new project** (name it anything)
3. Click **APIs & Services → Enable APIs**
4. Search for **YouTube Data API v3** → Enable it
5. Go to **APIs & Services → Credentials**
6. Click **Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Desktop App**
   - Name: `kids-autopilot`
7. Add redirect URI: `http://localhost:3000/auth/callback`
8. Download or copy your **Client ID** and **Client Secret**

---

### Step 4 — Get your YouTube Refresh Token (run once on your Mac)

```bash
npm install
cp .env.example .env
# Fill in .env with your YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET
node scripts/get-refresh-token.js
```

This opens a browser. Log in to your YouTube channel account.
Your **refresh token** will be printed in the terminal. Copy it.

---

### Step 5 — Add secrets to GitHub

Go to your GitHub repo:
**Settings → Secrets and variables → Actions → New repository secret**

Add these 4 secrets:

| Secret Name              | Value                        |
|--------------------------|------------------------------|
| `ANTHROPIC_API_KEY`      | Your Claude API key          |
| `YOUTUBE_CLIENT_ID`      | From Google Cloud Console    |
| `YOUTUBE_CLIENT_SECRET`  | From Google Cloud Console    |
| `YOUTUBE_REFRESH_TOKEN`  | Generated in Step 4          |

---

### Step 6 — Enable Actions and test

1. Go to your repo → **Actions** tab
2. Click **Generate & Upload Kids Video**
3. Click **Run workflow** → **Run workflow** button
4. Watch it run live in the logs!

If it goes green ✅ — you're live. Videos will now post automatically at:
- **8:00 AM UTC** daily
- **12:00 PM UTC** daily
- **6:00 PM UTC** daily

---

## 📊 GitHub Actions free tier usage

| Metric              | Your usage       | Free limit       |
|---------------------|------------------|------------------|
| Runs per month      | ~90 (3/day)      | Unlimited        |
| Minutes per month   | ~720 (8 min avg) | 2,000 min/month  |
| Storage             | ~0 (no artifacts)| 500 MB           |

✅ You stay well within the free tier.

---

## 🛠️ Customising topics

**Random topics** (default): Claude picks from a built-in pool of 15 educational topics.

**Fixed topic**: Add a `VIDEO_TOPIC_SEED` secret:
- Example value: `How do plants make food?`
- Every video will be about that topic (Claude still writes unique scripts each time)

**Edit the topic pool**: Open `pipeline/pipeline.js` and edit the `TOPIC_POOL` array.

---

## 🔍 Monitoring your channel

- **GitHub Actions logs**: Repo → Actions → click any run
- **YouTube Studio**: studio.youtube.com — see every uploaded video
- **If a run fails**: GitHub emails you automatically. Check the logs.

---

## ❓ Troubleshooting

| Problem | Solution |
|---------|----------|
| `edge-tts not found` | Check the workflow installs Python packages |
| `YouTube 403 error` | Refresh token expired — run `get-refresh-token.js` again |
| `FFmpeg error` | Check the `assembleVideo` step logs for the exact command |
| Runs taking >20 min | Whisper `tiny` model is too slow — it'll auto-skip captions |
