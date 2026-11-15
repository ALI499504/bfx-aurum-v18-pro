import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { TunerReport } from '@/lib/server/tuner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROGRESS_PATH = join(process.cwd(), 'db', 'tuner-progress.json');

interface ProgressFile {
  running: boolean; pid: number; startedAt: number; finishedAt: number | null;
  stage: string; done: number; total: number; log: string[]; error: string | null;
  reportSaved: boolean;
}

function readProgress(): ProgressFile | null {
  try {
    if (!existsSync(PROGRESS_PATH)) return null;
    return JSON.parse(readFileSync(PROGRESS_PATH, 'utf8')) as ProgressFile;
  } catch { return null; }
}

function isAlive(p: ProgressFile | null): boolean {
  if (!p?.running || !p.pid) return false;
  try { process.kill(p.pid, 0); return true; } catch { return false; }
}

/** حالة الضبط: تقدم العملية المستقلة + آخر تقرير من قاعدة البيانات */
export async function GET() {
  const prog = readProgress();
  let report: TunerReport | null = null;
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'tunerReport' } });
    if (row) report = (JSON.parse(row.json) as { report?: TunerReport }).report ?? null;
  } catch { /* بلا تقرير بعد */ }
  return NextResponse.json({
    running: isAlive(prog),
    stage: prog?.stage ?? '—',
    done: prog?.done ?? 0,
    total: prog?.total ?? 0,
    log: prog?.log ?? [],
    error: prog?.error ?? null,
    report,
  });
}

/** بدء عملية ضبط جديدة — بلا عمل مكثف داخل خادم الويب (درس انهيار الذاكرة) */
export async function POST() {
  const prog = readProgress();
  if (isAlive(prog)) {
    return NextResponse.json({ ok: false, error: 'الضبط يعمل حالياً — تابع التقدم من نفس الصفحة' }, { status: 409 });
  }
  try {
    const child = spawn('bun', ['scripts/tuner-run.ts'], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return NextResponse.json({ ok: true, pid: child.pid, message: 'بدأ الضبط في عملية مستقلة — تابع التقدم عبر التحديث' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 200) }, { status: 500 });
  }
}
