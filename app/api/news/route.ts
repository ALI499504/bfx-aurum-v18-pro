import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * تقويم الأخبار الحقيقي — يسحب أحداث ForexFactory الأسبوعية (عالية التأثير / USD فقط)
 * ويخزنها في قاعدة البيانات (مفتاح newsCache) ليجري عليها فلتر الأخبار في المحرك.
 * صلاحية الكاش 6 ساعات — وعند فشل السحب يعمل فلتر الأخبار بدون حجب
 * (لا تقويم تقريبي ولا مواعيد مولّدة في هذا النظام إطلاقاً).
 */
const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const TTL = 6 * 3600e3;

interface NewsItem { t: number; name: string; impact: string; country: string }

function upcoming(events: NewsItem[]) {
  return events.filter(e => e.t > Date.now() - 3600e3).slice(0, 25);
}

export async function GET() {
  // 1) الكاش المحلي
  let cached: { updatedAt: number; events: NewsItem[] } | null = null;
  try {
    const row = await db.botSettings.findUnique({ where: { key: 'newsCache' } });
    if (row) cached = JSON.parse(row.json);
  } catch { /* ignore */ }

  const now = Date.now();
  if (cached?.updatedAt && now - cached.updatedAt < TTL && cached.events?.length) {
    return NextResponse.json({
      ok: true, source: 'cache', updatedAt: cached.updatedAt,
      count: cached.events.length, events: upcoming(cached.events),
    });
  }

  // 2) سحب حقيقي من تقويم ForexFactory
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(FF_URL, {
      cache: 'no-store', signal: ctl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BfxAurumBot/1.0)' },
    });
    clearTimeout(to);
    if (r.ok) {
      const arr = await r.json() as { title?: string; country?: string; date?: string; impact?: string }[];
      const events: NewsItem[] = (Array.isArray(arr) ? arr : [])
        .filter(e => e.country === 'USD' && e.impact === 'High' && e.date && e.title)
        .map(e => ({ t: new Date(e.date!).getTime(), name: e.title!, impact: e.impact!, country: e.country! }))
        .filter(e => Number.isFinite(e.t))
        .sort((a, b) => a.t - b.t);
      if (events.length) {
        const payload = { updatedAt: now, events };
        await db.botSettings.upsert({
          where: { key: 'newsCache' },
          create: { key: 'newsCache', json: JSON.stringify(payload) },
          update: { json: JSON.stringify(payload) },
        });
        return NextResponse.json({
          ok: true, source: 'forexfactory', updatedAt: now,
          count: events.length, events: upcoming(events),
        });
      }
    }
  } catch { /* fallback below */ }

  return NextResponse.json({
    ok: false,
    error: 'تعذر سحب تقويم الأخبار الحقيقي حالياً — فلتر الأخبار متوقف مؤقتاً بدل استخدام مواعيد غير حقيقية',
    count: cached?.events?.length ?? 0,
  });
}
