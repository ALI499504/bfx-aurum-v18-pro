'use client';

// نافذة المستويات اليدوية — تعليماتك المباشرة للبوت (استراتيجية Z)
// كل مستوى يعمل كأمر معلق Limit بمستوى الدخول نفسه، هدف 1:2 من الوقف،
// بأعلى أولوية في السلم، وتتجاوز بوابات الجلسات وEMA — وتخضع لفلاتر المخاطر.
import { useState } from 'react';
import { Crosshair, Plus, Trash2 } from 'lucide-react';
import { useBot } from './store';
import { Switch } from './SessionsWindow';
import { Stepper } from './GlobalRulesWindow';
import { cn } from '@/lib/utils';

interface LevelRow {
  id: string;
  price: number;
  dir: 'buy' | 'sell';
  slDollars: number;
  note?: string;
  createdAt: number;
}

export function ManualLevelsWindow() {
  const { settings, patchSettings } = useBot();
  const ml = settings.manualLevels ?? { enabled: false, levels: [] };
  const [price, setPrice] = useState('');
  const [dir, setDir] = useState<'buy' | 'sell'>('buy');
  const [sl, setSl] = useState(10);
  const [note, setNote] = useState('');
  const [addErr, setAddErr] = useState<string | null>(null);

  const add = () => {
    const p = parseFloat(price);
    setAddErr(null);
    if (!Number.isFinite(p) || p <= 0) { setAddErr('أدخل سعر دخول صحيحاً (مثال: 3942.50)'); return; }
    const levels: LevelRow[] = [
      {
        id: `L${Date.now()}${Math.floor(Math.random() * 1000)}`,
        price: p,
        dir,
        slDollars: sl,
        note: note.trim() || undefined,
        createdAt: Date.now(),
      },
      ...((ml.levels ?? []) as LevelRow[]),
    ];
    patchSettings(d => { d.manualLevels = { enabled: ml.enabled, levels }; });
    setPrice('');
    setNote('');
  };

  const remove = (id: string) => {
    patchSettings(d => {
      d.manualLevels = { enabled: d.manualLevels?.enabled ?? false, levels: (d.manualLevels?.levels ?? []).filter(l => l.id !== id) };
    });
  };

  const toggleEnabled = (v: boolean) => {
    patchSettings(d => { d.manualLevels = { enabled: v, levels: d.manualLevels?.levels ?? [] }; });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-[#d9b45c] flex items-center gap-2">
              <Crosshair className="w-4.5 h-4.5" />
              المستويات اليدوية — تعليماتك المباشرة للبوت
            </h2>
            <p className="text-[11.5px] text-[#8a94a6] leading-relaxed mt-1">
              هنا تحدّد أنت أين يدخل البوت — كل مستوى يعمل كأمر معلق <b>Limit</b> بمستوى الدخول نفسه
              مع وقف مسافة بالدولار وهدف 1:2. المستويات اليدوية لها <span className="text-[#d9b45c]">أعلى أولوية في السلم</span>،
              تتجاوز بوابات الجلسات وفلتر EMA (لأنها تعليماتك الصريحة)، لكنها تخضع لفلاتر حماية الأموال:
              الأخبار، حدود اليوم، والحد الأقصى للصفقات.
            </p>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-[10.5px] text-[#8a94a6] font-bold">{ml.enabled ? 'مفعّلة' : 'مطفأة'}</span>
            <Switch on={ml.enabled} onChange={toggleEnabled} />
          </div>
        </div>
        {!ml.enabled && ml.levels.length > 0 && (
          <div className="mt-2.5 rounded-lg border border-[#d9b45c]/35 bg-[#d9b45c]/8 px-3 py-2 text-[10.5px] text-[#d9b45c] font-bold">
            المستويات محفوظة لكنها معطلة — فعّل المفتاح الأعلى حتى يدخلها المحرك في الباك تيست والإشارات الحية.
          </div>
        )}
      </div>

      {/* نموذج الإضافة */}
      <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-4">
        <div className="text-[12.5px] font-bold text-[#e9edf4] mb-3">إضافة مستوى جديد</div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-[9.5px] text-[#5a6474] font-bold mb-1">سعر الدخول ($)</div>
            <input
              value={price}
              onChange={e => setPrice(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="3942.50"
              dir="ltr"
              inputMode="decimal"
              className="w-[120px] rounded-lg border border-[#2a3550] bg-[#101726] px-2.5 py-2 text-[13px] font-mono font-bold text-[#e9edf4] outline-none focus:border-[#d9b45c]/60 text-center"
            />
          </div>
          <div>
            <div className="text-[9.5px] text-[#5a6474] font-bold mb-1">الاتجاه</div>
            <div className="flex rounded-lg border border-[#2a3550] overflow-hidden">
              <button onClick={() => setDir('buy')}
                className={cn('px-3.5 py-2 text-[11.5px] font-black transition-colors',
                  dir === 'buy' ? 'bg-[#2ebd85]/20 text-[#2ebd85]' : 'bg-[#101726] text-[#8a94a6] hover:text-[#2ebd85]')}>
                شراء
              </button>
              <button onClick={() => setDir('sell')}
                className={cn('px-3.5 py-2 text-[11.5px] font-black transition-colors border-r border-[#2a3550]',
                  dir === 'sell' ? 'bg-[#f6465d]/20 text-[#f6465d]' : 'bg-[#101726] text-[#8a94a6] hover:text-[#f6465d]')}>
                بيع
              </button>
            </div>
          </div>
          <div>
            <div className="text-[9.5px] text-[#5a6474] font-bold mb-1">مسافة الوقف</div>
            <Stepper value={sl} step={1} min={1} max={50} onChange={setSl} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <div className="text-[9.5px] text-[#5a6474] font-bold mb-1">ملاحظة (اختياري)</div>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add(); }}
              placeholder="مثال: دعم أسبوعي قوي"
              className="w-full rounded-lg border border-[#2a3550] bg-[#101726] px-2.5 py-2 text-[12px] text-[#e9edf4] outline-none focus:border-[#d9b45c]/60"
            />
          </div>
          <button onClick={add}
            className="flex items-center gap-1.5 rounded-lg bg-[#d9b45c] hover:bg-[#e5c26e] text-[#0a0e17] font-black text-[12px] px-4 py-2.5">
            <Plus className="w-4 h-4" />
            إضافة
          </button>
        </div>
        {addErr && <div className="mt-2 text-[10.5px] text-[#f6465d] font-bold">{addErr}</div>}
        <div className="mt-3 text-[10px] text-[#5a6474] leading-relaxed">
          الهدف يُحسب تلقائياً 1:2 (على مسافة الوقف المطبقة بعد حدود الوقف الدنيا/القصوى من القواعد العليا).
          صلاحية الأمر المعلق 30 يوماً أو حتى تنفيذه/إبطاله بكسر عكسي للوقف.
        </div>
      </div>

      {/* القائمة */}
      {ml.levels.length ? (
        <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] overflow-hidden">
          <div className="grid grid-cols-[46px_1fr_1fr_1fr_1.6fr_40px] gap-2 px-4 py-2.5 bg-[#101726] border-b border-[#1b2334] text-[9.5px] font-bold text-[#5a6474]">
            <span>#</span>
            <span>السعر</span>
            <span>الاتجاه</span>
            <span>الوقف</span>
            <span>ملاحظة</span>
            <span></span>
          </div>
          {(() => {
            const lot = settings.globalRules?.fixed_lot?.enabled ? (settings.globalRules.fixed_lot.value ?? 0.01) : 0.01;
            const floor = settings.globalRules?.sl_floor?.enabled ? (settings.globalRules.sl_floor.value ?? 10) : 0;
            const cap = settings.globalRules?.sl_cap?.enabled ? (settings.globalRules.sl_cap.value ?? 15) : 0;
            const tpRatio = settings.tpRatio ?? 2;
            return (ml.levels as LevelRow[]).map((l, i) => {
              const appliedSl = Math.min(Math.max(l.slDollars, floor || l.slDollars), cap || l.slDollars);
              const tp = l.price + (l.dir === 'buy' ? 1 : -1) * appliedSl * tpRatio;
              const slPrice = l.dir === 'buy' ? l.price - appliedSl : l.price + appliedSl;
              return (
                <div key={l.id} className="grid grid-cols-[46px_1fr_1fr_1fr_1.6fr_40px] gap-2 items-center px-4 py-2.5 border-b border-[#141a29] last:border-0 hover:bg-[#101726]/60 text-[11.5px]">
                  <span className="text-[#5a6474] font-bold">{i + 1}</span>
                  <span className="font-mono font-black text-[#d9b45c] text-[12.5px]">{l.price.toFixed(2)}</span>
                  <span className={cn('font-black', l.dir === 'buy' ? 'text-[#2ebd85]' : 'text-[#f6465d]')}>
                    {l.dir === 'buy' ? 'شراء' : 'بيع'}
                  </span>
                  <span className="font-mono text-[#8a94a6]" title={`الوقف ${slPrice.toFixed(2)} — الهدف ${tp.toFixed(2)}`}>
                    {appliedSl.toFixed(0)}$ <span className="text-[#5a6474] text-[9px]">/ هدف {tpRatio}:1</span>
                  </span>
                  <span className="text-[#8a94a6] truncate">{l.note ?? '—'}</span>
                  <button onClick={() => remove(l.id)} aria-label="حذف المستوى"
                    className="w-8 h-8 flex items-center justify-center rounded-md text-[#8a94a6] hover:text-[#f6465d] hover:bg-[#f6465d]/10">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            });
          })()}
        </div>
      ) : (
        <div className="rounded-xl border border-[#1b2334] bg-[#0d1220] p-8 text-center">
          <div className="text-[13px] font-bold text-[#e9edf4]">لا توجد مستويات يدوية بعد</div>
          <div className="text-[11px] text-[#8a94a6] mt-1.5 leading-relaxed max-w-[520px] mx-auto">
            أضف أول مستوى من النموذج أعلاه — ستظهر فوراً في الإشارات الحية كبطاقة مستوى يدوي،
            وتدخل في الباك تيست كأوامر معلقة بأعلى أولوية.
          </div>
        </div>
      )}
    </div>
  );
}
