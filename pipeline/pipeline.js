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
  'A magical flying carpet travels to candy land where everything is made of sweets',
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
  spawnSync('ffmpeg', ['-y','-f','lavfi','-i','color=c=0x'+colours[i%colours.length]+':size=1920x1080:rate=25','-t','1','-frames:v','1',p], { stdio: 'pipe' });
}

// ─── Step 1: Story ────────────────────────────────────────────────────────────
async function generateStory() {
  console.log('Step 1: Generating story...');
  
  // Load story history to avoid duplicates
  const historyFile = path.join(__dirname, '..', 'story_history.json');
  let usedThemes = [];
  if (fs.existsSync(historyFile)) {
    try { usedThemes = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}
  }
  
  // Pick theme not used in last 30 stories
  const recentThemes = usedThemes.slice(-30);
  const availableThemes = THEMES.filter(t => !recentThemes.includes(t));
  const themePool = availableThemes.length > 0 ? availableThemes : THEMES;
  const theme = themePool[Math.floor(Math.random() * themePool.length)];
  
  // Save to history
  usedThemes.push(theme);
  fs.writeFileSync(historyFile, JSON.stringify(usedThemes.slice(-100)));
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    max_tokens: 6000,
    messages: [{ role: 'user', content: `You are an EXCITING children's TV show scriptwriter. Write a fun 10-minute story for kids aged 3-8 about: "${theme}".

Write exactly 20 scenes. Use this EXACT format:
SCENE_START
TITLE: [exciting scene title]
IMAGE: [detailed cartoon scene description: characters, setting, colours, action happening, art style: bright pixar cartoon]
NARRATION: [150-180 words of ENERGETIC fun narration. Use CAPS for exciting words. Use ... for dramatic pauses. Make it sound like an excited TV presenter talking to kids. Include sound effects like WHOOSH, BOOM, SPLASH in the story]
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
  console.log('Step 2: Generating cartoon images with Stability AI (with cache)...');
  
  // Cache folder — persists between runs
  const CACHE_DIR = path.join(__dirname, '..', 'image_cache');
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Extract keywords from image description to find cache matches
  function getCacheKey(imageDesc) {
    const keywords = ['restaurant', 'forest', 'castle', 'kitchen', 'market', 'ocean', 'beach',
      'mountain', 'school', 'house', 'garden', 'city', 'space', 'jungle', 'cave', 'lake',
      'dragon', 'bunny', 'robot', 'princess', 'monster', 'fairy', 'wizard', 'dinosaur',
      'celebration', 'party', 'night', 'morning', 'rain', 'snow', 'fire', 'rainbow'];
    const desc = imageDesc.toLowerCase();
    const found = keywords.filter(k => desc.includes(k)).slice(0, 3);
    return found.length > 0 ? found.join('_') : null;
  }

  const imagePaths = [];
  let cacheHits = 0;
  let newGenerations = 0;

  for (let i = 0; i < scenes.length; i++) {
    const imgPath = path.join(OUT, 'scene_' + String(i).padStart(2,'0') + '.png');
    process.stdout.write('  Image ' + (i+1) + '/' + scenes.length + '...\r');

    // Check cache first
    const cacheKey = getCacheKey(scenes[i].image);
    const cacheFiles = cacheKey ? fs.readdirSync(CACHE_DIR).filter(f => f.startsWith(cacheKey)) : [];
    
    if (cacheFiles.length > 0) {
      // Reuse cached image
      const randomCache = cacheFiles[Math.floor(Math.random() * cacheFiles.length)];
      fs.copyFileSync(path.join(CACHE_DIR, randomCache), imgPath);
      cacheHits++;
      imagePaths.push(imgPath);
      continue;
    }

    // Generate new image
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
          text_prompts: [
            { text: prompt, weight: 1 },
            { text: 'ugly, scary, dark, violent, adult content, blurry', weight: -1 }
          ],
          cfg_scale: 7,
          height: 768,
          width: 1344,
          samples: 1,
          steps: 30,
        })
      });
      const data = await resp.json();
      if (!data.artifacts || !data.artifacts[0]) throw new Error(JSON.stringify(data).substring(0,200));
      const imgBuffer = Buffer.from(data.artifacts[0].base64, 'base64');
      fs.writeFileSync(imgPath, imgBuffer);
      
      // Save to cache
      if (cacheKey) {
        const cacheFile = path.join(CACHE_DIR, cacheKey + '_' + Date.now() + '.png');
        fs.writeFileSync(cacheFile, imgBuffer);
      }
      
      newGenerations++;
      imagePaths.push(imgPath);
      await new Promise(r => setTimeout(r, 500));
    } catch(err) {
      console.warn('\n  Image ' + i + ' failed: ' + err.message.substring(0,100));
      const colours = ['4ECDC4','FF6B6B','45B7D1','96CEB4','FFEAA7','DDA0DD','98FB98'];
      spawnSync('ffmpeg',['-y','-f','lavfi','-i','color=c=0x'+colours[i%colours.length]+':size=1344x768','-frames:v','1',imgPath],{stdio:'pipe'});
      imagePaths.push(imgPath);
    }
  }
  console.log('\n✅ Images done — ' + newGenerations + ' new generated, ' + cacheHits + ' from cache (saved ' + cacheHits + ' credits!)');
  return imagePaths;
}

// ─── Step 3: Voiceovers (Kokoro TTS primary, edge-tts fallback) ──────────────
async function generateVoiceovers(scenes) {
  console.log('Step 3: Generating voiceovers...');
  const audioPaths = [];

  // Try loading Kokoro TTS (ESM module, needs dynamic import)
  let tts = null;
  try {
    const { KokoroTTS } = await import('kokoro-js');
    console.log('  Loading Kokoro TTS model (first run downloads ~100MB)...');
    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'cpu',
    });
    console.log('  ✅ Kokoro TTS loaded — using af_heart voice (Grade A)');
  } catch (err) {
    console.log('  ⚠️ Kokoro TTS not available: ' + err.message.substring(0, 100));
    console.log('  Falling back to edge-tts...');
  }

  for (let i = 0; i < scenes.length; i++) {
    const audioPath = path.join(OUT, `audio_${String(i).padStart(2,'0')}.mp3`);
    process.stdout.write(`  Audio ${i+1}/${scenes.length}...\r`);

    let generated = false;

    // Primary: Kokoro TTS (natural human voice)
    if (tts) {
      try {
        const wavPath = audioPath.replace('.mp3', '_kokoro.wav');
        const audio = await tts.generate(scenes[i].narration, {
          voice: 'af_heart',  // top-rated natural female voice (Grade A)
        });
        audio.save(wavPath);

        // Convert WAV to MP3 with loudness normalization
        try {
          execSync(`ffmpeg -y -i "${wavPath}" -af "loudnorm=I=-16:TP=-1.5:LRA=11,equalizer=f=3000:width_type=o:width=2:g=1.5" -b:a 320k "${audioPath}"`, { stdio: 'pipe' });
        } catch {
          // Try without loudnorm if it fails
          execSync(`ffmpeg -y -i "${wavPath}" -b:a 320k "${audioPath}"`, { stdio: 'pipe' });
        }

        if (fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
          generated = true;
          try { fs.unlinkSync(wavPath); } catch {} // cleanup WAV
        }
      } catch (err) {
        console.log(`\n  ⚠️ Kokoro failed scene ${i}: ${err.message.substring(0, 80)}`);
      }
    }

    // Fallback: edge-tts
    if (!generated) {
      const r = spawnSync('edge-tts', [
        '--voice', 'en-US-MichelleNeural',
        '--rate', '+8%',
        '--pitch', '+15Hz',
        '--text', scenes[i].narration,
        '--write-media', audioPath, '--write-subtitles', '/dev/null'
      ], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('edge-tts failed scene ' + i);
      // Enhance audio quality
      const enhancedPath = audioPath.replace('.mp3', '_enhanced.mp3');
      spawnSync('ffmpeg', [
        '-y', '-i', audioPath,
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,equalizer=f=3000:width_type=o:width=2:g=1.5',
        '-b:a', '320k', enhancedPath
      ], { stdio: 'pipe' });
      if (fs.existsSync(enhancedPath)) fs.renameSync(enhancedPath, audioPath);
    }

    audioPaths.push(audioPath);
  }
  console.log(`\n✅ Voiceovers done (${tts ? 'Kokoro TTS' : 'edge-tts'})`);
  return audioPaths;
}

// ─── Step 4: Scene videos with Ken Burns motion ───────────────────────────────
async function buildSceneVideos(scenes, imagePaths, audioPaths) {
  console.log('Step 4: Building scene videos with Ken Burns animation...');
  const scenePaths = [];

  // 6 distinct Ken Burns motion patterns for variety
  // Each returns { z, x, y } expressions for zoompan filter
  function getMotion(i, frames) {
    const pattern = i % 6;
    switch (pattern) {
      case 0: // Slow zoom in, centered
        return {
          z: `'min(zoom+0.001,1.4)'`,
          x: `'iw/2-(iw/zoom/2)'`,
          y: `'ih/2-(ih/zoom/2)'`
        };
      case 1: // Zoom out from close-up
        return {
          z: `'if(lte(zoom,1.0),1.4,max(zoom-0.001,1.0))'`,
          x: `'iw/2-(iw/zoom/2)'`,
          y: `'ih/2-(ih/zoom/2)'`
        };
      case 2: // Pan left to right + slight zoom
        return {
          z: `'min(zoom+0.0005,1.2)'`,
          x: `'if(lte(on,1),0,min(on*${(0.2/(frames||1)).toFixed(8)}*iw,iw/5))'`,
          y: `'ih/2-(ih/zoom/2)'`
        };
      case 3: // Pan right to left + slight zoom
        return {
          z: `'min(zoom+0.0005,1.2)'`,
          x: `'if(lte(on,1),iw/5,max(iw/5-on*${(0.2/(frames||1)).toFixed(8)}*iw,0))'`,
          y: `'ih/2-(ih/zoom/2)'`
        };
      case 4: // Zoom in on upper area (sky/top of scene)
        return {
          z: `'min(zoom+0.0008,1.35)'`,
          x: `'iw/2-(iw/zoom/2)'`,
          y: `'if(lte(on,1),ih/6,ih/6)'`
        };
      case 5: // Zoom in on lower area (ground/characters)
        return {
          z: `'min(zoom+0.0008,1.35)'`,
          x: `'iw/2-(iw/zoom/2)'`,
          y: `'ih/3-(ih/zoom/3)'`
        };
    }
  }

  for (let i = 0; i < scenes.length; i++) {
    const scenePath = path.join(OUT, `scene_video_${String(i).padStart(2,'0')}.mp4`);
    const duration = getDuration(audioPaths[i]) + 0.5;
    const frames = Math.round(duration * 25);
    process.stdout.write(`  Scene ${i+1}/${scenes.length}...\r`);

    const motion = getMotion(i, frames);

    const r = spawnSync('ffmpeg', [
      '-y',
      '-loop', '1', '-i', imagePaths[i],
      '-i', audioPaths[i],
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '320k',
      '-vf', `scale=1920:1080,zoompan=z=${motion.z}:d=${frames}:x=${motion.x}:y=${motion.y}:s=1920x1080:fps=25`,
      '-r', '25',
      scenePath
    ], { stdio: 'pipe' });

    if (r.status !== 0) {
      // Fallback without zoom
      spawnSync('ffmpeg', ['-y','-loop','1','-i',imagePaths[i],'-i',audioPaths[i],'-t',String(duration),'-c:v','libx264','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-vf','scale=1920:1080','-r','25',scenePath], { stdio: 'pipe' });
    }
    scenePaths.push(scenePath);
  }
  console.log('\n✅ Scene videos done (Ken Burns animation)');
  return scenePaths;
}

// ─── Step 5: Join scenes with crossfade transitions ──────────────────────────
async function concatenateWithFades(scenePaths) {
  console.log('Step 5: Joining scenes with crossfade transitions...');

  const FADE_DURATION = 0.5; // seconds of crossfade between scenes

  // Get duration of each scene video
  const durations = scenePaths.map(p => getDuration(p));

  // Build xfade filter chain: [0][1]xfade -> [v01], [v01][2]xfade -> [v012], etc.
  // Also build audio crossfade with acrossfade
  const inputs = scenePaths.map((p, i) => ['-i', p]).flat();
  const filterParts = [];
  const audioFilterParts = [];
  let prevLabel = '[0:v]';
  let prevALabel = '[0:a]';
  let offsetAccum = durations[0] - FADE_DURATION;

  for (let i = 1; i < scenePaths.length; i++) {
    const outLabel = i < scenePaths.length - 1 ? `[v${i}]` : '[vout]';
    const outALabel = i < scenePaths.length - 1 ? `[a${i}]` : '[aout]';

    // Alternate between transition effects for variety
    const effects = ['fade', 'fadeblack', 'slideleft', 'slideup', 'circlecrop', 'dissolve'];
    const effect = effects[i % effects.length];

    filterParts.push(`${prevLabel}[${i}:v]xfade=transition=${effect}:duration=${FADE_DURATION}:offset=${offsetAccum.toFixed(2)}${outLabel}`);
    audioFilterParts.push(`${prevALabel}[${i}:a]acrossfade=d=${FADE_DURATION}:c1=tri:c2=tri${outALabel}`);

    prevLabel = outLabel;
    prevALabel = outALabel;
    offsetAccum += durations[i] - FADE_DURATION;
  }

  const rawVideo = path.join(OUT, 'raw.mp4');

  // Try crossfade approach
  if (scenePaths.length > 1) {
    const filterComplex = filterParts.join(';') + ';' + audioFilterParts.join(';');
    const r = spawnSync('ffmpeg', [
      '-y',
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'fast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '320k',
      '-r', '25',
      rawVideo
    ], { stdio: 'pipe', timeout: 600000 });

    if (r.status === 0) {
      console.log('✅ Scenes joined with crossfade transitions');
      return rawVideo;
    }
    console.log('  Crossfade failed, falling back to simple concat...');
  }

  // Fallback: simple concat (always works)
  const listFile = path.join(OUT, 'scenes.txt');
  fs.writeFileSync(listFile, scenePaths.map(p => `file '${p}'`).join('\n'));
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${rawVideo}"`, { stdio: 'pipe' });
  console.log('✅ Scenes joined (simple concat)');
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
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k',
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
async function upload(finalVideo, videoTitle, theme, scenes) {
  console.log('Step 7: Uploading to YouTube...');
  
  // Generate SEO-friendly title
  const seoTitle = videoTitle
    .replace('🌟 Kids Story', '| Bedtime Story for Kids')
    .replace('A funny', 'The Funny')
    .replace('A tiny', 'The Tiny')
    .replace('A brave', 'The Brave')
    .replace('A silly', 'The Silly')
    .replace('A group of', 'The')
    .replace('A princess', 'The Princess')
    .replace('A friendly', 'The Friendly')
    .replace('A little', 'The Little')
    .replace('A family of', 'The')
    .replace('A young', 'The Young')
    .replace('A space', 'The Space')
    .replace('A magic', 'The Magic')
    .substring(0, 90);

  // Generate timestamps from scenes
  let timestamps = '\n⏱️ CHAPTERS:\n0:00 - Introduction\n';
  let currentTime = 30;
  for (let i = 0; i < Math.min(scenes.length, 10); i++) {
    const mins = Math.floor(currentTime / 60);
    const secs = String(currentTime % 60).padStart(2, '0');
    timestamps += `${mins}:${secs} - ${scenes[i].title}\n`;
    currentTime += 45;
  }

  const description = [
    `🌟 ${seoTitle}`,
    '',
    `📖 Tonight's story: ${theme}`,
    '',
    '🎯 Perfect for:',
    '• Bedtime stories for toddlers',
    '• Kids aged 2-8 years old',
    '• Learning English through stories',
    '• Quiet time and relaxation',
    '',
    timestamps,
    '',
    '✅ NEW stories posted EVERY DAY — Subscribe & hit the 🔔 bell!',
    '👍 If your child enjoyed this, please LIKE and SHARE!',
    '',
    '🌙 About Limitless Bedtime Stories:',
    'We create magical, fun and safe bedtime stories for children around the world. Our stories help kids develop imagination, learn new words, and fall asleep peacefully.',
    '',
    '🤖 AI Disclosure: This video was created using AI tools. The story, images, and voiceover were generated with the assistance of artificial intelligence.',
    '',
    '─────────────────────────────',
    '#BedtimeStories #KidsStories #StoriesForKids #CartoonForKids #ChildrensStories #FunnyStoriesForKids #KidsCartoon #BedtimeStoriesForToddlers #KidsEntertainment #AnimatedStories #StoryTime #KidsBedtime #ToddlerStories #FairyTales #KidsYouTube',
  ].join('\n');

  const tags = [
    'bedtime stories', 'stories for kids', 'story time',
    'animated stories', 'fairy tales', 'relaxing stories',
    'english stories', 'adventure stories', 'limitless bedtime stories',
    theme.split(' ').slice(0,4).join(' ')
  ];

  await uploadToYouTube({
    videoPath: finalVideo,
    title: seoTitle,
    description,
    tags,
    categoryId: '1',
    privacyStatus: 'public',
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
    await upload(finalVideo, videoTitle, theme, scenes);
    console.log(`\n✅ Done in ${((Date.now()-start)/60000).toFixed(1)} minutes!\n`);
  } catch (err) {
    console.error('\n❌ Pipeline failed:', err.message, '\n', err.stack);
    process.exit(1);
  }
})();
