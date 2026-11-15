import { NextResponse } from 'next/server';
import { buildBasketReport } from '@/lib/engine/basket';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * السلة المعتمدة — محفظة الظل المستقلة على أساس افتراضي 1000$.
 * سلة A (TSMOM-30d + Sunrise Ogle) بمعزولها الحرفي من المحاكاة المعتمدة،
 * مع الصمامات المعتمدة (يومي 3% / أسبوعي 6% / حاجز إيكويتي 500$).
 * الحساب الحقيقي (190$) لا يمس إطلاقاً — قراءة شموع فقط.
 * الحساب الثقيل مخزّن مؤقتاً: يُعاد فقط عند إغلاق شمعة ساعة جديدة.
 */
export async function GET() {
  const rep = await buildBasketReport();
  return NextResponse.json(rep);
}
