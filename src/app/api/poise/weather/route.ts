/**
 * Live weather + air quality (Open-Meteo, no API key) + city (BigDataCloud).
 * GET /api/poise/weather?lat=..&lon=.. -> { tempC, feelsC, condition, uv, aqi, aqiLabel, humidity, isDay, city }
 */

const WMO: Record<number, string> = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "foggy",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "freezing rain", 71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "rain showers", 81: "rain showers", 82: "heavy showers", 85: "snow showers", 86: "snow showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
};

function aqiLabel(aqi?: number): string {
  if (aqi == null) return "unknown";
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "unhealthy for sensitive groups";
  if (aqi <= 200) return "unhealthy";
  if (aqi <= 300) return "very unhealthy";
  return "hazardous";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");
    if (!lat || !lon) return Response.json({ ok: false, error: "lat/lon required" }, { status: 400 });

    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,uv_index,is_day&timezone=auto`;
    const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi`;
    const geoUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;

    const [wxRes, aqRes, geoRes] = await Promise.allSettled([
      fetch(wxUrl, { signal: AbortSignal.timeout(8000) }),
      fetch(aqUrl, { signal: AbortSignal.timeout(8000) }),
      fetch(geoUrl, { signal: AbortSignal.timeout(8000) }),
    ]);

    const wx = wxRes.status === "fulfilled" && wxRes.value.ok ? (await wxRes.value.json())?.current : null;
    const aq = aqRes.status === "fulfilled" && aqRes.value.ok ? (await aqRes.value.json())?.current : null;
    const geo = geoRes.status === "fulfilled" && geoRes.value.ok ? await geoRes.value.json() : null;

    if (!wx) return Response.json({ ok: false, error: "weather unavailable" }, { status: 502 });

    const aqi = aq?.us_aqi;
    return Response.json({
      ok: true,
      tempC: Math.round(wx.temperature_2m),
      feelsC: Math.round(wx.apparent_temperature),
      condition: WMO[wx.weather_code] ?? "clear",
      uv: Math.round(wx.uv_index ?? 0),
      humidity: Math.round(wx.relative_humidity_2m ?? 0),
      isDay: wx.is_day === 1,
      aqi: aqi != null ? Math.round(aqi) : undefined,
      aqiLabel: aqiLabel(aqi),
      city: geo?.city || geo?.locality || geo?.principalSubdivision || undefined,
    });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
