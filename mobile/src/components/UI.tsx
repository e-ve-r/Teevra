import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, styles } from '../lib/theme';

export function Screen({ children }: { children: ReactNode }) {
  return <SafeAreaView style={styles.screen} edges={['top']}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}><View style={styles.brandRow}><Text style={styles.brand}>Teevra<Text style={{color: colors.red}}>.</Text></Text><Text style={styles.badge}>PREVIEW</Text></View>{children}<Text style={[styles.small, { textAlign: 'center', marginTop: 22 }]}>Prototype · For an emergency, call your local emergency service directly.</Text></ScrollView></SafeAreaView>;
}
export function Heading({ eyebrow, title, description }: { eyebrow?: string; title: string; description: string }) {
  return <><Text style={styles.eyebrow}>{eyebrow}</Text><Text accessibilityRole="header" style={styles.title}>{title}<Text style={{color: colors.red}}>.</Text></Text><Text style={styles.subtitle}>{description}</Text></>;
}
export function Action({ label, onPress, secondary, disabled, loading }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean; loading?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled: !!disabled || !!loading}} disabled={disabled || loading} onPress={onPress} style={[styles.button, secondary ? styles.secondary : {backgroundColor: colors.red}, (disabled || loading) && {opacity: .55}]}>{loading ? <ActivityIndicator color={secondary ? colors.blue : colors.white} /> : <Text style={secondary ? styles.secondaryText : styles.buttonText}>{label}</Text>}</Pressable>;
}
export function ErrorText({ error }: { error?: string | null }) { return error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null; }
