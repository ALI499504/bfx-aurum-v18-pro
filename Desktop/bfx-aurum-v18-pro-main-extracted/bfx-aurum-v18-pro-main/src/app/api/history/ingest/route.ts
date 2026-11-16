// src/app/api/history/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

// المسار الذي سيُحفظ فيه ملف اللقطة التاريخية
const SNAP_PATH = path.join(process.cwd(), 'db', 'mt5-feed-snapshot.json');

/**
 * يتوقع جسم الطلب JSON يحتوي على:
 * {
 *   "symbol": "XAUUSD",
 *   "broker": "imported",
 *   "tfs": {
 *     "5m": [[t,o,h,l,c,v], ...],
 *     "15m": [[t,o,h,l,c,v], ...],
 *     ...
 *   }
 * }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  if (!body.tfs?.['5m']?.length) {
    return NextResponse.json({ error: 'الملف لا يحتوي على شموع 5m صالحة' }, { status: 400 });
  }

  try {
    // احفظ المجلد إذا لم يكن موجوداً
    fs.mkdirSync(path.dirname(SNAP_PATH), { recursive: true });
    // اكتب الملف (تجاوز إذا كان موجوداً مسبقاً)
    fs.writeFileSync(SNAP_PATH, JSON.stringify(body, null, 2));
    console.log('[history/ingest] تم استيراد البيانات التاريخية بنجاح');
    return NextResponse.json({ ok: true, msg: 'تم استيراد البيانات التاريخية' });
  } catch (e) {
    console.error('[history/ingest] فشل حفظ الملف', e);
    return NextResponse.json({ error: 'فشل حفظ الملف على الخادم' }, { status: 500 });
  }
}
