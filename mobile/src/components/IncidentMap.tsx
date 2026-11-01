import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, UrlTile } from 'react-native-maps';
import type { Coordinates, Incident, IncidentMap as IncidentMapData } from '../lib/types';
import { colors, styles } from '../lib/theme';

export default function IncidentMap({ incident, data, picked, onPick }: { incident?: Incident | null; data?: IncidentMapData | null; picked?: Coordinates | null; onPick?: (point: Coordinates) => void }) {
  const mapRef = useRef<MapView>(null);
  const fitted = useRef('');
  const [ready, setReady] = useState(false);
  const point = picked || (incident?.lat != null && incident.lng != null ? { lat: incident.lat, lng: incident.lng } : null);
  const lat = point?.lat; const lng = point?.lng;
  const units = useMemo(() => data && data.incident_id === incident?.id ? data.units : [], [data, incident?.id]);
  const routes = data && data.incident_id === incident?.id ? data.routes : [];
  const coordinates = [point && { latitude: point.lat, longitude: point.lng }, ...units.filter(u => u.lat != null && u.lng != null).map(u => ({ latitude: u.lat!, longitude: u.lng! }))].filter((p): p is {latitude: number; longitude: number} => !!p);
  const fitKey = `${incident?.id || 'picker'}:${lat}:${lng}:${units.map(u => u.id).sort().join(',')}`;
  useEffect(() => {
    if (!ready || !coordinates.length || fitted.current === fitKey) return;
    if (coordinates.length > 1) {
      mapRef.current?.fitToCoordinates(coordinates, { edgePadding: {top:40,right:40,bottom:40,left:40}, animated:true });
    } else {
      mapRef.current?.animateToRegion({ ...coordinates[0], latitudeDelta: 0.035, longitudeDelta: 0.035 }, 350);
    }
    fitted.current = fitKey;
  }, [ready, fitKey, coordinates]);
  return <View style={{borderWidth: 1, borderColor: colors.line, borderRadius: 14, overflow: 'hidden', backgroundColor: '#eef2f7'}}>
    <MapView ref={mapRef} style={{width:'100%', height:250}} initialRegion={{ latitude: point?.lat ?? 12.9716, longitude: point?.lng ?? 77.5946, latitudeDelta: 0.1, longitudeDelta: 0.1 }} provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} mapType={Platform.OS === 'android' ? 'none' : 'standard'} onPress={onPick ? e => onPick({ lat:e.nativeEvent.coordinate.latitude, lng:e.nativeEvent.coordinate.longitude }) : undefined} onMapReady={() => setReady(true)}>
      <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
      {point && <Marker coordinate={{latitude:point.lat,longitude:point.lng}} title={incident?.location_name || 'Incident location'} pinColor={colors.red} />}
      {units.map(u => u.lat != null && u.lng != null ? <Marker key={u.id} coordinate={{latitude:u.lat,longitude:u.lng}} title={u.name} description={u.location_source === 'demo' ? 'Demo fleet position' : `GPS updated ${u.location_updated_at ? new Date(u.location_updated_at).toLocaleTimeString() : 'recently'}`} pinColor={colors.blue} /> : null)}
      {routes.map(route => <Polyline key={route.unit_id} coordinates={route.geometry.coordinates.map(([longitude, latitude]) => ({latitude, longitude}))} strokeColor={colors.blue} strokeWidth={4} />)}
    </MapView>
    <View style={{padding: 12, gap: 5}}><Text style={styles.small}>{onPick ? (point ? 'Tap the map to move the incident pin.' : 'Tap the map to pin the incident. Initial view: Bengaluru.') : 'Red: incident · Blue: fleet · Routes use current stored positions.'}</Text>{routes.map(r => <Text key={r.unit_id} style={styles.small}>{units.find(u => u.id === r.unit_id)?.name || r.unit_id}: {r.eta_minutes} min · {r.distance_km} km by road{units.find(u => u.id === r.unit_id)?.location_source === 'demo' ? ' · Demo fleet' : ''}</Text>)}{data?.routing_unavailable && <Text style={styles.small}>Road route unavailable for one or more fleets.</Text>}<Text accessibilityRole="link" onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')} style={[styles.small,{color:colors.blue}]}>© OpenStreetMap contributors</Text></View>
  </View>;
}
