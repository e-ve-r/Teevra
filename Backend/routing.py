"""Cached OSRM road routes. Coordinates are sent only to the configured router."""
import asyncio
from math import ceil, isfinite
from time import monotonic


class RoadRouter:
    def __init__(self, base_url):
        self.base_url = base_url.rstrip('/')
        self.cache = {}
        self.lock = asyncio.Lock()

    async def route(self, client, unit, incident):
        coords = (unit.lng, unit.lat, incident.lng, incident.lat)
        if not self.base_url or None in coords:
            return None
        # Serialize cache misses to avoid duplicate requests from polling clients.
        async with self.lock:
            now = monotonic()
            cached = self.cache.get(coords)
            if cached and cached[0] > now:
                return cached[1]
            result = None
            try:
                origin_lng, origin_lat, dest_lng, dest_lat = coords
                response = await client.get(
                    f'{self.base_url}/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}',
                    params={'overview': 'full', 'geometries': 'geojson', 'steps': 'false'},
                    timeout=4.0,
                )
                response.raise_for_status()
                data = response.json()
                route = data['routes'][0] if data.get('code') == 'Ok' else None
                if route:
                    duration, distance = float(route['duration']), float(route['distance'])
                    geometry = route['geometry']
                    if duration < 0 or distance < 0 or not isfinite(duration + distance) or geometry.get('type') != 'LineString' or len(geometry.get('coordinates', [])) < 2:
                        raise ValueError('Invalid route')
                    for point in geometry['coordinates']:
                        if len(point) < 2 or not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                            raise ValueError('Invalid route coordinates')
                    result = {'unit_id': unit.id, 'geometry': geometry, 'distance_km': round(distance / 1000, 1), 'eta_minutes': max(1, ceil(duration / 60)), 'basis': 'road_route', 'traffic_aware': False}
            except Exception:
                # A routing outage must not prevent incident intake or dispatch.
                result = None
            if len(self.cache) > 500:
                self.cache = {key: value for key, value in self.cache.items() if value[0] > now}
            self.cache[coords] = (monotonic() + (300 if result else 30), result)
            return result
