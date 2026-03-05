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

    // ── 2. Fetch AVM (estimated value) ──
    const avmParams = new URLSearchParams({
      address: fullAddress,
      ...(property?.propertyType && { propertyType: property.propertyType }),
    });

    const avmRes = await fetch(
      `https://api.rentcast.io/v1/avm/value?${avmParams.toString()}`,
      { method: "GET", headers }
    );

    let estimatedValue = null;
    if (avmRes.ok) {
      const avmData = await avmRes.json();
      estimatedValue = avmData.price ?? avmData.value ?? null;
    } else if (avmRes.status !== 404) {
      console.warn("Rentcast AVM endpoint:", avmRes.status);
    }

    // If we got nothing from either endpoint, return no data silently
    if (!property && estimatedValue === null) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ success: true, data: null }),
      };
    }

    // ── 3. Map to our standard shape ──
    const data = {
      estimatedValue:  estimatedValue                         ?? null,
      lastSalePrice:   property?.lastSalePrice                ?? null,
      lastSaleDate:    property?.lastSaleDate                 ?? null,
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
