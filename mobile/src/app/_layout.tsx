import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ReporterProvider } from '../context/ReporterContext';
import { colors } from '../lib/theme';

export default function RootLayout() {
  return <ReporterProvider><Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.blue, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: '#fff', borderTopColor: colors.line, height: 78, paddingTop: 8, paddingBottom: 12 }, tabBarLabelStyle: { fontSize: 10, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({focused, size}) => <Ionicons name="home-outline" color={focused ? colors.blue : colors.muted} size={size} /> }} />
    <Tabs.Screen name="tracking" options={{ title: 'Response', tabBarIcon: ({focused, size}) => <Ionicons name="location-outline" color={focused ? colors.blue : colors.muted} size={size} /> }} />
    <Tabs.Screen name="report" options={{ title: 'Report', tabBarIcon: ({size}) => <Ionicons name="send" color={colors.red} size={size} /> }} />
    <Tabs.Screen name="chat" options={{ title: 'AI chat', tabBarIcon: ({focused, size}) => <Ionicons name="chatbubble-outline" color={focused ? colors.blue : colors.muted} size={size} /> }} />
    <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({focused, size}) => <Ionicons name="person-outline" color={focused ? colors.blue : colors.muted} size={size} /> }} />
  </Tabs></ReporterProvider>;
}
