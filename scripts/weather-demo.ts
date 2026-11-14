// Smoke test for src/lib/weather: prints a forecast, race-day climatology and monthly normals for one place.
//   node scripts/weather-demo.ts
import { getForecast, geocode } from '../src/lib/weather/client.ts';
import { raceDayClimatology } from '../src/lib/weather/climatology.ts';
import { fetchNormals } from '../src/lib/weather/normals.ts';

const [place] = await geocode('Boston');
console.log(`${place.name}, ${place.admin1} (${place.latitude}, ${place.longitude})`);
const fc = await getForecast({ lat: place.latitude, lon: place.longitude, hourly: ['temperature_2m', 'dew_point_2m'], days: 2 });
console.log('forecast:', fc.hourly!.time[9], `${fc.hourly!.temperature_2m[9]}°C, dew point ${fc.hourly!.dew_point_2m[9]}°C`, `(${fc.timezone})`);
console.log('typical Apr 19, 10:00 for 4 h:', await raceDayClimatology(place.latitude, place.longitude, '04-19', 10, 4));
const normals = await fetchNormals(place.latitude, place.longitude);
console.log('normals 1991–2020:', normals.months.map((m) => `${m.month}: ${m.tmin}–${m.tmax}°C, ${m.precip} mm`).join(' | '));
