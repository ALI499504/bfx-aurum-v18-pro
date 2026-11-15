#!/bin/bash
# إثبات بصري: استراتيجية R تظهر في واجهة تقارير الباك تيست
set -u
cd /home/z/my-project

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null || echo 000)
if [ "$code" != "200" ]; then
  setsid bash -c 'exec bun run dev' < /dev/null > /tmp/devsrv.log 2>&1 &
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/ 2>/dev/null)
    [ "$code" = "200" ] && break
    sleep 2
  done
fi
echo "[1] server: $code"

agent-browser set viewport 1440 900 2>/dev/null
agent-browser open http://localhost:3000/ 2>&1 | tail -1
agent-browser wait --load networkidle --timeout 30000 2>/dev/null
sleep 4
agent-browser click "text=الباك تيست والتقارير" 2>&1 | tail -1
sleep 3
agent-browser screenshot /tmp/render/12_strategy_r.png 2>&1 | tail -1
TXT=$(agent-browser get text "body" 2>/dev/null)
echo "[2] اسم R في التقارير؟ (يجب ≥1): $(echo "$TXT" | grep -c 'اختراق شمعة الاحتواء' || true)"
echo "[3] أرقام R في المصفوفة؟ (يجب ≥1): $(echo "$TXT" | grep -oE 'R[^A-Za-z]{0,40}282' | head -2)"
echo "=== done ==="
