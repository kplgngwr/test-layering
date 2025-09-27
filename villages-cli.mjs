// Usage:
//   node villages-cli.mjs "Tripura"
//   node villages-cli.mjs "Tripura" "Gomati"

const VILLAGE_SERVICE =
  'https://livingatlas.esri.in/server/rest/services/IAB2024/IAB_Village_2024/MapServer/0';

// Ensure fetch exists (Node < 18 fallback)
if (typeof fetch === 'undefined') {
  const { default: f } = await import('node-fetch');
  globalThis.fetch = f;
}

function esc(s) {
  return String(s).replace(/'/g, "''"); // SQL-escape single quotes
}

function getArgs() {
  const [, , stateArg, distArg] = process.argv;
  if (!stateArg) {
    console.error('Usage: node villages-cli.mjs "<StateName>" ["<DistrictName>"]');
    process.exit(1);
  }
  return { state: stateArg.trim(), district: (distArg || '').trim() || null };
}

/**
 * Fetch distinct village names with pagination.
 * Uses groupByFieldsForStatistics=Name for true distincts + resultOffset paging.
 */
async function fetchVillageNames(stateName, districtName = null, pageSize = 2000) {
  const whereParts = [`State='${esc(stateName)}'`]; // service stores names in State/District/Name
  if (districtName) whereParts.push(`District='${esc(districtName)}'`);
  const where = whereParts.join(' AND ');

  const villages = new Set();
  let resultOffset = 0;
  let more = true;

  // Prefer statistics+groupBy (handles distinct + paging reliably)
  const stats = JSON.stringify([
    { statisticType: 'count', onStatisticField: 'Name', outStatisticFieldName: 'cnt' }
  ]);

  while (more) {
    const params = new URLSearchParams({
      where,
      outFields: 'Name',
      groupByFieldsForStatistics: 'Name',
      outStatistics: stats,
      orderByFields: 'Name',
      returnGeometry: 'false',
      f: 'json',
      resultOffset: String(resultOffset),
      resultRecordCount: String(pageSize)
    });

    const url = `${VILLAGE_SERVICE}/query?${params.toString()}`;
    const res = await fetch(url);
    const json = await res.json();

    if (json.error) {
      throw new Error(`ArcGIS error: ${JSON.stringify(json.error)}`);
    }

    const feats = json.features || [];
    for (const f of feats) {
      const name = f?.attributes?.Name ?? f?.attributes?.name;
      if (name) villages.add(String(name).trim());
    }

    // Paging control: ArcGIS sets exceededTransferLimit when more data exists
    if (json.exceededTransferLimit && feats.length > 0) {
      resultOffset += feats.length;
    } else {
      more = false;
    }
  }

  return [...villages].sort((a, b) => a.localeCompare(b));
}

(async () => {
  try {
    const { state, district } = getArgs();
    console.log(`Querying villages for State="${state}"${district ? `, District="${district}"` : ''} ...`);

    const list = await fetchVillageNames(state, district);
    console.log(`\nTotal villages: ${list.length}\n`);
    // Print one per line
    for (const v of list) console.log(v);

    if (list.length === 0) {
      console.log('\nNo villages found. Check spelling/casing of State/District or service availability.');
    }
  } catch (err) {
    console.error('\nFailed to fetch villages:\n', err?.message || err);
    process.exit(1);
  }
})();
