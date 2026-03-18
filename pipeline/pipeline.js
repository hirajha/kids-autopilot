const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { uploadToYouTube } = require('./youtube');

const OUT   = path.join(__dirname, '..', 'output');
const ASSETS= path.join(__dirname, '..', 'assets');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const AUDIO_FILE   = path.join(OUT, 'narration.mp3');
const RAW_VIDEO    = path.join(OUT, 'raw.mp4');
const FINAL_VIDEO  = path.join(OUT, 'final.mp4');
const CAPTION_FILE = path.join(OUT, 'captions.srt');

const TOPIC_POOL = [
  'Why is the sky blue?','How do volcanoes work?','What are black holes?',
  'How do bees make honey?','Why does the moon change shape?',
  'How do fish breathe underwater?','What makes a rainbow?',
  'How do planes fly?','Why do we dream?','What are dinosaurs?',
  'How does the human heart work?','What is gravity?',
  'How do spiders make webs?','Why is the ocean salty?','How do trees grow?',
];

async function generateScript() {
  console.log('🤖  Step 1: Generating script with Gemini...');
  const topic = process.env.VIDEO_TOPIC_SEED || TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(
    `You are a scriptwriter for a YouTube kids educational channel.
Write a fun, engaging 90-second narration script for children aged 4-8 about: "${topic}"
Rules:
- Use simple vocabulary a 5-year-old understands
- Include 2 fun facts they can tell their parents
- End with an encouraging call to subscribe
- NO markdown, NO stage directions — plain spoken words only
- Aim for ~220 words (reads in ~90 seconds at normal pace)`
  );
  const script = result.response.text().trim();
  const title  = `${topic} 🌟 Fun Facts for Kids!`;
  fs.writeFileSync(path.join(OUT, 'script.txt'), script);
  console.log(`   ✅ Script ready — topic: "${topic}"`);
  return { script, title, topic };
}

async function generateVoiceover(script) {
  console.log('🎙️   Step 2: Generating voiceover with edge-tts...');
  const result = spawnSync('edge-tts', [
    '--voice', 'en-US-AriaNeural',
    '--text', script,
    '--write-media', AUDIO_FILE,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('edge-tts failed: ' + result.stderr);
  const probe = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${AUDIO_FILE}"`
  ).toString().trim();
  const duration = parseFloat(probe);
  console.log(`   ✅ Voiceover ready — ${duration.toFixed(1)}s`);
  return duration;
}

async function assembleVideo(duration) {
  console.log('🎬  Step 3: Assembling video with FFmpeg...');
  const bgImage = path.join(ASSETS, 'background.jpg');
  const bgSource = fs.existsSync(bgImage)
    ? `-loop 1 -i "${bgImage}"`
    : `-f lavfi -i color=c=0x1a1a2e:size=1280x720:rate=30`;
  const cmd = [
    'ffmpeg -y', bgSource, `-i "${AUDIO_FILE}"`, `-t ${duration}`,
    '-c:v libx264 -tune stillimage -preset fast',
    '-c:a aac -b:a 192k -pix_fmt yuv420p',
    `-vf "scale=1280:720,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='Kids Learn':fontsize=60:fontcolor=white:x=(w-text_w)/2:y=80:shadowcolor=black:shadowx=3:shadowy=3"`,
    `"${RAW_VIDEO}"`
  ].join(' ');
  execSync(cmd, { stdio: 'pipe' });
  console.log('   ✅ Raw video assembled');
}

async function addCaptions() {
  console.log('📝  Step 4: Generating captions...');
  try {
    execSync(`python3 -m whisper "${AUDIO_FILE}" --model tiny --output_format srt --output_dir "${OUT}"`, { stdio: 'pipe', timeout: 120000 });
    const generatedSrt = path.join(OUT, 'narration.srt');
    if (fs.existsSync(generatedSrt)) fs.renameSync(generatedSrt, CAPTION_FILE);
    execSync(`ffmpeg -y -i "${RAW_VIDEO}" -vf "subtitles=${CAPTION_FILE}:force_style='FontSize=22,PrimaryColour=&H00FFFFFF,Bold=1'" -c:a copy "${FINAL_VIDEO}"`, { stdio: 'pipe' });
    console.log('   ✅ Captions burned in');
  } catch {
    console.warn('   ⚠️  Captions skipped');
    fs.copyFileSync(RAW_VIDEO, FINAL_VIDEO);
  }
}

async function upload(title, topic) {
  console.log('📤  Step 5: Uploading to YouTube...');
  const description = `🌟 ${title}\n\nIn this video we explore: "${topic}" — explained simply for kids aged 4-8!\n\n✅ Subscribe for new fun facts every day!\n\n#KidsLearning #EducationalKids #FunFacts`;
  await uploadToYouTube({ videoPath: FINAL_VIDEO, title, description, tags: ['kids','education','learning', topic], categoryId: '27', privacyStatus: 'public' });
  console.log('   ✅ Upload complete!');
}

(async () => {
  console.log('\n🚀  Kids Autopilot Pipeline starting...\n');
  try {
    const { script, title, topic } = await generateScript();
    const duration = await generateVoiceover(script);
    await assembleVideo(duration);
    await addCaptions();
    await upload(title, topic);
    console.log('\n✅  Pipeline complete!\n');
  } catch (err) {
    console.error('\n❌  Pipeline failed:', err.message);
    process.exit(1);
  }
})();
