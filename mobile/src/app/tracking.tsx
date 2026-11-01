import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Screen, Heading, Action, ErrorText } from '../components/UI';
import IncidentMap from '../components/IncidentMap';
import ReportForm from '../components/ReportForm';
import { useReporter } from '../context/ReporterContext';
import { isClosed, statusLabel } from '../lib/types';
import { colors, styles } from '../lib/theme';
export default function TrackingScreen() {
  const { report, reportId, ready, map, error, notice, setNotice, refresh } = useReporter();
  const [showUpdate, setShowUpdate] = useState(false);
  const dispatches = report?.dispatches?.length ? report.dispatches : report?.dispatch ? [report.dispatch] : [];
  return <Screen><Heading eyebrow="CONNECTED, EVERY STEP" title="Your response" description="Follow your report. Keep us up to date."/><ErrorText error={error}/>{error ? <View style={{marginVertical:12}}><Action secondary label="Refresh report" onPress={refresh}/></View> : null}{notice ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss confirmation" onPress={() => setNotice('')}><Text style={styles.notice}>{notice}  ×</Text></Pressable> : null}
    {!report ? <View style={styles.card}><Text style={styles.heading}>{!ready || reportId ? 'Loading your report…' : 'Your report will appear here'}</Text><Text style={[styles.body,{marginVertical:15}]}>After submitting an emergency you can follow its response and send updates here.</Text><Action label="Report an emergency" onPress={() => router.navigate('/report')}/></View> : <>
      <View style={styles.card}><Text style={styles.eyebrow}>{report.id}</Text><Text style={[styles.heading,{fontSize:24}]}>{statusLabel(report.status)}</Text><Text style={[styles.small,{marginTop:6}]}>Response updates refresh while the app is open.</Text><View style={styles.divider}/>
        {dispatches.length ? dispatches.map(d => { const route = map?.incident_id === report.id ? map.routes.find(r => r.unit_id === d.unit_id) : null; return <View key={d.unit_id} style={{marginBottom:12}}><Text style={{fontSize:15,fontWeight:'700',color:colors.blueDark}}>{d.unit_name}</Text><Text style={[styles.small,{marginTop:3}]}>{isClosed(report) ? 'Response completed' : report.status === 'on_scene' ? 'At the incident' : route ? `Road ETA: ${route.eta_minutes} min · ${route.distance_km} km${map?.units.find(u => u.id === d.unit_id)?.location_source === 'demo' ? ' · Demo fleet position' : ''}` : `Assigned ETA: ${d.eta_minutes} min`}</Text></View>; }) : <Text style={styles.body}>Your report is in the response queue. A fleet has not been assigned yet.</Text>}
        <View style={styles.divider}/><Text style={styles.eyebrow}>REPORTED LOCATION</Text><Text style={{color:colors.blueDark,fontWeight:'700',fontSize:14}}>{report.location_name}</Text><Text style={[styles.small,{marginTop:5}]}>{report.lat != null && report.lng != null ? `${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}${report.location_accuracy_m != null ? ` · ±${Math.round(report.location_accuracy_m)} m` : ''}` : 'Address provided · GPS not shared'}</Text>
        {report.lat != null && report.lng != null && <View style={{marginTop:16}}><IncidentMap incident={report} data={map}/><Text style={[styles.small,{marginTop:8}]}>Road ETA excludes live traffic. Fleet locations update when shared by responders.</Text></View>}
      </View>
      {!isClosed(report) && <><Pressable accessibilityRole="button" accessibilityState={{expanded:showUpdate}} onPress={() => setShowUpdate(v=>!v)} style={styles.card}><Text style={styles.heading}>Has anything changed? {showUpdate ? '−' : '+'}</Text><Text style={[styles.small,{marginTop:6}]}>Send new details, a photo, or a voice note.</Text></Pressable>{showUpdate && <ReportForm isUpdate onComplete={() => setShowUpdate(false)}/>}</>}
      {!!report.updates?.length && <View style={styles.card}><Text style={styles.heading}>Your situation updates</Text>{[...report.updates].reverse().map((update, index) => <View key={`${update.timestamp}-${index}`} style={{paddingTop:15,marginTop:15,borderTopWidth:1,borderTopColor:colors.line}}><Text style={styles.small}>{new Date(update.timestamp).toLocaleString()}</Text><Text style={[styles.body,{marginTop:6}]}>{update.description || 'Media update'}</Text>{!!update.attachments.length && <Text style={styles.small}>{update.attachments.length} attachment(s)</Text>}</View>)}</View>}
    </>}
  </Screen>;
}
