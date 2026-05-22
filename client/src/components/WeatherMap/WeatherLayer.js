import React from "react";
import PropTypes from "prop-types";
import { TileLayer } from "react-leaflet";

/**
 * Weather layer — OpenWeatherMap tile overlay. Inert in the current
 * deployment (the project moved to RainViewer + Tomorrow.io for radar
 * and conditions); kept around for the eventual return-to-OWM path
 * tracked in the OpenWeatherMap variant of CurrentWeather.
 *
 * @param {object} props
 * @param {String} props.layer One of OpenWeatherMap's tile layer names — `precipitation_new`, `clouds_new`, `temp_new`, etc.
 * @param {String} props.weatherApiKey OpenWeatherMap API key, appended to the tile URL as the `appid` query parameter.
 * @returns {JSX.Element} Weather layer
 */
const WeatherLayer = ({ layer, weatherApiKey }) => {
  return (
    <TileLayer
      attribution='&amp;copy <a href="https://openweathermap.org/">OpenWeather</a>'
      url={`https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${weatherApiKey}`}
      apiKey
    />
  );
};

WeatherLayer.propTypes = {
  layer: PropTypes.string.isRequired,
  weatherApiKey: PropTypes.string,
};

export default WeatherLayer;
