import { useCallback, useRef, useState } from 'react';
import { Image, Pressable, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Action, ErrorText } from './UI';
import IncidentMap from './IncidentMap';
import { useReporter } from '../context/ReporterContext';
import { uploadAttachments } from '../lib/api';
import { validateDraft } from '../lib/incidentValidation';
import { colors, styles } from '../lib/theme';
import type { Coordinates, LocalAttachment } from '../lib/types';

const MAX_FILE = 20 * 1024 * 1024;
function AudioPreview({ uri }: { uri: string }) {
  const player = useAudioPlayer({ uri });
  const [playing, setPlaying] = useState(false);
  return <Pressable accessibilityRole="button" onPress={() => { if (playing) player.pause(); else player.play(); setPlaying(!playing); }}><Text style={{color: colors.blue, fontWeight:'700'}}>{playing ? 'Pause' : 'Play'}</Text></Pressable>;
}
export default function ReportForm({ isUpdate = false, onComplete }: { isUpdate?: boolean; onComplete?: () => void }) {
  const { name, createReport, updateReport } = useReporter();
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationSource, setLocationSource] = useState<'gps' | 'map' | null>(null);
  const [locationMessage, setLocationMessage] = useState('Use your location, choose a map pin, or enter an address.');
  const [files, setFiles] = useState<LocalAttachment[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recording = useAudioRecorderState(recorder);
  const recordingRef = useRef(false);
  useFocusEffect(useCallback(() => () => {
    if (recordingRef.current) {
      recordingRef.current = false;
      void recorder.stop().then(() => {
        if (recorder.uri) setFiles(current => [...current, { uri: recorder.uri!, name: `voice-${Date.now()}.m4a`, mimeType: 'audio/mp4', kind: 'audio' }]);
        return setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      }).catch(() => {});
    }
  }, [recorder]));
  const [showMap, setShowMap] = useState(false);

  function addFile(file: LocalAttachment) {
    if (files.length >= 10) { setError('You can attach up to 10 files at a time.'); return; }
    if (file.size && file.size > MAX_FILE) { setError('Keep each attachment under 20 MB.'); return; }
    setFiles(current => [...current, file]); setError('');
  }
  async function locate() {
    setLocating(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Location permission was not granted. You can use the map or enter an address.');
      const result = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Could not get GPS. Use the map or enter an address.')), 15000))]);
      setLocation({ lat: result.coords.latitude, lng: result.coords.longitude, location_accuracy_m: result.coords.accuracy ?? undefined }); setLocationSource('gps');
      setLocationMessage(`GPS captured${result.coords.accuracy != null ? ` · accurate to about ${Math.round(result.coords.accuracy)} m` : ''}.`);
    } catch (failure) { setLocationMessage(failure instanceof Error ? failure.message : 'GPS unavailable. Use the map or enter an address.'); }
    finally { setLocating(false); }
  }
  async function chooseImage(camera: boolean) {
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Camera permission is required to take a photo.');
      const result = camera ? await ImagePicker.launchCameraAsync({mediaTypes:['images'], quality:.8}) : await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'], allowsMultipleSelection:true, quality:.8});
      if (!result.canceled && files.length + result.assets.length > 10) throw new Error('You can attach up to 10 files at a time.');
      if (!result.canceled) for (const [i, asset] of result.assets.entries()) {
        const ext = asset.fileName?.split('.').pop()?.toLowerCase();
        if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
          addFile({ uri: asset.uri, name: asset.fileName!, mimeType: asset.mimeType || 'image/jpeg', kind:'image', size: asset.fileSize });
        } else {
          // HEIC and other camera formats are converted for the existing upload API.
          const context = ImageManipulator.manipulate(asset.uri);
          const image = await context.renderAsync();
          const converted = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
          addFile({ uri: converted.uri, name: `photo-${Date.now()}-${i}.jpg`, mimeType: 'image/jpeg', kind: 'image' });
        }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open the camera or gallery.'); }
  }
  async function chooseAudio() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type:'audio/*', multiple:true, copyToCacheDirectory:true });
      if (!result.canceled && files.length + result.assets.length > 10) throw new Error('You can attach up to 10 files at a time.');
      if (!result.canceled) result.assets.forEach(asset => addFile({ uri:asset.uri, name:asset.name, mimeType:asset.mimeType || 'audio/mpeg', kind:'audio', size:asset.size }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not open the audio picker.'); }
  }
  async function toggleRecording() {
    try {
      if (recording.isRecording) {
        await recorder.stop();
        recordingRef.current = false;
        if (recorder.uri) addFile({ uri: recorder.uri, name:`voice-${Date.now()}.m4a`, mimeType:'audio/mp4', kind:'audio' });
        await setAudioModeAsync({ allowsRecording:false, playsInSilentMode:true });
      } else {
        if (files.length >= 10) throw new Error('You can attach up to 10 files at a time.');
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error('Microphone permission is required to record audio.');
        await setAudioModeAsync({ allowsRecording:true, playsInSilentMode:true });
        await recorder.prepareToRecordAsync(); recorder.record(); recordingRef.current = true;
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Recording failed. Try an audio upload instead.'); }
  }
  async function submit() {
    if (busy || recording.isRecording) return;
    const text = description.trim();
    const validation = validateDraft({ description: text, attachmentCount: files.length, isUpdate, phone, address, hasLocation: !!location });
    if (validation) { setError(validation); return; }
    setBusy(true); setError('');
    try {
      const attachments = await uploadAttachments(files);
      if (isUpdate) await updateReport({ description:text, attachments });
      else {
        let current = location;
        if (locationSource === 'gps') {
          try { const fresh = await Promise.race([Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High}), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('GPS timed out')), 10000))]); current = {lat:fresh.coords.latitude, lng:fresh.coords.longitude, location_accuracy_m:fresh.coords.accuracy ?? undefined}; }
          catch { if (!address.trim()) throw new Error('GPS could not be refreshed. Enter an address or select a map pin.'); current = null; }
        }
        const locationName = address.trim() || (current ? `${locationSource === 'map' ? 'Map pin' : 'GPS'}: ${current.lat.toFixed(5)}, ${current.lng.toFixed(5)}` : '');
        await createReport({ reporter_name:name, reporter_phone:phone.trim(), location_name:locationName, description:text || 'Media report. Review the attached evidence to assess the emergency.', attachments, ...(current || {}) });
      }
      setDescription(''); setFiles([]); onComplete?.(); router.navigate('/tracking');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to submit your report.'); }
    finally { setBusy(false); }
  }
  return <View style={styles.card}>
    {isUpdate ? <Text style={styles.body}>Tell us what changed. The team will receive your new details for reassessment.</Text> : <>
      <Text style={styles.label}>Mobile number</Text><TextInput accessibilityLabel="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="+91 …" style={styles.input} />
      <Text style={styles.label}>Incident address or landmark</Text><TextInput accessibilityLabel="Incident address or landmark" value={address} onChangeText={setAddress} placeholder={location ? 'Nearby landmark (optional)' : 'Street, landmark, city'} maxLength={300} style={styles.input} />
      <Text style={[styles.small,{marginVertical:10}]}>{locationMessage}</Text>
      <View style={{gap:10}}><Action label="Use my current location" secondary loading={locating} onPress={locate}/><Action label={showMap ? 'Hide map' : 'Choose location on map'} secondary onPress={() => setShowMap(!showMap)} /></View>
      {showMap && <View style={{marginTop:12}}><IncidentMap picked={location} onPick={p => { setLocation(p); setLocationSource('map'); setLocationMessage(`Map pin: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`); }} /></View>}
    </>}
    <Text style={styles.label}>{isUpdate ? 'What has changed?' : 'Describe the emergency'}</Text><TextInput accessibilityLabel={isUpdate ? 'What has changed?' : 'Describe the emergency'} multiline maxLength={2000} value={description} onChangeText={setDescription} placeholder="What happened? Add any details that could help." style={[styles.input, styles.textArea]} />
    <Text style={[styles.small,{textAlign:'right', marginTop:5}]}>{description.length}/2000</Text>
    <Text style={styles.label}>Photos or voice</Text><View style={{gap:8}}><Action label="Take a photo" secondary onPress={() => chooseImage(true)} /><Action label="Choose photos" secondary onPress={() => chooseImage(false)} /><Action label={recording.isRecording ? `Stop recording · ${Math.floor(recording.durationMillis / 1000)}s` : 'Record a voice note'} secondary onPress={toggleRecording} /><Action label="Choose an audio file" secondary onPress={chooseAudio} /></View>
    {files.map((file, index) => <View key={`${file.uri}-${index}`} style={[styles.row, {paddingVertical:12, borderBottomWidth:1, borderBottomColor:colors.line}]}>{file.kind === 'image' && <Image source={{uri:file.uri}} style={{width:50,height:50,borderRadius:8}} />}<View style={{flex:1}}><Text numberOfLines={2} style={{color:colors.blueDark,fontSize:12,fontWeight:'700'}}>{file.name}</Text><Text style={styles.small}>{file.kind === 'audio' ? 'Voice note' : 'Image'}</Text></View>{file.kind === 'audio' && <AudioPreview uri={file.uri}/>}<Pressable accessibilityRole="button" accessibilityLabel={`Remove ${file.name}`} onPress={() => setFiles(current => current.filter((_, i) => i !== index))}><Text style={{color:colors.red,fontWeight:'700',padding:8}}>Remove</Text></Pressable></View>)}
    <ErrorText error={error}/><View style={{marginTop:20}}><Action label={isUpdate ? 'Send situation update' : 'Submit report'} onPress={submit} loading={busy} disabled={recording.isRecording} /></View><Text style={[styles.small,{marginTop:12}]}>Reports and media are saved for the response team. Assessment may use OpenRouter.</Text>
  </View>;
}
