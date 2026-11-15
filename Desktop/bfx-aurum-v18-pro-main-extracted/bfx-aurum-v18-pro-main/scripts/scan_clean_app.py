# -*- coding: utf-8 -*-
"""Scan the cleaned app.js for any leftover references to removed engine/
strategy/rules/trade symbols."""
import re

path = '/home/z/my-project/work/BFX-AURUM-v13/app.js'
src = open(path, encoding='utf-8').read()

removed = [
    # engine
    'computeSignal', 'updateSignalCard', 'renderMlCard', 'mlLoad', 'mlTfKey',
    'mlModel', 'mlModelRaw', 'mlStratW', 'mlFeatures', 'mlLogistic',
    'mlPredictHead', 'mlPHorizon', 'mlMix', 'computeProjection',
    'journalSignal', 'renderSigList', 'journal', 'sigJournal',
    # forecast pane
    'drawProj', 'fcQueueDraw', 'drawFcOverlay', 'renderFcDecide', 'fcOvlSize',
    'fcChart', 'fcAnchor', 'fcCandle', 'fcHi', 'fcLo', 'fcOC', 'fcOX',
    'fcWrap', 'fcHead', 'fcTag', 'fcDecide', 'fcOvl', 'structuralTP',
    # strategies
    'buildProfile', 'buildFootRow', 'footMetrics', 'drawOverlayCore',
    'drawFootCols', 'setProf', 'setFp', 'PROF', 'wyckAnalyze', 'wyckReady',
    'drawWyck', 'renderWy', 'wySim', 'wyBtShow', 'wyBacktestRun', 'setWy',
    'wyMA', 'wyATR', 'paATR', 'paZones', 'paPin', 'paEngulf', 'paAnalyze',
    'paData', 'paEnsureData', 'paReady', 'renderPA', 'drawPA', 'paSim',
    'paBtShow', 'paBacktestRun', 'setPa', 'rrPip', 'rrMarubozu', 'rrZones',
    'rrAnalyze', 'rrData', 'rrReady', 'renderRR', 'drawRR', 'rrSim',
    'rrBtShow', 'rrBacktestRun', 'setRR', 'krPip', 'krAtr', 'krStrong',
    'krLevels', 'krWaitPhrase', 'krBreaks', 'krAnalyze', 'krData',
    'krEnsureData', 'krReady', 'renderKR', 'drawKR', 'krSim', 'krBtShow',
    'krBacktestRun', 'setKR', 'fbPip', 'fbAtr', 'fbClusters', 'fbScanTf',
    'fbSteps', 'fbAnalyze', 'fbData', 'fbEnsureData', 'fbReady', 'renderFB',
    'drawFB', 'fbSimTf', 'fbSim', 'fbBtShow', 'fbBacktestRun', 'setFB',
    # rules engine
    'RULES', 'PFX', 'sessNow', 'sessNames', 'pollNews', 'newsBlocked',
    'nextNews', 'NEWS', 'fmtDur', 'todayStr', 'dayStartEpoch',
    'monthStartEpoch', 'rulesDay', 'saveDay', 'TLOG', 'LT', 'dealsStats',
    'usingRealDeals', 'dayStats', 'periodStats', 'activeReal', 'spreadUSD',
    'compliance', 'compBlock', 'SLMAP', 'addViolation', 'rulesSyncAcc',
    'pushClosed', 'openLocal', 'closeLocal', 'renderRules', 'renderBt',
    'btRun', 'btShow', 'btLocal', 'rulesDemoSeed', 'haltBanner', 'BFX_HALTED',
    'rulesBox', 'verdictBox', 'mlBox', 'statBox', 'accBox', 'posList',
    'logList', 'sigList', 'wyBox', 'paBox', 'rrBox', 'krBox', 'fbBox',
    'btBox', 'rlList', 'rlStat', 'indList', 'indLive', 'stList',
    # trades / journal / backtest UI
    'tjPush', 'tjTick', 'tjRender', 'tjSave', 'tjPriceOf', 'tjRisk',
    'tjWinrate', 'tjPnlTxt', 'tjCardHtml', 'tjCache', 'TJ_KEY', 'TJ_STRATS',
    'tradesFeed', 'tradesHead', 'tjF_all', 'tjF_open', 'tjF_closed',
    'classicToggle', 'classicPanel', 'btLoad', 'btBody', 'btCards', 'btEq',
    'btSeg', 'btYear', 'btAgg', 'btList', 'btMore', 'btMeta', 'btEnsure',
    'buildBt', 'drawEquity', 'btFiltered', 'renderBtView',
    # control center
    'renderRulesTab', 'renderRulesStat', 'renderIndTab', 'renderStratTab',
    'stratState', 'swx', 'lastBars', 'liveInd', 'histWeight', 'switchTab',
    'curTab', '__pfxSwitch', 'pTabs', 'paneLive', 'paneRules', 'paneInd',
    'paneStrat', 'paneBt', 'paneClassic', 'fsSig',
    # model
    'model.json', 'ML.',
]
found = []
for name in removed:
    for m in re.finditer(re.escape(name), src):
        ln = src.count('\n', 0, m.start()) + 1
        line = src.split('\n')[ln-1].strip()
        found.append((name, ln, line[:110]))

if found:
    print('LEFTOVER REFERENCES (%d):' % len(found))
    seen = set()
    for name, ln, line in found:
        k = (name, ln)
        if k in seen: continue
        seen.add(k)
        print('  L%-5d %-18s %s' % (ln, name, line))
else:
    print('CLEAN — no leftover references to removed symbols.')

# also verify kept key functions exist
need = ['fetchT','startMarketFeed','stopMarketFeed','fallBackToLive',
        'webTfLoad','fuseMktBid','loadHistory','refreshData','fuseLive',
        'updateSymSrc','updateSrcPill','updateEngineHelp','connectSSE',
        'buildTabs','setTf','buildTfBar','setMax','zoomChart','setBridge',
        'probe2','probe','boot','instantRecover','gotoLocal','adoptLan',
        'useLan','renderEngStat','applyHealth','useCloud','relayFreshH',
        'relayFresh','useRelay','isBlobUrl','relayHealth','blobApply',
        'bfxUnzip','blobFetch','blobBoot','pickRelay','updateTicker',
        'updateChips','demoSeries','demoTick','demoJSON','jget','startDemo',
        'stopDemo','mktAgg','mktAggMonth','mktSeed','marketApply','legendRowHTML',
        'drawReal','krow','fmt','fitRange','ovlSize','drawOverlay','ovlC',
        'chartOpts','whenLwc','initCharts','priceFmt','applyDigits',
        'setReconnecting','endReconn','fetchT','barsNow','key','esc']
missing = [n for n in need if not re.search(r'(function\s+%s\b|var\s+%s\b)' % (re.escape(n), re.escape(n)), src)]
print('MISSING KEPT SYMBOLS:', missing if missing else 'none')
