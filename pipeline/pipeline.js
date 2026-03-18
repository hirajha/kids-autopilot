/**
 * pipeline.js  –  Full kids-video pipeline for GitHub Actions
 *
 * Flow:
 *   1. Claude  → script (topic + narration)
 *   2. edge-tts → voiceover MP3
 *   3. FFmpeg  → combine background + audio → MP4
 *   4. Whisper → auto-captions (burned into video)
 *   5. YouTube → upload finished video
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { uploadToYouTube } = require('./youtube');

// ─── Paths ────────────────────────────────────────────────────────────────────
const OUT   = path.join(__dirname, '..', 'output');
const ASSETS= path.join(__dirname, '..', 'assets');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const AUDIO_FILE   = path.join(OUT, 'narration.mp3');
const RAW_VIDEO    = path.join(OUT, 'raw.mp4');
const FINAL_VIDEO  = path.join(OUT, 'final.mp4');
const CAPTION_FILE = path.join(OUT, 'captions.srt');

// ─── Topic pool (Claude picks from these or generates fresh) ─────────────────
const TOPIC_POOL = [
  'Why is the sky blue?',
  'How do volcanoes work?',
  'What are black holes?',
  'How do bees make honey?',
  'Why does the moon change shape?',
  'How do fish breathe underwater?',
  'What makes a rainbow?',
  'How do planes fly?',
  'Why do we dream?',
  'What are dinosaurs and why did they disappear?',
  'How does the human heart work?',
  'What is gravity?',
  'How do spiders make webs?',
  'Why is the ocean salty?',
  'How do trees grow so tall?',
];

// ─── Step 1: Generate script with Claude ─────────────────────────────────────
async function generateScript() {
  console.log('🤖  Step 1: Generating script with Claude...');

  const seed = process.env.VIDEO_TOPIC_SEED;
  const topic = seed || TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const msg = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are a scriptwriter for a YouTube kids educational channel.
Write a fun, engaging 90-second narration script for children aged 4–8 about:
"${topic}"

Rules:
- Use simple vocabulary a 5-year-old understands
- Include 2 fun facts they can tell their parents
- End with an encouraging call to subscribe
- NO markdown, NO stage directions — plain spoken words only
- Aim for ~220 words (reads in ~90 seconds at normal pace)

Topic: ${topic}`
    }]
  });

  const script = msg.content[0].text.trim();
  const title  = `${topic} 🌟 Fun Facts for Kids!`;

  fs.writeFileSync(path.join(OUT, 'script.txt'), script);
  console.log(`   ✅ Script ready — topic: "${topic}"`);
  return { script, title, topic };
}

// ─── Step 2: Text-to-speech with edge-tts ────────────────────────────────────
async function generateVoiceover(script) {
  console.log('🎙️   Step 2: Generating voiceover with edge-tts...');

  // Escape single quotes in script for shell safety
  const safeScript = script.replace(/'/g, "'\\''");

  const result = spawnSync('edge-tts', [
    '--voice', 'en-US-AriaNeural',
    '--text', script,
    '--write-media', AUDIO_FILE,
  ], { encoding: 'utf8' });

  if (result.status !== 0) {
    console.error(result.stderr);
    throw new Error('edge-tts failed');
  }

  // Get audio duration
  const probe = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${AUDIO_FILE}"`
  ).toString().trim();

  const duration = parseFloat(probe);
  console.log(`   ✅ Voiceover ready — ${duration.toFixed(1)}s`);
  return duration;
}

// ─── Step 3: Assemble video with FFmpeg ──────────────────────────────────────
async function assembleVideo(duration) {
  console.log('🎬  Step 3: Assembling video with FFmpeg...');

  // Use bundled background image or generate a solid colour background
  const bgImage = path.join(ASSETS, 'background.jpg');
  let bgSource;

  if (fs.existsSync(bgImage)) {
    bgSource = `-loop 1 -i "${bgImage}"`;
  } else {
    // Generate a colourful gradient background on the fly
    bgSource = `-f lavfi -i color=c=0x1a1a2e:size=1280x720:rate=30`;
  }

  const cmd = [
    'ffmpeg -y',
    bgSource,
    `-i "${AUDIO_FILE}"`,
    `-t ${duration}`,
    '-c:v libx264 -tune stillimage -preset fast',
    '-c:a aac -b:a 192k',
    '-pix_fmt yuv420p',
    `-vf "scale=1280:720,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='Kids Learn':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=80:shadowcolor=black:shadowx=3:shadowy=3"`,
    `"${RAW_VIDEO}"`
  ].join(' ');

  execSync(cmd, { stdio: 'pipe' });
  console.log('   ✅ Raw video assembled');
}

// ─── Step 4: Generate captions with Whisper and burn them in ─────────────────
async function addCaptions() {
  console.log('📝  Step 4: Generating captions with Whisper...');

  try {
    // Run whisper to generate SRT
    execSync(
      `python3 -m whisper "${AUDIO_FILE}" --model tiny --output_format srt --output_dir "${OUT}"`,
      { stdio: 'pipe', timeout: 120_000 }
    );

    const generatedSrt = path.join(OUT, 'narration.srt');
    if (fs.existsSync(generatedSrt)) {
      fs.renameSync(generatedSrt, CAPTION_FILE);
    }

    // Burn captions into video
    const captionCmd = [
      'ffmpeg -y',
      `-i "${RAW_VIDEO}"`,
      `-vf "subtitles=${CAPTION_FILE}:force_style='FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Bold=1'"`,
      '-c:a copy',
      `"${FINAL_VIDEO}"`
    ].join(' ');

    execSync(captionCmd, { stdio: 'pipe' });
    console.log('   ✅ Captions burned in');

  } catch (err) {
    // Captions optional — fall back to raw video
    console.warn('   ⚠️  Whisper captions failed, using video without captions');
    fs.copyFileSync(RAW_VIDEO, FINAL_VIDEO);
  }
}

// ─── Step 5: Upload to YouTube ────────────────────────────────────────────────
async function upload(title, topic) {
  console.log('📤  Step 5: Uploading to YouTube...');

  const description = [
    `🌟 ${title}`,
    '',
    `In this video, we explore: "${topic}" — explained simply for kids aged 4-8!`,
    '',
    '✅ Subscribe for new fun facts every day!',
    '',
    '#KidsLearning #EducationalKids #FunFacts #KidsScience #LearnWithMe',
  ].join('\n');

  const tags = ['kids', 'education', 'learning', 'fun facts', 'science for kids', topic];

  await uploadToYouTube({
    videoPath:   FINAL_VIDEO,
    title,
    description,
    tags,
    categoryId:  '27',    // Education
    privacyStatus: 'public',
  });

  console.log('   ✅ Upload complete!');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🚀  Kids Autopilot Pipeline starting...\n');
  const start = Date.now();

  try {
    const { script, title, topic } = await generateScript();
    const duration = await generateVoiceover(script);
    await assembleVideo(duration);
    await addCaptions();
    await upload(title, topic);

    const mins = ((Date.now() - start) / 60000).toFixed(1);
    console.log(`\n✅  Pipeline complete in ${mins} minutes!\n`);
  } catch (err) {
    console.error('\n❌  Pipeline failed:', err.message);
    console.error(err.stack);
    process.exit(1);   // Non-zero exit = GitHub Actions marks run as failed
  }
})();
