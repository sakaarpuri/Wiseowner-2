// netlify/functions/directory.js
// Motivated seller directory — PropStream API with mock data fallback

const MOCK_PROPERTIES = [
  {
    address: "2847 Ridgewood Dr",
    city: "Austin",
    state: "TX",
    zip: "78704",
    estimatedValue: 485000,
    estimatedEquity: 218000,
    equityPercent: 45,
    signals: ["expired_listing", "absentee_owner"],
    daysOnMarket: 127,
    lastListedPrice: 519000,
    lastListedDate: "2024-08-14",
    priceReductions: 3,
    ownerName: "Patterson, Robert J",
    ownerMailingAddress: "1204 Cherry Hill Rd, Denver CO 80220",
    isAbsentee: true,
    yearsOwned: 9,
    lastSalePrice: 267000,
    lastSaleDate: "2015-04-22"
  },
  {
    address: "514 Maple Crest Ln",
    city: "Austin",
    state: "TX",
    zip: "78748",
    estimatedValue: 372000,
    estimatedEquity: 194000,
    equityPercent: 52,
    signals: ["pre_foreclosure", "tax_delinquent"],
    daysOnMarket: 0,
    lastListedPrice: null,
    lastListedDate: null,
    priceReductions: 0,
    ownerName: "Vasquez, Maria L",
    ownerMailingAddress: "514 Maple Crest Ln, Austin TX 78748",
    isAbsentee: false,
    yearsOwned: 6,
    lastSalePrice: 178000,
    lastSaleDate: "2018-09-03"
  },
  {
    address: "931 Thornberry Ct",
    city: "Austin",
    state: "TX",
    zip: "78753",
    estimatedValue: 610000,
    estimatedEquity: 390000,
    equityPercent: 64,
    signals: ["high_equity", "long_vacant", "absentee_owner"],
    daysOnMarket: 0,
    lastListedPrice: null,
    lastListedDate: null,
    priceReductions: 0,
    ownerName: "Nguyen, Thomas K",
    ownerMailingAddress: "78 Oakdale Rd, Chicago IL 60601",
    isAbsentee: true,
    yearsOwned: 14,
    lastSalePrice: 220000,
    lastSaleDate: "2010-07-18"
  },
  {
    address: "1602 Westover Hills Blvd",
    city: "Austin",
    state: "TX",
    zip: "78704",
    estimatedValue: 295000,
    estimatedEquity: 134000,
    equityPercent: 45,
    signals: ["price_reduced", "expired_listing"],
    daysOnMarket: 94,
    lastListedPrice: 329000,
    lastListedDate: "2024-09-02",
    priceReductions: 4,
    ownerName: "Kowalski, Sandra M",
    ownerMailingAddress: "1602 Westover Hills Blvd, Austin TX 78704",
    isAbsentee: false,
    yearsOwned: 3,
    lastSalePrice: 261000,
    lastSaleDate: "2021-03-14"
  },
  {
    address: "408 Pinecrest Ave",
    city: "Austin",
    state: "TX",
    zip: "78757",
    estimatedValue: 730000,
    estimatedEquity: 510000,
    equityPercent: 70,
    signals: ["probate", "high_equity"],
    daysOnMarket: 0,
    lastListedPrice: null,
    lastListedDate: null,
    priceReductions: 0,
    ownerName: "Estate of Holloway, James",
    ownerMailingAddress: "c/o Wells & Pratt Law, 2200 Congress Ave, Austin TX 78701",
    isAbsentee: true,
    yearsOwned: 22,
    lastSalePrice: 219000,
    lastSaleDate: "2002-11-06"
  },
  {
    address: "77 Lakeview Terrace",
    city: "Austin",
    state: "TX",
    zip: "78703",
    estimatedValue: 920000,
    estimatedEquity: 560000,
    equityPercent: 61,
    signals: ["absentee_owner", "high_equity", "long_vacant"],
    daysOnMarket: 0,
    lastListedPrice: null,
    lastListedDate: null,
    priceReductions: 0,
    ownerName: "Chen, William & Amy",
    ownerMailingAddress: "340 Pacific Coast Hwy, Malibu CA 90265",
    isAbsentee: true,
    yearsOwned: 11,
    lastSalePrice: 360000,
    lastSaleDate: "2013-05-29"
  },
  {
    address: "2219 Brentwood Dr",
    city: "Austin",
    state: "TX",
    zip: "78722",
    estimatedValue: 415000,
    estimatedEquity: 155000,
    equityPercent: 37,
    signals: ["tax_delinquent", "long_vacant"],
    daysOnMarket: 0,
    lastListedPrice: null,
    lastListedDate: null,
    priceReductions: 0,
    ownerName: "Okafor, Emmanuel",
    ownerMailingAddress: "88 Sutton Place N, New York NY 10022",
    isAbsentee: true,
    yearsOwned: 7,
    lastSalePrice: 260000,
    lastSaleDate: "2017-02-11"
  },
  {
    address: "356 Creekwood Pass",
    city: "Austin",
    state: "TX",
    zip: "78741",
    estimatedValue: 280000,
    estimatedEquity: 168000,
    equityPercent: 60,
    signals: ["pre_foreclosure", "price_reduced"],
    daysOnMarket: 62,
    lastListedPrice: 299000,
    lastListedDate: "2024-10-01",
    priceReductions: 2,
    ownerName: "Williams, Derek A",
    ownerMailingAddress: "356 Creekwood Pass, Austin TX 78741",
    isAbsentee: false,
    yearsOwned: 4,
    lastSalePrice: 112000,
    lastSaleDate: "2020-08-19"
  }
];

function filterProperties(properties, filters) {
  const { signals = [], minValue = 0, maxValue = Infinity, minEquityPct = 0 } = filters;

  return properties.filter(p => {
    if (p.estimatedValue < minValue || p.estimatedValue > maxValue) return false;
    if (p.equityPercent < minEquityPct) return false;
    if (signals.length > 0 && !signals.some(s => p.signals.includes(s))) return false;
    return true;
  });
}

async function fetchFromPropStream(params, apiKey) {
  const { zip, signals, minValue, maxValue, minEquityPct } = params;
  const url = `https://api.propstream.com/v1/properties?zip=${zip}&equity_min=${minEquityPct}&value_min=${minValue}&value_max=${maxValue}`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) throw new Error(`PropStream ${res.status}`);

  const data = await res.json();

  // Normalize PropStream response to our shape
  return (data.properties || []).map(p => ({
    address: p.address?.street || '',
    city: p.address?.city || '',
    state: p.address?.state || '',
    zip: p.address?.zip || zip,
    estimatedValue: p.avm?.value || 0,
    estimatedEquity: p.equity?.amount || 0,
    equityPercent: p.equity?.percent || 0,
    signals: (p.signals || []).map(s => s.type),
    daysOnMarket: p.listing?.daysOnMarket || 0,
    lastListedPrice: p.listing?.price || null,
    lastListedDate: p.listing?.date || null,
    priceReductions: p.listing?.priceReductions || 0,
    ownerName: p.owner?.name || 'Unknown',
    ownerMailingAddress: p.owner?.mailingAddress || '',
    isAbsentee: p.owner?.isAbsentee || false,
    yearsOwned: p.owner?.yearsOwned || 0,
    lastSalePrice: p.lastSale?.price || null,
    lastSaleDate: p.lastSale?.date || null
  }));
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
  }

  try {
    const params = JSON.parse(event.body || '{}');
    const { zip, signals = [], minValue = 0, maxValue = 9999999, minEquityPct = 0 } = params;

    if (!zip) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'zip is required' })
      };
    }

    const apiKey = process.env.PROPSTREAM_KEY;
    let properties;

    if (apiKey) {
      // Live PropStream data
      try {
        const raw = await fetchFromPropStream(params, apiKey);
        properties = filterProperties(raw, { signals, minValue, maxValue, minEquityPct });
      } catch (apiErr) {
        console.error('PropStream error, falling back to mock:', apiErr.message);
        properties = filterProperties(MOCK_PROPERTIES, { signals, minValue, maxValue, minEquityPct });
      }
    } else {
      // No API key — use mock data (filtered)
      properties = filterProperties(MOCK_PROPERTIES, { signals, minValue, maxValue, minEquityPct });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        data: properties,
        isMock: !apiKey
      })
    };
  } catch (err) {
    console.error('directory.js error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
