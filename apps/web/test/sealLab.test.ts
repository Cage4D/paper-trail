// @vitest-environment node
// (jsdom's TextEncoder returns a Uint8Array from another realm, which QoreSeal rejects; browsers and workers are fine)
import { describe, expect, it } from 'vitest';
import * as core from '@paper-trail/core';
import { errorCode, makeKey, openNote, sealNote } from '../src/lib/sealLab';

const EXAM = `0x${'1'.repeat(64)}`;
const CENTRE = `0x${'a'.repeat(64)}`;

describe('try-the-encryption lab (real @paper-trail/core crypto)', () => {
  it('makes a key whose public facts carry no secrets', () => {
    const { key, info } = makeKey(core);
    expect(info.address).toMatch(/^qor1/);
    expect(info.kemPublicKeyBytes).toBe(1568); // ML-KEM-1024
    const shown = JSON.stringify(info);
    for (const word of key.mnemonic.split(' ')) expect(shown).not.toContain(` ${word} `);
    expect(shown).not.toContain(key.mnemonic);
  });

  it('locks a note that only the chosen keys can open', () => {
    const me = makeKey(core).key;
    const marker = makeKey(core).key;
    const stranger = makeKey(core).key;
    const { sealed, info } = sealNote(core, { key: me, text: 'Paper opens at 09:00', examId: EXAM, centreId: CENTRE, extra: [marker.recipient] });
    expect(info.recipients).toBe(2);
    expect(info.bytes).toBeGreaterThan(3000); // two ML-KEM-1024 + X25519 key slots and the ciphertext
    expect(new TextDecoder().decode(sealed.envelope)).not.toContain('Paper opens at 09:00');
    expect(openNote(core, { key: me, sealed }).text).toBe('Paper opens at 09:00');
    expect(openNote(core, { key: marker, sealed }).text).toBe('Paper opens at 09:00');
    let code = '';
    try {
      openNote(core, { key: stranger, sealed });
    } catch (e) {
      code = errorCode(e);
    }
    expect(code).toBe('NOT_A_RECIPIENT');
  });

  it('binds the note to its exam and centre: opening under another exam fails', () => {
    const me = makeKey(core).key;
    const { sealed } = sealNote(core, { key: me, text: 'x', examId: EXAM, centreId: CENTRE });
    expect(() => openNote(core, { key: me, sealed: { ...sealed, examId: `0x${'2'.repeat(64)}` } })).toThrow();
  });
});
