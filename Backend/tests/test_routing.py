import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
import httpx
from Backend.routing import RoadRouter


class RoadRoutingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.unit = SimpleNamespace(id='AMB-101', lat=12.9745, lng=77.645)
        self.incident = SimpleNamespace(lat=12.9716, lng=77.6412)
        self.payload = {'code': 'Ok', 'routes': [{'duration': 241, 'distance': 2150, 'geometry': {'type': 'LineString', 'coordinates': [[77.645, 12.9745], [77.6412, 12.9716]]}}]}
        self.client = AsyncMock()
        self.client.get.return_value = httpx.Response(200, request=httpx.Request("GET", "https://routing.example"), json=self.payload)
        self.router = RoadRouter('https://routing.example')

    async def test_department_to_reporter_coordinate_order_and_road_eta(self):
        route = await self.router.route(self.client, self.unit, self.incident)
        self.assertEqual(route['eta_minutes'], 5)
        self.assertEqual(route['distance_km'], 2.1)
        self.assertIn('/77.645,12.9745;77.6412,12.9716', self.client.get.call_args.args[0])
        self.assertEqual(route['geometry'], self.payload['routes'][0]['geometry'])
        self.assertFalse(route['traffic_aware'])

    async def test_polling_is_cached_but_fleet_movement_recalculates(self):
        await self.router.route(self.client, self.unit, self.incident)
        await self.router.route(self.client, self.unit, self.incident)
        self.assertEqual(self.client.get.await_count, 1)
        self.unit.lat = 12.973
        self.payload['routes'][0]['duration'] = 120
        self.client.get.return_value = httpx.Response(200, request=httpx.Request("GET", "https://routing.example"), json=self.payload)
        route = await self.router.route(self.client, self.unit, self.incident)
        self.assertEqual(route['eta_minutes'], 2)
        self.assertEqual(self.client.get.await_count, 2)

    async def test_outages_and_unknown_coordinates_do_not_invent_routes(self):
        self.client.get.side_effect = httpx.ConnectError('Offline')
        self.assertIsNone(await self.router.route(self.client, self.unit, self.incident))
        self.assertIsNone(await self.router.route(self.client, self.unit, self.incident))
        self.assertEqual(self.client.get.await_count, 1)
        self.unit.lat = None
        self.assertIsNone(await self.router.route(self.client, self.unit, self.incident))
        self.assertEqual(self.client.get.await_count, 1)

    async def test_no_route_and_invalid_geometry_are_explicitly_unavailable(self):
        self.client.get.return_value = httpx.Response(200, request=httpx.Request("GET", "https://routing.example"), json={'code': 'NoRoute', 'routes': []})
        self.assertIsNone(await self.router.route(self.client, self.unit, self.incident))
        self.unit.lat += .001
        self.payload['routes'][0]['geometry']['coordinates'] = [[500, 200], [500, 200]]
        self.client.get.return_value = httpx.Response(200, request=httpx.Request("GET", "https://routing.example"), json=self.payload)
        self.assertIsNone(await self.router.route(self.client, self.unit, self.incident))
