// Daily update: finds TransMilenio's newest GTFS, packs it, audits it, tests it and builds the site.
// A feed that fails any step stops here, so the published app keeps the last good routes. Some real files are incomplete:
// the one from the 2 Nov 2026 holiday had 6 weekday trips instead of 80,000. GitHub emails the owner when a run fails.
// usage: node tools/update.js [--list] (needs curl and unzip, both present on GitHub's runners)
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const BUCKET = 'https://storage.googleapis.com/gtfs-estaticos/';
const run = (cmd, args, opts) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

async function latestFeed() {
  // The bucket returns at most 1000 names per page in alphabetical order, so the newest comes last.
  const keys = [];
  let marker = '';
  for (;;) {
    const res = await fetch(`${BUCKET}?prefix=GTFS_&marker=${encodeURIComponent(marker)}`);
    if (!res.ok) throw new Error('bucket ' + res.status);
    const xml = await res.text(), page = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    keys.push(...page);
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !page.length) break;
    marker = page[page.length - 1];
  }
  const dated = keys.map(k => ({ key: k, m: k.match(/^GTFS_(\d{4})(\d{2})(\d{2})\.zip$/) })).filter(x => x.m).sort((a, b) => a.key.localeCompare(b.key));
  if (!dated.length) throw new Error('No GTFS files found in the bucket');
  const last = dated[dated.length - 1];
  return { key: last.key, date: `${last.m[1]}-${last.m[2]}-${last.m[3]}` };
}

(async () => {
  const feed = await latestFeed();
  console.log('Archivo más reciente:', feed.key);
  if (process.argv.includes('--list')) return;
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gtfs-'));
  try {
    run('curl', ['-sSfL', '--max-time', '900', '-o', path.join(tmp, 'feed.zip'), BUCKET + feed.key]);
    run('unzip', ['-q', '-o', path.join(tmp, 'feed.zip'), '-d', tmp]);
    run(process.execPath, ['--max-old-space-size=6000', 'build-data.js', tmp, feed.date], { cwd: __dirname });
    run(process.execPath, ['--max-old-space-size=6000', 'audit-routes.js', tmp, '--strict', '--engine'], { cwd: __dirname });
    run(process.execPath, ['test-engine.js'], { cwd: __dirname });
    run(process.execPath, ['test-geo.js'], { cwd: __dirname });
    run(process.execPath, ['build.js'], { cwd: root });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e.message); process.exit(1); });
