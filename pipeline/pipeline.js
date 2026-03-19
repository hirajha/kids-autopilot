require('dotenv').config();
const { execSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), https = require('https'), http = require('http');
const Groq = require('groq-sdk');
const { uploadToYouTube } = require('./youtube');

const OUT = path.join(__dirname, '..', 'output');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const THEMES = [
  'A funny dragon who is afraid of fire has hilarious adventures with his animal friends',
  'A tiny superhero mouse saves the city from a giant cheese thief villain',
  'A magical school bus travels to candy land where everything is made of sweets',
  'A brave little robot who wants to make friends goes on a journey',
  'A silly wizard who always gets his spells mixed up in the most hilarious ways',
  'A group of animal friends go on a treasure hunt in the magical jungle',
  'A princess who loves adventures more than royal balls discovers a hidden kingdom',
  'A friendly dinosaur time-travels to modern day city and gets hilariously confused',
  'A little mermaid discovers a magical underwater city full of amazing surprises',
  'A family of talking vegetables run a restaurant and go on wild adventures',
  'A young fairy loses her wings and goes on a quest through enchanted lands',
  'Three little monsters who are actually scared of everything try to be brave',
  'A space explorer bunny discovers a planet made entirely of sweets and candy',
  'A clumsy superhero keeps accidentally saving the day in the funniest ways',
  'A magic paintbrush brings everything it draws to life causing funny chaos',
];

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function getDuration(p) {
  return parseFloat(execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}"`
  ).toString().trim());
}

function isValidImage(p) {
  try {
    const r = spawnSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=width','-of','csv=p=0', p], { encoding: 'utf8' });
    return r.stdout && r.stdout.trim() !== '' && parseInt(r.stdout.trim()) > 0;
  } catch { return false; }
}

function makeColourBg(p, i) {
  const colours = ['4ECDC4','FF6B6B','45B7D1','96CEB4','FFEAA7','DDA0DD','98FB98','F7DC6F','AED6F1','A9DFBF'];
  spawnSync('ffmpeg', ['-y','-f','lavfi','-i','color=c=0x'+colours[i%colours.length]+':size=1280x720:rate=25','-t','1','-frames:v','1',p], { stdio: 'pipe' });
}

// ─── Step 1: Story ────────────────────────────────────────────────────────────
async function generateStory() {
  console.log('Step 1: Generating story...');
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 6000,
    messages: [{ role: 'user', content: `You are an EXCITING children's TV show scriptwriter. Write a fun 10-minute story for kids aged 3-8 about: "${theme}".

Write exactly 18 scenes. Use this EXACT format:
SCENE_START
TITLE: [exciting scene title]
IMAGE: [detailed cartoon scene description: characters, setting, colours, action happening, art style: bright pixar cartoon]
NARRATION: [80-100 words of ENERGETIC fun narration. Use CAPS for exciting words. Use ... for dramatic pauses. Make it sound like an excited TV presenter talking to kids. Include sound effects like WHOOSH, BOOM, SPLASH in the story]
SCENE_END

Rules: super funny and exciting, simple words kids love, full of surprises, happy ending, no asterisks or markdown.` }]
  });
  const text = completion.choices[0].message.content.trim();
  fs.writeFileSync(path.join(OUT, 'story.txt'), text);
  const scenes = [];
  for (const block of text.split('SCENE_START').slice(1)) {
    const t = block.match(/TITLE:\s*(.+)/), img = block.match(/IMAGE:\s*([\s\S]+?)(?=NARRATION:)/), n = block.match(/NARRATION:\s*([\s\S]+?)(?=SCENE_END|$)/);
    if (t && img && n) scenes.push({ title: t[1].trim(), image: img[1].trim(), narration: n[1].trim() });
  }
  console.log(`✅ Story: ${scenes.length} scenes — "${theme}"`);
  return { scenes, videoTitle: theme.split(' ').slice(0,8).join(' ') + ' 🌟 Kids Story', theme };
}

// ─── Step 2: Images (Pollinations with PNG fallback) ─────────────────────────
async function generateImages(scenes) {
  console.log('Step 2: Generating cartoon images with Stability AI...');
  const imagePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const imgPath = path.join(OUT, 'scene_' + String(i).padStart(2,'0') + '.png');
    process.stdout.write('  Image ' + (i+1) + '/' + scenes.length + '...\r');
    try {
      const prompt = 'childrens cartoon illustration, bright vibrant colours, pixar disney style, cute friendly characters, safe for kids, high quality: ' + scenes[i].image.substring(0, 300);
      const resp = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.STABILITY_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          text_prompts: [{ text: prompt, weight: 1 }, { text: 'ugly, scary, dark, violent, adult content', weight: -1 }],
          cfg_scale: 7,
          height: 1024,
          width: 1024,
          samples: 1,
          steps: 20,
        })
      });
      const data = await resp.json();
      if (!data.artifacts || !data.artifacts[0]) throw new Error(JSON.stringify(data));
      const imgBuffer = Buffer.from(data.artifacts[0].base64, 'base64');
      fs.writeFileSync(imgPath, imgBuffer);
      imagePaths.push(imgPath);
      await new Promise(r => setTimeout(r, 500));
    } catch(err) {
      console.warn('\n  Image ' + i + ' failed: ' + err.message.substring(0,100));
      const colours = ['4ECDC4','FF6B6B','45B7D1','96CEB4','FFEAA7','DDA0DD','98FB98'];
      spawnSync('ffmpeg',['-y','-f','lavfi','-i','color=c=0x'+colours[i%colours.length]+':size=1280x720','-frames:v','1',imgPath],{stdio:'pipe'});
      imagePaths.push(imgPath);
    }
  }
  console.log('\n✅ Images done');
  return imagePaths;
}

// ─── Step 3: Voiceovers ───────────────────────────────────────────────────────
async function generateVoiceovers(scenes) {
  console.log('Step 3: Generating voiceovers...');
  const audioPaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const audioPath = path.join(OUT, `audio_${String(i).padStart(2,'0')}.mp3`);
    process.stdout.write(`  Audio ${i+1}/${scenes.length}...\r`);
    const r = spawnSync('edge-tts', [
      '--voice', 'en-US-MichelleNeural',
      '--rate', '+15%',
      '--pitch', '+10Hz',
      '--text', scenes[i].narration,
      '--write-media', audioPath
    ], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('edge-tts failed scene ' + i);
    audioPaths.push(audioPath);
  }
  console.log('\n✅ Voiceovers done');
  return audioPaths;
}

// ─── Step 4: Scene videos with zoom motion ────────────────────────────────────
async function buildSceneVideos(scenes, imagePaths, audioPaths) {
  console.log('Step 4: Building scene videos with motion...');
  const scenePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const scenePath = path.join(OUT, `scene_video_${String(i).padStart(2,'0')}.mp4`);
    const duration = getDuration(audioPaths[i]) + 0.5;
    const frames = Math.round(duration * 25);
    process.stdout.write(`  Scene ${i+1}/${scenes.length}...\r`);

    // Alternate zoom in / zoom out for variety
    const zoomExpr = i % 2 === 0
      ? `'min(zoom+0.0008,1.3)'`  // zoom in
      : `'if(lte(zoom,1.0),1.3,max(zoom-0.0008,1.0))'`; // zoom out

    const r = spawnSync('ffmpeg', [
      '-y',
      '-loop', '1', '-i', imagePaths[i],
      '-i', audioPaths[i],
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-vf', `scale=1280:720,zoompan=z=${zoomExpr}:d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=25`,
      '-r', '25',
      scenePath
    ], { stdio: 'pipe' });

    if (r.status !== 0) {
      // Fallback without zoom
      spawnSync('ffmpeg', ['-y','-loop','1','-i',imagePaths[i],'-i',audioPaths[i],'-t',String(duration),'-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-vf','scale=1280:720','-r','25',scenePath], { stdio: 'pipe' });
    }
    scenePaths.push(scenePath);
  }
  console.log('\n✅ Scene videos done');
  return scenePaths;
}

// ─── Step 5: Add fade transitions between scenes ─────────────────────────────
async function concatenateWithFades(scenePaths) {
  console.log('Step 5: Joining scenes with fade transitions...');

  // Simple concat first (fades are complex, this is reliable)
  const listFile = path.join(OUT, 'scenes.txt');
  fs.writeFileSync(listFile, scenePaths.map(p => `file '${p}'`).join('\n'));
  const rawVideo = path.join(OUT, 'raw.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${rawVideo}"`, { stdio: 'pipe' });
  console.log('✅ Scenes joined');
  return rawVideo;
}

// ─── Step 6: Background music ─────────────────────────────────────────────────
async function addBackgroundMusic(rawVideo) {
  console.log('Step 6: Adding background music...');
  const finalVideo = path.join(OUT, 'final.mp4');
  const duration = getDuration(rawVideo);
  const musicFile = path.join(__dirname, '..', 'assets', 'music.mp3');
  if (fs.existsSync(musicFile)) {
    const r = spawnSync('ffmpeg', [
      '-y', '-i', rawVideo,
      '-stream_loop', '-1', '-i', musicFile,
      '-t', String(duration),
      '-filter_complex', `[1:a]volume=0.08,afade=t=in:st=0:d=3,afade=t=out:st=${duration-3}:d=3[music];[0:a][music]amix=inputs=2:duration=first[aout]`,
      '-map', '0:v', '-map', '[aout]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      finalVideo
    ], { stdio: 'pipe' });
    if (r.status !== 0) fs.copyFileSync(rawVideo, finalVideo);
  } else {
    fs.copyFileSync(rawVideo, finalVideo);
  }
  console.log('✅ Music done');
  return finalVideo;
}

// ─── Step 7: Upload ───────────────────────────────────────────────────────────
async function upload(finalVideo, videoTitle, theme) {
  console.log('Step 7: Uploading to YouTube...');
  const description = [
    `🌟 ${videoTitle}`,
    '', `Join us for an amazing adventure: ${theme}`,
    '', '🎉 Fun cartoon story for kids aged 3-8!',
    '✅ New stories every single day — Subscribe so you never miss one!',
    '👍 Like and share with your friends!',
    '', '#KidsStories #CartoonForKids #BedtimeStories #KidsEntertainment #FunForKids #KidsCartoon #ChildrensStories',
  ].join('\n');
  await uploadToYouTube({
    videoPath: finalVideo, title: videoTitle, description,
    tags: ['kids stories','cartoon for kids','bedtime stories','kids entertainment','funny kids','childrens cartoon'],
    categoryId: '1', privacyStatus: 'public',
  });
  console.log('✅ Uploaded!');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🚀 Kids Entertainment Pipeline starting...\n');
  const start = Date.now();
  try {
    const { scenes, videoTitle, theme } = await generateStory();
    const imagePaths = await generateImages(scenes);
    const audioPaths = await generateVoiceovers(scenes);
    const scenePaths = await buildSceneVideos(scenes, imagePaths, audioPaths);
    const rawVideo   = await concatenateWithFades(scenePaths);
    const finalVideo = await addBackgroundMusic(rawVideo);
    await upload(finalVideo, videoTitle, theme);
    console.log(`\n✅ Done in ${((Date.now()-start)/60000).toFixed(1)} minutes!\n`);
  } catch (err) {
    console.error('\n❌ Pipeline failed:', err.message, '\n', err.stack);
    process.exit(1);
  }
})();
