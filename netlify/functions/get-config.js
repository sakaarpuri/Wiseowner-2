// Returns public-safe config to the browser client
// SUPABASE_ANON_KEY is designed to be exposed client-side (protected by RLS)
exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const stripePk = process.env.STRIPE_PUBLIC_KEY;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      supabaseUrl: supabaseUrl || '',
      supabaseAnonKey: supabaseAnonKey || '',
      stripePk: stripePk || '',
      googleMapsApiKey: googleMapsApiKey || '',
    }),
  };
};
