/**
 * get-refresh-token.js
 *
 * Run this ONCE on your Mac to get your YouTube refresh token.
 * Then paste the token into GitHub Secrets — you never need to run it again.
 *
 * Usage:
 *   node scripts/get-refresh-token.js
 *
 * Prerequisites:
 *   1. Go to https://console.cloud.google.com
 *   2. Create a project → Enable "YouTube Data API v3"
 *   3. Create OAuth 2.0 credentials (Desktop App type)
 *   4. Add redirect URI: http://localhost:3000/auth/callback
 *   5. Fill in CLIENT_ID and CLIENT_SECRET below (or in .env)
 */

require('dotenv').config();
const { google } = require('googleapis');
const http       = require('http');
const url        = require('url');
const open       = require('open');   // npm i open

const CLIENT_ID     = process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:3000/auth/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌  Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/youtube.upload'],
  prompt: 'consent',   // Forces Google to return a refresh_token every time
});

console.log('\n🔐  Opening browser for YouTube authorisation...\n');

// Spin up a temp server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/auth/callback')) return;

  const code = url.parse(req.url, true).query.code;

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2>✅ Authorised! Check your terminal.</h2><p>You can close this tab.</p>');
  server.close();

  try {
    const { tokens } = await oauth2.getToken(code);
    console.log('\n─────────────────────────────────────────────────');
    console.log('✅  Your YouTube Refresh Token:');
    console.log('');
    console.log(tokens.refresh_token);
    console.log('');
    console.log('─────────────────────────────────────────────────');
    console.log('📋  Copy the token above and add it to GitHub:');
    console.log('    Repo → Settings → Secrets → Actions → New secret');
    console.log('    Name:  YOUTUBE_REFRESH_TOKEN');
    console.log('    Value: <paste token here>');
    console.log('─────────────────────────────────────────────────\n');
  } catch (err) {
    console.error('❌  Token exchange failed:', err.message);
  }
});

server.listen(3000, () => {
  open(authUrl);   // Opens browser automatically
  console.log('👉  If the browser does not open, visit:');
  console.log(authUrl);
});
