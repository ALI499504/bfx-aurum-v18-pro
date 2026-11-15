import { withBacktestEngine, type BacktestWindow } from '../src/lib/server/backtestCache';
import { runBacktest } from '../src/lib/engine/backtest';
import { DEFAULT_SETTINGS, buildScenarioSessions, Settings } from '../src/lib/engine/rules';
import { mt5Feed } from '../src/lib/server/mt5feed';
const OOS_W: BacktestWindow = { fromT: Date.UTC(2026,5,1)-180*86400e3, toT: Date.now(), reportFrom: Date.UTC(2026,5,1), reportTo: Date.now(), permanent: true };
function metricsOf(trades: {strategy:string;pnl:number}[]) {
  if (!trades.length) return null;
  let gw=0,gl=0,net=0,wins=0;
  for (const x of trades){net+=x.pnl;if(x.pnl>=0){gw+=x.pnl;wins++;}else gl+=-x.pnl;}
  return {trades:trades.length,winRate:(wins/trades.length)*100,pf:gl>0?gw/gl:(gw>0?99:0),net};
}
const fmt=(n:number)=>Math.round(n*100)/100;
function s(xaa:boolean): Settings {
  const st=structuredClone(DEFAULT_SETTINGS) as Settings;
  st.scenarioSessions=buildScenarioSessions();
  const sp=st.strategyParams as unknown as Record<string,Record<string,unknown>>;
  sp['A'].slPips=100;sp['A'].tpPips=120;sp['E'].slPips=50;sp['E'].tpPips=200;
  (sp['F'].exec as Record<string,unknown>).slPips=60;(sp['F'].exec as Record<string,unknown>).tpPips=120;
  sp['H'].slPips=90;sp['H'].tpPips=200;
  (sp['L'].exec as Record<string,unknown>).revSlPips=30;(sp['L'].exec as Record<string,unknown>).revTpPips=120;
  (sp['M'].exec as Record<string,unknown>).revSlPips=50;(sp['M'].exec as Record<string,unknown>).revTpPips=200;
  (sp['N'].exec as Record<string,unknown>).revSlPips=80;(sp['N'].exec as Record<string,unknown>).revTpPips=200;
  for (const k of ['B','C','D','G','I','J','O','P','Q','R','T','U','V','W','Y','Z']) sp[k].enabled=false;
  sp['X'].enabled=xaa; sp['AA'].enabled=xaa;
  return st;
}
mt5Feed();
const r0=withBacktestEngine(OOS_W,d=>runBacktest(d,s(false),Date.now(),[],{fromT:OOS_W.reportFrom,toT:OOS_W.reportTo}));
const r1=withBacktestEngine(OOS_W,d=>runBacktest(d,s(true),Date.now(),[],{fromT:OOS_W.reportFrom,toT:OOS_W.reportTo}));
if(!r0.ok||!r1.ok) throw new Error('فشل');
const t0=(r0.result.trades as {strategy:string;pnl:number}[]), t1=(r1.result.trades as {strategy:string;pnl:number}[]);
console.log('النظام وحده:', JSON.stringify(metricsOf(t0), null, 0));
console.log('النظام + X + AA:', JSON.stringify(metricsOf(t1), null, 0));
console.log('X داخل النظام:', JSON.stringify(metricsOf(t1,'X')));
console.log('AA داخل النظام:', JSON.stringify(metricsOf(t1,'AA')));
