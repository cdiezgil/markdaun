import { describe, it, expect } from 'vitest';
import { captureToast, formatSize, kindLabel, voiceStatusText } from './inbox';

describe('formatSize', () => {
  it('uses B, KB and MB', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('kindLabel', () => {
  it('names every kind in Spanish', () => {
    expect(kindLabel('md')).toBe('Markdown');
    expect(kindLabel('txt')).toBe('Texto');
    expect(kindLabel('pdf')).toBe('PDF');
    expect(kindLabel('image')).toBe('Imagen');
    expect(kindLabel('docx')).toBe('Word');
    expect(kindLabel('pptx')).toBe('PowerPoint');
    expect(kindLabel('audio')).toBe('Audio');
    expect(kindLabel('other')).toBe('Otro');
  });
});

describe('captureToast', () => {
  it('confirms a saved capture', () => {
    expect(captureToast({ kind: 'note', rel_path: 'Entrada/C.md', clipped: null, failure: null })).toBe('Guardado en Entrada');
    expect(captureToast({ kind: 'clip', rel_path: 'Entrada/A.md', clipped: true, failure: null })).toBe('Guardado en Entrada');
  });
  it('says a voice note is being transcribed', () => {
    expect(captureToast({ kind: 'voice', rel_path: 'Entrada/Nota de voz.m4a', clipped: null, failure: null })).toBe(
      'Nota de voz guardada en Entrada. Transcribiendo…',
    );
  });
  it('says when only the link was kept', () => {
    expect(captureToast({ kind: 'clip', rel_path: 'Entrada/h.md', clipped: false, failure: 'HTTP 404' })).toBe(
      'No se pudo recortar la página (HTTP 404). Guardé el enlace en Entrada.',
    );
  });
});

describe('voiceStatusText', () => {
  it('describes each transcription state in Spanish', () => {
    expect(voiceStatusText({ state: 'transcribing', detail: null, progress: null })).toBe('Transcribiendo…');
    expect(voiceStatusText({ state: 'downloading', detail: null, progress: null })).toBe('Descargando el modelo de voz…');
    expect(voiceStatusText({ state: 'downloading', detail: null, progress: 0.426 })).toBe('Descargando el modelo de voz… 43 %');
    expect(voiceStatusText({ state: 'error', detail: 'boom', progress: null })).toBe('Error de transcripción · boom');
    expect(voiceStatusText({ state: 'error', detail: null, progress: null })).toBe('Error de transcripción');
  });
});
