import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { Screen, Heading, Action } from '../components/UI';
import { useReporter } from '../context/ReporterContext';
import { colors, styles } from '../lib/theme';
import { statusLabel } from '../lib/types';

export default function HomeScreen() {
  const { report } = useReporter();
  return <Screen><Heading title={'We got you\nquick'} description="Report an emergency. Get help." /><View style={[styles.card, { padding: 25, minHeight: 280, justifyContent: 'space-between' }]}><View><View style={{ width: 55, height: 55, borderRadius: 17, backgroundColor: '#fff0f3', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}><Ionicons name="alert-circle-outline" size={30} color={colors.red}/></View><Text style={[styles.heading, {fontSize: 25}]}>Unsure?</Text><Text style={[styles.body, {marginTop: 8}]}>Share what’s happening.{"\n"}We’ll help you take the next step.</Text></View><View><Action label="Report an emergency  →" onPress={() => router.navigate('/report')} /><Text style={[styles.small, {marginTop: 10, textAlign: 'center'}]}>A photo. A few words. Or just your voice.</Text></View></View>
    {[{title:'Your response', detail:'Follow your report and share what changes.', icon:'location-outline' as const, path:'/tracking' as const}, {title:'Talk to Teevra', detail:'Your AI companion, one tap away.', icon:'sparkles-outline' as const, path:'/chat' as const}].map(item => <Pressable accessibilityRole="button" onPress={() => router.navigate(item.path)} key={item.title} style={[styles.card, styles.row]}><View style={{backgroundColor: colors.pale, padding: 12, borderRadius: 12}}><Ionicons name={item.icon} color={colors.blue} size={24}/></View><View style={{flex:1}}><Text style={[styles.heading, {fontSize: 16}]}>{item.title}</Text><Text style={[styles.small, {marginTop:4}]}>{item.detail}</Text></View><Ionicons name="arrow-forward" color={colors.blue} size={20}/></Pressable>)}
    {report && <Pressable accessibilityRole="button" style={[styles.card, styles.row]} onPress={() => router.navigate('/tracking')}><Text style={{color:colors.blue,fontWeight:'700'}}>{report.id}</Text><Text style={[styles.small,{flex:1}]}>{statusLabel(report.status)}</Text><Ionicons name="arrow-forward" color={colors.blue} size={20}/></Pressable>}
  </Screen>;
}
