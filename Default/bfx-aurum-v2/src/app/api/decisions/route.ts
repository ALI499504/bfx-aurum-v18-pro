import { NextResponse } from 'next/server';
import {
  constitutionState,
  CONSTITUTION_PREAMBLE,
  CONSTITUTION_RULES,
  FROZEN_NUMBERS,
  SETUP_MAP,
  FROZEN_FIELDS,
} from '@/lib/engine/constitution';

export const dynamic = 'force-dynamic';

/**
 * سجل قرارات وكيل التنفيذ — بصيغة المواصفة الإلزامية:
 * «الوقت (بتوقيت سوريا) | الرقم النفسي | الإعداد (A أو B) | الشرط الذي تحقق أو فشل |
 *   القرار (دخول / إلغاء / لا شيء) | الوقف والهدف بالأرقام إن وُجد دخول»
 * + ملخص الجلسة (إشارات / إلغاءات وأسبابها / صفقات منفذة / النتيجة بوحدة R)
 * + سجل الرفضات (القاعدة 7) + نص الدستور والأرقام المجمدة.
 */
export async function GET() {
  const st = constitutionState();
  return NextResponse.json({
    ok: true,
    constitution: {
      preamble: CONSTITUTION_PREAMBLE,
      rules: CONSTITUTION_RULES,
      setupMap: SETUP_MAP,
      frozenNumbers: FROZEN_NUMBERS,
      frozenFields: FROZEN_FIELDS.map(f => ({ path: f.path, reason: f.reason })),
    },
    summary: st.summary,
    decisions: st.decisions,
    refusals: st.refusals,
  });
}
