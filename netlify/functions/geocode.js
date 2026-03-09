exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "GOOGLE_MAPS_API_KEY not configured" }),
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

  const { address } = body;
  if (!address || typeof address !== "string" || address.trim().length < 5) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "address is required" }),
    };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ success: false, error: "Google API request failed" }),
      };
    }

    const data = await res.json();

    if (data.status !== "OK" || !data.results || data.results.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: `No results found (${data.status})` }),
      };
    }

    const result = data.results[0];
    const components = result.address_components || [];

    // Helper: pull a component by type
    function get(type, useShort = false) {
      const c = components.find((c) => c.types.includes(type));
      return c ? (useShort ? c.short_name : c.long_name) : null;
    }

    const state   = get("administrative_area_level_1", true);  // e.g. "TX"
    const county  = get("administrative_area_level_2");         // e.g. "Travis County"
    const city    = get("locality") || get("sublocality") || get("postal_town");
    const zip     = get("postal_code");
    const lat     = result.geometry?.location?.lat ?? null;
    const lng     = result.geometry?.location?.lng ?? null;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        success: true,
        data: { state, county, city, zip, lat, lng },
      }),
    };
  } catch (err) {
    console.error("geocode error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Geocode request failed", detail: err.message }),
    };
  }
};
