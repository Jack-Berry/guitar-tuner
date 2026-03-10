import { TunerCharacter } from "@/components/TunerCharacter";
import { usePitchDetection } from "@/hooks/usePitchDetection";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

const METER_WIDTH = 300;
const NEEDLE_RANGE = METER_WIDTH * 0.42;

// How long the note must sit in tune before confirming.
// Each unit = one 500ms reading window. e.g. 4 = 2 seconds, 6 = 3 seconds.
const IN_TUNE_CONFIRM_COUNT = 4;

// Cents tolerance to count as "in tune". ±5 is a common tuner standard.
const IN_TUNE_CENTS = 5;

// ─── Tuning data ──────────────────────────────────────────────────────────────

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function midiToString(midi: number): {
  note: string;
  octave: number;
  freq: number;
} {
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  const freq = Math.round(440 * Math.pow(2, (midi - 69) / 12) * 10) / 10;
  return { note, octave, freq };
}

type TuningPreset = { name: string; midi: readonly number[] };

const TUNINGS: TuningPreset[] = [
  { name: "Standard", midi: [40, 45, 50, 55, 59, 64] }, // E A D G B E
  { name: "Drop D", midi: [38, 45, 50, 55, 59, 64] }, // D A D G B E
  { name: "Open G", midi: [38, 43, 50, 55, 59, 62] }, // D G D G B D
  { name: "Open D", midi: [38, 45, 50, 54, 57, 62] }, // D A D F# A D
  { name: "Open E", midi: [40, 47, 52, 56, 59, 64] }, // E B E G# B E
  { name: "DADGAD", midi: [38, 45, 50, 55, 57, 62] }, // D A D G A D
  { name: "Drop C", midi: [36, 43, 48, 53, 57, 62] }, // C G C F A D
];

// Max semitone shift allowed by the ± buttons
const MAX_OFFSET = 6;

// ─── Reference tone ──────────────────────────────────────────────────────────

function useReferenceTone() {
  const ctxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const [playingFreq, setPlayingFreq] = useState<number | null>(null);
  // Ref so callbacks never close over stale state
  const playingFreqRef = useRef<number | null>(null);

  const stopTone = useCallback(() => {
    if (!ctxRef.current || !gainRef.current || !oscRef.current) return;
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    const osc = oscRef.current;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    setTimeout(() => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    }, 400);
    oscRef.current = null;
    gainRef.current = null;
    playingFreqRef.current = null;
    setPlayingFreq(null);
  }, []);

  const playTone = useCallback((freq: number) => {
    if (Platform.OS !== "web") return;
    // Fade out any current tone quickly before starting the new one
    if (oscRef.current && gainRef.current && ctxRef.current) {
      const gain = gainRef.current;
      const osc = oscRef.current;
      gain.gain.cancelScheduledValues(ctxRef.current.currentTime);
      gain.gain.setTargetAtTime(0, ctxRef.current.currentTime, 0.03);
      setTimeout(() => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {}
      }, 150);
      oscRef.current = null;
      gainRef.current = null;
    }
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    oscRef.current = osc;
    gainRef.current = gain;
    playingFreqRef.current = freq;
    setPlayingFreq(freq);
  }, []);

  // Toggle: same freq → stop; different freq → switch
  const toggleTone = useCallback(
    (freq: number) => {
      if (playingFreqRef.current === freq) {
        stopTone();
      } else {
        playTone(freq);
      }
    },
    [playTone, stopTone],
  );

  useEffect(() => () => stopTone(), [stopTone]);

  return { playingFreq, toggleTone, playTone, stopTone };
}

// ─── Tuning selector ─────────────────────────────────────────────────────────

function TuningSelector({
  tuningIdx,
  offset,
  onSelectTuning,
  onShift,
  onRecentre,
}: {
  tuningIdx: number;
  offset: number;
  onSelectTuning: (i: number) => void;
  onShift: (delta: number) => void;
  onRecentre: () => void;
}) {
  const [open, setOpen] = useState(false);
  const offsetLabel =
    offset === 0
      ? ""
      : offset > 0
        ? ` +${offset}`
        : ` \u2212${Math.abs(offset)}`;

  return (
    <View style={styles.selectorWrapper}>
      {offset !== 0 && (
        <TouchableOpacity style={styles.recentreBtn} onPress={onRecentre}>
          <Text style={styles.recentreBtnText}>↺ Reset tuning</Text>
        </TouchableOpacity>
      )}

      <View style={styles.selectorRow}>
        <TouchableOpacity
          style={[
            styles.stepBtn,
            offset <= -MAX_OFFSET && styles.stepBtnDisabled,
          ]}
          onPress={() => onShift(-1)}
          disabled={offset <= -MAX_OFFSET}
        >
          <Text style={styles.stepBtnText}>−</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.tuningBtn}
          onPress={() => setOpen(true)}
        >
          <Text style={styles.tuningBtnText}>
            {TUNINGS[tuningIdx].name}
            {offsetLabel !== "" && (
              <Text style={styles.tuningOffset}>{offsetLabel}</Text>
            )}
          </Text>
          <Text style={styles.tuningChevron}>▾</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.stepBtn,
            offset >= MAX_OFFSET && styles.stepBtnDisabled,
          ]}
          onPress={() => onShift(1)}
          disabled={offset >= MAX_OFFSET}
        >
          <Text style={styles.stepBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={open}
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.dropdownList}>
            <Text style={styles.dropdownHeader}>Select Tuning</Text>
            {TUNINGS.map((t, i) => (
              <TouchableOpacity
                key={t.name}
                style={[
                  styles.dropdownItem,
                  i === tuningIdx && styles.dropdownItemActive,
                ]}
                onPress={() => {
                  onSelectTuning(i);
                  setOpen(false);
                }}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    i === tuningIdx && styles.dropdownItemTextActive,
                  ]}
                >
                  {t.name}
                </Text>
                <Text style={styles.dropdownItemNotes}>
                  {t.midi.map((m) => midiToString(m).note).join(" ")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ─── Confirmed banner ────────────────────────────────────────────────────────

type StringInfo = { note: string; octave: number; freq: number };

function ConfirmedBanner({ nextString }: { nextString?: StringInfo }) {
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 220 });
    scale.value = withSpring(1, { damping: 11, stiffness: 200 });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      exiting={FadeOut.duration(180)}
      style={[styles.confirmedBanner, animStyle]}
    >
      <Text style={styles.confirmedCheck}>✓</Text>
      <Text style={styles.confirmedTitle}>In Tune!</Text>
      {nextString ? (
        <Text style={styles.confirmedNext}>
          Next:{" "}
          <Text style={styles.confirmedNextHighlight}>
            {nextString.note}{nextString.octave}
          </Text>
        </Text>
      ) : (
        <Text style={styles.confirmedNext}>All done!</Text>
      )}
    </Animated.View>
  );
}

// ─── Tuning meter ─────────────────────────────────────────────────────────────

function TuningMeter({
  cents,
  isActive,
  shouldNudge,
}: {
  cents: number;
  isActive: boolean;
  shouldNudge: boolean;
}) {
  const offset = useSharedValue(0);
  const nudgeX = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      offset.value = withSpring((cents / 50) * NEEDLE_RANGE, {
        damping: 18,
        stiffness: 180,
      });
    }
  }, [cents, isActive]);

  useEffect(() => {
    if (shouldNudge) {
      nudgeX.value = withSequence(
        withTiming(0, { duration: 900 }),
        withTiming(7, { duration: 70 }),
        withTiming(-7, { duration: 140 }),
        withTiming(5, { duration: 90 }),
        withTiming(-5, { duration: 90 }),
        withTiming(0, { duration: 90 }),
      );
    } else {
      cancelAnimation(nudgeX);
      nudgeX.value = withTiming(0, { duration: 200 });
    }
  }, [shouldNudge]);

  const centsAbs = Math.abs(cents);
  const color =
    centsAbs > 20 ? "#e05c5c" : centsAbs > 8 ? "#e0a832" : "#4cda7a";

  const needleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
    opacity: isActive ? 1 : 0.55,
  }));
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: nudgeX.value }],
  }));

  const ticks = [-50, -25, 0, 25, 50];

  return (
    <Animated.View style={[styles.meterContainer, containerStyle]}>
      <View style={[styles.meterTrack, { width: METER_WIDTH }]}>
        {ticks.map((t) => (
          <View
            key={t}
            style={[
              styles.tick,
              {
                left: METER_WIDTH / 2 + (t / 50) * NEEDLE_RANGE - 1,
                height: t === 0 ? 20 : 12,
                backgroundColor: t === 0 ? "#fff" : "#555",
              },
            ]}
          />
        ))}
        <Animated.View
          style={[styles.needle, { backgroundColor: color }, needleStyle]}
        />
      </View>
      <View style={styles.meterLabels}>
        <Text style={styles.meterLabel}>-50</Text>
        <Text style={styles.meterLabel}>0</Text>
        <Text style={styles.meterLabel}>+50</Text>
      </View>
    </Animated.View>
  );
}

// ─── Playing waveform ────────────────────────────────────────────────────────

const BAR_CONFIGS = [
  { min: 5, max: 26, duration: 420 },
  { min: 10, max: 40, duration: 310 },
  { min: 7, max: 48, duration: 510 },
  { min: 12, max: 34, duration: 360 },
  { min: 5, max: 52, duration: 270 },
  { min: 12, max: 34, duration: 360 },
  { min: 7, max: 48, duration: 510 },
  { min: 10, max: 40, duration: 310 },
  { min: 5, max: 26, duration: 420 },
];

function WaveBar({
  min,
  max,
  duration,
  delay,
}: {
  min: number;
  max: number;
  duration: number;
  delay: number;
}) {
  const h = useSharedValue(min);

  useEffect(() => {
    const t = setTimeout(() => {
      h.value = withRepeat(
        withSequence(
          withTiming(max, { duration }),
          withTiming(min, { duration }),
        ),
        -1,
        false,
      );
    }, delay);
    return () => {
      clearTimeout(t);
      cancelAnimation(h);
    };
  }, []);

  const style = useAnimatedStyle(() => ({ height: h.value }));
  return <Animated.View style={[styles.waveBar, style]} />;
}

function PlayingWaveform() {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={styles.waveformContainer}
    >
      <View style={styles.waveBars}>
        {BAR_CONFIGS.map((cfg, i) => (
          <WaveBar
            key={i}
            min={cfg.min}
            max={cfg.max}
            duration={cfg.duration}
            delay={i * 50}
          />
        ))}
      </View>
      <Text style={styles.waveformLabel}>Reference tone playing</Text>
    </Animated.View>
  );
}

// ─── String button ────────────────────────────────────────────────────────────

function StringButton({
  note,
  freq,
  isActive,
  isNext,
  isPlaying,
  onPress,
}: {
  note: string;
  freq: number;
  isActive: boolean;
  isNext: boolean;
  isPlaying: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.stringBtn,
        isActive && styles.stringBtnActive,
        isNext && styles.stringBtnNext,
        isPlaying && styles.stringBtnPlaying,
      ]}
    >
      <Text
        style={[
          styles.stringLabel,
          isActive && styles.stringLabelActive,
          isNext && styles.stringLabelNext,
          isPlaying && styles.stringLabelPlaying,
        ]}
      >
        {note}
      </Text>
      <Text
        style={[
          styles.stringFreq,
          (isActive || isPlaying) && styles.stringFreqActive,
        ]}
      >
        {isPlaying ? "♪" : `${freq.toFixed(0)}Hz`}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type ConfirmedInfo = {
  note: string;
  octave: number;
  nextString?: StringInfo;
};

export default function TunerScreen() {
  const { pitch, rawCents, error, start, stop } = usePitchDetection();
  const { playingFreq, playTone, stopTone } = useReferenceTone();
  const [confirmed, setConfirmed] = useState<ConfirmedInfo | null>(null);
  const [tuningIdx, setTuningIdx] = useState(0);
  const [offset, setOffset] = useState(0);
  const [showCharacter, setShowCharacter] = useState(true);
  const [showMeter, setShowMeter] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { width: winW, height: winH } = useWindowDimensions();
  // Character fills ~55% of screen height, maintaining 1:2 aspect ratio
  const charHeight = Math.round(winH * 0.55);
  const charWidth = Math.round(charHeight / 2);
  // Note sign fills available width (screen minus horizontal padding)
  const signWidth = winW - 48;

  const inTuneCountRef = useRef(0);
  const confirmedRef = useRef<ConfirmedInfo | null>(null);
  confirmedRef.current = confirmed;
  // Track which string index the reference tone is playing so shifts can follow it
  const playingIdxRef = useRef<number | null>(null);

  // Compute active strings from selected tuning + semitone offset
  const activeStrings = TUNINGS[tuningIdx].midi.map((midi) =>
    midiToString(midi + offset),
  );
  const activeStringsRef = useRef(activeStrings);
  activeStringsRef.current = activeStrings;

  // Pause tuner while reference tone is playing (mic would pick up the speaker output)
  useEffect(() => {
    if (playingFreq !== null) {
      stop();
    } else {
      start();
      setConfirmed(null);
      inTuneCountRef.current = 0;
    }
    return () => stop();
  }, [playingFreq]);

  // Reset state when tuning changes
  const handleSelectTuning = (i: number) => {
    if (playingIdxRef.current !== null) {
      playTone(midiToString(TUNINGS[i].midi[playingIdxRef.current]).freq);
    }
    setTuningIdx(i);
    setOffset(0);
    setConfirmed(null);
    inTuneCountRef.current = 0;
  };

  const handleShift = (delta: number) => {
    const newOffset = Math.max(
      -MAX_OFFSET,
      Math.min(MAX_OFFSET, offset + delta),
    );
    if (playingIdxRef.current !== null) {
      playTone(
        midiToString(TUNINGS[tuningIdx].midi[playingIdxRef.current] + newOffset)
          .freq,
      );
    }
    setOffset(newOffset);
    setConfirmed(null);
    inTuneCountRef.current = 0;
  };

  const handleRecentre = () => {
    if (playingIdxRef.current !== null) {
      playTone(
        midiToString(TUNINGS[tuningIdx].midi[playingIdxRef.current]).freq,
      );
    }
    setOffset(0);
    setConfirmed(null);
    inTuneCountRef.current = 0;
  };

  useEffect(() => {
    if (!pitch) {
      inTuneCountRef.current = 0;
      return;
    }

    if (pitch.isActive) {
      if (confirmedRef.current) {
        setConfirmed(null);
        confirmedRef.current = null;
        inTuneCountRef.current = 0;
        return;
      }

      if (Math.abs(pitch.cents) <= IN_TUNE_CENTS) {
        inTuneCountRef.current += 1;
        if (inTuneCountRef.current >= IN_TUNE_CONFIRM_COUNT) {
          const strings = activeStringsRef.current;
          const idx = strings.findIndex(
            (s) => s.note === pitch.note && s.octave === pitch.octave,
          );
          const next: ConfirmedInfo = {
            note: pitch.note,
            octave: pitch.octave,
            nextString:
              idx >= 0 && idx < strings.length - 1
                ? strings[idx + 1]
                : undefined,
          };
          confirmedRef.current = next;
          setConfirmed(next);
        }
      } else {
        inTuneCountRef.current = 0;
      }
    } else {
      inTuneCountRef.current = 0;
    }
  }, [pitch]);

  // When a string confirms in-tune and a reference tone is playing, advance to the next string
  useEffect(() => {
    if (!confirmed || playingFreq === null) return;
    if (confirmed.nextString) {
      const nextIdx = activeStringsRef.current.findIndex(
        (s) => s.freq === confirmed.nextString!.freq,
      );
      playingIdxRef.current = nextIdx !== -1 ? nextIdx : null;
      playTone(confirmed.nextString.freq);
    } else {
      playingIdxRef.current = null;
      stopTone();
    }
  }, [confirmed]);

  const hasPitch = pitch !== null;
  const shouldNudge = hasPitch && !pitch!.isActive && !confirmed;
  const playingNote =
    playingFreq !== null && playingIdxRef.current !== null
      ? activeStrings[playingIdxRef.current].note
      : hasPitch ? pitch!.note : "";
  const centsAbs = hasPitch ? Math.abs(pitch!.cents) : 100;
  const inTune = centsAbs <= IN_TUNE_CENTS;

  const noteColor = confirmed
    ? "#4cda7a"
    : !hasPitch
      ? "#555"
      : !pitch!.isActive
        ? "#666"
        : inTune
          ? "#4cda7a"
          : centsAbs <= 15
            ? "#e0a832"
            : "#e05c5c";

  const activeNote = hasPitch ? pitch!.note : undefined;
  const activeOctave = hasPitch ? pitch!.octave : undefined;

  const confirmedIdx = confirmed
    ? activeStrings.findIndex(
        (s) => s.note === confirmed.note && s.octave === confirmed.octave,
      )
    : -1;

  return (
    <SafeAreaView style={styles.root}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={styles.headerSpacer} />
        <Text style={styles.header}>Guitar Tuner</Text>
        <TouchableOpacity style={styles.settingsBtn} onPress={() => setSettingsOpen(true)}>
          <Text style={styles.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Settings modal */}
      <Modal
        transparent
        animationType="fade"
        visible={settingsOpen}
        onRequestClose={() => setSettingsOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setSettingsOpen(false)}
        >
          <View style={styles.settingsPanel}>
            <Text style={styles.settingsPanelHeader}>Settings</Text>
            <View style={[styles.settingsRow, !showMeter && styles.settingsRowDisabled]}>
              <Text style={styles.settingsLabel}>Show character</Text>
              <Switch
                value={showCharacter}
                onValueChange={setShowCharacter}
                disabled={!showMeter}
                trackColor={{ false: "#333", true: "#2a6640" }}
                thumbColor={showCharacter ? "#4cda7a" : "#666"}
              />
            </View>
            <View style={[styles.settingsRow, !showCharacter && styles.settingsRowDisabled]}>
              <Text style={styles.settingsLabel}>Show meter</Text>
              <Switch
                value={showMeter}
                onValueChange={setShowMeter}
                disabled={!showCharacter}
                trackColor={{ false: "#333", true: "#2a6640" }}
                thumbColor={showMeter ? "#4cda7a" : "#666"}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Tuner character (or static note sign) + frequency/cents below */}
      <View style={styles.characterSection}>
        {showCharacter ? (
          <TunerCharacter
            cents={rawCents !== null ? rawCents : 0}
            color={confirmed ? "#4cda7a" : noteColor}
            note={playingNote}
            playing={playingFreq !== null}
            playingFreq={playingFreq ?? undefined}
            width={charWidth}
            height={charHeight}
          />
        ) : (
          <View style={[styles.noteSign, { borderColor: noteColor, width: signWidth }]}>
            <Text style={[styles.noteSignText, { color: noteColor }]}>
              {hasPitch ? pitch!.note : "—"}
            </Text>
          </View>
        )}
        <Text style={styles.frequency}>
          {hasPitch ? `${pitch!.frequency} Hz` : "Play a string..."}
        </Text>
        <Text style={styles.centsLabel}>
          {confirmed
            ? ""
            : pitch?.isActive
              ? inTune
                ? "In Tune"
                : `${pitch.cents > 0 ? "+" : ""}${pitch.cents} cents`
              : shouldNudge
                ? "Play again..."
                : ""}
        </Text>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomSection}>
        {/* Fixed-height slot — swapping content here must not shift the layout */}
        {showMeter && (
          <View style={styles.meterSlot}>
            {playingFreq !== null ? (
              <PlayingWaveform />
            ) : confirmed ? (
              <ConfirmedBanner nextString={confirmed.nextString} />
            ) : (
              <TuningMeter
                cents={hasPitch ? pitch!.cents : 0}
                isActive={!!pitch?.isActive}
                shouldNudge={shouldNudge}
              />
            )}
          </View>
        )}

        {/* Tuning selector */}
        <TuningSelector
          tuningIdx={tuningIdx}
          offset={offset}
          onSelectTuning={handleSelectTuning}
          onShift={handleShift}
          onRecentre={handleRecentre}
        />

        {/* String reference */}
        <View style={styles.stringsRow}>
          {activeStrings.map((s, i) => (
            <StringButton
              key={i}
              note={s.note}
              freq={s.freq}
              isActive={
                confirmed
                  ? s.note === confirmed.note && s.octave === confirmed.octave
                  : s.note === activeNote && s.octave === activeOctave
              }
              isNext={confirmed ? i === confirmedIdx + 1 : false}
              isPlaying={playingIdxRef.current === i && playingFreq !== null}
              onPress={() => {
                if (playingIdxRef.current === i && playingFreq !== null) {
                  playingIdxRef.current = null;
                  stopTone();
                } else {
                  playingIdxRef.current = i;
                  playTone(s.freq);
                }
              }}
            />
          ))}
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {Platform.OS !== "web" && (
        <Text style={styles.platformNote}>
          Pitch detection works in the browser (web) target.{"\n"}Run with{" "}
          <Text style={styles.code}>expo start --web</Text>
        </Text>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0d0d0d",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  headerSpacer: {
    width: 36,
  },
  header: {
    color: "#888",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  settingsBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: {
    fontSize: 20,
    color: "#666",
  },
  settingsPanel: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
    width: "100%",
    maxWidth: 340,
    overflow: "hidden",
    paddingBottom: 8,
  },
  settingsPanelHeader: {
    color: "#666",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#252525",
  },
  settingsRowDisabled: {
    opacity: 0.35,
  },
  noteSign: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: 16,
  },
  noteSignText: {
    fontSize: 120,
    fontWeight: "800",
  },
  settingsLabel: {
    color: "#ccc",
    fontSize: 16,
  },
  characterSection: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingBottom: 8,
  },
  bottomSection: {
    alignItems: "center",
    gap: 20,
  },
  frequency: {
    color: "#aaa",
    fontSize: 16,
  },
  centsLabel: {
    color: "#777",
    fontSize: 14,
    height: 20,
  },
  // Tuning selector
  selectorWrapper: {
    alignItems: "center",
    gap: 8,
  },
  selectorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#444",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnDisabled: {
    opacity: 0.3,
  },
  recentreBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: "#2a2210",
    borderWidth: 1,
    borderColor: "#e0a83266",
  },
  recentreBtnText: {
    color: "#e0a832",
    fontSize: 12,
    fontWeight: "500",
  },
  stepBtnText: {
    color: "#fff",
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "300",
  },
  tuningBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1e1e1e",
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  tuningBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  tuningOffset: {
    color: "#e0a832",
    fontSize: 13,
    fontWeight: "500",
  },
  tuningChevron: {
    color: "#888",
    fontSize: 11,
  },
  // Dropdown modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: "#000000cc",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  dropdownList: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#333",
    width: "100%",
    maxWidth: 340,
    overflow: "hidden",
  },
  dropdownHeader: {
    color: "#666",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 2,
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  dropdownItem: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#252525",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dropdownItemActive: {
    backgroundColor: "#1a2e1e",
  },
  dropdownItemText: {
    color: "#ccc",
    fontSize: 16,
    fontWeight: "500",
  },
  dropdownItemTextActive: {
    color: "#4cda7a",
    fontWeight: "700",
  },
  dropdownItemNotes: {
    color: "#555",
    fontSize: 12,
    letterSpacing: 1,
  },
  meterSlot: {
    width: METER_WIDTH,
    height: 80,
    justifyContent: "center",
    alignItems: "center",
  },
  // Confirmed banner
  confirmedBanner: {
    width: METER_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#0f2318",
    borderWidth: 1,
    borderColor: "#2a6640",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  confirmedCheck: {
    fontSize: 18,
    color: "#4cda7a",
  },
  confirmedTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#4cda7a",
  },
  confirmedNext: {
    fontSize: 14,
    color: "#aaa",
  },
  confirmedNextHighlight: {
    color: "#fff",
    fontWeight: "700",
  },
  // Meter
  meterContainer: {
    alignItems: "center",
    gap: 8,
  },
  meterTrack: {
    height: 40,
    backgroundColor: "#1e1e1e",
    borderRadius: 20,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#333",
  },
  tick: {
    position: "absolute",
    width: 2,
    top: "50%",
    marginTop: -6,
    borderRadius: 1,
  },
  needle: {
    position: "absolute",
    alignSelf: "center",
    width: 3,
    height: 32,
    borderRadius: 2,
  },
  meterLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: METER_WIDTH,
    paddingHorizontal: 8,
  },
  meterLabel: {
    color: "#555",
    fontSize: 11,
  },
  // String buttons
  stringsRow: {
    flexDirection: "row",
    gap: 8,
  },
  stringBtn: {
    width: 52,
    height: 64,
    backgroundColor: "#1e1e1e",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#333",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  stringBtnActive: {
    borderColor: "#4cda7a",
    backgroundColor: "#1a2e1e",
  },
  stringBtnNext: {
    borderColor: "#e0a832",
    backgroundColor: "#2a2210",
  },
  stringBtnPlaying: {
    borderColor: "#7c9ef5",
    backgroundColor: "#151c33",
  },
  stringLabel: {
    color: "#aaa",
    fontSize: 18,
    fontWeight: "700",
  },
  stringLabelActive: {
    color: "#4cda7a",
  },
  stringLabelNext: {
    color: "#e0a832",
  },
  stringLabelPlaying: {
    color: "#7c9ef5",
  },
  stringFreq: {
    color: "#555",
    fontSize: 10,
  },
  stringFreqActive: {
    color: "#4cda7a99",
  },
  // Waveform
  waveformContainer: {
    width: METER_WIDTH,
    alignItems: "center",
    gap: 12,
  },
  waveBars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 56,
  },
  waveBar: {
    width: 5,
    borderRadius: 3,
    backgroundColor: "#7c9ef5",
  },
  waveformLabel: {
    color: "#7c9ef566",
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  error: {
    color: "#e05c5c",
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  platformNote: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
  },
  code: {
    color: "#888",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
});
