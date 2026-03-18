/**
 * youtube.js  –  Upload a video to YouTube using OAuth2 refresh token
 *
 * No browser needed on GitHub Actions — uses a refresh token stored
 * in GitHub Secrets that you generate once on your Mac.
 */

const { google } = require('googleapis');
const fs         = require('fs');

/**
 * Build an authenticated YouTube client from stored refresh token.
 */
function getYouTubeClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    'http://localhost:3000/auth/callback'   // must match your Google Console redirect URI
  );

  oauth2.setCredentials({
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
  });

  return google.youtube({ version: 'v3', auth: oauth2 });
}

/**
 * Upload a video file to YouTube.
 *
 * @param {object} opts
 * @param {string} opts.videoPath      - Absolute path to the .mp4 file
 * @param {string} opts.title          - YouTube video title
 * @param {string} opts.description    - Video description
 * @param {string[]} opts.tags         - Array of tag strings
 * @param {string} opts.categoryId     - YouTube category ID (27 = Education)
 * @param {string} opts.privacyStatus  - 'public' | 'unlisted' | 'private'
 */
async function uploadToYouTube({ videoPath, title, description, tags, categoryId, privacyStatus }) {
  const youtube = getYouTubeClient();

  const fileSize = fs.statSync(videoPath).size;
  console.log(`   📁 File: ${videoPath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId,
        defaultLanguage: 'en',
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: true,   // Required for kids content
      },
    },
    media: {
      mimeType: 'video/mp4',
      body: fs.createReadStream(videoPath),
    },
  }, {
    // Progress logging
    onUploadProgress: (evt) => {
      const pct = Math.round((evt.bytesRead / fileSize) * 100);
      process.stdout.write(`   ⬆️  Uploading... ${pct}%\r`);
    },
  });

  const videoId  = res.data.id;
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`\n   🎉 Published: ${videoUrl}`);
  return videoUrl;
}

module.exports = { uploadToYouTube };
