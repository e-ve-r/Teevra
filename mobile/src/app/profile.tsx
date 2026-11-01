import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Screen, Heading, Action, ErrorText } from '../components/UI';
import { useReporter } from '../context/ReporterContext';
import { styles } from '../lib/theme';
export default function ProfileScreen() {
  const { name, report, apiBase, saveName, saveApiBase } = useReporter();
  const [nameDraft, setNameDraft] = useState<string | null>(null); const [serverDraft, setServerDraft] = useState<string | null>(null);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  async function save(action: () => Promise<void>, success: string) { try { setError(''); await action(); setMessage(success); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save.'); } }
  return <Screen><Heading eyebrow="YOUR REPORTER SPACE" title="Your profile" description="The details that keep everything connected."/><View style={styles.card}><Text style={styles.heading}>{name}</Text><Text style={styles.label}>Your name</Text><TextInput accessibilityLabel="Your name" value={nameDraft ?? name} onChangeText={setNameDraft} maxLength={80} style={styles.input}/><View style={{marginTop:12}}><Action secondary label="Save name" onPress={() => save(() => saveName(nameDraft ?? name), 'Name saved.')}/></View>{report && <Text style={[styles.body,{marginTop:18}]}>Latest report: {report.id}{'\n'}Callback: {report.reporter_phone}</Text>}</View>
    <View style={styles.card}><Text style={styles.heading}>Server connection</Text><Text style={[styles.small,{marginTop:8}]}>Use your backend’s HTTPS address. For local testing, your phone must reach the development computer.</Text><Text style={styles.label}>Backend URL</Text><TextInput accessibilityLabel="Backend URL" value={serverDraft ?? apiBase} onChangeText={setServerDraft} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input}/><Text style={[styles.small,{marginTop:8}]}>Changing servers clears the saved report reference on this device.</Text><View style={{marginTop:12}}><Action secondary label="Save server address" onPress={() => save(() => saveApiBase(serverDraft ?? apiBase), 'Server address saved.')}/></View><ErrorText error={error}/>{message ? <Text style={[styles.notice,{marginTop:12}]}>{message}</Text> : null}</View>
  </Screen>;
}
