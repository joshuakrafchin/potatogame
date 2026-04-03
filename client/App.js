import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Dimensions, TouchableOpacity,
  TextInput, Animated, ScrollView, Alert, Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from './src/constants';
import { PixelPotato, SweatDrop, IrishHills, PixelCloud, CoinIcon } from './src/PixelArt';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ============================================================
//  MOCK GAME STATE (works without server for UI development)
//  Replace with Socket.IO when server is connected
// ============================================================

const MOCK_CONNECTIONS = [
  { id: 'p1', name: 'Sean', lastPlayed: Date.now() - 3600000, tossesTo: 3, tossesFrom: 5 },
  { id: 'p2', name: 'Brigid', lastPlayed: Date.now() - 7200000, tossesTo: 1, tossesFrom: 2 },
  { id: 'p3', name: 'Paddy', lastPlayed: Date.now() - 600000, tossesTo: 7, tossesFrom: 4 },
];

const BADGE_ICONS = {
  FIRST_TOSS: { icon: '🥔✈️', name: 'First Toss', desc: 'Tossed your first potato!' },
  FIRST_CATCH: { icon: '🤲', name: 'First Catch', desc: 'Caught your first potato!' },
  BURNED: { icon: '🔥', name: 'Burned!', desc: 'Got burned for the first time' },
  HOT_HANDS: { icon: '🖐️🔥', name: 'Hot Hands', desc: '5 hot tosses' },
  STREAK_3: { icon: '⚡', name: 'On a Roll', desc: '3 toss streak' },
  STREAK_10: { icon: '🌟', name: 'Streak Master', desc: '10 toss streak' },
};

// ============================================================
//  MAIN APP
// ============================================================

export default function App() {
  const [screen, setScreen] = useState('title'); // title | lobby | game | badges | tossing | relief
  const [playerName, setPlayerName] = useState('');
  const [coins, setCoins] = useState(10);
  const [badges, setBadges] = useState([]);
  const [potato, setPotato] = useState(null);
  const [potatoHeat, setPotatoHeat] = useState(0); // 0-1, drives heat visuals
  const [selectedTarget, setSelectedTarget] = useState(MOCK_CONNECTIONS[2]); // default: most recent
  const [connections] = useState(MOCK_CONNECTIONS);
  const [showBadgePopup, setShowBadgePopup] = useState(null);
  const [coinAnim, setCoinAnim] = useState(null);

  // Animations
  const potatoY = useRef(new Animated.Value(0)).current;
  const potatoScale = useRef(new Animated.Value(1)).current;
  const potatoRotate = useRef(new Animated.Value(0)).current;
  const screenGlow = useRef(new Animated.Value(0)).current;
  const sweatOpacity = useRef(new Animated.Value(0)).current;
  const reliefScale = useRef(new Animated.Value(0)).current;
  const reliefOpacity = useRef(new Animated.Value(0)).current;
  const coinFloatY = useRef(new Animated.Value(0)).current;
  const coinFloatOpacity = useRef(new Animated.Value(0)).current;
  const receiveY = useRef(new Animated.Value(-300)).current;
  const receiveBounce = useRef(new Animated.Value(0)).current;

  // Heat timer
  useEffect(() => {
    if (!potato || screen !== 'game') return;
    const interval = setInterval(() => {
      setPotatoHeat((prev) => {
        const next = Math.min(prev + 0.02, 1);
        // Update glow
        Animated.timing(screenGlow, { toValue: next, duration: 400, useNativeDriver: false }).start();
        // Sweat appears at 0.4 heat
        if (next > 0.4) {
          Animated.timing(sweatOpacity, { toValue: Math.min((next - 0.4) * 2, 1), duration: 300, useNativeDriver: true }).start();
        }
        // Potato wobbles more as it heats
        if (next > 0.3) {
          Animated.sequence([
            Animated.timing(potatoRotate, { toValue: next * 5, duration: 100, useNativeDriver: true }),
            Animated.timing(potatoRotate, { toValue: -next * 5, duration: 100, useNativeDriver: true }),
            Animated.timing(potatoRotate, { toValue: 0, duration: 100, useNativeDriver: true }),
          ]).start();
        }
        // BURN at 1.0
        if (next >= 1) {
          clearInterval(interval);
          handleBurn();
        }
        return next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, [potato, screen]);

  // Receive potato animation
  const animateReceive = useCallback(() => {
    receiveY.setValue(-300);
    receiveBounce.setValue(0);
    Animated.sequence([
      Animated.spring(receiveY, { toValue: 0, velocity: 10, tension: 40, friction: 5, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(receiveBounce, { toValue: -20, duration: 150, useNativeDriver: true }),
        Animated.timing(receiveBounce, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(receiveBounce, { toValue: -10, duration: 100, useNativeDriver: true }),
        Animated.timing(receiveBounce, { toValue: 0, duration: 100, useNativeDriver: true }),
      ]),
    ]).start();
  }, [receiveY, receiveBounce]);

  const handleReceivePotato = () => {
    setPotato({ type: 'GOLDEN', name: 'Golden Potato' });
    setPotatoHeat(0);
    screenGlow.setValue(0);
    sweatOpacity.setValue(0);
    setScreen('game');
    animateReceive();
    // Award badge
    if (!badges.includes('FIRST_CATCH')) {
      const newBadges = [...badges, 'FIRST_CATCH'];
      setBadges(newBadges);
      setCoins((c) => c + 5);
      setTimeout(() => {
        setShowBadgePopup(BADGE_ICONS.FIRST_CATCH);
        setTimeout(() => setShowBadgePopup(null), 2500);
      }, 1500);
    }
  };

  const handleToss = () => {
    if (!potato || !selectedTarget) return;
    // Toss animation — potato launches UP with spin
    setScreen('tossing');
    Animated.parallel([
      Animated.timing(potatoY, { toValue: -SCREEN_H, duration: 600, useNativeDriver: true }),
      Animated.timing(potatoScale, { toValue: 0.3, duration: 600, useNativeDriver: true }),
      Animated.timing(potatoRotate, { toValue: 360, duration: 600, useNativeDriver: true }),
    ]).start(() => {
      // Calculate coins
      let earned = 2;
      let tossType = 'normal';
      if (potatoHeat >= 0.85) { earned = 10; tossType = 'DANGER'; }
      else if (potatoHeat >= 0.5) { earned = 5; tossType = 'HOT'; }

      setCoins((c) => c + earned);
      setCoinAnim({ amount: earned, type: tossType });
      setPotato(null);
      setPotatoHeat(0);
      screenGlow.setValue(0);
      sweatOpacity.setValue(0);
      potatoY.setValue(0);
      potatoScale.setValue(1);
      potatoRotate.setValue(0);

      // Badge check
      if (!badges.includes('FIRST_TOSS')) {
        const newBadges = [...badges, 'FIRST_TOSS'];
        setBadges(newBadges);
        setCoins((c) => c + 5);
        setTimeout(() => {
          setShowBadgePopup(BADGE_ICONS.FIRST_TOSS);
          setTimeout(() => setShowBadgePopup(null), 2500);
        }, 500);
      }

      // Show relief screen
      showRelief(earned, tossType);
    });
  };

  const showRelief = (earned, tossType) => {
    setScreen('relief');
    // Coin float animation
    coinFloatY.setValue(0);
    coinFloatOpacity.setValue(1);
    Animated.parallel([
      Animated.timing(coinFloatY, { toValue: -80, duration: 1500, useNativeDriver: true }),
      Animated.timing(coinFloatOpacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
    ]).start();

    // Relief burst
    reliefScale.setValue(0);
    reliefOpacity.setValue(1);
    Animated.parallel([
      Animated.spring(reliefScale, { toValue: 1, tension: 60, friction: 5, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(2000),
        Animated.timing(reliefOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    ]).start(() => {
      setScreen('game');
    });
  };

  const handleBurn = () => {
    setCoins((c) => Math.max(0, c - 3));
    setPotato(null);
    setPotatoHeat(0);
    screenGlow.setValue(0);
    sweatOpacity.setValue(0);
    if (!badges.includes('BURNED')) {
      const newBadges = [...badges, 'BURNED'];
      setBadges(newBadges);
      setCoins((c) => c + 3);
      setTimeout(() => {
        setShowBadgePopup(BADGE_ICONS.BURNED);
        setTimeout(() => setShowBadgePopup(null), 2500);
      }, 500);
    }
    Alert.alert('🔥 BURNED!', 'The potato burned ye! -3 coins', [{ text: 'Ach!' }]);
  };

  const formatTimeAgo = (ts) => {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  };

  // ============================================================
  //  SCREENS
  // ============================================================

  // --- TITLE SCREEN ---
  if (screen === 'title') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <IrishHills width={SCREEN_W} height={SCREEN_H} />
        <View style={styles.titleOverlay}>
          <PixelCloud size={80} style={{ position: 'absolute', top: 60, left: 20 }} />
          <PixelCloud size={50} style={{ position: 'absolute', top: 90, right: 30 }} />

          <View style={styles.titleBox}>
            <Text style={styles.titleText}>HOT</Text>
            <PixelPotato size={100} isHot />
            <Text style={styles.titleText}>POTATO</Text>
            <Text style={styles.subtitleText}>An Irish Farm Adventure</Text>
          </View>

          <TextInput
            style={styles.nameInput}
            placeholder="Enter yer name, lad..."
            placeholderTextColor="#888"
            value={playerName}
            onChangeText={setPlayerName}
            maxLength={16}
          />

          <TouchableOpacity
            style={[styles.pixelButton, !playerName && styles.buttonDisabled]}
            disabled={!playerName}
            onPress={() => setScreen('lobby')}
          >
            <Text style={styles.pixelButtonText}>START GAME</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- LOBBY / WAITING ---
  if (screen === 'lobby') {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <IrishHills width={SCREEN_W} height={SCREEN_H} />
        <View style={styles.lobbyOverlay}>
          {/* Header */}
          <View style={styles.headerBar}>
            <View style={styles.coinDisplay}>
              <CoinIcon size={24} />
              <Text style={styles.coinText}>{coins}</Text>
            </View>
            <TouchableOpacity onPress={() => setScreen('badges')}>
              <Text style={styles.badgeCountText}>🏅 {badges.length}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.lobbyContent}>
            <PixelPotato size={60} />
            <Text style={styles.sectionTitle}>Welcome, {playerName}!</Text>
            <Text style={styles.bodyText}>Yer farm is peaceful... for now.</Text>

            {/* Simulate receiving a potato */}
            <TouchableOpacity
              style={[styles.pixelButton, { backgroundColor: COLORS.HOT_ORANGE, marginTop: 30 }]}
              onPress={handleReceivePotato}
            >
              <Text style={styles.pixelButtonText}>🥔 CATCH A POTATO</Text>
            </TouchableOpacity>

            {/* Share buttons */}
            <Text style={[styles.sectionTitle, { marginTop: 40 }]}>Toss to a Friend</Text>
            <View style={styles.shareRow}>
              <TouchableOpacity style={styles.shareButton}>
                <Text style={styles.shareIcon}>💬</Text>
                <Text style={styles.shareLabel}>Text</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareButton}>
                <Text style={styles.shareIcon}>📧</Text>
                <Text style={styles.shareLabel}>Email</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareButton}>
                <Text style={styles.shareIcon}>📱</Text>
                <Text style={styles.shareLabel}>Bump</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.shareButton}>
                <Text style={styles.shareIcon}>🔗</Text>
                <Text style={styles.shareLabel}>Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // --- BADGE SCREEN ---
  if (screen === 'badges') {
    const allBadgeKeys = Object.keys(BADGE_ICONS);
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={[styles.container, { backgroundColor: COLORS.GREEN_DARK }]}>
          <View style={styles.headerBar}>
            <TouchableOpacity onPress={() => setScreen(potato ? 'game' : 'lobby')}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.sectionTitle}>Badges</Text>
            <View style={{ width: 60 }} />
          </View>
          <ScrollView contentContainerStyle={styles.badgeGrid}>
            {allBadgeKeys.map((key) => {
              const b = BADGE_ICONS[key];
              const earned = badges.includes(key);
              return (
                <View key={key} style={[styles.badgeCard, !earned && styles.badgeCardLocked]}>
                  <Text style={{ fontSize: 36 }}>{earned ? b.icon : '🔒'}</Text>
                  <Text style={[styles.badgeName, !earned && { color: '#666' }]}>{b.name}</Text>
                  <Text style={styles.badgeDesc}>{b.desc}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    );
  }

  // --- RELIEF SCREEN ---
  if (screen === 'relief') {
    return (
      <View style={[styles.container, { backgroundColor: COLORS.COOL_MINT }]}>
        <StatusBar style="light" />
        <IrishHills width={SCREEN_W} height={SCREEN_H} />
        <Animated.View style={[styles.reliefContainer, {
          transform: [{ scale: reliefScale }],
          opacity: reliefOpacity,
        }]}>
          <Text style={styles.reliefEmoji}>😮‍💨</Text>
          <Text style={styles.reliefText}>PHEW!</Text>
          <Text style={styles.reliefSubtext}>Potato tossed to {selectedTarget?.name}!</Text>

          {/* Floating coin reward */}
          <Animated.View style={{
            transform: [{ translateY: coinFloatY }],
            opacity: coinFloatOpacity,
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 20,
          }}>
            <CoinIcon size={28} />
            <Text style={styles.coinEarnedText}>
              +{coinAnim?.amount || 2} {coinAnim?.type === 'DANGER' ? '🔥 DANGER BONUS!' : coinAnim?.type === 'HOT' ? '♨️ HOT BONUS!' : ''}
            </Text>
          </Animated.View>
        </Animated.View>
      </View>
    );
  }

  // --- GAME SCREEN (Holding Potato) ---
  const isHot = potatoHeat > 0.5;
  const isDanger = potatoHeat > 0.85;

  const edgeGlowColor = screenGlow.interpolate({
    inputRange: [0, 0.3, 0.6, 1],
    outputRange: ['transparent', 'rgba(255,140,0,0.0)', 'rgba(255,140,0,0.4)', 'rgba(255,0,0,0.7)'],
  });

  const bgColor = screenGlow.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [COLORS.SKY_BLUE, '#ffcc80', '#ff6b6b'],
  });

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      {/* Background */}
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: bgColor }]} />
      <IrishHills width={SCREEN_W} height={SCREEN_H * 0.4} />

      {/* Burning screen edges */}
      <Animated.View style={[styles.edgeGlow, styles.edgeTop, { backgroundColor: edgeGlowColor }]} />
      <Animated.View style={[styles.edgeGlow, styles.edgeBottom, { backgroundColor: edgeGlowColor }]} />
      <Animated.View style={[styles.edgeGlow, styles.edgeLeft, { backgroundColor: edgeGlowColor }]} />
      <Animated.View style={[styles.edgeGlow, styles.edgeRight, { backgroundColor: edgeGlowColor }]} />

      {/* Header */}
      <View style={styles.headerBar}>
        <View style={styles.coinDisplay}>
          <CoinIcon size={24} />
          <Text style={styles.coinText}>{coins}</Text>
        </View>
        <TouchableOpacity onPress={() => setScreen('badges')}>
          <Text style={styles.badgeCountText}>🏅 {badges.length}</Text>
        </TouchableOpacity>
      </View>

      {/* Badge popup */}
      {showBadgePopup && (
        <View style={styles.badgePopup}>
          <Text style={{ fontSize: 32 }}>{showBadgePopup.icon}</Text>
          <Text style={styles.badgePopupTitle}>BADGE UNLOCKED!</Text>
          <Text style={styles.badgePopupName}>{showBadgePopup.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <CoinIcon size={16} />
            <Text style={styles.badgePopupCoins}> +5</Text>
          </View>
        </View>
      )}

      {/* Main content */}
      <View style={styles.gameCenter}>
        {potato ? (
          <>
            {/* Heat indicator */}
            <View style={styles.heatBar}>
              <View style={[styles.heatFill, {
                width: `${potatoHeat * 100}%`,
                backgroundColor: isDanger ? COLORS.DANGER_RED : isHot ? COLORS.HOT_ORANGE : COLORS.FLAME_YELLOW,
              }]} />
            </View>
            <Text style={[styles.heatLabel, isDanger && { color: COLORS.DANGER_RED }]}>
              {isDanger ? '🔥 DANGER! TOSS NOW!' : isHot ? '♨️ Getting hot...' : '🥔 Fresh potato'}
            </Text>

            {/* Sweating */}
            <View style={styles.potatoArea}>
              <Animated.View style={{ opacity: sweatOpacity, position: 'absolute', top: -10, left: -15 }}>
                <SweatDrop size={18} />
              </Animated.View>
              <Animated.View style={{ opacity: sweatOpacity, position: 'absolute', top: 5, right: -20 }}>
                <SweatDrop size={14} />
              </Animated.View>
              <Animated.View style={{ opacity: sweatOpacity, position: 'absolute', bottom: 0, left: -25 }}>
                <SweatDrop size={20} />
              </Animated.View>

              {/* The potato */}
              <Animated.View style={{
                transform: [
                  { translateY: Animated.add(potatoY, receiveY) },
                  { scale: potatoScale },
                  { rotate: potatoRotate.interpolate({
                    inputRange: [-360, 360],
                    outputRange: ['-360deg', '360deg'],
                  })},
                ],
              }}>
                <PixelPotato size={120} isHot={isHot} />
              </Animated.View>
            </View>

            {/* Target selector */}
            <View style={styles.targetSection}>
              <Text style={styles.tossLabel}>TOSS TO:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.targetScroll}>
                {connections.map((c) => (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.targetCard,
                      selectedTarget?.id === c.id && styles.targetCardSelected,
                    ]}
                    onPress={() => setSelectedTarget(c)}
                  >
                    <Text style={styles.targetName}>{c.name}</Text>
                    <Text style={styles.targetStat}>
                      {c.tossesFrom > 0
                        ? `Tossed you ${c.tossesFrom}x`
                        : 'New connection'}
                    </Text>
                    <Text style={styles.targetTime}>{formatTimeAgo(c.lastPlayed)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* TOSS BUTTON (swipe up will be gesture handler - this is tap fallback) */}
            <TouchableOpacity
              style={[styles.tossButton, isDanger && styles.tossButtonDanger]}
              onPress={handleToss}
            >
              <Text style={styles.tossButtonText}>
                ⬆️ SWIPE UP TO TOSS!
              </Text>
              <Text style={styles.tossHint}>
                {isDanger ? '+10 DANGER BONUS!' : isHot ? '+5 hot toss bonus' : '+2 coins'}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.emptyState}>
            <PixelPotato size={80} />
            <Text style={styles.emptyText}>No potato right now.</Text>
            <Text style={styles.emptySubtext}>Enjoy the peace while it lasts...</Text>
            <TouchableOpacity
              style={[styles.pixelButton, { marginTop: 20 }]}
              onPress={() => setScreen('lobby')}
            >
              <Text style={styles.pixelButtonText}>← BACK TO FARM</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================
//  STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.SKY_BLUE,
  },

  // --- Title Screen ---
  titleOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  titleBox: {
    alignItems: 'center',
    marginBottom: 40,
  },
  titleText: {
    fontFamily: 'monospace',
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    textShadowColor: COLORS.BROWN_DARK,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
    letterSpacing: 6,
  },
  subtitleText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: COLORS.GREEN_PALE,
    marginTop: 10,
    letterSpacing: 2,
  },
  nameInput: {
    fontFamily: 'monospace',
    fontSize: 18,
    color: COLORS.BLACK,
    backgroundColor: COLORS.WHITE,
    borderWidth: 3,
    borderColor: COLORS.BROWN_DARK,
    paddingHorizontal: 20,
    paddingVertical: 12,
    width: '80%',
    textAlign: 'center',
    marginBottom: 20,
  },
  pixelButton: {
    backgroundColor: COLORS.GREEN_MID,
    borderWidth: 3,
    borderColor: COLORS.GREEN_DARK,
    borderBottomWidth: 5,
    paddingHorizontal: 30,
    paddingVertical: 14,
    minWidth: 200,
    alignItems: 'center',
  },
  pixelButtonText: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    letterSpacing: 2,
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  // --- Lobby ---
  lobbyOverlay: {
    ...StyleSheet.absoluteFillObject,
    paddingTop: 50,
  },
  lobbyContent: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 30,
  },
  sectionTitle: {
    fontFamily: 'monospace',
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    letterSpacing: 2,
    marginTop: 15,
    textShadowColor: COLORS.BLACK,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  bodyText: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: COLORS.GREEN_PALE,
    marginTop: 5,
  },
  shareRow: {
    flexDirection: 'row',
    marginTop: 15,
    gap: 15,
  },
  shareButton: {
    backgroundColor: COLORS.WHITE,
    borderWidth: 3,
    borderColor: COLORS.BROWN_DARK,
    borderBottomWidth: 5,
    paddingHorizontal: 15,
    paddingVertical: 12,
    alignItems: 'center',
    minWidth: 65,
  },
  shareIcon: {
    fontSize: 24,
  },
  shareLabel: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.BLACK,
    marginTop: 4,
  },

  // --- Header ---
  headerBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 55 : 40,
    paddingBottom: 10,
    zIndex: 100,
  },
  coinDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: COLORS.COIN_GOLD,
  },
  coinText: {
    fontFamily: 'monospace',
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.COIN_GOLD,
    marginLeft: 8,
  },
  badgeCountText: {
    fontFamily: 'monospace',
    fontSize: 18,
    color: COLORS.WHITE,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: COLORS.BADGE_PURPLE,
  },
  backText: {
    fontFamily: 'monospace',
    fontSize: 16,
    color: COLORS.WHITE,
    fontWeight: 'bold',
  },

  // --- Game Screen ---
  gameCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 10,
  },

  // Heat bar
  heatBar: {
    width: '80%',
    height: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 2,
    borderColor: COLORS.BLACK,
    marginBottom: 8,
    overflow: 'hidden',
  },
  heatFill: {
    height: '100%',
  },
  heatLabel: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    marginBottom: 20,
    textShadowColor: COLORS.BLACK,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },

  // Potato area
  potatoArea: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },

  // Edge glow (screen burn effect)
  edgeGlow: {
    position: 'absolute',
    zIndex: 50,
  },
  edgeTop: {
    top: 0, left: 0, right: 0, height: 40,
  },
  edgeBottom: {
    bottom: 0, left: 0, right: 0, height: 40,
  },
  edgeLeft: {
    top: 0, bottom: 0, left: 0, width: 20,
  },
  edgeRight: {
    top: 0, bottom: 0, right: 0, width: 20,
  },

  // Target selector
  targetSection: {
    width: '100%',
    marginBottom: 20,
  },
  tossLabel: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: 2,
    textShadowColor: COLORS.BLACK,
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 0,
  },
  targetScroll: {
    maxHeight: 90,
  },
  targetCard: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 6,
    alignItems: 'center',
    minWidth: 100,
  },
  targetCardSelected: {
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderColor: COLORS.COIN_GOLD,
    borderWidth: 3,
  },
  targetName: {
    fontFamily: 'monospace',
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.WHITE,
  },
  targetStat: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: COLORS.GREEN_PALE,
    marginTop: 4,
  },
  targetTime: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },

  // Toss button
  tossButton: {
    backgroundColor: COLORS.GREEN_MID,
    borderWidth: 3,
    borderColor: COLORS.GREEN_DARK,
    borderBottomWidth: 6,
    paddingHorizontal: 40,
    paddingVertical: 16,
    alignItems: 'center',
    width: '80%',
  },
  tossButtonDanger: {
    backgroundColor: COLORS.HOT_RED,
    borderColor: COLORS.DANGER_RED,
  },
  tossButtonText: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    letterSpacing: 2,
  },
  tossHint: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: COLORS.COIN_GOLD,
    marginTop: 4,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'monospace',
    fontSize: 18,
    color: COLORS.WHITE,
    marginTop: 20,
    fontWeight: 'bold',
    textShadowColor: COLORS.BLACK,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  emptySubtext: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: COLORS.GREEN_PALE,
    marginTop: 8,
  },

  // Relief screen
  reliefContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },
  reliefEmoji: {
    fontSize: 80,
  },
  reliefText: {
    fontFamily: 'monospace',
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    letterSpacing: 6,
    textShadowColor: COLORS.GREEN_DARK,
    textShadowOffset: { width: 3, height: 3 },
    textShadowRadius: 0,
    marginTop: 10,
  },
  reliefSubtext: {
    fontFamily: 'monospace',
    fontSize: 16,
    color: COLORS.WHITE,
    marginTop: 10,
  },
  coinEarnedText: {
    fontFamily: 'monospace',
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.COIN_GOLD,
    marginLeft: 8,
    textShadowColor: COLORS.BLACK,
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },

  // Badge popup
  badgePopup: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 80,
    left: 30,
    right: 30,
    backgroundColor: COLORS.BADGE_PURPLE,
    borderWidth: 3,
    borderColor: '#7d3c98',
    borderBottomWidth: 5,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
    zIndex: 300,
  },
  badgePopupTitle: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.COIN_GOLD,
    letterSpacing: 2,
    marginTop: 4,
  },
  badgePopupName: {
    fontFamily: 'monospace',
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    marginTop: 4,
  },
  badgePopupCoins: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: COLORS.COIN_GOLD,
    fontWeight: 'bold',
  },

  // Badges screen
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    padding: 20,
    gap: 15,
  },
  badgeCard: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 3,
    borderColor: COLORS.COIN_GOLD,
    width: SCREEN_W * 0.4,
    paddingVertical: 20,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  badgeCardLocked: {
    borderColor: '#444',
    opacity: 0.5,
  },
  badgeName: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.WHITE,
    marginTop: 8,
    textAlign: 'center',
  },
  badgeDesc: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: COLORS.GREEN_PALE,
    marginTop: 4,
    textAlign: 'center',
  },
});
