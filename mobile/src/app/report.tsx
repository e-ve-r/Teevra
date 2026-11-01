import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen, Heading, Action } from '../components/UI';
import ReportForm from '../components/ReportForm';
import { useReporter } from '../context/ReporterContext';
import { isClosed } from '../lib/types';
import { styles } from '../lib/theme';
export default function ReportScreen() {
  const { report } = useReporter();
  return <Screen><Heading eyebrow="LET’S START WITH THE DETAILS" title="Report an emergency" description="A photo, a few words, or your voice. Every detail helps."/>{report && !isClosed(report) && <View style={styles.card}><Text style={styles.body}>You already have an active report, {report.id}. Send changes on that report to keep the team up to date.</Text><View style={{marginTop:12}}><Action secondary label="Update existing report" onPress={() => router.navigate('/tracking')}/></View></View>}<ReportForm/></Screen>;
}
