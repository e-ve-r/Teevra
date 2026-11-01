import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import { Screen, Heading, Action, ErrorText } from '../components/UI';
import { useReporter } from '../context/ReporterContext';
import { askAssistant } from '../lib/api';
import { colors, styles } from '../lib/theme';
import { isClosed, type ChatMessage } from '../lib/types';
const welcome = 'Hi, I’m Teevra Assist. I can share basic first-aid steps while you wait for professional help. For an emergency, call your local emergency service directly—this app cannot dispatch help. What happened?';
export default function ChatScreen() {
  const { report, updateReport } = useReporter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sharing, setSharing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState<ChatMessage[] | null>(null);
  async function reply(conversation: ChatMessage[]) {
    try {
      const result = await askAssistant(conversation, report);
      if (!result.reply?.trim()) throw new Error('The assistant returned an empty reply.');
      setMessages(current => [...current, {role:'assistant', content:result.reply.trim()}]); setFailed(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Chat is unavailable.'); setFailed(conversation); }
    finally { setBusy(false); }
  }
  async function send() {
    const text = draft.trim(); if (!text || busy) return;
    setBusy(true); setError(''); setFailed(null);
    if (report && !isClosed(report) && sharing) {
      try { await updateReport({description:text}); }
      catch (failure) { setError(`Your report update was not saved: ${failure instanceof Error ? failure.message : 'Please retry.'}`); setBusy(false); return; }
    }
    const conversation: ChatMessage[] = [...messages, {role:'user', content:text}];
    setMessages(conversation); setDraft(''); await reply(conversation);
  }
  return <Screen><Heading eyebrow="YOU DON’T HAVE TO WAIT ALONE" title="A little support" description="Ask a question. We’re right here with you."/><View style={styles.card}><Text style={styles.heading}>Teevra Assist</Text><Text style={[styles.small,{marginTop:4}]}>A little support, right here.</Text><View style={styles.divider}/>
    {[{role:'assistant' as const,content:welcome}, ...messages].map((message,index) => <View key={index} style={{alignSelf:message.role === 'user' ? 'flex-end' : 'flex-start', backgroundColor:message.role === 'user' ? colors.blue : '#f1f5fc', borderRadius:16, padding:14, maxWidth:'94%', marginBottom:12}}><Text style={{color:message.role === 'user' ? '#fff' : colors.blueDark, fontSize:14,lineHeight:22}}>{message.content}</Text></View>)}
    {busy && <Text style={styles.small}>Preparing a reply…</Text>}{report && !isClosed(report) && <View style={[styles.row,{marginVertical:12}]}><Switch accessibilityLabel={`Share messages with report ${report.id}`} value={sharing} onValueChange={setSharing} trackColor={{true:colors.blue}}/><Text style={[styles.small,{flex:1}]}>Share my messages as updates to report {report.id}</Text></View>}
    <TextInput accessibilityLabel="Message Teevra Assist" value={draft} onChangeText={setDraft} maxLength={2000} multiline placeholder="Type your message…" style={[styles.input,{minHeight:72,textAlignVertical:'top'}]}/><ErrorText error={error}/><View style={{marginTop:12}}><Action label="Send message" onPress={send} disabled={!draft.trim()} loading={busy}/></View>{failed && <View style={{marginTop:8}}><Action secondary label="Retry assistant reply" disabled={busy} onPress={() => { setBusy(true); setError(''); reply(failed); }}/></View>}
    <Text style={[styles.small,{marginTop:14}]}>AI can make mistakes. Messages are sent to OpenRouter and its inference provider.</Text>
  </View></Screen>;
}
