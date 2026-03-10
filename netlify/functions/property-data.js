exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.RENTCAST_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "RENTCAST_KEY not configured" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Invalid JSON" }),
    };
  }

  const { address, city, state, zip } = body;
  if (!address || !state) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "address and state are required" }),
    };
  }

  const headers = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
  };

  const fullAddress = [address, city, state, zip].filter(Boolean).join(", ");

  function toSaleYear(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") {
      // Some providers return unix seconds, ms, or year-only integers.
      if (raw >= 1900 && raw <= 2100) return raw;
      const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : raw;
      const y = new Date(ms).getUTCFullYear();
      return y >= 1900 && y <= 2100 ? y : null;
    }
    const txt = String(raw).trim();
    if (!txt) return null;
    const m = txt.match(/\b(19|20)\d{2}\b/);
    if (m) return Number(m[0]);
    const d = new Date(txt);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      if (y >= 1900 && y <= 2100) return y;
    }
    return null;
  }

  function normalizeComp(comp) {
    if (!comp) return null;
    const price =
      comp.price ??
      comp.salePrice ??
      comp.lastSalePrice ??
      comp.value ??
      comp.amount ??
      null;
    if (!price || !Number.isFinite(Number(price))) return null;
    const saleDate =
      comp.saleDate ??
      comp.lastSaleDate ??
      comp.date ??
      comp.recordingDate ??
      comp.closedDate ??
      null;
    const fallbackAddress = [comp.streetAddress, comp.city, comp.state, comp.zipCode].filter(Boolean).join(", ");
    const address = comp.formattedAddress ?? comp.address ?? (fallbackAddress || null);
    return {
      address,
      price: Number(price),
      saleDate: saleDate ?? null,
      saleYear: toSaleYear(saleDate),
    };
  }

  function pickSaleInfo(property) {
    if (!property) return { lastSalePrice: null, lastSaleDate: null, lastSaleYear: null };

    const directPrice =
      property.lastSalePrice ??
      property.salePrice ??
      property.lastSale?.price ??
      property.lastSaleAmount ??
      null;
    const directDate =
      property.lastSaleDate ??
      property.saleDate ??
      property.lastSale?.date ??
      null;

    const history =
      property.saleHistory ??
      property.salesHistory ??
      property.transactionHistory ??
      property.transactions ??
      [];

    let latest = null;
    if (Array.isArray(history) && history.length) {
      const sorted = [...history]
        .filter(Boolean)
        .sort((a, b) => new Date(b.date || b.saleDate || b.recordingDate || 0) - new Date(a.date || a.saleDate || a.recordingDate || 0));
      latest = sorted[0] || null;
    }

    const historyPrice =
      latest?.price ??
      latest?.salePrice ??
      latest?.amount ??
      latest?.value ??
      null;
    const historyDate =
      latest?.date ??
      latest?.saleDate ??
      latest?.recordingDate ??
      latest?.year ??
      latest?.saleYear ??
      null;

    const lastSalePrice = directPrice ?? historyPrice ?? null;
    const lastSaleDate = directDate ?? historyDate ?? null;
    const lastSaleYear = toSaleYear(lastSaleDate) ?? toSaleYear(latest?.year ?? latest?.saleYear ?? null);

    return { lastSalePrice, lastSaleDate, lastSaleYear: lastSaleYear ?? null };
  }

  try {
    // ── 1. Fetch property details (bedrooms, bathrooms, sqft, year built, last sale) ──
    const propRes = await fetch(
      `https://api.rentcast.io/v1/properties?address=${encodeURIComponent(fullAddress)}&limit=1`,
      { method: "GET", headers }
    );

    let property = null;
    if (propRes.ok) {
      const propData = await propRes.json();
      // Rentcast returns an array
      property = Array.isArray(propData) ? propData[0] : propData;
    } else if (propRes.status !== 404) {
      console.warn("Rentcast properties endpoint:", propRes.status);
    }

    const saleInfo = pickSaleInfo(property);

    // ── 2. Fetch AVM value + rent estimate (parallel for speed) ──
    const avmParams = new URLSearchParams({
      address: fullAddress,
      ...(property?.propertyType && { propertyType: property.propertyType }),
    });

    const rentParams = new URLSearchParams({
      address: fullAddress,
      ...(property?.propertyType && { propertyType: property.propertyType }),
      ...(property?.bedrooms     && { bedrooms:     property.bedrooms }),
      ...(property?.bathrooms    && { bathrooms:    property.bathrooms }),
      ...(property?.squareFootage && { squareFootage: property.squareFootage }),
    });

    const [avmRes, rentRes] = await Promise.all([
      fetch(`https://api.rentcast.io/v1/avm/value?${avmParams.toString()}`, { method: "GET", headers }),
      fetch(`https://api.rentcast.io/v1/avm/rent/long-term?${rentParams.toString()}`, { method: "GET", headers }),
    ]);

    let estimatedValue = null;
    let valueComps = [];
    if (avmRes.ok) {
      const avmData = await avmRes.json();
      estimatedValue = avmData.price ?? avmData.value ?? null;
      const rawComps =
        avmData.comparables ??
        avmData.comps ??
        avmData.comparableSales ??
        avmData.recentSales ??
        [];
      if (Array.isArray(rawComps)) {
        valueComps = rawComps
          .map(normalizeComp)
          .filter(Boolean)
          .sort((a, b) => {
            const ad = new Date(a.saleDate || 0).getTime() || 0;
            const bd = new Date(b.saleDate || 0).getTime() || 0;
            return bd - ad;
          })
          .slice(0, 5);
      }
    } else if (avmRes.status !== 404) {
      console.warn("Rentcast AVM endpoint:", avmRes.status);
    }

    let estimatedRent = null, rentRangeLow = null, rentRangeHigh = null;
    if (rentRes.ok) {
      const rentData = await rentRes.json();
      estimatedRent  = rentData.rent ?? null;
      rentRangeLow   = rentData.rentRangeLow  ?? null;
      rentRangeHigh  = rentData.rentRangeHigh ?? null;
    } else if (rentRes.status !== 404) {
      console.warn("Rentcast rent estimate endpoint:", rentRes.status);
    }

    // If we got nothing from any endpoint, return no data silently
    if (!property && estimatedValue === null && estimatedRent === null) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ success: true, data: null }),
      };
    }

    // ── 3. Map to our standard shape ──
    const data = {
      estimatedValue:  estimatedValue                         ?? null,
      valueComps:      valueComps                             ?? [],
      estimatedRent:   estimatedRent                          ?? null,
      rentRangeLow:    rentRangeLow                           ?? null,
      rentRangeHigh:   rentRangeHigh                         ?? null,
      lastSalePrice:   saleInfo.lastSalePrice                 ?? null,
      lastSaleDate:    saleInfo.lastSaleDate                  ?? null,
      lastSaleYear:    saleInfo.lastSaleYear                  ?? null,
      propertyType:    property?.propertyType                 ?? null,
      bedrooms:        property?.bedrooms                     ?? null,
      bathrooms:       property?.bathrooms                    ?? null,
      squareFeet:      property?.squareFootage ?? property?.squareFeet ?? null,
      yearBuilt:       property?.yearBuilt                    ?? null,
    };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ success: true, data }),
    };
  } catch (err) {
    console.error("property-data error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Property data request failed", detail: err.message }),
    };
  }
};
