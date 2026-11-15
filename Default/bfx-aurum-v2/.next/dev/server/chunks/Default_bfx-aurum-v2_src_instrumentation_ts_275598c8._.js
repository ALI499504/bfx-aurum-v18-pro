module.exports = [
"[project]/Default/bfx-aurum-v2/src/instrumentation.ts [instrumentation] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// إقلاع الوكيل الحارس مع عملية الخادم — مراقبة وإصلاح تلقائي على مدار الساعة
// يعمل تلقائياً عند تشغيل الخادم (dev أو production) دون أي تدخل يدوي.
__turbopack_context__.s([
    "register",
    ()=>register
]);
async function register() {
    if ("TURBOPACK compile-time truthy", 1) {
        try {
            const { guardian } = await __turbopack_context__.A("[project]/Default/bfx-aurum-v2/src/lib/monitor/guardian.ts [instrumentation] (ecmascript, async loader)");
            guardian.start();
        } catch (e) {
            console.error('[guardian] تعذر إقلاع الوكيل الحارس:', e);
        }
    }
}
}),
];

//# sourceMappingURL=Default_bfx-aurum-v2_src_instrumentation_ts_275598c8._.js.map