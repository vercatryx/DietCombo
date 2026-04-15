const DEFAULT_URL = 'https://customer.thedietfantasy.com/api/bill';

function parseArgs() {
  const args = process.argv.slice(2);
  let name = 'EVA WEINSTEIN';
  let url = DEFAULT_URL;
  let account = 'both';

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name' && args[i + 1]) {
      name = String(args[i + 1]);
      i++;
    } else if (a === '--url' && args[i + 1]) {
      url = String(args[i + 1]);
      i++;
    } else if (a === '--account' && args[i + 1]) {
      account = String(args[i + 1]);
      i++;
    }
  }
  return { name, url, account };
}

function norm(s) {
  return String(s ?? '').trim().toLowerCase();
}

async function main() {
  const { name, url, account } = parseArgs();
  const target = norm(name);

  const u = new URL(url);
  if (account) u.searchParams.set('account', account);

  console.log('=== check-customer-api-bill-for-name ===');
  console.log('Fetching:', u.toString());
  console.log('Searching for name contains:', JSON.stringify(name));
  console.log('');

  const res = await fetch(u, { headers: { accept: 'application/json' } });
  console.log('HTTP:', res.status, res.statusText);
  const contentType = res.headers.get('content-type') || '';
  console.log('content-type:', contentType);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.log('body (first 400 chars):', text.slice(0, 400));
    process.exit(1);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    console.log('Unexpected payload (not an array). Keys:', data && typeof data === 'object' ? Object.keys(data) : typeof data);
    process.exit(1);
  }

  const matches = data.filter((row) => norm(row?.name).includes(target));
  console.log('Rows returned:', data.length);
  console.log('Matches:', matches.length);

  for (const row of matches.slice(0, 10)) {
    console.log('-', JSON.stringify({ clientId: row.clientId, name: row.name, url: row.url, amount: row.amount, dependantsCount: (row.dependants || []).length }));
  }

  if (matches.length === 0) {
    console.log('');
    console.log('Not found in customer /api/bill payload.');
    console.log('This usually means either:');
    console.log('- customer app is on a different DB/sync snapshot than this repo');
    console.log('- customer /api/bill applies extra filters (active/eligible/etc.)');
    console.log('- you need a different account filter (?account=regular|brooklyn|both)');
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});

