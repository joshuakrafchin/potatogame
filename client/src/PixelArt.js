// Pixel art components rendered with View boxes (no images needed)
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS } from './constants';

// 8x8 pixel grid potato — each row is an array of colors (null = transparent)
const POTATO_PIXELS = [
  [null, null, '#5c3d2e', '#5c3d2e', '#5c3d2e', null, null, null],
  [null, '#5c3d2e', '#c9a84c', '#c9a84c', '#c9a84c', '#5c3d2e', null, null],
  ['#5c3d2e', '#c9a84c', '#f5e6b8', '#f5e6b8', '#c9a84c', '#c9a84c', '#5c3d2e', null],
  ['#5c3d2e', '#c9a84c', '#f5e6b8', '#f5e6b8', '#f5e6b8', '#c9a84c', '#5c3d2e', null],
  ['#5c3d2e', '#c9a84c', '#c9a84c', '#f5e6b8', '#f5e6b8', '#c9a84c', '#5c3d2e', null],
  [null, '#5c3d2e', '#c9a84c', '#c9a84c', '#c9a84c', '#c9a84c', '#5c3d2e', null],
  [null, null, '#5c3d2e', '#5c3d2e', '#5c3d2e', '#5c3d2e', null, null],
  [null, null, null, '#5c3d2e', '#5c3d2e', null, null, null],
];

const HOT_POTATO_PIXELS = [
  [null, '#ff4444', '#5c3d2e', '#5c3d2e', '#5c3d2e', '#ff4444', null, null],
  ['#ff8c42', '#5c3d2e', '#ff8c42', '#ff8c42', '#ff8c42', '#5c3d2e', '#ff8c42', null],
  ['#5c3d2e', '#ff8c42', '#ffd700', '#ffd700', '#ff8c42', '#ff8c42', '#5c3d2e', null],
  ['#5c3d2e', '#ff8c42', '#ffd700', '#ffd700', '#ffd700', '#ff8c42', '#5c3d2e', null],
  ['#5c3d2e', '#ff8c42', '#ff8c42', '#ffd700', '#ffd700', '#ff8c42', '#5c3d2e', null],
  [null, '#5c3d2e', '#ff8c42', '#ff8c42', '#ff8c42', '#ff8c42', '#5c3d2e', null],
  ['#ff4444', null, '#5c3d2e', '#5c3d2e', '#5c3d2e', '#5c3d2e', null, '#ff4444'],
  [null, null, '#ff4444', '#5c3d2e', '#5c3d2e', '#ff4444', null, null],
];

const SWEAT_DROP = [
  [null, '#4fc3f7', null],
  ['#4fc3f7', '#87ceeb', '#4fc3f7'],
  [null, '#4fc3f7', null],
  [null, null, null],
];

// Rolling Irish hills background (bottom portion of screen)
const HILLS_ROWS = [
  { color: '#7bc96f', heights: [0.3, 0.5, 0.4, 0.6, 0.35, 0.55, 0.45, 0.5] },
  { color: '#4a8c3f', heights: [0.5, 0.6, 0.55, 0.7, 0.5, 0.65, 0.6, 0.55] },
  { color: '#2d5a1e', heights: [0.7, 0.75, 0.72, 0.8, 0.7, 0.78, 0.74, 0.72] },
];

export function PixelPotato({ size = 80, isHot = false, style }) {
  const pixels = isHot ? HOT_POTATO_PIXELS : POTATO_PIXELS;
  const pixelSize = size / 8;

  return (
    <View style={[{ width: size, height: size }, style]}>
      {pixels.map((row, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {row.map((color, x) => (
            <View
              key={x}
              style={{
                width: pixelSize,
                height: pixelSize,
                backgroundColor: color || 'transparent',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export function SweatDrop({ size = 24, style }) {
  const pixelSize = size / 3;
  return (
    <View style={[{ width: size, height: size * 1.33 }, style]}>
      {SWEAT_DROP.map((row, y) => (
        <View key={y} style={{ flexDirection: 'row' }}>
          {row.map((color, x) => (
            <View
              key={x}
              style={{
                width: pixelSize,
                height: pixelSize,
                backgroundColor: color || 'transparent',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export function IrishHills({ width, height }) {
  return (
    <View style={{ width, height, position: 'absolute', bottom: 0 }}>
      {/* Sky gradient approximation */}
      <View style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: COLORS.SKY_BLUE,
      }} />
      {/* Hills layers */}
      {HILLS_ROWS.map((hill, i) => (
        <View key={i} style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: height * (1 - i * 0.15),
          flexDirection: 'row',
        }}>
          {hill.heights.map((h, j) => (
            <View key={j} style={{
              flex: 1,
              justifyContent: 'flex-end',
            }}>
              <View style={{
                height: height * h,
                backgroundColor: hill.color,
                borderTopLeftRadius: 40,
                borderTopRightRadius: 40,
              }} />
            </View>
          ))}
        </View>
      ))}
      {/* Little pixel shamrocks */}
      <View style={[styles.shamrock, { left: '15%', bottom: '25%' }]}>
        <Text style={{ fontSize: 16 }}>☘</Text>
      </View>
      <View style={[styles.shamrock, { left: '55%', bottom: '35%' }]}>
        <Text style={{ fontSize: 12 }}>☘</Text>
      </View>
      <View style={[styles.shamrock, { left: '80%', bottom: '20%' }]}>
        <Text style={{ fontSize: 14 }}>☘</Text>
      </View>
    </View>
  );
}

export function PixelCloud({ size = 60, style }) {
  const p = size / 8;
  return (
    <View style={[{ flexDirection: 'row' }, style]}>
      <View style={{ marginTop: p * 2 }}>
        <View style={{ width: p * 2, height: p * 2, backgroundColor: '#fff', borderRadius: 2 }} />
      </View>
      <View>
        <View style={{ width: p * 2, height: p, backgroundColor: '#fff', borderRadius: 2 }} />
        <View style={{ width: p * 4, height: p * 3, backgroundColor: '#fff', borderRadius: 2 }} />
      </View>
      <View style={{ marginTop: p }}>
        <View style={{ width: p * 2, height: p * 2, backgroundColor: '#fff', borderRadius: 2 }} />
      </View>
    </View>
  );
}

export function CoinIcon({ size = 20 }) {
  return (
    <View style={{
      width: size, height: size,
      backgroundColor: COLORS.COIN_GOLD,
      borderRadius: size / 2,
      borderWidth: 2,
      borderColor: '#b8860b',
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <Text style={{
        ...styles.pixelText,
        fontSize: size * 0.5,
        color: '#8b6914',
      }}>P</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shamrock: {
    position: 'absolute',
  },
  pixelText: {
    fontFamily: 'monospace',
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
