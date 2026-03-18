require('dotenv').config();
const { execSync, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path'), https = require('https'), http = require('http');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { uploadToYouTube } = require('./youtube');
const OUT = path.join(__dirname, '..', 'output');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const THEMES = ['A funny dragon afraid of fire','A tiny superhero mouse saves the city','A magical school bus travels to candy land','A brave little robot who wants friends','A silly wizard who mixes up spells','Animal friends on a jungle treasure hunt','A princess who loves adventures','A dinosaur time-travels to modern day','A little mermaid finds a magical city','Talking vegetables run a restaurant','A fairy loses her wings on a quest','Three monsters scared of everything','A space bunny finds a planet of sweets','A clumsy superhero saves the day by accident','A magic paintbrush brings drawings to life'];
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) { file.close(); return downloadFile(res.headers.location, dest).then(resolve).catch(reject); }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}
async function generateStory() {
  console.log('Step 1: Generating story...');
  const theme = THEMES[Math.floor(Math.random() * THEMES.length)];
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
  const result = await model.generateContent(`You are a childrens entertainment scriptwriter. Write a fun 10-minute story for kids aged 3-8 about: "${theme}". Write exactly 18 scenes in this EXACT format:\nSCENE_START\nTITLE: [title]\nIMAGE: [cartoon illustration description, bright colours, cute, safe for kids]\nNARRATION: [80-100 words fun narration, no asterisks]\nSCENE_END\nMake it funny, exciting, simple language, happy ending.`);
  const text = result.response.text().trim();
  fs.writeFileSync(path.join(OUT, 'story.txt'), text);
  const scenes = [];
  for (const block of text.split('SCENE_START').slice(1)) {
    const t = block.match(/TITLE:\s*(.+)/), img = block.match(/IMAGE:\s*([\s\S]+?)(?=NARRATION:)/), n = block.match(/NARRATION:\s*([\s\S]+?)(?=SCENE_END|$)/);
    if (t && img && n) scenes.push({ title: t[1].trim(), image: img[1].trim(), narration: n[1].trim() });
  }
  console.log(`✅ Story: ${scenes.length} scenes — "${theme}"`);
  return { scenes, videoTitle: theme + ' 🌟 Kids Story', theme };
}
async function generateImages(scenes) {
  console.log('Step 2: Generating images...');
  const imagePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const imgPath = path.join(OUT, `scene_${String(i).padStart(2,'0')}.jpg`);
    const prompt = encodeURIComponent(`childrens cartoon illustration bright colours cute fun pixar style: ${scenes[i].image}`);
    try {
      process.stdout.write(`  Image ${i+1}/${scenes.length}...\r`);
      await downloadFile(`https://image.pollinations.ai/prompt/${prompt}?width=1280&height=720&seed=${i*7}&nologo=true`, imgPath);
      imagePaths.push(imgPath);
      await new Promise(r => setTimeout(r, 2500));
    } catch {
      const c = ['FF6B6B','4ECDC4','45B7D1','96CEB4','FFEAA7','DDA0DD','98FB98'];
      execSync(`ffmpeg -y -f lavfi -i color=c=0x${c[i%c.length]}:size=1280x720 -frames:v 1 "${imgPath}"`, { stdio: 'pipe' });
      imagePaths.push(imgPath);
    }
  }
  console.log('\n✅ Images done');
  return imagePaths;
}
async function generateVoiceovers(scenes) {
  console.log('Step 3: Generating voiceovers...');
  const audioPaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const audioPath = path.join(OUT, `audio_${String(i).padStart(2,'0')}.mp3`);
    process.stdout.write(`  Audio ${i+1}/${scenes.length}...\r`);
    const r = spawnSync('edge-tts', ['--voice','en-US-AriaNeural','--rate','+5%','--text',scenes[i].narration,'--write-media',audioPath], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('edge-tts failed scene ' + i);
    audioPaths.push(audioPath);
  }
  console.log('\n✅ Voiceovers done');
  return audioPaths;
}
function getDuration(p) { return parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${p}"`).toString().trim()); }
async function buildSceneVideos(scenes, imagePaths, audioPaths) {
  console.log('Step 4: Building scene videos...');
  const scenePaths = [];
  for (let i = 0; i < scenes.length; i++) {
    const scenePath = path.join(OUT, `scene_video_${String(i).padStart(2,'0')}.mp4`);
    const duration = getDuration(audioPaths[i]);
    const frames = Math.round((duration + 0.5) * 25);
    const titleSafe = scenes[i].title.replace(/[':,!?]/g,'').substring(0,40);
    process.stdout.write(`  Scene ${i+1}/${scenes.length}...\r`);
    execSync([
      'ffmpeg -y',
      `-loop 1 -i "${imagePaths[i]}"`,
      `-i "${audioPaths[i]}"`,
      `-t ${duration + 0.5}`,
      '-c:v libx264 -preset fast -pix_fmt yuv420p -c:a aac -b:a 128k',
      `-vf "scale=1280:720,zoompan=z='min(zoom+0.0006,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720:fps=25,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${titleSafe}':fontsize=34:fontcolor=white:x=(w-text_w)/2:y=h-70:shadowcolor=black:shadowx=2:shadowy=2:enable='lt(t,3)'"`,
      `"${scenePath}"`
    ].join(' '), { stdio: 'pipe' });
    scenePaths.push(scenePath);
  }
  console.log('\n✅ Scene videos done');
  return scenePaths;
}
async function concatenateScenes(scenePaths) {
  console.log('Step 5: Joining scenes...');
  const listFile = path.join(OUT, 'scenes.txt');
  fs.writeFileSync(listFile, scenePaths.map(p => `file '${p}'`).join('\n'));
  const rawVideo = path.join(OUT, 'raw.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${rawVideo}"`, { stdio: 'pipe' });
  console.log('✅ Scenes joined');
  return rawVideo;
}
async function addBackgroundMusic(rawVideo) {
  console.log('Step 6: Adding music...');
  const finalVideo = path.join(OUT, 'final.mp4');
  const duration = getDuration(rawVideo);
  const musicFile = path.join(__dirname, '..', 'assets', 'music.mp3');
  if (fs.existsSync(musicFile)) {
    execSync(['ffmpeg -y', `-i "${rawVideo}"`, `-stream_loop -1 -i "${musicFile}"`, `-t ${duration}`, `-filter_complex "[1:a]volume=0.10,afade=t=in:st=0:d=3,afade=t=out:st=${duration-3}:d=3[music];[0:a][music]amix=inputs=2:duration=first[aout]"`, `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k "${finalVideo}"`].join(' '), { stdio: 'pipe' });
  } else { fs.copyFileSync(rawVideo, finalVideo); }
  console.log('✅ Music done');
  return finalVideo;
}
async function upload(finalVideo, videoTitle, theme) {
  console.log('Step 7: Uploading to YouTube...');
  await uploadToYouTube({ videoPath: finalVideo, title: videoTitle, description: `🌟 ${videoTitle}\n\n${theme}\n\n🎉 Fun for kids 3-8!\n✅ Subscribe for daily stories!\n\n#KidsStories #CartoonForKids #BedtimeStories`, tags: ['kids stories','cartoon for kids','bedtime stories','kids entertainment'], categoryId: '1', privacyStatus: 'public' });
  console.log('✅ Uploaded!');
}
(async () => {
  console.log('\n🚀 Kids Entertainment Pipeline starting...\n');
  const start = Date.now();
  try {
    const { scenes, videoTitle, theme } = await generateStory();
    const imagePaths = await generateImages(scenes);
    const audioPaths = await generateVoiceovers(scenes);
    const scenePaths = await buildSceneVideos(scenes, imagePaths, audioPaths);
    const rawVideo = await concatenateScenes(scenePaths);
    const finalVideo = await addBackgroundMusic(rawVideo);
    await upload(finalVideo, videoTitle, theme);
    console.log(`\n✅ Done in ${((Date.now()-start)/60000).toFixed(1)} minutes!\n`);
  } catch (err) {
    console.error('\n❌ Pipeline failed:', err.message, err.stack);
    process.exit(1);
  }
})();
