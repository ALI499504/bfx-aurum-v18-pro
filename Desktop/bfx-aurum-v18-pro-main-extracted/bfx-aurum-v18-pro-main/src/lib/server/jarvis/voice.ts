// ============================================================
// جارفس — محرك الصوت (server-only)
// صوت «ليلى» اللبنانية الفصيحة (ar-LB-LaylaNeural) عبر edge-tts
// — بطلب السيد: صوت أنثوي جميل اللحن دقيق اللفظ (على نمط هيفاء وهبي:
//   نبرة لبنانية ناعمة موحدة). التوليد طبيعي بلا أي معالجة نبرة صناعية
//   — إيقاعها ونبرتها الأصلية هما الأجمل والأدق لفظاً.
// ملاحظة الاستنساخ الحرفي لأصوات المشاهير يتطلب نماذج GPU (XTTS-v2 /
// VoxCPM) بزمن 20-60 ثانية للجملة — قاتل للمحادثة اللحظية؛ ليلى فورية
// التوليد بجودة الإذاعة ولفظ فصيح مضبوط.
// لربط صوت مستنسخ مرخّص لاحقاً: غيّر متغير البيئة JARVIS_TTS_VOICE.
// الفلسفة: بث تدريجي — أول إطارات MP3 تصل المتصفح خلال ~ثانية
// واحدة والنطق يبدأ فوراً بينما يواصل المحرك التوليد في الخلفية
// (بدل الانتظار للملف الكامل = سبب التأخير القديم).
// كل جملة تُؤرشف في db/jarvis-tts فتعود الجملة المكررة فورية 100%.
// النطق السليم: كل نص يمر عبر المُطبعّع العربي (arabic-speak)
// قبل التوليد — الأرقام تصبح كلمات فصيحة والمختصرات اللاتينية
// (XAUUSD، EMA، PF، MT5، $، %) تصبح عربية واضحة اللفظ.
// ============================================================
import { normalizeForSpeech } from './arabic-speak';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TTS_VOICE = process.env.JARVIS_TTS_VOICE || 'ar-LB-LaylaNeural'; // ليلى — صوت لبناني أنثوي جميل اللحن دقيق اللفظ
export const TTS_RATE = process.env.TTS_RATE || '+0%';    // إيقاعها الطبيعي الأصلي — لا تسريع صناعي
export const TTS_PITCH = process.env.TTS_PITCH || '+0Hz'; // نبرتها الطبيعية الصافية — بلا تلاعب

const CACHE_DIR = path.join(process.cwd(), 'db', 'jarvis-tts');
const MAX_CONC = 3;          // أقصى عدد عمليات توليد متوازية
const KEEP_FILES = 240;      // نحفظ أحدث 240 جملة مؤرشفة
const PROC_TIMEOUT_MS = 60_000;

// ---------- سيمافور بسيطة لمنع إغراق الخادم ----------
let active = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (active < MAX_CONC) { active++; return; }
  await new Promise<void>(r => waiters.push(r));
  active++;
}
function release() {
  active = Math.max(0, active - 1);
  const w = waiters.shift();
  if (w) w();
}

export function ttsCachePath(text: string): string {
  // مفتاح الكاش على النص المُطبع — الجمل المختلفة كتابةً المتشابهة منطوقاً تتشارك الكاش
  const norm = normalizeForSpeech(text);
  const hash = crypto.createHash('sha1').update(`${TTS_VOICE}|${TTS_RATE}|${TTS_PITCH}|${norm}`).digest('hex').slice(0, 20);
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

export function hasCached(text: string): boolean {
  try { return fs.statSync(ttsCachePath(text)).size > 800; } catch { return false; }
}

// ---------- اختيار مفسر بايثون المتوفر مرة واحدة ----------
let binPromise: Promise<string> | null = null;
function getBin(): Promise<string> {
  if (!binPromise) {
    binPromise = new Promise<string>((resolve, reject) => {
      const bins = ['python3', 'python', '/home/z/.venv/bin/python3'];
      let i = 0;
      const probe = () => {
        if (i >= bins.length) { binPromise = null; reject(new Error('edge_tts غير متوفر على الخادم')); return; }
        const bin = bins[i++];
        const p = spawn(bin, ['-c', 'import edge_tts'], { stdio: 'ignore' });
        p.on('error', () => probe());
        p.on('close', code => (code === 0 ? resolve(bin) : probe()));
      };
      probe();
    });
  }
  return binPromise;
}

function cleanupOld() {
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.endsWith('.mp3'))
      .map(f => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(KEEP_FILES)) fs.rmSync(path.join(CACHE_DIR, old.f), { force: true });
  } catch { /* اختياري */ }
}

// ---------- البث التدريجي: stdout → المتصفح مع أرشفة متوازية ----------
export async function synthesizeStream(text: string): Promise<ReadableStream<Uint8Array>> {
  await acquire();
  let released = false;
  const done = () => { if (!released) { released = true; release(); } };

  try {
    const bin = await getBin();
    const spoken = normalizeForSpeech(text) || text; // النص الملفوظ فعلياً — أرقام كلمات ومصطلحات عربية
    const finalPath = ttsCachePath(text);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const tmpPath = `${finalPath}.${Date.now()}.part`;

    const child = spawn(bin,
      ['-m', 'edge_tts', '--voice', TTS_VOICE, `--rate=${TTS_RATE}`, `--pitch=${TTS_PITCH}`, '--text', spoken, '--write-media', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* انتهى */ } }, PROC_TIMEOUT_MS);

    // نسختان من البث: واحدة للمتصفح وأخرى للأرشفة (بدون انتظار بعضهما)
    const tee = fs.createWriteStream(tmpPath);
    const dup = new (await import('node:stream')).PassThrough();
    child.stdout.pipe(tee);
    child.stdout.pipe(dup);

    child.on('close', code => {
      clearTimeout(timer);
      done();
      try {
        if (code === 0 && fs.existsSync(tmpPath) && fs.statSync(tmpPath).size > 800) {
          fs.renameSync(tmpPath, finalPath);
          cleanupOld();
        } else {
          fs.rmSync(tmpPath, { force: true });
        }
      } catch { /* الأرشفة اختيارية */ }
    });
    child.on('error', () => {
      clearTimeout(timer);
      done();
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* تجاهل */ }
    });

    return Readable.toWeb(dup) as unknown as ReadableStream<Uint8Array>;
  } catch (e) {
    done();
    throw e;
  }
}

// ---------- تسخين العبارات الجاهزة عند إقلاع الخادم ----------
// تُولَّد صامتة في الخلفية فتنطق للمستخدم فوراً (كاش ساخن) عند أول أمر.
export function warmVoice(phrases: string[]) {
  for (const phrase of phrases) {
    if (hasCached(phrase)) continue;
    synthesizeStream(phrase)
      .then(async stream => {
        const reader = stream.getReader();
        for (;;) { const { done } = await reader.read(); if (done) break; }
      })
      .catch(() => { /* التسخين اختياري — المسار الحي سيعيد المحاولة */ });
  }
}
