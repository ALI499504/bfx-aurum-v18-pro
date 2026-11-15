const r = JSON.parse(require('fs').readFileSync('db/research/mt5-feed-snapshot.json', 'utf8'));
for (const [k, v] of Object.entries(r.tfs)) {
  const valid = v.filter((c) => Array.isArray(c) && c.length >= 5 && c[0] > 0);
  console.log(k, valid.length, valid.length ? new Date(valid[0][0]).toISOString() + ' → ' + new Date(valid[valid.length - 1][0]).toISOString() : '-');
}
