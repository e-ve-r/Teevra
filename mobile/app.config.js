// HTTP is useful for a local demo but must be explicitly enabled in native builds.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...config.plugins.map((plugin) =>
      Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
        ? ['expo-build-properties', { android: { usesCleartextTraffic: process.env.TEEVRA_ALLOW_HTTP === '1' } }]
        : plugin,
    ),
    ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
      ? [['react-native-maps', { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }]]
      : []),
  ],
});
