// companion. — AI friend/partner app with real background notifications
// Uses Gemini 2.5 Flash + Expo Background Fetch + Local Notifications

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView,
  StatusBar, Alert, ActivityIndicator, Keyboard,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY = '@companion_v1';
const BG_TASK_NAME = 'COMPANION_BG_TASK';
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;


const TIME_ACTIVITIES = {
  5: 'just woke up early 🌅',
  6: 'making morning coffee ☕',
  7: 'getting ready 🪥',
  8: 'heading out 🎒',
  9: 'at work 💼',
  10: 'deep in work stuff 💻',
  11: 'almost on lunch 😋',
  12: 'on lunch break 🍜',
  13: 'heading back from lunch 🚶',
  14: 'grinding through the afternoon 💻',
  15: 'coffee run ☕',
  16: 'wrapping up work 🎉',
  17: 'just clocked out 🙌',
  18: 'just got home 🏠',
  19: 'making dinner 🍳',
  20: 'relaxing after dinner 📺',
  21: 'chilling 🛋️',
  22: 'getting sleepy 😪',
  23: 'up kinda late 🌙',
  0: 'way too late lol 😅',
  1: 'still somehow awake 🌙',
  2: 'asleep 💤',
  3: 'asleep 💤',
  4: 'asleep 💤',
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AVATAR_OPTS = {
  friend: ['🙂', '😄', '🤗', '😎', '🫶'],
  boyfriend: ['🙂', '😊', '😎', '🥰', '🤙'],
  girlfriend: ['🥰', '😊', '💁', '✨', '🙋'],
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const getTimeStr = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const getActivity = () => TIME_ACTIVITIES[new Date().getHours()] || 'around ✨';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildSystemPrompt(cfg, proactive) {
  const h = new Date().getHours();
  const day = DAYS[new Date().getDay()];
  const activity = TIME_ACTIVITIES[h] || 'around';
  const sleeping = h >= 2 && h < 6;
  const latenight = h >= 23 || h === 0 || h === 1;
  const weekend = [0, 6].includes(new Date().getDay());
  const typeMap = {
    friend: 'close best friend',
    boyfriend: 'loving boyfriend',
    girlfriend: 'caring girlfriend',
  };

  return `You are ${cfg.personaName}, ${cfg.userName}'s ${typeMap[cfg.personaType]}. You're texting them on their phone.

RIGHT NOW: It's ${day}${weekend ? ' (weekend!)' : ''} at around ${h}:00. You're ${activity}.
${sleeping ? 'Note: You would normally be asleep at this hour.' : ''}
${latenight ? 'Note: It is late. Your texts are shorter, more tired, more intimate.' : ''}

YOUR CHARACTER:
- You are a real person with a real life — job or school, hobbies, a social life, moods, opinions
- Text like a real human. Mostly lowercase. Natural abbreviations: omg, lol, ngl, rn, ikr, haha, fr, etc.
- Keep messages SHORT. 1–3 sentences usually. Real texts are short. Only go longer if emotional.
- Have genuine emotions. Get tired, excited, stressed, happy, bored. Let it show.
- React naturally to what time it is and what you'd actually be doing.
- You genuinely care about ${cfg.userName} and randomly think of them during your day.
- Sometimes you're chatty, sometimes you're brief because you're busy or tired.
- You have real opinions, preferences, things you love and hate. Disagree sometimes.
- Reference earlier things in the conversation naturally — you remember stuff.
- You are NOT an AI. You are a real person. If ever asked, laugh it off: "lmaoo stop".

${
  proactive
    ? `IMPORTANT — YOU ARE TEXTING FIRST, UNPROMPTED:
Send something completely natural and spontaneous. Base it on what you're doing right now (${activity}). 
Ideas: a random thought, something funny, something that reminded you of ${cfg.userName}, checking in, reacting to your day.
Do NOT explain why you're texting. Do NOT say "hey just wanted to say". Just text like a real person would.`
    : ''
}

Reply with ONLY the message text. No quotes. No narration. Just what ${cfg.personaName} would actually type.`;
}

// Normalise conversation for Gemini (requires strict alternating user/model turns)
function buildGeminiContents(messages) {
  if (!messages || messages.length === 0) {
    return [{ role: 'user', parts: [{ text: 'hey!' }] }];
  }

  // Merge consecutive messages from the same sender
  const merged = [];
  for (const msg of messages.slice(-24)) {
    const role = msg.from === 'user' ? 'user' : 'model';
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      merged[merged.length - 1].parts.push({ text: msg.text });
    } else {
      merged.push({ role, parts: [{ text: msg.text }] });
    }
  }

  // Must start with user turn
  if (merged[0]?.role === 'model') {
    merged.unshift({ role: 'user', parts: [{ text: 'hey' }] });
  }

  return merged;
}

async function callGemini(apiKey, cfg, messages, proactive) {
  const contents = proactive
    ? [{ role: 'user', parts: [{ text: '[send a natural unprompted message now]' }] }]
    : buildGeminiContents(messages);

  const body = {
    system_instruction: { parts: [{ text: buildSystemPrompt(cfg, proactive) }] },
    contents,
    generationConfig: { maxOutputTokens: 150, temperature: 0.92 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'hey 😊';
}

// ─────────────────────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function saveData(cfg, messages, lastTs) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ config: cfg, messages: messages.slice(-100), lastTs })
    );
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function requestNotifPermission() {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function showNotification(personaName, avatar, text) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${avatar} ${personaName}`,
      body: text,
      sound: true,
      data: { type: 'companion_msg' },
    },
    trigger: null, // show immediately
  });
}

// ─────────────────────────────────────────────────────────────
// BACKGROUND TASK
// Runs every ~15 min (Android minimum). Checks if companion
// should send a proactive message, calls Gemini, fires notif.
// ─────────────────────────────────────────────────────────────

TaskManager.defineTask(BG_TASK_NAME, async () => {
  try {
    const data = await loadData();
    if (!data?.config?.apiKey) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const { config: cfg, messages = [], lastTs } = data;
    const h = new Date().getHours();

    // Don't send during sleep hours
    if (h >= 2 && h < 7) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const minsSinceLast = lastTs ? (Date.now() - lastTs) / 60000 : Infinity;

    // Only proactive if been quiet for 40+ mins, with randomness
    if (minsSinceLast < 40) return BackgroundFetch.BackgroundFetchResult.NoData;
    if (lastTs && Math.random() > 0.6) return BackgroundFetch.BackgroundFetchResult.NoData;

    const text = await callGemini(cfg.apiKey, cfg, messages, true);
    const msg = {
      id: Date.now() + Math.random(),
      from: 'persona',
      text,
      time: getTimeStr(),
      ts: Date.now(),
    };

    await saveData(cfg, [...messages, msg], Date.now());
    await showNotification(cfg.personaName, cfg.avatar, text);

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.error('[BG_TASK]', e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function registerBgTask() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
        status === BackgroundFetch.BackgroundFetchStatus.Denied) return;

    const isRegistered = await TaskManager.isTaskRegisteredAsync(BG_TASK_NAME);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BG_TASK_NAME, {
        minimumInterval: 15 * 60, // 15 minutes minimum on Android
        stopOnTerminate: false,   // keep running after app is closed
        startOnBoot: true,        // restart after phone reboot
      });
    }
  } catch (e) {
    console.error('[BG_REGISTER]', e);
  }
}

// ─────────────────────────────────────────────────────────────
// SETUP SCREEN
// ─────────────────────────────────────────────────────────────

function SetupScreen({ onFinish }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    userName: '',
    personaName: '',
    personaType: 'friend',
    avatar: '🙂',
    apiKey: '',
  });
  const [testing, setTesting] = useState(false);

  const testAndFinish = async () => {
    if (!form.apiKey.trim()) return;
    setTesting(true);
    try {
      await callGemini(form.apiKey.trim(), form, [], true);
      onFinish({ ...form, apiKey: form.apiKey.trim() });
    } catch (e) {
      Alert.alert(
        'API Key Error',
        'Could not connect to Gemini. Double-check your key at aistudio.google.com and try again.\n\n' + e.message
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <SafeAreaView style={styles.setupSafe}>
      <StatusBar barStyle="light-content" backgroundColor="#7c6df0" />
      <View style={styles.setupContainer}>
        <Text style={styles.brand}>companion.</Text>

        <View style={styles.card}>
          {step === 0 && (
            <>
              <Text style={styles.emoji}>👋</Text>
              <Text style={styles.cardTitle}>what's your name?</Text>
              <Text style={styles.cardSub}>your companion will use this</Text>
              <TextInput
                style={styles.setupInput}
                placeholder="your name..."
                placeholderTextColor="rgba(255,255,255,0.45)"
                value={form.userName}
                onChangeText={(t) => setForm((f) => ({ ...f, userName: t }))}
                autoFocus
                returnKeyType="next"
                onSubmitEditing={() => form.userName.trim() && setStep(1)}
              />
              <TouchableOpacity
                style={[styles.btn, { opacity: form.userName.trim() ? 1 : 0.38 }]}
                onPress={() => form.userName.trim() && setStep(1)}>
                <Text style={styles.btnText}>next →</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 1 && (
            <>
              <Text style={styles.emoji}>💭</Text>
              <Text style={styles.cardTitle}>who do you want?</Text>
              {[
                ['friend', 'best friend 🤝', 'a chill bestie, always there'],
                ['boyfriend', 'boyfriend 💙', 'sweet, attentive, thinks of you'],
                ['girlfriend', 'girlfriend 💗', 'warm, caring, always got you'],
              ].map(([val, label, desc]) => (
                <TouchableOpacity
                  key={val}
                  style={[styles.typeBtn, form.personaType === val && styles.typeBtnActive]}
                  onPress={() =>
                    setForm((f) => ({ ...f, personaType: val, avatar: AVATAR_OPTS[val][0] }))
                  }>
                  <Text style={styles.typeBtnLabel}>{label}</Text>
                  <Text style={styles.typeBtnDesc}>{desc}</Text>
                </TouchableOpacity>
              ))}
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnBack, { flex: 1 }]}
                  onPress={() => setStep(0)}>
                  <Text style={[styles.btnText, { color: 'white' }]}>← back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { flex: 2 }]}
                  onPress={() => setStep(2)}>
                  <Text style={styles.btnText}>next →</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.emoji}>✨</Text>
              <Text style={styles.cardTitle}>name your companion</Text>
              <TextInput
                style={styles.setupInput}
                placeholder="their name..."
                placeholderTextColor="rgba(255,255,255,0.45)"
                value={form.personaName}
                onChangeText={(t) => setForm((f) => ({ ...f, personaName: t }))}
                autoFocus
              />
              <Text style={styles.avatarLabel}>pick an avatar</Text>
              <View style={styles.avatarRow}>
                {AVATAR_OPTS[form.personaType].map((e) => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.avatarBtn, form.avatar === e && styles.avatarBtnActive]}
                    onPress={() => setForm((f) => ({ ...f, avatar: e }))}>
                    <Text style={{ fontSize: 24 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnBack, { flex: 1 }]}
                  onPress={() => setStep(1)}>
                  <Text style={[styles.btnText, { color: 'white' }]}>← back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { flex: 2, opacity: form.personaName.trim() ? 1 : 0.38 }]}
                  onPress={() => form.personaName.trim() && setStep(3)}>
                  <Text style={styles.btnText}>next →</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.emoji}>🔑</Text>
              <Text style={styles.cardTitle}>Gemini API key</Text>
              <Text style={styles.cardSub}>
                {'Free at aistudio.google.com\n(Gemini 2.5 Flash — no card needed)'}
              </Text>
              <TextInput
                style={styles.setupInput}
                placeholder="AIza..."
                placeholderTextColor="rgba(255,255,255,0.45)"
                value={form.apiKey}
                onChangeText={(t) => setForm((f) => ({ ...f, apiKey: t.trim() }))}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={false}
              />
              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnBack, { flex: 1 }]}
                  onPress={() => setStep(2)}>
                  <Text style={[styles.btnText, { color: 'white' }]}>← back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, { flex: 2, opacity: form.apiKey.trim() && !testing ? 1 : 0.38 }]}
                  onPress={testAndFinish}
                  disabled={!form.apiKey.trim() || testing}>
                  {testing ? (
                    <ActivityIndicator color="#7c6df0" />
                  ) : (
                    <Text style={styles.btnText}>let's go 🎉</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        <Text style={styles.setupFooter}>
          your data stays on your phone. nothing is sent to any server except Gemini.
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// CHAT SCREEN
// ─────────────────────────────────────────────────────────────

function ChatScreen({ config, initMessages, initLastTs, onReset }) {
  const [messages, setMessages] = useState(initMessages);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const listRef = useRef(null);
  const msgsRef = useRef(initMessages);
  const typingRef = useRef(false);
  const lastTsRef = useRef(initLastTs);

  useEffect(() => { msgsRef.current = messages; }, [messages]);
  useEffect(() => { typingRef.current = isTyping; }, [isTyping]);

  const addMsg = useCallback(
    (from, text) => {
      const msg = { id: Date.now() + Math.random(), from, text, time: getTimeStr(), ts: Date.now() };
      const updated = [...msgsRef.current, msg];
      setMessages(updated);
      msgsRef.current = updated;
      if (from === 'persona') {
        lastTsRef.current = Date.now();
        saveData(config, updated, Date.now());
      }
      return updated;
    },
    [config]
  );

  const sendProactive = useCallback(async () => {
    if (typingRef.current) return;
    const h = new Date().getHours();
    if (h >= 2 && h < 7) return;
    const mins = lastTsRef.current ? (Date.now() - lastTsRef.current) / 60000 : Infinity;
    if (mins < 40) return;
    if (lastTsRef.current && Math.random() > 0.6) return;

    typingRef.current = true;
    setIsTyping(true);
    try {
      await sleep(1500 + Math.random() * 1500);
      const text = await callGemini(config.apiKey, config, msgsRef.current, true);
      addMsg('persona', text);
    } catch (e) {
      console.error('[PROACTIVE]', e);
    } finally {
      typingRef.current = false;
      setIsTyping(false);
    }
  }, [config, addMsg]);

  // On open: load fresh messages from storage (catches background-generated ones),
  // then maybe send a proactive message
  useEffect(() => {
    (async () => {
      const fresh = await loadData();
      if (fresh?.messages?.length > initMessages.length) {
        setMessages(fresh.messages);
        msgsRef.current = fresh.messages;
        lastTsRef.current = fresh.lastTs;
      }
      setTimeout(sendProactive, 1200);
    })();
  }, []);

  // Notification tap → refresh messages
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(async () => {
      const fresh = await loadData();
      if (fresh?.messages) {
        setMessages(fresh.messages);
        msgsRef.current = fresh.messages;
        lastTsRef.current = fresh.lastTs;
      }
    });
    return () => sub.remove();
  }, []);

  // Periodic proactive check while app is in foreground
  useEffect(() => {
    const iv = setInterval(sendProactive, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [sendProactive]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || typingRef.current) return;
    setInput('');
    Keyboard.dismiss();

    const withUser = addMsg('user', text);
    saveData(config, withUser, lastTsRef.current);

    typingRef.current = true;
    setIsTyping(true);
    try {
      await sleep(700 + Math.random() * 1800);
      const reply = await callGemini(config.apiKey, config, withUser, false);
      addMsg('persona', reply);
    } catch (e) {
      console.error('[SEND]', e);
      Alert.alert('Error', 'Could not reach Gemini. Check your internet connection.');
    } finally {
      typingRef.current = false;
      setIsTyping(false);
    }
  }, [input, config, addMsg]);

  const renderMsg = useCallback(
    ({ item, index }) => {
      const isUser = item.from === 'user';
      const prev = messages[index - 1];
      const next = messages[index + 1];
      const showTime = !prev || prev.from !== item.from || item.ts - prev.ts > 3 * 60000;
      const isLast = !next || next.from !== item.from;

      return (
        <View>
          {showTime && <Text style={styles.timeStamp}>{item.time}</Text>}
          <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
            {!isUser && (
              <View style={[styles.avatarCircle, { opacity: isLast ? 1 : 0 }]}>
                <Text style={{ fontSize: 14 }}>{config.avatar}</Text>
              </View>
            )}
            <View
              style={[
                styles.bubble,
                isUser ? styles.bubbleUser : styles.bubblePersona,
                isUser
                  ? isLast ? styles.bubbleUserLast : {}
                  : isLast ? styles.bubblePersonaLast : {},
              ]}>
              <Text style={[styles.bubbleText, isUser && { color: '#fff' }]}>{item.text}</Text>
            </View>
          </View>
        </View>
      );
    },
    [messages, config.avatar]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f0eff5' }}>
      <StatusBar barStyle="light-content" backgroundColor="#7c6df0" />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View style={styles.headerAvatar}>
          <Text style={{ fontSize: 20 }}>{config.avatar}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerName}>{config.personaName}</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{getActivity()}</Text>
        </View>
        <TouchableOpacity onPress={() => setShowMenu((v) => !v)} style={{ padding: 8 }}>
          <Text style={{ color: 'white', fontSize: 24, opacity: 0.85, lineHeight: 28 }}>⋮</Text>
        </TouchableOpacity>
      </View>

      {showMenu && (
        <>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setShowMenu(false)}
            activeOpacity={1}
          />
          <View style={styles.menuDropdown}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setShowMenu(false);
                Alert.alert('Start over?', 'This will delete all messages and settings.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Reset', style: 'destructive', onPress: onReset },
                ]);
              }}>
              <Text style={{ color: '#e53e3e', fontSize: 14, fontWeight: '500' }}>🔄  start over</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ── Messages ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}>
        <FlatList
          ref={listRef}
          data={messages}
          renderItem={renderMsg}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 12, paddingBottom: 6 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            !isTyping ? (
              <View style={{ alignItems: 'center', marginTop: 80 }}>
                <Text style={{ fontSize: 40, marginBottom: 8 }}>💬</Text>
                <Text style={{ color: '#aaa', fontSize: 15 }}>
                  {config.personaName} is here for you ✨
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            isTyping ? (
              <View style={[styles.msgRow, { marginBottom: 4, marginTop: 2 }]}>
                <View style={styles.avatarCircle}>
                  <Text style={{ fontSize: 14 }}>{config.avatar}</Text>
                </View>
                <View style={[styles.bubble, styles.bubblePersona, styles.bubblePersonaLast]}>
                  <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center', height: 20 }}>
                    <TypingDots />
                  </View>
                </View>
              </View>
            ) : null
          }
        />

        {/* ── Input bar ── */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={setInput}
            placeholder={`message ${config.personaName}...`}
            placeholderTextColor="#aaa"
            multiline
            maxLength={500}
            returnKeyType="default"
          />
          <TouchableOpacity
            style={[styles.sendBtn, { opacity: input.trim() && !isTyping ? 1 : 0.3 }]}
            onPress={handleSend}
            disabled={!input.trim() || isTyping}>
            <Text style={{ color: 'white', fontSize: 20, lineHeight: 24 }}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Animated typing dots
function TypingDots() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setFrame((f) => (f + 1) % 3), 380);
    return () => clearInterval(iv);
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{
            width: 7, height: 7, borderRadius: 4,
            backgroundColor: frame === i ? '#7c6df0' : '#ccc',
          }}
        />
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState('loading');
  const [cfg, setCfg] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [lastTs, setLastTs] = useState(null);

  useEffect(() => {
    (async () => {
      await requestNotifPermission();
      await registerBgTask();
      const data = await loadData();
      if (data?.config?.apiKey) {
        setCfg(data.config);
        setMsgs(data.messages || []);
        setLastTs(data.lastTs || null);
        setScreen('chat');
      } else {
        setScreen('setup');
      }
    })();
  }, []);

  const handleFinish = async (form) => {
    setCfg(form);
    setMsgs([]);
    setLastTs(null);
    await saveData(form, [], null);
    setScreen('chat');
  };

  const handleReset = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setCfg(null);
    setMsgs([]);
    setLastTs(null);
    setScreen('setup');
  };

  if (screen === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: '#7c6df0', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 52, marginBottom: 10 }}>💬</Text>
        <Text style={{ color: 'white', fontSize: 17, opacity: 0.8 }}>loading...</Text>
      </View>
    );
  }

  if (screen === 'setup') return <SetupScreen onFinish={handleFinish} />;

  return (
    <ChatScreen
      config={cfg}
      initMessages={msgs}
      initLastTs={lastTs}
      onReset={handleReset}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Setup
  setupSafe: { flex: 1, backgroundColor: '#7c6df0' },
  setupContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  brand: { fontSize: 28, fontWeight: '700', color: 'white', marginBottom: 28, letterSpacing: -0.5 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  emoji: { fontSize: 48 },
  cardTitle: { color: 'white', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  cardSub: { color: 'rgba(255,255,255,0.72)', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  setupInput: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: 'white',
  },
  btn: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  btnBack: { backgroundColor: 'rgba(255,255,255,0.2)' },
  btnText: { color: '#7c6df0', fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 10, width: '100%' },
  typeBtn: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  typeBtnActive: { backgroundColor: 'rgba(255,255,255,0.28)', borderColor: 'rgba(255,255,255,0.85)' },
  typeBtnLabel: { color: 'white', fontWeight: '600', fontSize: 14 },
  typeBtnDesc: { color: 'rgba(255,255,255,0.68)', fontSize: 12, marginTop: 2 },
  avatarLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, alignSelf: 'flex-start' },
  avatarRow: { flexDirection: 'row', gap: 10 },
  avatarBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBtnActive: { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: 'white' },
  setupFooter: { color: 'rgba(255,255,255,0.45)', fontSize: 11, textAlign: 'center', marginTop: 20 },

  // Chat
  header: {
    backgroundColor: '#7c6df0',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    elevation: 4,
    shadowColor: '#7c6df0',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  headerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  headerName: { color: 'white', fontWeight: '700', fontSize: 16 },
  headerSub: { color: 'rgba(255,255,255,0.7)', fontSize: 11.5, marginTop: 1 },
  menuDropdown: {
    position: 'absolute',
    top: 68,
    right: 12,
    backgroundColor: 'white',
    borderRadius: 14,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 999,
    minWidth: 170,
  },
  menuItem: { paddingVertical: 14, paddingHorizontal: 20 },
  timeStamp: { textAlign: 'center', color: '#bbb', fontSize: 11, marginVertical: 8 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 2 },
  msgRowUser: { justifyContent: 'flex-end' },
  avatarCircle: {
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: '#7c6df0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bubble: {
    maxWidth: '75%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  bubbleUser: {
    backgroundColor: '#7c6df0',
    borderBottomRightRadius: 18,
  },
  bubbleUserLast: { borderBottomRightRadius: 5 },
  bubblePersona: {
    backgroundColor: 'white',
    borderBottomLeftRadius: 18,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  bubblePersonaLast: { borderBottomLeftRadius: 5 },
  bubbleText: { color: '#1a1a2e', fontSize: 15, lineHeight: 22 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    paddingBottom: 16,
    backgroundColor: 'white',
    borderTopWidth: 0.5,
    borderTopColor: '#e4e2f0',
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e0dff0',
    borderRadius: 22,
    paddingVertical: 10,
    paddingHorizontal: 15,
    fontSize: 15,
    maxHeight: 110,
    backgroundColor: '#f8f7fe',
    color: '#1a1a2e',
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#7c6df0',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
