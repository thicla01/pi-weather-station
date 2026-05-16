/**
 * Tomorrow.io weather-code parsing — extracted from the v2
 * `CurrentWeather` component so the Direction C `HeroCompact` can
 * reuse the exact same mapping without duplicating the switch
 * statement. Pure logic, no React.
 *
 * Codes are documented at
 *   https://docs.tomorrow.io/reference/data-layers-weather-codes
 */

import nightClear from "@iconify/icons-wi/night-clear";
import daySunny from "@iconify/icons-wi/day-sunny";
import dayCloudy from "@iconify/icons-wi/day-cloudy";
import nightAltCloudy from "@iconify/icons-wi/night-alt-cloudy";
import dayRain from "@iconify/icons-wi/day-rain";
import nightRain from "@iconify/icons-wi/night-rain";
import strongWind from "@iconify/icons-wi/strong-wind";
import snowIcon from "@iconify/icons-ion/snow";
import rainMix from "@iconify/icons-wi/rain-mix";
import thunderstormIcon from "@iconify/icons-wi/thunderstorm";
import fogIcon from "@iconify/icons-wi/fog";
import cloudyIcon from "@iconify/icons-wi/cloudy";
import daySunnyOvercast from "@iconify/icons-wi/day-sunny-overcast";

/**
 * Map a Tomorrow.io weather code to its display icon + i18n key.
 *
 * Accepts both the 4-digit `weatherCode` / `weatherCodeMax` family
 * (e.g. 1001 = Cloudy) and the 5-digit `weatherCodeDay` /
 * `weatherCodeNight` variants (e.g. 10010 = Cloudy + day flag,
 * 10011 = Cloudy + night flag) per the Tomorrow.io documentation —
 * https://docs.tomorrow.io/reference/data-layers-weather-codes
 *
 * The trailing day/night flag in 5-digit codes is purely metadata
 * (the `isDay` parameter already drives icon variant selection), so
 * we normalise 5-digit input down to its 4-digit base before
 * matching. Without this normalisation v2.14.57's expanded 5-day
 * columns view rendered raw placeholders like "c10010" instead of
 * icons because the switch only knew the 4-digit names.
 *
 * @param {number} code — Tomorrow.io weather code (4-digit base or
 *   5-digit day/night variant)
 * @param {boolean} [isDay] — true if currently in daylight hours.
 *   Drives the day/night icon variants for clear/cloudy/rain.
 * @returns {{descKey: string, icon: object} | undefined} icon + i18n
 *   key, or undefined when the code is unknown (caller renders nothing).
 */
export function parseWeatherCode(code, isDay) {
  const baseCode = code != null && code > 9999 ? Math.floor(code / 10) : code;
  switch (baseCode) {
    case 6201: return { descKey: "weather.heavyFreezingRain", icon: isDay ? dayRain : nightRain };
    case 6001: return { descKey: "weather.freezingRain", icon: isDay ? dayRain : nightRain };
    case 6200: return { descKey: "weather.lightFreezingRain", icon: isDay ? dayRain : nightRain };
    case 6000: return { descKey: "weather.freezingDrizzle", icon: rainMix };
    case 7101: return { descKey: "weather.heavyIcePellets", icon: rainMix };
    case 7000: return { descKey: "weather.icePellets", icon: rainMix };
    case 7102: return { descKey: "weather.lightIcePellets", icon: rainMix };
    case 5101: return { descKey: "weather.heavySnow", icon: snowIcon };
    case 5000: return { descKey: "weather.snow", icon: snowIcon };
    case 5100: return { descKey: "weather.lightSnow", icon: snowIcon };
    case 5001: return { descKey: "weather.flurries", icon: snowIcon };
    case 8000: return { descKey: "weather.thunderStorm", icon: thunderstormIcon };
    case 4201: return { descKey: "weather.heavyRain", icon: isDay ? dayRain : nightRain };
    case 4001: return { descKey: "weather.rain", icon: isDay ? dayRain : nightRain };
    case 4200: return { descKey: "weather.lightRain", icon: isDay ? dayRain : nightRain };
    case 4000: return { descKey: "weather.drizzle", icon: rainMix };
    case 2100: return { descKey: "weather.lightFog", icon: fogIcon };
    case 2000: return { descKey: "weather.fog", icon: fogIcon };
    case 1001: return { descKey: "weather.cloudy", icon: cloudyIcon };
    case 1102: return { descKey: "weather.mostlyCloudy", icon: cloudyIcon };
    case 1101: return { descKey: "weather.partlyCloudy", icon: isDay ? daySunnyOvercast : nightAltCloudy };
    case 1100: return { descKey: "weather.mostlyClear", icon: isDay ? dayCloudy : nightAltCloudy };
    case 1000: return { descKey: "weather.clear", icon: isDay ? daySunny : nightClear };
    case 3001: return { descKey: "weather.wind", icon: strongWind };
    case 3000: return { descKey: "weather.lightWind", icon: strongWind };
    case 3002: return { descKey: "weather.strongWind", icon: strongWind };
    default:   return undefined;
  }
}

/**
 * True iff the current local time falls between sunrise and sunset.
 *
 * @param {Date|string|number} sunrise — sunrise time
 * @param {Date|string|number} sunset — sunset time
 * @returns {boolean} true during daylight hours
 */
export function isDaylight(sunrise, sunset) {
  const sunriseTime = new Date(sunrise).getTime();
  const sunsetTime = new Date(sunset).getTime();
  const now = Date.now();
  return now > sunriseTime && now < sunsetTime;
}
