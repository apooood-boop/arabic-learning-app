import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Eraser,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { SentencePair, VocabCard } from '../types/arabic';
import {
  invalidateCachedArabicAudio,
  normalizeStandaloneArabicKey,
  speakArabic,
  stopArabicSpeech,
  stripFinalIrabForSpeech,
  stripTashkeel,
  unlockArabicAudioContext,
} from '../utils/arabic';

interface EditVocabCardModalProps {
  card: VocabCard;
  speechRate: number;
  onSave: (updatedCard: VocabCard, previousCard: VocabCard) => void;
  onClose: () => void;
}

type FocusedArabicTarget =
  | { kind: 'word' }
  | { kind: 'example'; index: number };

const TASHKEEL_BUTTONS: Array<{ mark: string; labelAr: string; labelEn: string }> = [
  { mark: '\u064E', labelAr: 'ـَ', labelEn: 'Fatha' },
  { mark: '\u064F', labelAr: 'ـُ', labelEn: 'Damma' },
  { mark: '\u0650', labelAr: 'ـِ', labelEn: 'Kasra' },
  { mark: '\u0652', labelAr: 'ـْ', labelEn: 'Sukun' },
  { mark: '\u0651', labelAr: 'ـّ', labelEn: 'Shaddah' },
  { mark: '\u064B', labelAr: 'ـً', labelEn: 'Tanwin Fath' },
  { mark: '\u064C', labelAr: 'ـٌ', labelEn: 'Tanwin Damm' },
  { mark: '\u064D', labelAr: 'ـٍ', labelEn: 'Tanwin Kasr' },
];

export function EditVocabCardModal({
  card,
  speechRate,
  onSave,
  onClose,
}: EditVocabCardModalProps) {
  const [wordAr, setWordAr] = useState(card.wordWithTashkeel);
  const [englishMeaning, setEnglishMeaning] = useState(card.englishMeaning);
  const [transliteration, setTransliteration] = useState(card.transliteration);
  const [examples, setExamples] = useState<SentencePair[]>(() =>
    card.examples.length > 0
      ? card.examples.slice(0, 3).map((ex) => ({ ...ex }))
      : []
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<'word' | number | null>(null);
  const [previewPhase, setPreviewPhase] = useState<'idle' | 'loading' | 'playing'>('idle');

  const activeTargetRef = useRef<FocusedArabicTarget>({ kind: 'word' });
  const wordInputRef = useRef<HTMLInputElement | null>(null);
  const exampleRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopArabicSpeech();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      stopArabicSpeech();
    };
  }, [onClose]);

  const insertTashkeelMark = (mark: string) => {
    const target = activeTargetRef.current;
    if (target.kind === 'word') {
      const input = wordInputRef.current;
      const start = input?.selectionStart ?? wordAr.length;
      const end = input?.selectionEnd ?? wordAr.length;
      const next = wordAr.slice(0, start) + mark + wordAr.slice(end);
      setWordAr(next);
      window.requestAnimationFrame(() => {
        if (input) {
          input.focus();
          const pos = start + mark.length;
          input.setSelectionRange(pos, pos);
        }
      });
      return;
    }

    const idx = target.index;
    const area = exampleRefs.current[idx];
    const currentText = examples[idx]?.arabic ?? '';
    const start = area?.selectionStart ?? currentText.length;
    const end = area?.selectionEnd ?? currentText.length;
    const nextText = currentText.slice(0, start) + mark + currentText.slice(end);
    setExamples((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, arabic: nextText } : item))
    );
    window.requestAnimationFrame(() => {
      if (area) {
        area.focus();
        const pos = start + mark.length;
        area.setSelectionRange(pos, pos);
      }
    });
  };

  const clearMarksInActiveField = () => {
    const target = activeTargetRef.current;
    if (target.kind === 'word') {
      setWordAr((prev) => stripTashkeel(prev));
      wordInputRef.current?.focus();
    } else {
      const idx = target.index;
      setExamples((prev) =>
        prev.map((item, i) =>
          i === idx ? { ...item, arabic: stripTashkeel(item.arabic) } : item
        )
      );
      exampleRefs.current[idx]?.focus();
    }
  };

  const handlePreviewAudio = (text: string, target: 'word' | number) => {
    unlockArabicAudioContext();
    const clean = text.trim();
    if (!clean) return;
    if (previewPhase === 'loading') return;

    if (previewTarget === target) {
      stopArabicSpeech();
      setPreviewTarget(null);
      setPreviewPhase('idle');
      return;
    }

    // Invalidate previous cache if the user modified the text in this editor so they hear the updated tashkeel immediately
    invalidateCachedArabicAudio(clean, target === 'word' ? 'word' : 'example');

    if (target === 'word') {
      speakArabic(clean, {
        rate: speechRate,
        mode: 'word',
        vocalizedText: clean,
        meaningHint: englishMeaning,
        wordType: card.wordType,
        partOfSpeech: card.partOfSpeech,
        onLoading: () => {
          setPreviewTarget(target);
          setPreviewPhase('loading');
        },
        onStart: () => {
          setPreviewTarget(target);
          setPreviewPhase('playing');
        },
        onEnd: () => {
          setPreviewTarget((curr) => (curr === target ? null : curr));
          setPreviewPhase('idle');
        },
        onError: () => {
          setPreviewTarget(null);
          setPreviewPhase('idle');
        },
      });
    } else {
      speakArabic(clean, {
        rate: speechRate,
        mode: 'example',
        vocalizedText: clean,
        onLoading: () => {
          setPreviewTarget(target);
          setPreviewPhase('loading');
        },
        onStart: () => {
          setPreviewTarget(target);
          setPreviewPhase('playing');
        },
        onEnd: () => {
          setPreviewTarget((curr) => (curr === target ? null : curr));
          setPreviewPhase('idle');
        },
        onError: () => {
          setPreviewTarget(null);
          setPreviewPhase('idle');
        },
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedWord = wordAr.trim();
    if (!cleanedWord) {
      setErrorMsg('Please enter an Arabic word before saving.');
      return;
    }

    const cleanedExamples = examples
      .map((ex) => ({
        ...ex,
        arabic: ex.arabic.trim(),
        english: ex.english.trim(),
      }))
      .filter((ex) => ex.arabic.length > 0);

    stopArabicSpeech();

    const updatedCard: VocabCard = {
      ...card,
      word: stripTashkeel(cleanedWord) || cleanedWord,
      wordWithTashkeel: cleanedWord,
      vocalizedWord: stripFinalIrabForSpeech(cleanedWord, {
        wordType: card.wordType,
        partOfSpeech: card.partOfSpeech,
      }),
      normalizedKey: normalizeStandaloneArabicKey(cleanedWord) || card.normalizedKey,
      englishMeaning: englishMeaning.trim() || card.englishMeaning,
      transliteration: transliteration.trim() || card.transliteration,
      examples: cleanedExamples,
      hasCustomEdits: true,
    };

    onSave(updatedCard, card);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#16200F]/60 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-card-modal-title"
      onClick={() => {
        stopArabicSpeech();
        onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-[#DCE5D3] bg-[#FAFBF8] shadow-2xl overflow-hidden my-auto animate-fade-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-[#2D3B22] to-[#3B4D2B] px-5 py-4 text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#16200F]/70 border border-[#FACC15]/30 text-[#FACC15]">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="edit-card-modal-title"
                className="font-display text-base sm:text-lg font-bold tracking-tight flex flex-wrap items-center gap-2"
              >
                <span className="font-arabic-cairo text-[#FEF08A]">تعديل البطاقة</span>
                <span className="text-white/40" aria-hidden="true">·</span>
                <span>Edit Word &amp; Tashkeel</span>
              </h2>
              <p className="text-[11px] text-[#DCE5D3]">
                Refine Arabic spelling or diacritics (التشكيل) for clearer pronunciation
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              stopArabicSpeech();
              onClose();
            }}
            aria-label="Close editor"
            className="rounded-lg p-1.5 text-[#DCE5D3] hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {errorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
              {errorMsg}
            </div>
          )}

          {/* Quick Tashkeel Helper Bar */}
          <div className="rounded-xl border border-[#DCE5D3] bg-[#EEF2E9]/70 px-3.5 py-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-semibold text-[#2D3B22]">
                Quick Tashkeel · <span className="font-arabic-cairo">أدوات التشكيل السريع</span>
              </span>
              <button
                type="button"
                onClick={clearMarksInActiveField}
                className="inline-flex items-center gap-1 rounded-lg border border-[#DCE5D3] bg-white px-2 py-0.5 text-[11px] font-medium text-[#5A6552] hover:text-[#1F2718] cursor-pointer"
                title="Remove tashkeel from the active Arabic field"
              >
                <Eraser className="h-3 w-3" aria-hidden="true" />
                <span>Clear marks</span>
              </button>
            </div>
            <div dir="rtl" className="flex flex-wrap items-center gap-1.5">
              {TASHKEEL_BUTTONS.map((btn) => (
                <button
                  key={btn.labelEn}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertTashkeelMark(btn.mark)}
                  title={`Insert ${btn.labelEn}`}
                  className="font-arabic-scheherazade inline-flex min-w-[36px] items-center justify-center rounded-lg border border-[#DCE5D3] bg-white px-2.5 py-1 text-lg font-bold text-[#1F2718] hover:border-[#2D3B22] hover:bg-[#FBF3DC] transition-colors cursor-pointer"
                >
                  {btn.labelAr}
                </button>
              ))}
            </div>
          </div>

          {/* Standalone Arabic Word */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="edit-word-ar"
                className="text-xs font-semibold text-[#2D3B22] flex items-center gap-1.5"
              >
                <span>Arabic Word</span>
                <span className="text-[#9A6F14] font-arabic-cairo">· الكلمة العربية</span>
              </label>
              <button
                type="button"
                onClick={() => handlePreviewAudio(wordAr, 'word')}
                disabled={previewPhase === 'loading'}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  previewTarget === 'word'
                    ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FACC15]'
                    : 'border-[#DCE5D3] bg-white text-[#9A6F14] hover:bg-[#FBF3DC]'
                }`}
              >
                {previewTarget === 'word' && previewPhase === 'loading' ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-3 w-3" aria-hidden="true" />
                )}
                <span>Test Audio · استمع</span>
              </button>
            </div>
            <input
              id="edit-word-ar"
              ref={wordInputRef}
              type="text"
              dir="rtl"
              lang="ar"
              value={wordAr}
              onFocus={() => {
                activeTargetRef.current = { kind: 'word' };
              }}
              onChange={(e) => {
                setWordAr(e.target.value);
                setErrorMsg(null);
              }}
              className="font-arabic-scheherazade w-full rounded-xl border border-[#DCE5D3] bg-white px-4 py-2.5 text-3xl font-bold text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
            />
          </div>

          {/* Meaning & Transliteration */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="edit-meaning-en" className="block text-xs font-semibold text-[#2D3B22]">
                English Meaning
              </label>
              <input
                id="edit-meaning-en"
                type="text"
                value={englishMeaning}
                onChange={(e) => setEnglishMeaning(e.target.value)}
                className="w-full rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 text-sm text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="edit-translit" className="block text-xs font-semibold text-[#2D3B22]">
                Transliteration
              </label>
              <input
                id="edit-translit"
                type="text"
                dir="ltr"
                value={transliteration}
                onChange={(e) => setTransliteration(e.target.value)}
                className="w-full rounded-xl border border-[#DCE5D3] bg-white px-3.5 py-2 font-mono text-sm text-[#1F2718] focus:border-[#2D3B22] focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15"
              />
            </div>
          </div>

          {/* Example Sentences & Diacritics */}
          <div className="space-y-3 border-t border-[#DCE5D3] pt-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-[#2D3B22]">
                  Example Sentences &amp; Diacritics · <span className="font-arabic-cairo text-[#9A6F14]">تشكيل الجمل التوضيحية</span>
                </p>
                <p className="text-[11px] text-[#5A6552]">
                  Saving clears old cached audio so pronunciation reflects your updated text &amp; tashkeel.
                </p>
              </div>
              {examples.length < 3 && (
                <button
                  type="button"
                  onClick={() =>
                    setExamples((prev) => [
                      ...prev,
                      { arabic: wordAr.trim(), english: '', contextLabel: 'Custom Example' },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-[#DCE5D3] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#2D3B22] hover:bg-[#EEF2E9] cursor-pointer"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  <span>Add Example</span>
                </button>
              )}
            </div>

            {examples.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#DCE5D3] bg-white px-4 py-4 text-center text-xs text-[#5A6552]">
                No example sentences yet. Click &ldquo;Add Example&rdquo; to write one.
              </div>
            ) : (
              <div className="space-y-3">
                {examples.map((ex, idx) => {
                  const isPlayingEx = previewTarget === idx;
                  return (
                    <div
                      key={idx}
                      className="rounded-xl border border-[#DCE5D3] bg-white p-3.5 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-bold text-[#9A6F14]">
                          Example 0{idx + 1}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handlePreviewAudio(ex.arabic, idx)}
                            disabled={previewPhase === 'loading' || !ex.arabic.trim()}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                              isPlayingEx
                                ? 'border-[#2D3B22] bg-[#2D3B22] text-[#FACC15]'
                                : 'border-[#DCE5D3] bg-[#FAFBF8] text-[#9A6F14] hover:bg-[#FBF3DC]'
                            }`}
                          >
                            {isPlayingEx && previewPhase === 'loading' ? (
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Volume2 className="h-3 w-3" aria-hidden="true" />
                            )}
                            <span>Test · استمع</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setExamples((prev) => prev.filter((_, i) => i !== idx))
                            }
                            aria-label={`Remove example ${idx + 1}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#6B7861] hover:bg-[#FEF2E8] hover:text-[#C2410C] cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <textarea
                        ref={(el) => {
                          exampleRefs.current[idx] = el;
                        }}
                        rows={2}
                        dir="rtl"
                        lang="ar"
                        value={ex.arabic}
                        onFocus={() => {
                          activeTargetRef.current = { kind: 'example', index: idx };
                        }}
                        onChange={(e) => {
                          const val = e.target.value;
                          setExamples((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, arabic: val } : item
                            )
                          );
                        }}
                        placeholder="أدخل الجملة العربية مع التشكيل..."
                        className="font-arabic-scheherazade w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3.5 py-2 text-xl leading-[2.0] text-[#1F2718] focus:border-[#2D3B22] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2D3B22]/15 resize-none"
                      />

                      <input
                        type="text"
                        dir="ltr"
                        value={ex.english}
                        onChange={(e) => {
                          const val = e.target.value;
                          setExamples((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, english: val } : item
                            )
                          );
                        }}
                        placeholder="English translation..."
                        className="w-full rounded-xl border border-[#DCE5D3] bg-[#FAFBF8] px-3 py-1.5 text-xs text-[#5A6552] focus:border-[#2D3B22] focus:bg-white focus:outline-none"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-[#DCE5D3] pt-4">
            <button
              type="button"
              onClick={() => {
                stopArabicSpeech();
                onClose();
              }}
              className="rounded-xl border border-[#DCE5D3] bg-white px-4 py-2 text-xs font-semibold text-[#5A6552] hover:bg-[#EEF2E9] hover:text-[#1F2718] cursor-pointer"
            >
              إلغاء · Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2D3B22] to-[#3B4D2B] px-5 py-2 text-xs font-bold text-white shadow-sm hover:brightness-110 transition-all cursor-pointer"
            >
              <Check className="h-3.5 w-3.5 text-[#FACC15]" aria-hidden="true" />
              <span>حفظ التعديلات · Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
